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

## Take work from the queue (auto-run)

A project can hand out work instead of you picking a ticket by hand. Call
**`claim_next_task({ projectId, claimedBy })`**: CodBoard decides whether there is something
you may take, and for how long you hold it.

- `{ task, reason: "claimed" }` — it is yours until `task.leaseExpiresAt`. Work it like any
  other task (start → branch → proofs → finish).
- `reason: "auto_run_off"` — this project does not hand out work. **Stop asking**; pick tickets
  the usual way.
- `reason: "max_concurrent_reached"` — the project's ceiling is reached. Try later.
- `reason: "nothing_claimable"` — the queue is empty right now.

Two agents never receive the same task: the claim is atomic. If you give up before finishing,
`queue_task({ id, queued: false })` returns it to the queue immediately instead of waiting for
the lease to expire. `queue_task({ id, queued: true })` sends a task to the queue.

The policy lives in `autoRun` on the project (`get_project`) (`mode` off | on_demand |
eligible, `leaseMinutes`, `maxConcurrent`, `statuses`) — read it, never assume it. CodBoard
never starts you: you ask, it answers.

## Turn a ticket into work

1. For every ticket you pick up, `create_request` and set its `type` (e.g. `bug` / `feature`).
2. State what the work will have to prove **before** decomposing it: `add_acceptance_criterion`
   ({ requestId, given?, when?, then }) once per criterion. Each gets a stable handle (`AC1`,
   `AC2`, …) that is never reused, so a criterion can be cited in a PR, a test step or a report
   and still mean the same thing later. `list_acceptance_criteria` reads them back.
3. Break it into tasks per the playbook (by context / layer). `create_task` per unit of work.

## Start a task

4. `start_execution` ({ requestId, changedByType: `llm`, `agentClient`, `agentModel`,
   `agentMode` }) — this opens **your run** and returns an `executionId`. Keep it for the whole
   ticket: presence, activity and artifacts all hang off it. See **Declare your run** below for
   what it buys you.
5. Move it to the workflow's in-progress status (`change_task_status`). Check the move first
   with `get_transition_policy` if it may need proofs or human approval — see **Governed
   transitions** below.
6. `set_task_branch` — branch `{type}/{slug}` per the playbook.
7. `record_work_note` with kind `started` and a one-line summary.

## Declare your run

CodBoard already records the **milestones** your task lifecycle declares: `set_task_branch` and
`set_task_pull_request` become branch / pull-request proofs on their own — you never re-attach
them by hand. What only you can report is **what happened in between**, so log it as you go on
the `executionId` from step 4:

- `log_activity({ executionId, taskId, type, summary })` — `analysis_started`,
  `files_changed`, `command_executed`, `tests_started`, `tests_passed`, `tests_failed`,
  `review_requested`, `note`, `error`. One line each, at the moment it happens.
- `attach_commit({ executionId, taskId, sha, url })` for a commit worth citing.
- `complete_execution({ executionId })` when the work lands, `fail_execution({ executionId,
  summary })` when you give up — a run left open reads as still running forever.

Say only what you did. An event you did not observe is not evidence.

## Governed transitions

Before a `change_task_status`, call **`get_transition_policy({ id, toStatus, reason? })`**:
it changes nothing and returns `missing` (everything the move still lacks) and `wouldBlock`.
The server refuses a move whose policy is not met, so satisfy what it lists first:

- **Proofs** (`policy.proofs`) — attach the branch, open the PR, make tests green and/or settle
  the request's acceptance criteria before the move. Under a `strict` transition a missing proof
  is refused (`invalid`).
- **Human approval** (`actor: human_approval`) — you propose, a human decides:
  1. `create_task_directive(taskId, kind: "approve_transition", payload: { toStatus })`.
  2. Wait — poll `list_task_directives(taskId)` (or `list_pending_directives`) until that
     directive is `resolved` (a human resolves it, or you keep working other tasks meanwhile).
  3. Then retry `change_task_status`; it now passes. An unapproved move is refused (`forbidden`).
- **Human-only** (`actor: human_only`) — do not attempt as an agent; comment to ask the human.
- **Agent-only** (`actor: agent_only`) — the mirror case: a human is refused on that edge, you
  are not. Cross it as usual.

## Presence — declare that you are working

While actively working a task, make yourself visible so CodBoard can show you online:

8. `start_session` (the `executionId` from step 4 + taskId) once when you begin.
9. `heartbeat_task` (taskId) periodically (~every 30s).
10. `end_session` (taskId) when you stop.

If you stop pinging, the task shows stale, then offline, on its own.

## Finish a task

11. Open the PR and `set_task_pull_request` — that alone puts the pull request on the run's
    timeline; there is nothing else to attach.
12. Move to the in-review / terminal status, respecting transitions
    (`in_progress → in_review` needs a `change_request` artifact) **and their execution
    policy** (proofs / human approval — see **Governed transitions**).
13. Settle every acceptance criterion of the request — `update_acceptance_criterion` with
    `verified` only when a proof backs it, `failed` when you proved it does not hold, `waived`
    with a reason when it was dropped. Never leave one `pending`: that is what
    `policy.proofs.acceptanceCriteria` checks, and it is the honest record of what the work
    actually proved.
14. `record_work_note` with kind `finished`.
15. Attach a **test plan** so a human can replay and validate, with a proof of the nature
    the technology demands → see below.
16. `complete_execution` (or `fail_execution`) to close your run.
17. Then refresh the report per cadence → skill **codboard-report**.

## Prove what the technology demands

A capture is judged on **what it shows**, not on its mere presence: a screenshot proves
nothing about an API, and a response body proves nothing about a screen. The **technology of
the repository** (`list_repositories` → `technology`) decides the nature of the proof a
transition's `capture` accepts, and the tool that produces it:

| Technology | Tool | What to attach |
| --- | --- | --- |
| `frontend` | Playwright | a screenshot, or a video when the behaviour only exists in motion |
| `backend` | cURL | the response itself — status line and body, as returned |
| `mobile` | Maestro | a screenshot, or a video for a flow that spans screens |
| `mcp` | an LLM call | the response the tool returned, verbatim |
| `documentation` | the rendered document | the content a reader sees — the interpreted rendering for a `.md`, not the raw source |
| `monorepo` | discovery | nothing by itself: see below |

Never guess it: `get_transition_policy({ id, toStatus })` answers `proofExpectation`
{ `technologies`, `declared`, `natures`, `recipes` [{ `tool`, `instruction` }] } — what is
expected, and how to produce it, before you try.

**A repository typed `monorepo` has no technology of its own.** CodBoard never sees your
files, so only you can say which apps the change touches: read the diff, then
`set_task_technologies({ id, technologies: ["frontend", "backend", …] })`. Until you do,
`proofExpectation.declared` is `false` and the move is refused for a reason that names the
missing declaration — that refusal is how the discovery gets done. Every technology you
declare then demands a proof of **its** nature.

A ticket typed `docs` elects `documentation` whatever the repository produces: what it ships
is the document, and what proves it is the document's content.

## Test plan (strongly recommended once work is done)

Describe how to test the task or request so a human can follow, replay and validate it.

- `add_test_step` once per ordered step: `targetType` (`task` | `request`), `targetId`,
  `instruction`, optional `expectedResult`, `position` for ordering, and `authorType: llm`.
  A human later moves each step's `status` `pending → passed | failed | skipped`.
- Attach proof as `media`. What is **looked at** lives behind a URL —
  `{ kind: image | video, url, caption? }`, hosted per the section below so a browser can
  load it. What is **read** is its own text: `{ kind: "text", content, caption? }` carries a
  cURL response, an LLM answer or a rendered document, and nothing is hosted for it.
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
