---
name: board-task
description: >-
  Drive a Board task's lifecycle: turn a ticket into a request, decompose it into tasks,
  start and finish work, and keep status, branch, PR and presence up to date. Use when
  picking up a ticket, starting or finishing a task, or when asked to work a Board item.
  Applies the statuses, transitions and playbook loaded by the board-workflow skill.
---

# Board — task lifecycle

Runtime policy comes from `get_workflow` (loaded by the **board-workflow** skill). Apply
this project's statuses, transitions and playbook — do not invent states.

## Turn a ticket into work

1. For every ticket you pick up, `create_request` and set its `type` (e.g. `bug` / `feature`).
2. Break it into tasks per the playbook (by context / layer). `create_task` per unit of work.

## Start a task

3. Move it to the workflow's in-progress status (`change_task_status`).
4. `set_task_branch` — branch `{type}/{slug}` per the playbook.
5. `record_work_note` with kind `started` and a one-line summary.

## Presence — declare that you are working

While actively working a task, make yourself visible so Board can show you online:

6. `start_session` (executionId + taskId) once when you begin.
7. `heartbeat_task` (taskId) periodically (~every 30s).
8. `end_session` (taskId) when you stop.

If you stop pinging, the task shows stale, then offline, on its own.

## Finish a task

9. Open the PR and `set_task_pull_request`.
10. Move to the in-review / terminal status, respecting transitions
    (`in_progress → in_review` needs a `change_request` artifact).
11. `record_work_note` with kind `finished`.
12. Then refresh the report per cadence → skill **board-report**.
