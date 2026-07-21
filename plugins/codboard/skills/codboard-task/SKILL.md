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
this project's statuses, transitions and playbook — do not invent states. A project may hold
several named workflows, so resolve the one governing THIS task with
`get_workflow({ projectId, taskId })` and honour its per-transition **execution policy**
(codboard-workflow › "Transition execution policy") — the server enforces it.

## Turn a ticket into work

1. For every ticket you pick up, `create_request` and set its `type` (e.g. `bug` / `feature`).
2. Break it into tasks per the playbook (by context / layer). `create_task` per unit of work.

## Start a task

3. Move it to the workflow's in-progress status (`change_task_status`). If the transition
   pins an agent (`policy.agent.agentId`), pass your registered `agentId`; if it needs
   proofs or human approval, see **Governed transitions** below.
4. `set_task_branch` — branch `{type}/{slug}` per the playbook.
5. `record_work_note` with kind `started` and a one-line summary.

## Governed transitions

Before a `change_task_status`, read the target transition's policy (from the task's workflow).
The server refuses a move whose policy is not met, so satisfy it first:

- **Assigned agent** (`policy.agent.agentId`) — pass that id as `agentId` on `change_task_status`;
  another agent (or none) is refused with `forbidden`.
- **Proofs** (`policy.proofs`) — attach the branch, open the PR, and/or make tests green before
  the move. Under a `strict` transition a missing proof is refused (`invalid`).
- **Human approval** (`actor: human_approval`) — you propose, a human decides:
  1. `create_task_directive(taskId, kind: "approve_transition", payload: { toStatus })`.
  2. Wait — poll `list_task_directives(taskId)` (or `list_pending_directives`) until that
     directive is `resolved` (a human resolves it, or you keep working other tasks meanwhile).
  3. Then retry `change_task_status`; it now passes. An unapproved move is refused (`forbidden`).
- **Human-only** (`actor: human_only`) — do not attempt as an agent; comment to ask the human.

## Presence — declare that you are working

While actively working a task, make yourself visible so CodBoard can show you online:

6. `start_session` (executionId + taskId) once when you begin.
7. `heartbeat_task` (taskId) periodically (~every 30s).
8. `end_session` (taskId) when you stop.

If you stop pinging, the task shows stale, then offline, on its own.

## Finish a task

9. Open the PR and `set_task_pull_request`.
10. Move to the in-review / terminal status, respecting transitions
    (`in_progress → in_review` needs a `change_request` artifact) **and their execution
    policy** (proofs / assigned agent / human approval — see **Governed transitions**).
11. `record_work_note` with kind `finished`.
12. Attach a **test plan** so a human can replay and validate → see below.
13. Then refresh the report per cadence → skill **codboard-report**.

## Test plan (strongly recommended once work is done)

Describe how to test the task or request so a human can follow, replay and validate it.

- `add_test_step` once per ordered step: `targetType` (`task` | `request`), `targetId`,
  `instruction`, optional `expectedResult`, `position` for ordering, and `authorType: llm`.
  A human later moves each step's `status` `pending → passed | failed | skipped`.
- Attach proof as `media` (`{ kind: image | video, url, caption? }`). Host the media first
  (see below) so the `url` is one a browser can load.
- `list_test_steps` (`targetType` + `targetId`) reads the current plan;
  `update_test_step` (by `id`) edits a step — passing `media` **replaces** its whole set;
  `remove_test_step` (by `id`) drops a step and its media.

Summaries, descriptions and comments render as **markdown**: embed screenshots/videos inline
with `![alt](url)` (a `.mp4`/`.webm` URL renders as an inline player), so the captures show up
directly on the task and request pages.

## Hosting media (screenshots / videos)

The CodBoard web app renders media in a browser that has **no GitHub access** — a private-repo
URL or a CI-artifact URL will not load. Re-host such captures on CodBoard storage, then
reference the public URL. You are the bridge: you can read the repo/artifact, CodBoard cannot.

1. Bring the file into your workspace (you have repo/artifact read access — clone/checkout,
   `gh api`, or download the artifact).
2. `create_media_upload` with the file's `contentType` (e.g. `image/png`, `video/mp4`) → returns
   `{ uploadUrl, publicUrl, contentType, expiresInSeconds }` (a short-lived presigned R2 URL;
   CodBoard keeps the R2 credentials — you never handle them).
3. Upload the bytes yourself:
   `curl -X PUT -H "Content-Type: <contentType>" --upload-file <file> "<uploadUrl>"`.
4. Use `publicUrl` in a test step's `media` or inline markdown.

Never paste a private repo/artifact URL directly. An already-public, durable URL may be used
as-is without re-hosting.
