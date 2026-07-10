#!/usr/bin/env node
// PostToolUse(mcp__*codboard*) — clear ledger milestones as they get mirrored,
// and cache automation.autoMergeMode from get_workflow so the merge guard can
// enforce it. Matched broadly on the tool-name suffix so it is robust to the
// MCP namespace prefix (mcp__codboard__, mcp__plugin_codboard_codboard__, ...).
import { readStdin, readConfig, readState, writeState, emit } from './lib.mjs';

// tool-name suffix -> ledger milestone it satisfies
const CLEARS = {
  set_task_branch: 'branch',
  set_task_pull_request: 'pr',
};

function toolSuffix(toolName) {
  const parts = String(toolName || '').split('__');
  return parts[parts.length - 1] || '';
}

function extractAutoMergeMode(input) {
  // Best-effort: MCP tool output is a JSON string nested in a content array.
  // Regex-scan the raw stringified response rather than assume a shape.
  const blob = JSON.stringify(input.tool_response ?? input.tool_output ?? '');
  const m = blob.match(/autoMergeMode\\?"\s*:\s*\\?"(none|ci_green|local_ci_green|without_ci)\\?"/);
  return m ? m[1] : undefined;
}

function main() {
  const input = readStdin();
  if (!readConfig(input)) emit(undefined);

  const suffix = toolSuffix(input.tool_name);
  const state = readState(input);
  state.pending = state.pending || {};

  if (suffix === 'get_workflow') {
    state.workflowRead = true;
    const mode = extractAutoMergeMode(input);
    if (mode) state.autoMergeMode = mode;
    writeState(input, state);
    emit(undefined);
  }

  const milestone = CLEARS[suffix];
  if (milestone) {
    state.pending[milestone] = { ...(state.pending[milestone] || { seen: true }), synced: true };
    writeState(input, state);
  }
  emit(undefined);
}

try {
  main();
} catch {
  process.exit(0);
}
