#!/usr/bin/env node
// PostToolUse(Bash) — record dev milestones (branch created, PR opened) in the
// ledger so the Stop hook can check they were mirrored to CodBoard, and nudge
// Claude to sync each milestone once, the moment it happens.
import { readStdin, readConfig, readState, writeState, emit } from './lib.mjs';

const BRANCH_RE = /\bgit\s+(?:checkout\s+-b|switch\s+-c|switch\s+--create)\s+(\S+)/;
const PR_OPEN_RE = /\bgh\s+pr\s+create\b/;

// Milestone -> the CodBoard tool that mirrors it (used in the nudge text).
const NUDGE = {
  branch: 'the branch is not yet on CodBoard — call `set_task_branch` and move the task to in_progress',
  pr: 'the PR is not yet on CodBoard — call `set_task_pull_request` (+ `attach_change_request`)',
};

function detect(command) {
  const events = [];
  const branch = command.match(BRANCH_RE);
  if (branch) events.push({ key: 'branch', detail: branch[1] });
  if (PR_OPEN_RE.test(command)) events.push({ key: 'pr', detail: undefined });
  return events;
}

function main() {
  const input = readStdin();
  if (!readConfig(input)) emit(undefined); // not a CodBoard repo -> no-op

  const command = (input.tool_input && input.tool_input.command) || '';
  const events = detect(command);
  if (events.length === 0) emit(undefined);

  const state = readState(input);
  state.pending = state.pending || {};
  state.nudged = state.nudged || {};

  const nudges = [];
  for (const ev of events) {
    const prev = state.pending[ev.key] || {};
    // never downgrade a synced milestone back to pending
    state.pending[ev.key] = {
      seen: true,
      synced: prev.synced === true,
      detail: ev.detail || prev.detail,
    };
    if (!state.pending[ev.key].synced && !state.nudged[ev.key]) {
      state.nudged[ev.key] = true;
      nudges.push(`CodBoard: ${NUDGE[ev.key]}.`);
    }
  }

  writeState(input, state);

  if (nudges.length === 0) emit(undefined);
  emit({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: nudges.join('\n'),
    },
  });
}

try {
  main();
} catch {
  process.exit(0);
}
