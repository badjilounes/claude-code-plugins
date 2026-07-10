import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

// Shared helpers for the CodBoard enforcement hooks.
//
// Hard constraint: hook scripts run as plain OS processes. They have NO access
// to the MCP OAuth token, so they NEVER call the CodBoard API. All they do is
// read the committed pointer file (.codboard/config.json) and read/write a
// local, gitignored ledger (.codboard/session-state.json). Everything a hook
// needs to decide is derived from those two files plus the hook's stdin.

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
    autoMergeMode: undefined,
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
