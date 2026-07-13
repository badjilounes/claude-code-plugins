#!/usr/bin/env node
// PostToolUse(mcp__*codboard*) — the ledger's write side. Two jobs:
//   1. Cache the whole per-project policy from get_workflow (the four config
//      areas: Workflow statuses, Automation, Testing, Report cadence) so the
//      Stop and merge hooks can enforce it without ever calling the API.
//   2. Record which milestones/obligations have been satisfied as the matching
//      codboard tools fire (branch, PR, test plan, capture, report, finish).
// Matched broadly on the tool-name suffix so it is robust to the MCP namespace
// prefix (mcp__codboard__, mcp__plugin_codboard_codboard__, ...).
import { readStdin, readConfig, readState, writeState, emit } from './lib.mjs';

function toolSuffix(toolName) {
  const parts = String(toolName || '').split('__');
  return parts[parts.length - 1] || '';
}

// Pull the workflow object out of the get_workflow response, whatever shape the
// harness wraps MCP output in (string, {content:[{text}]}, or the object itself).
function extractWorkflow(input) {
  const resp = input.tool_response ?? input.tool_output;
  const texts = [];
  const collect = (v) => {
    if (v == null) return;
    if (typeof v === 'string') texts.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (typeof v === 'object') {
      if (typeof v.text === 'string') texts.push(v.text);
      if (Array.isArray(v.content)) collect(v.content);
    }
  };
  collect(resp);
  const candidates = [];
  if (resp && typeof resp === 'object' && (resp.statuses || resp.automation || resp.testing)) {
    candidates.push(resp);
  }
  for (const t of texts) {
    try {
      candidates.push(JSON.parse(t));
    } catch {
      // not JSON — skip
    }
  }
  return candidates.find((c) => c && (c.statuses || c.automation || c.testing));
}

function cachePolicy(state, wf) {
  const a = (wf && wf.automation) || {};
  const t = (wf && wf.testing) || {};
  const cap = t.capture || {};
  const terminal = Array.isArray(wf.statuses)
    ? wf.statuses.filter((s) => s && (s.terminal === true || s.category === 'done')).map((s) => s.key).filter(Boolean)
    : [];
  state.policy = {
    autoMergeMode: a.autoMergeMode, // none | ci_green | local_ci_green | without_ci
    reportingCadence: a.reportingCadence || 'on_task_finished',
    testPlans: t.testPlans || 'never', // never | when_possible | always
    captureScreens: cap.screenshots || 'off', // off | when_possible | required
    captureVideo: cap.video || 'off',
    terminalStatuses: terminal.length ? terminal : ['done'],
  };
  state.workflowRead = true;
}

function main() {
  const input = readStdin();
  if (!readConfig(input)) emit(undefined); // not a CodBoard repo

  const suffix = toolSuffix(input.tool_name);
  const state = readState(input);
  state.pending = state.pending || {};
  state.done = state.done || {};

  if (suffix === 'get_workflow') {
    const wf = extractWorkflow(input);
    if (wf) cachePolicy(state, wf);
    else state.workflowRead = true; // it was read even if we could not parse the policy
    writeState(input, state);
    emit(undefined);
  }

  const cadence = (state.policy && state.policy.reportingCadence) || 'on_task_finished';
  const staleOnFinish = () => {
    state.finished = true;
    if (cadence !== 'manual') state.reportStale = true;
  };

  // milestone / obligation satisfied
  if (suffix === 'set_task_branch') state.pending.branch = { ...(state.pending.branch || { seen: true }), synced: true };
  else if (suffix === 'set_task_pull_request') state.pending.pr = { ...(state.pending.pr || { seen: true }), synced: true };
  else if (suffix === 'add_test_step') state.done.testPlan = true;
  else if (suffix === 'create_media_upload') state.done.capture = true;
  else if (suffix === 'upsert_report') state.reportStale = false;
  else if (suffix === 'complete_execution') staleOnFinish();
  else if (suffix === 'record_work_note') {
    if (cadence === 'on_each_note') state.reportStale = true;
    if (input.tool_input && input.tool_input.kind === 'finished') staleOnFinish();
  } else if (suffix === 'change_task_status') {
    const toStatus = input.tool_input && input.tool_input.toStatus;
    const terminal = (state.policy && state.policy.terminalStatuses) || ['done'];
    if (toStatus && terminal.includes(toStatus)) staleOnFinish();
  }

  writeState(input, state);

  // D1 (ADR 0044): a status change makes CodBoard's read-only remote mirrors
  // (the ticket status and the PR state) stale. The hook never reads the remote
  // nor calls the API — it reminds the agent, which IS connected, to redeclare
  // them so the badges stay fresh. CodBoard never reads the board/forge itself.
  if (suffix === 'change_task_status' || suffix === 'change_request_status') {
    emit({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          'CodBoard: status changed — redeclare the remote-board mirrors so the read-only badges stay fresh (ADR 0044). ' +
          'Read the current remote state with your own credentials, then declare it back: the ticket status via ' +
          '`update_request` (remoteStatus), and the pull-request state via `set_task_pull_request`. ' +
          'CodBoard never reads the board or forge itself.',
      },
    });
  }
  emit(undefined);
}

try {
  main();
} catch {
  process.exit(0);
}
