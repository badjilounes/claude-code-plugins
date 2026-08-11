#!/usr/bin/env node
// PreToolUse(Bash) — enforce the project's merge policy. CodBoard's
// autoMergeMode of the repository being merged is the source of truth (cached from
// post-codboard). This guard only ever acts on a `gh pr merge`; every other
// Bash command passes through untouched.
import { execFileSync } from 'node:child_process';
import { readStdin, readConfig, readState, projectDir, emit } from './lib.mjs';

const MERGE_RE = /\bgh\s+pr\s+merge\b/;

function deny(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

function ask(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  });
}

function normalizeRepoUrl(url) {
  return String(url)
    .trim()
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

// The remote of the directory the merge is being run in, matched against the
// repositories cached from list_repositories. Unknown remote → unknown policy, which
// asks rather than assumes.
function mergeModeForCwd(state, input) {
  const modes = state.mergeModes || {};
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: projectDir(input),
      encoding: 'utf8',
    });
    return modes[normalizeRepoUrl(remote)];
  } catch {
    return undefined;
  }
}

function main() {
  const input = readStdin();
  if (!readConfig(input)) emit(undefined); // not a CodBoard repo

  const command = (input.tool_input && input.tool_input.command) || '';
  if (!MERGE_RE.test(command)) emit(undefined); // not a merge

  const state = readState(input);
  // The policy belongs to the repository being merged (ADR 0069), so match the one
  // this working directory actually is rather than answering for the whole project.
  const mode = mergeModeForCwd(state, input);

  if (mode === 'none') {
    deny(
      "CodBoard autoMergeMode is 'none' for this repository: the owner merges. Do " +
        'not merge without explicit owner approval — ask the owner to perform or ' +
        'request the merge.',
    );
  }

  if (!mode) {
    ask(
      'CodBoard tracks this repo but its merge policy has not been read this ' +
        'session. Call `list_repositories` and check the `automation.autoMergeMode` ' +
        'of this repository (and satisfy its CI evidence) before merging. Proceed anyway?',
    );
  }

  // ci_green / local_ci_green / without_ci: a configured non-none mode IS the
  // standing authorization to merge. Let it through with NO confirmation prompt
  // (never return 'ask' here) — the codboard-watch skill governs the CI evidence
  // and mandates merging without re-asking once it holds.
  emit(undefined);
}

try {
  main();
} catch {
  process.exit(0);
}
