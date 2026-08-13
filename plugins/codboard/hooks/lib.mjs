import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

// Shared helpers for the CodBoard enforcement hooks.
//
// Hard constraint: hook scripts run as plain OS processes. They have NO access
// to the MCP OAuth token, so they NEVER call the CodBoard API. All they do is
// read the committed pointer file (.codboard/config.json), shell out to the
// local git, and read/write a local, gitignored ledger
// (.codboard/session-state.json). Everything a hook needs to decide is derived
// from those plus the hook's stdin.

export function readStdin() {
  try {
    const raw = readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Resolve the project root the hook is acting on. CLAUDE_PROJECT_DIR is the
// authoritative signal; fall back to the stdin cwd, then process.cwd().
export function projectDir(input) {
  return (
    process.env.CLAUDE_PROJECT_DIR ||
    (input && input.cwd) ||
    process.cwd()
  );
}

export function configPath(input) {
  return join(projectDir(input), '.codboard', 'config.json');
}

export function statePath(input) {
  return join(projectDir(input), '.codboard', 'session-state.json');
}

// The repo is CodBoard-tracked iff the committed pointer exists. Every hook
// except SessionStart no-ops when it does not — so the plugin stays inert in
// repos that were never initialised with /codboard:init.
export function readConfig(input) {
  try {
    const p = configPath(input);
    if (!existsSync(p)) return undefined;
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
}

function emptyState(sessionId) {
  return {
    sessionId,
    workflowRead: false,
    mergeSettled: false,
    pending: {},
    nudged: {},
  };
}

// Read the ledger. Reset it whenever the session id changes so stale milestones
// from a previous session never gate the current one.
export function readState(input) {
  const sessionId = input && input.session_id;
  try {
    const p = statePath(input);
    if (!existsSync(p)) return emptyState(sessionId);
    const state = JSON.parse(readFileSync(p, 'utf8'));
    if (sessionId && state.sessionId && state.sessionId !== sessionId) {
      return emptyState(sessionId);
    }
    return { ...emptyState(sessionId), ...state };
  } catch {
    return emptyState(sessionId);
  }
}

export function writeState(input, state) {
  try {
    const p = statePath(input);
    // .codboard/ already exists (config.json lives there); guard anyway.
    if (!existsSync(dirname(p))) return;
    writeFileSync(p, JSON.stringify(state, undefined, 2));
  } catch {
    // never fail a session because the ledger could not be written
  }
}

// Emit a hook result and exit. `payload` undefined -> silent no-op (exit 0).
export function emit(payload) {
  if (payload !== undefined) process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

// --- git -------------------------------------------------------------------

// A fresh clone (every Claude Code web session is one) has no
// refs/remotes/origin/HEAD, so the default branch cannot be resolved from the
// remote. Without this list every branch would look like the default one and
// the branch gate would silently never arm.
const FALLBACK_DEFAULT_BRANCHES = ['main', 'master', 'develop', 'trunk'];

function git(input, args) {
  try {
    return execFileSync('git', args, {
      cwd: projectDir(input),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

// The branch the working directory is on, and whether it is the repo's default.
// Detached HEAD yields undefined: there is no branch to mirror.
export function resolveBranch(input) {
  const name = git(input, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!name || name === 'HEAD') return undefined;
  const head = git(input, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const remoteDefault = head ? head.replace(/^origin\//, '') : undefined;
  const isDefault = remoteDefault
    ? name === remoteDefault
    : FALLBACK_DEFAULT_BRANCHES.includes(name);
  return { name, isDefault };
}

export function remoteUrl(input) {
  return git(input, ['config', '--get', 'remote.origin.url']);
}

// --- merge -----------------------------------------------------------------

// The two ways a merge actually happens: the CLI, and the GitHub MCP server a
// hosted session has instead of it. Shared, so the guard that stops a forbidden
// merge and the ledger that notices a due one can never disagree on what counts
// as merging.
export const MERGE_COMMAND_RE = /\bgh\s+pr\s+merge\b/;
export const MERGE_TOOLS = new Set(['merge_pull_request', 'enable_pr_auto_merge']);

// A PR opened under a non-`none` policy owes the session an outcome. Merging is
// one; reporting a barrier that did not hold is the other. Both settle it —
// what the Stop gate refuses is silence, not a red CI.
export function markMergeSettled(state) {
  state.mergeSettled = true;
}

export function normalizeRepoUrl(url) {
  return String(url)
    .trim()
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

// --- ledger writes ---------------------------------------------------------

// Never downgrade a milestone that was already mirrored: the codboard tool may
// fire before the git command that produced it is observed.
export function markPending(state, key, detail) {
  state.pending = state.pending || {};
  const prev = state.pending[key] || {};
  state.pending[key] = {
    seen: true,
    synced: prev.synced === true,
    detail: detail || prev.detail,
  };
}

export function markSynced(state, key) {
  state.pending = state.pending || {};
  const prev = state.pending[key] || {};
  state.pending[key] = { ...prev, seen: true, synced: true };
}

// The session produced code. Also arms the branch gate: a work branch that was
// never created by an observed command (the harness makes one before the first
// turn) is still a branch that owes CodBoard a `set_task_branch`.
export function markWork(state) {
  markPending(state, 'work', undefined);
  if (state.branch && state.branch.isDefault === false) {
    markPending(state, 'branch', state.branch.name);
  }
}

// --- nudges ----------------------------------------------------------------

const MILESTONE_NUDGE = {
  work: 'this session is changing code with no run open — `create_request` + `create_task` + `start_execution` now, so the work lands on the board as it happens instead of being reconstructed afterwards',
  branch: 'the branch is not yet on CodBoard — call `set_task_branch` and move the task to in_progress',
  pr: 'the PR is not yet on CodBoard — call `set_task_pull_request` (it lands on the execution timeline on its own)',
};

// One nudge per milestone per session: repeating it every turn trains the model
// to skim past it. Mutates `state.nudged`, so the caller must persist after.
export function nudgesFor(state) {
  const nudges = [];
  state.nudged = state.nudged || {};
  for (const key of ['work', 'branch', 'pr']) {
    const entry = (state.pending || {})[key];
    if (!entry || !entry.seen || entry.synced || state.nudged[key]) continue;
    if (key === 'work' && state.executionOpen === true) continue;
    state.nudged[key] = true;
    nudges.push(`CodBoard: ${MILESTONE_NUDGE[key]}.`);
  }
  return nudges;
}

export function emitNudges(nudges) {
  if (nudges.length === 0) emit(undefined);
  emit({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: nudges.join('\n'),
    },
  });
}

// --- MCP response parsing --------------------------------------------------

// MCP output reaches the hook wrapped differently depending on the harness: a
// raw object, a JSON string, or {content:[{text}]}. Collect every plausible
// payload — top level AND one level of nesting, since servers commonly answer
// {project: {...}} or {repositories: [...]} rather than the bare value.
export function extractPayloads(input) {
  const roots = [];
  const texts = [];
  const collect = (v) => {
    if (v == null) return;
    if (typeof v === 'string') texts.push(v);
    else if (Array.isArray(v)) {
      roots.push(v);
      v.forEach(collect);
    } else if (typeof v === 'object') {
      roots.push(v);
      if (typeof v.text === 'string') texts.push(v.text);
      if (Array.isArray(v.content)) collect(v.content);
    }
  };
  collect(input.tool_response ?? input.tool_output);
  for (const t of texts) {
    try {
      roots.push(JSON.parse(t));
    } catch {
      // not JSON — skip
    }
  }
  const candidates = [];
  for (const r of roots) {
    candidates.push(r);
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      for (const v of Object.values(r)) {
        if (v && typeof v === 'object') candidates.push(v);
      }
    }
  }
  return candidates;
}

// Each caller brings its own shape test rather than sharing one loose
// heuristic: a predicate that matches three different payloads matches the
// wrong one eventually, and does it silently.
export function pick(candidates, predicate) {
  return candidates.find((c) => {
    try {
      return predicate(c);
    } catch {
      return false;
    }
  });
}
