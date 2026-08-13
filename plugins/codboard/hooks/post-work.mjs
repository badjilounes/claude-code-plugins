#!/usr/bin/env node
// PostToolUse(Edit|Write|...) — the existence gate.
//
// Every other gate in this plugin checks that a milestone was *mirrored*: a
// branch was created, so declare it; a PR was opened, so declare it. None of
// them checks that the work exists on the board at all. That leaves a legal
// path straight through the plugin — edit files, commit, push, stop — with no
// request, no task, no execution, and nothing to block on. This hook closes it
// by recording that the session actually produced code, so Stop can refuse to
// end a turn whose work was never opened as a CodBoard run.
import {
  readStdin,
  readConfig,
  readState,
  writeState,
  resolveBranch,
  markWork,
  nudgesFor,
  emitNudges,
  emit,
} from './lib.mjs';

function main() {
  const input = readStdin();
  if (!readConfig(input)) emit(undefined); // not a CodBoard repo -> no-op

  const state = readState(input);
  // The branch is usually resolved at SessionStart; resolve here too so a
  // branch switched into mid-session still arms the branch gate.
  if (!state.branch) state.branch = resolveBranch(input);

  markWork(state);
  const nudges = nudgesFor(state);
  writeState(input, state);
  emitNudges(nudges);
}

try {
  main();
} catch {
  process.exit(0);
}
