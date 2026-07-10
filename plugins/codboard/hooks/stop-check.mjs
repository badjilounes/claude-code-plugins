#!/usr/bin/env node
// Stop — the sync checkpoint. Blocks the turn from ending while an obligation
// from any of the four CodBoard config areas is unmet:
//   Workflow  — a created branch / opened PR was never mirrored.
//   Testing   — a task was finished but the project's test-plan / capture policy
//               (testing.testPlans: always, testing.capture: required) is unmet.
//   Report    — a task was finished (or a note logged) but the daily report was
//               not refreshed per automation.reportingCadence.
// The testing/report gates require the workflow to have been read this session
// (so an unknown policy never produces a surprise block); the branch/PR gates
// are always on. Loop-guarded via stop_hook_active.
import { readStdin, readConfig, readState, emit } from './lib.mjs';

function collect(state) {
  const issues = [];
  const pending = state.pending || {};
  const p = state.policy || {};
  const done = state.done || {};

  if (pending.branch && pending.branch.seen && !pending.branch.synced) {
    const d = pending.branch.detail ? ` (${pending.branch.detail})` : '';
    issues.push(`Workflow: a branch${d} was created but never mirrored — call \`set_task_branch\` and move the task to in_progress.`);
  }
  if (pending.pr && pending.pr.seen && !pending.pr.synced) {
    issues.push('Workflow: a PR was opened but never mirrored — call `set_task_pull_request`.');
  }

  if (state.workflowRead && state.finished) {
    if (p.testPlans === 'always' && !done.testPlan) {
      issues.push('Testing: `testing.testPlans: always` — attach a test plan before finishing (`add_test_step`).');
    }
    if ((p.captureScreens === 'required' || p.captureVideo === 'required') && !done.capture) {
      issues.push('Testing: `testing.capture: required` — attach a screenshot/video capture before finishing (`create_media_upload`).');
    }
  }

  if (state.workflowRead && state.reportStale && (p.reportingCadence || 'on_task_finished') !== 'manual') {
    issues.push(
      `Report: \`reportingCadence: ${p.reportingCadence || 'on_task_finished'}\` — refresh the dated daily report ` +
        '(`list_work_notes` then `upsert_report`).',
    );
  }

  return issues;
}

function main() {
  const input = readStdin();
  if (input.stop_hook_active === true) emit(undefined); // don't loop
  if (!readConfig(input)) emit(undefined); // not a CodBoard repo

  const issues = collect(readState(input));
  if (issues.length === 0) emit(undefined);

  emit({
    decision: 'block',
    reason:
      'CodBoard sync incomplete — satisfy these before finishing, then you may stop:\n- ' +
      issues.join('\n- '),
  });
}

try {
  main();
} catch {
  process.exit(0);
}
