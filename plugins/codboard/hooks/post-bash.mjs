#!/usr/bin/env node
// PostToolUse(Bash) — record dev milestones (branch created or pushed, PR
// opened, code committed) in the ledger so the Stop hook can check they were
// mirrored to CodBoard, and nudge Claude to sync each milestone once, the
// moment it happens.
//
// Detection is deliberately wider than "the command that creates a branch".
// A branch reaches a forge by being pushed at least as often as by being
// created, and in a Claude Code web session the branch usually exists before
// the first turn — so `git push` on a non-default branch is itself a
// milestone, resolved from git rather than parsed out of the command.
import {
  readStdin,
  readConfig,
  readState,
  writeState,
  resolveBranch,
  markPending,
  markWork,
  markMergeSettled,
  MERGE_COMMAND_RE,
  nudgesFor,
  emitNudges,
  emit,
} from './lib.mjs';

// Creation forms, including the capitalised variants (`checkout -B`, `switch
// -C`) the harness itself prescribes when restarting a branch from a fresh base.
const CREATE_RE = /\bgit\s+(?:checkout\s+-[bB]|switch\s+(?:-[cC]|--create|--force-create))\s+(\S+)/;
const BRANCH_CMD_RE = /\bgit\s+branch\s+(?![-\s])(\S+)/;
const PUSH_UPSTREAM_RE = /\bgit\s+push\b[^|;&]*?\s(?:-u|--set-upstream)\s+\S+\s+(\S+)/;
const PUSH_RE = /\bgit\s+push\b/;
// Any command that can move HEAD or publish it: re-resolve rather than parse.
const BRANCH_TOUCH_RE = /\bgit\s+(?:checkout|switch|branch|push|worktree)\b/;
const COMMIT_RE = /\bgit\s+commit\b/;
const PR_OPEN_RE = /\bgh\s+pr\s+create\b/;

function parsedBranchName(command) {
  const match =
    command.match(CREATE_RE) || command.match(BRANCH_CMD_RE) || command.match(PUSH_UPSTREAM_RE);
  return match ? match[1] : undefined;
}

function applyBranch(state, input, command) {
  if (BRANCH_TOUCH_RE.test(command)) state.branch = resolveBranch(input) || state.branch;

  const parsed = parsedBranchName(command);
  if (parsed) return markPending(state, 'branch', parsed);

  // A push only owes CodBoard a branch when it publishes a work branch.
  const onWorkBranch = state.branch && state.branch.isDefault === false;
  if (PUSH_RE.test(command) && onWorkBranch) markPending(state, 'branch', state.branch.name);
}

function apply(state, input, command) {
  applyBranch(state, input, command);
  if (COMMIT_RE.test(command)) markWork(state);
  if (PR_OPEN_RE.test(command)) markPending(state, 'pr', undefined);
  if (MERGE_COMMAND_RE.test(command)) markMergeSettled(state);
}

function main() {
  const input = readStdin();
  if (!readConfig(input)) emit(undefined); // not a CodBoard repo -> no-op

  const command = (input.tool_input && input.tool_input.command) || '';
  if (!command) emit(undefined);

  const state = readState(input);
  apply(state, input, command);
  const nudges = nudgesFor(state);
  writeState(input, state);
  emitNudges(nudges);
}

try {
  main();
} catch {
  process.exit(0);
}
