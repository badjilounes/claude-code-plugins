---
name: codboard-task
description: >-
  Drive a CodBoard task's lifecycle: turn a ticket into a request, decompose it into tasks,
  start and finish work, attach a test plan with media captures, and keep status, branch,
  PR and presence up to date. Use when picking up a ticket, starting or finishing a task,
  writing a test plan, or when asked to work a CodBoard item. Applies the statuses, transitions
  and playbook loaded by the codboard-workflow skill.
---

# CodBoard — task lifecycle

Runtime policy comes from `get_workflow` (loaded by the **codboard-workflow** skill). Apply
this project's statuses, transitions and playbook — do not invent states.

## Turn a ticket into work

1. For every ticket you pick up, `create_request` and set its `type` (e.g. `bug` / `feature`).
2. Break it into tasks per the playbook (by context / layer). `create_task` per unit of work.

## Start a task

3. Move it to the workflow's in-progress status (`change_task_status`).
4. `set_task_branch` — branch `{type}/{slug}` per the playbook.
5. `record_work_note` with kind `started` and a one-line summary.

## Presence — declare that you are working

While actively working a task, make yourself visible so CodBoard can show you online:

6. `start_session` (executionId + taskId) once when you begin.
7. `heartbeat_task` (taskId) periodically (~every 30s).
8. `end_session` (taskId) when you stop.

If you stop pinging, the task shows stale, then offline, on its own.

## Finish a task

9. Open the PR and `set_task_pull_request`.
10. Move to the in-review / terminal status, respecting transitions
    (`in_progress → in_review` needs a `change_request` artifact).
11. `record_work_note` with kind `finished`.
12. Attach a **test plan** so a human can replay and validate → see below.
13. Then refresh the report per cadence → skill **codboard-report**.

## Test plan (strongly recommended once work is done)

Describe how to test the task or request so a human can follow, replay and validate it.

- `add_test_step` once per ordered step: `targetType` (`task` | `request`), `targetId`,
  `instruction`, optional `expectedResult`, `position` for ordering, and `authorType: llm`.
  A human later moves each step's `status` `pending → passed | failed | skipped`.
- Attach proof as `media` — **external URLs only** (`{ kind: image | video, url, caption? }`);
  CodBoard stores the URL, never the bytes.
- `list_test_steps` (`targetType` + `targetId`) reads the current plan;
  `update_test_step` (by `id`) edits a step — passing `media` **replaces** its whole set;
  `remove_test_step` (by `id`) drops a step and its media.

Summaries, descriptions and comments render as **markdown**: embed screenshots/videos inline
with `![alt](https://…/shot.png)` (a `.mp4`/`.webm` URL renders as an inline player), so the
captures show up directly on the task and request pages.
