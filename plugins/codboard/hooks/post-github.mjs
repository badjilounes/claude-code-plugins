#!/usr/bin/env node
// PostToolUse(mcp__*github*) — the same milestone ledger as post-bash, for the
// path that actually gets used.
//
// Claude Code web sessions have no `gh` CLI: branches, pull requests and file
// writes go through the GitHub MCP server. A plugin that only watches Bash is
// blind in the environment it is most often installed in, so every forge
// milestone is recorded here too.
import {
  readStdin,
  readConfig,
  readState,
  writeState,
  resolveBranch,
  markPending,
  markWork,
  markMergeSettled,
  MERGE_TOOLS,
  extractPayloads,
  pick,
  nudgesFor,
  emitNudges,
  emit,
} from './lib.mjs';

function toolSuffix(toolName) {
  const parts = String(toolName || '').split('__');
  return parts[parts.length - 1] || '';
}

const PR_OPEN = new Set(['create_pull_request', 'create_pull_request_with_copilot']);
const BRANCH_OPEN = new Set(['create_branch']);
const WRITES = new Set(['push_files', 'create_or_update_file', 'delete_file']);

// The PR number is only used to make the nudge and the Stop message concrete;
// nothing gates on it, so any failure to find it is harmless.
function pullRequestDetail(input) {
  const pr = pick(extractPayloads(input), (c) => typeof c.number === 'number' && (c.html_url || c.head));
  return pr ? `#${pr.number}` : undefined;
}

function branchDetail(input, state) {
  const asked = input.tool_input && (input.tool_input.branch || input.tool_input.new_branch);
  if (asked) return String(asked);
  return state.branch && state.branch.isDefault === false ? state.branch.name : undefined;
}

function apply(state, input, suffix) {
  if (PR_OPEN.has(suffix)) markPending(state, 'pr', pullRequestDetail(input));
  if (BRANCH_OPEN.has(suffix)) markPending(state, 'branch', branchDetail(input, state));
  if (WRITES.has(suffix)) markWork(state);
  if (MERGE_TOOLS.has(suffix)) markMergeSettled(state);
}

function main() {
  const input = readStdin();
  if (!readConfig(input)) emit(undefined); // not a CodBoard repo -> no-op

  const suffix = toolSuffix(input.tool_name);
  if (!PR_OPEN.has(suffix) && !BRANCH_OPEN.has(suffix) && !WRITES.has(suffix) && !MERGE_TOOLS.has(suffix)) {
    emit(undefined);
  }

  const state = readState(input);
  if (!state.branch) state.branch = resolveBranch(input);

  apply(state, input, suffix);
  const nudges = nudgesFor(state);
  writeState(input, state);
  emitNudges(nudges);
}

try {
  main();
} catch {
  process.exit(0);
}
