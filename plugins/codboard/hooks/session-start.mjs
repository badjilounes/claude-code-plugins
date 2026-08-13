#!/usr/bin/env node
// SessionStart — guarantee every session that opens a CodBoard-tracked repo
// knows it, without depending on a skill being triggered. Injects a pointer as
// additionalContext and resets the per-session sync ledger.
import { existsSync, writeFileSync } from 'node:fs';
import { readStdin, readConfig, statePath, projectDir, resolveBranch, emit } from './lib.mjs';

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
    '1. Read the configuration NOW, from THREE places — a workflow is a state machine and',
    '   nothing else. All of it is the SOURCE OF TRUTH, per-project and changing, so read it',
    '   at runtime and NEVER copy its values into CLAUDE.md or any repo file:',
    '   - `list_workflows` then `get_workflow({ workflowId })` — `statuses`, `transitions`',
    '     (their guards, and the proofs each one requires) and `playbook`. A ticket no rule',
    '     elects has NO workflow; the two below still apply.',
    '   - `get_project` — `reportPrompt`, `reportingCadence`',
    '     (on_task_finished|on_each_note|manual), `autoRun` (may you claim work, and under',
    '     which limits), `watch` { comments, pollHint }.',
    '   - `list_repositories` — per repository, `automation` { autoMergeMode, autoCreatePr,',
    '     ciCheckName }. Apply the policy of the repository the task belongs to: two',
    '     repositories of one project may answer differently.',
    '2. Push every dev milestone to CodBoard THE MOMENT it happens, not batched:',
    '   ticket picked up (`create_request` + `create_task` + `start_execution`),',
    '   branch created (`set_task_branch` + move to in_progress), PR opened',
    '   (`set_task_pull_request`), test plan (`add_test_step`), capture',
    '   (`create_media_upload`), done (`change_task_status` -> `complete_execution`),',
    '   report (`upsert_report`).',
    '   Branch and PR land on the execution timeline on their own — what only YOU can report',
    '   is what happened in between: `log_activity` (analysis, commands, tests) on the',
    '   `executionId` returned by `start_execution`.',
    '3. Auto-merge is a MANDATE, not a question: when the repository `autoMergeMode` is non-`none`',
    '   and its evidence is satisfied, MERGE the PR without asking the user to confirm — the',
    '   configured mode IS the authorization. Only `none` requires the owner to merge; an',
    '   unsatisfied barrier (e.g. CI red) means you do NOT merge and you fix/report it — you',
    '   still never ask "should I merge?".',
    '',
    'Enforcement: the turn is BLOCKED from ending while this session has changed code with no',
    'run open, while a created or pushed branch or an opened PR is unmirrored, or while the',
    'daily report is stale versus `reportingCadence`; and a merge that violates the repository',
    '`autoMergeMode` is blocked whether it goes through `gh pr merge` or the GitHub MCP server.',
    'Test plan and capture are no longer a local gate: when a transition requires them, the',
    'SERVER refuses the move — call `get_transition_policy` to see what is missing before you try.',
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
  // The branch is captured here because in a hosted session it is created by the
  // harness before the first turn — no command the hooks can observe ever makes
  // it, so a ledger that only learns branches from `git checkout -b` never sees
  // the one the work actually happens on.
  if (cfg) {
    try {
      const sp = statePath(input);
      writeFileSync(
        sp,
        JSON.stringify(
          {
            sessionId: input.session_id,
            workflowRead: false,
            branch: resolveBranch(input),
            pending: {},
            nudged: {},
          },
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
