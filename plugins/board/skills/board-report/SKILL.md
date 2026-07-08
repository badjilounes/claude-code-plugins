---
name: board-report
description: >-
  Write and keep fresh the Board daily report for a project, following the project's
  reportPrompt and reporting cadence. Use when asked to write or refresh the daily report,
  or after finishing a task when the cadence requires it. Uses reportPrompt and
  automation.reportingCadence loaded by the board-workflow skill.
---

# Board — reporting

There is no scheduled cutoff — **you** produce the report; Board never generates it.

## WHAT to write

Follow the project's `reportPrompt` (from `get_workflow`) to the letter — it is THE
reporting guidance for this project (structure, tone, and the ticket / PR links it asks
for). It is user-configurable, so re-read it each session rather than assuming a fixed
format.

## WHEN to (re)generate — per `automation.reportingCadence`

Call `list_work_notes` for the current reporting day, then `upsert_report` to (re)write the
dated daily report for the project.

- **on_task_finished** (default) — regenerate right after each `record_work_note` "finished".
- **on_each_note** — regenerate after every work note, both "started" and "finished".
- **manual** — only regenerate when a comment or instruction asks for it.

`reportingTime` / `reportingTimezone` only date and window the report — they never trigger
anything.
