#!/usr/bin/env node
// SessionStart — guarantee every session that opens a CodBoard-tracked repo
// knows it, without depending on a skill being triggered. Injects a pointer as
// additionalContext and resets the per-session sync ledger.
import { existsSync, writeFileSync } from 'node:fs';
import { readStdin, readConfig, statePath, projectDir, emit } from './lib.mjs';

function trackedContext(cfg) {
  const id = (v) => (v ? String(v) : 'unknown');
  return [
    'This repository is tracked on CodBoard (the LLM task-tracking layer).',
    `- project: ${id(cfg.projectName)} (${id(cfg.projectId)})`,
    `- repository: ${id(cfg.repositoryName)} (${id(cfg.repositoryId)})`,
    `- workflow: ${id(cfg.workflowId)}`,
    cfg.boardUrl ? `- board: ${cfg.boardUrl}` : undefined,
    '',
    'Sync is MANDATORY and STRONG for this repo.',
    '1. Call `get_workflow` NOW and follow all FOUR config areas it returns — they',
    '   are the SOURCE OF TRUTH, per-project and changing, so read them at runtime',
    '   and NEVER copy their values into CLAUDE.md or any repo file:',
    '   - Workflow: `statuses` / `transitions` (guarded) / `playbook`.',
    '   - Automation: `autoMergeMode`, `watch`, `autoCreatePr`, `ciCheckName`.',
    '   - Testing: `testing.testPlans` (never|when_possible|always) and',
    '     `testing.capture.{screenshots,video}` (off|when_possible|required).',
    '   - Report: `reportPrompt` + `automation.reportingCadence`',
    '     (on_task_finished|on_each_note|manual).',
    '2. Push every dev milestone to CodBoard THE MOMENT it happens, not batched:',
    '   ticket picked up (`create_request` + `create_task` + `start_execution`),',
    '   branch created (`set_task_branch` + move to in_progress), PR opened',
    '   (`set_task_pull_request`), test plan (`add_test_step`), capture',
    '   (`create_media_upload`), done (`change_task_status` -> `complete_execution`),',
    '   report (`upsert_report`).',
    '3. Do not merge a PR unless `automation.autoMergeMode` allows it and you have',
    '   satisfied its evidence; when it is `none`, the owner merges.',
    '',
    'Enforcement (local hooks, deterministic): the turn is BLOCKED from ending while',
    '- a created branch / opened PR is unmirrored (Workflow),',
    "- a finished task lacks a test plan when `testing.testPlans: always`, or a",
    '  capture when `testing.capture: required` (Testing),',
    '- the daily report is stale versus `reportingCadence` (Report);',
    'and a `gh pr merge` that violates `autoMergeMode` is blocked (Automation).',
    'Keep all four in sync to avoid being blocked.',
  ]
    .filter((l) => l !== undefined)
    .join('\n');
}

function untrackedContext() {
  return [
    'The CodBoard plugin is active but this repository is not initialised for it',
    '(no `.codboard/config.json`). If work here should be tracked on CodBoard,',
    'run `/codboard:init` to bind this repo to its CodBoard project — otherwise',
    'ignore this notice.',
  ].join('\n');
}

function main() {
  const input = readStdin();
  const cfg = readConfig(input);

  // Reset the ledger for the new session (best-effort; only if .codboard exists).
  if (cfg) {
    try {
      const sp = statePath(input);
      writeFileSync(
        sp,
        JSON.stringify(
          { sessionId: input.session_id, workflowRead: false, pending: {}, nudged: {} },
          undefined,
          2,
        ),
      );
    } catch {
      // ignore
    }
  }

  // Only speak up on a fresh/cleared session, not on every resume, to avoid noise.
  const source = input.source || 'startup';
  const isFresh = source === 'startup' || source === 'clear';

  let additionalContext;
  if (cfg) {
    additionalContext = trackedContext(cfg);
  } else if (isFresh && existsSync(projectDir(input) + '/.git')) {
    additionalContext = untrackedContext();
  }

  if (!additionalContext) emit(undefined);
  emit({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  });
}

try {
  main();
} catch {
  process.exit(0);
}
