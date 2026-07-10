#!/usr/bin/env node
// PreToolUse(Bash) — enforce the project's merge policy. CodBoard's
// automation.autoMergeMode is the source of truth (cached from get_workflow by
// post-codboard). This guard only ever acts on a `gh pr merge`; every other
// Bash command passes through untouched.
import { readStdin, readConfig, readState, emit } from './lib.mjs';

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

function main() {
  const input = readStdin();
  if (!readConfig(input)) emit(undefined); // not a CodBoard repo

  const command = (input.tool_input && input.tool_input.command) || '';
  if (!MERGE_RE.test(command)) emit(undefined); // not a merge

  const state = readState(input);
  const mode = (state.policy && state.policy.autoMergeMode) ?? state.autoMergeMode;

  if (mode === 'none') {
    deny(
      "CodBoard workflow automation.autoMergeMode is 'none' for this project: " +
        'the owner merges. Do not merge without explicit owner approval — ask the ' +
        'owner to perform or request the merge.',
    );
  }

  if (!mode || !state.workflowRead) {
    ask(
      'CodBoard tracks this repo but the merge policy has not been read this ' +
        'session. Call `get_workflow` and check `automation.autoMergeMode` (and ' +
        'satisfy its CI evidence) before merging. Proceed anyway?',
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
