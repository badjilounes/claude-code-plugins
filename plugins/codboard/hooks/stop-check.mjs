#!/usr/bin/env node
// Stop — the sync checkpoint. Blocks the turn from ending while a recorded dev
// milestone (branch created, PR opened) has not been mirrored to CodBoard. This
// is what turns "please keep the board in sync" from a hope into a guarantee.
import { readStdin, readConfig, readState, emit } from './lib.mjs';

const MESSAGES = {
  branch: (d) =>
    `a branch${d ? ` (${d})` : ''} was created but never mirrored — call ` +
    '`set_task_branch` and move the task to in_progress',
  pr: () => 'a PR was opened but never mirrored — call `set_task_pull_request`',
};

function main() {
  const input = readStdin();

  // Guard against an infinite Stop loop: if a Stop hook already blocked this
  // turn, let the turn end regardless.
  if (input.stop_hook_active === true) emit(undefined);

  if (!readConfig(input)) emit(undefined); // not a CodBoard repo

  const state = readState(input);
  const pending = state.pending || {};

  const unsynced = Object.keys(pending)
    .filter((k) => pending[k] && pending[k].seen && !pending[k].synced)
    .map((k) => (MESSAGES[k] ? MESSAGES[k](pending[k].detail) : k));

  if (unsynced.length === 0) emit(undefined);

  emit({
    decision: 'block',
    reason:
      'CodBoard sync incomplete — mirror these milestones before finishing, ' +
      'then you may stop:\n- ' +
      unsynced.join('\n- '),
  });
}

try {
  main();
} catch {
  process.exit(0);
}
