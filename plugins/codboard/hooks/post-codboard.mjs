#!/usr/bin/env node
// PostToolUse(mcp__*codboard*) — the ledger's write side. Two jobs:
//   1. Cache the policy from its three sources — get_workflow, get_project and
//      list_repositories (ADR 0069) — so the Stop and merge hooks can enforce
//      it without ever calling the API.
//   2. Record which milestones/obligations have been satisfied as the matching
//      codboard tools fire (run opened, branch, PR, report, finish).
// Matched broadly on the tool-name suffix so it is robust to the MCP namespace
// prefix (mcp__codboard__, mcp__plugin_codboard_codboard__, ...).
import {
  readStdin,
  readConfig,
  readState,
  writeState,
  markSynced,
  extractPayloads,
  pick,
  normalizeRepoUrl,
  emit,
} from './lib.mjs';

function toolSuffix(toolName) {
  const parts = String(toolName || '').split('__');
  return parts[parts.length - 1] || '';
}

// Each reader brings its own shape test. One shared heuristic across three
// different payloads eventually matches the wrong one — and does it silently,
// which is how a gate ends up permanently disarmed with nothing in the logs.
const IS_WORKFLOW = (c) => Boolean(c.statuses || c.transitions || c.playbook);
const IS_PROJECT = (c) => Boolean(c.reportingCadence || c.reportPrompt || c.autoRun || c.watch);
const IS_REPOSITORIES = (c) =>
  Array.isArray(c) && c.some((r) => r && typeof r === 'object' && typeof r.url === 'string');

// The configuration comes from three tools (ADR 0069): the workflow says where
// a ticket may go, the project says how the report is written and when, and
// each repository says how its own pull requests may land.
function cacheWorkflow(state, wf) {
  const statuses = Array.isArray(wf && wf.statuses) ? wf.statuses : [];
  const terminal = statuses
    .filter((s) => s && (s.terminal === true || s.category === 'done'))
    .map((s) => s.key)
    .filter(Boolean);
  state.policy = {
    ...(state.policy || {}),
    terminalStatuses: terminal.length ? terminal : ['done'],
  };
  state.workflowRead = true;
}

function cacheProject(state, project) {
  state.policy = {
    ...(state.policy || {}),
    reportingCadence: (project && project.reportingCadence) || 'on_task_finished',
  };
  // Set even when the payload could not be parsed: the project WAS read, and
  // the cadence falls back to the strict default. Leaving it unset would turn
  // an unrecognised response shape into a silently disabled report gate.
  state.projectRead = true;
}

// Keyed by repository URL: the merge guard answers for one repository at a
// time. A project-wide answer would either forbid a merge the docs repo allows,
// or allow one the API repo forbids.
function cacheRepositories(state, repositories) {
  const byUrl = {};
  for (const repo of repositories || []) {
    if (repo && typeof repo.url === 'string' && repo.automation) {
      byUrl[normalizeRepoUrl(repo.url)] = repo.automation.autoMergeMode || 'none';
    }
  }
  state.mergeModes = byUrl;
  state.repositoriesRead = true;
}

const READERS = {
  get_workflow: (state, payloads) => cacheWorkflow(state, pick(payloads, IS_WORKFLOW)),
  get_project: (state, payloads) => cacheProject(state, pick(payloads, IS_PROJECT)),
  list_repositories: (state, payloads) => cacheRepositories(state, pick(payloads, IS_REPOSITORIES)),
};

// Tools that can only be called with an executionId (or that return one) prove
// a run exists for this session's work — which is what the Stop existence gate
// is asking for.
const OPENS_RUN = new Set(['start_execution', 'log_activity', 'attach_commit', 'complete_execution']);

function applyMilestone(state, input, suffix) {
  const cadence = (state.policy && state.policy.reportingCadence) || 'on_task_finished';
  const staleOnFinish = () => {
    state.finished = true;
    if (cadence !== 'manual') state.reportStale = true;
  };

  if (OPENS_RUN.has(suffix)) {
    state.executionOpen = true;
    markSynced(state, 'work');
  }

  if (suffix === 'set_task_branch') markSynced(state, 'branch');
  else if (suffix === 'set_task_pull_request') markSynced(state, 'pr');
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
}

function main() {
  const input = readStdin();
  if (!readConfig(input)) emit(undefined); // not a CodBoard repo

  const suffix = toolSuffix(input.tool_name);
  const state = readState(input);
  state.pending = state.pending || {};

  const reader = READERS[suffix];
  if (reader) {
    reader(state, extractPayloads(input));
    writeState(input, state);
    emit(undefined);
  }

  applyMilestone(state, input, suffix);
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
