#!/usr/bin/env node
// Stop — the sync checkpoint. Blocks the turn from ending while an obligation
// from any of the four CodBoard config areas is unmet:
//   Workflow  — a created branch / opened PR was never mirrored.
//   Report    — a task was finished (or a note logged) but the daily report was
//               not refreshed per the project reportingCadence.
// Test plan and capture are NOT gated here since ADR 0069: when a transition requires
// them the server refuses the move, and a local gate that duplicates a server rule can
// only disagree with it. The report gate requires the project to have been read this
// session (so an unknown cadence never produces a surprise block); the branch/PR gates
// are always on. Loop-guarded via stop_hook_active.
import { readStdin, readConfig, readState, emit } from './lib.mjs';

function collect(state) {
  const issues = [];
  const pending = state.pending || {};
  const p = state.policy || {};


  if (pending.branch && pending.branch.seen && !pending.branch.synced) {
    const d = pending.branch.detail ? ` (${pending.branch.detail})` : '';
    issues.push(`Workflow: a branch${d} was created but never mirrored — call \`set_task_branch\` and move the task to in_progress.`);
  }
  if (pending.pr && pending.pr.seen && !pending.pr.synced) {
    issues.push('Workflow: a PR was opened but never mirrored — call `set_task_pull_request`.');
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
