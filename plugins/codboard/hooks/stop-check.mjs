#!/usr/bin/env node
// Stop — the sync checkpoint. Blocks the turn from ending while an obligation
// from the CodBoard config areas is unmet:
//   Existence — the session changed code but never opened a run for it.
//   Workflow  — a created/pushed branch or an opened PR was never mirrored.
//   Report    — a task was finished (or a note logged) but the daily report was
//               not refreshed per the project reportingCadence.
// Test plan and capture are NOT gated here since ADR 0069: when a transition
// requires them the server refuses the move, and a local gate that duplicates a
// server rule can only disagree with it. The report gate requires the project to
// have been read this session (so an unknown cadence never produces a surprise
// block); the existence and branch/PR gates are always on. Loop-guarded via
// stop_hook_active.
import { readStdin, readConfig, readState, emit } from './lib.mjs';

// The existence gate comes first because it is the one the others assume.
// Mirroring a branch is meaningless if no task was ever opened to mirror it
// onto — and a session that edits, commits and pushes without a run used to
// satisfy every gate this hook had.
function existenceIssue(state) {
  const work = (state.pending || {}).work;
  if (!work || !work.seen || state.executionOpen === true) return undefined;
  return (
    'Existence: this session changed code but no CodBoard run covers it — ' +
    '`create_request` (+ `add_acceptance_criterion`), `create_task`, then `start_execution`. ' +
    'Work that is not on the board did not happen, as far as the audit trail is concerned.'
  );
}

function collect(state) {
  const issues = [];
  const pending = state.pending || {};
  const p = state.policy || {};

  const existence = existenceIssue(state);
  if (existence) issues.push(existence);

  if (pending.branch && pending.branch.seen && !pending.branch.synced) {
    const d = pending.branch.detail ? ` (${pending.branch.detail})` : '';
    issues.push(`Workflow: a branch${d} was created or pushed but never mirrored — call \`set_task_branch\` and move the task to in_progress.`);
  }
  if (pending.pr && pending.pr.seen && !pending.pr.synced) {
    const d = pending.pr.detail ? ` (${pending.pr.detail})` : '';
    issues.push(`Workflow: a PR${d} was opened but never mirrored — call \`set_task_pull_request\`.`);
  }

  if (state.projectRead && state.reportStale && (p.reportingCadence || 'on_task_finished') !== 'manual') {
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
