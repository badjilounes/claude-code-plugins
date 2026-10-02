---
name: codboard-task
description: >-
  Drive a CodBoard task's lifecycle in one `sync_milestone` call per milestone: pick up a
  ticket (request, acceptance criteria, tasks, run), then declare branch, PR, test plan with
  captures, verdicts, status and finish — syncing at milestones only, never in between. Use when picking up a ticket, starting or finishing a task,
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

## Sync at milestones — one `sync_milestone` call each

CodBoard is a record of **milestones**, not a running commentary. Every milestone below is
**one** `sync_milestone` call, made the moment it happens; between milestones you make **no**
CodBoard call. Each field you pass runs through the same API command as its single-purpose tool
(same guards, same audit), in a fixed order that puts proofs **before** the status move they
unlock: request → acceptance criteria → tasks → run → technologies → branch → PR → activities →
test steps → criterion verdicts → status → work note → complete the run.

`actorType` defaults to `llm`. `taskId` defaults to the first task the call created and
`executionId` to the run it opened, so the pick-up call needs neither.

### 1. Ticket picked up

```
sync_milestone({
  projectId,
  request: { title, type: "bug" | "feature" | …, externalUrl?, description?, priority? },
  acceptanceCriteria: [{ given?, when?, then }, …],   // BEFORE decomposing — what the work must prove
  tasks: [{ title, repositoryId?, … }, …],            // per the playbook (by context / layer)
  startExecution: { agentClient, agentModel, agentMode }
})
```

Keep what it returns for the whole session: `requestId`, `criteria` (`id` + stable handle `AC1`,
`AC2`, … — never reused, so a criterion can be cited in a PR, a test step or a report),
`tasks` (`id` each) and `executionId` (your run: presence, activity and artifacts hang off it).
Picking up an existing request? Pass `requestId` instead of `request`.

### 2. Branch created — the task starts

```
sync_milestone({
  taskId, branch: { name, url },                      // `{type}/{slug}` per the playbook
  technologies?: ["frontend", "backend", …],          // mandatory on a `monorepo` repository
  status: { to: "<in-progress status>" },
  note: { kind: "started", summary: "<one line>" }
})
```

### 3. PR opened — the task goes to review

Write the test plan and produce the capture **before** this call (see below), so they ride it:

```
sync_milestone({
  taskId, executionId,
  pullRequest: { url, status: "open" },               // its body already carries the backlink
  activities: [{ type: "tests_passed", summary: "nx affected -t lint test build" }],
  testSteps: [{ instruction, expectedResult?, status?, criterionKeys?: ["AC1"], media? }, …],
  criterionVerdicts: [{ criterionId, status: "verified" | "failed" | "waived", waivedReason? }],
  status: { to: "<in-review status>" }
})
```

### 4. Done — merged (or abandoned)

```
sync_milestone({
  taskId, executionId,
  pullRequest: { url, status: "merged" },
  status: { to: "<terminal status>" },
  note: { kind: "finished", summary: "<one line>" },
  completeExecution: { summary? }                    // last task of the run only
})
```

Then refresh the report per cadence → skill **codboard-report**. Giving up instead:
`fail_execution({ executionId, summary })` — a run left open reads as still running forever.

### When a step is refused

The first failing step stops the call. The answer says what is `done` (it is recorded — **do
not** resend it), the `failed` step with the server's reason, and what was `skipped`. Fix the
cause (`get_transition_policy` names what a move lacks) and resend **only** the remaining fields.

### What happens between milestones

Nothing, on CodBoard. Branch and PR become proofs on the run on their own; what only you can
report — the test outcome, a notable command, an error — rides the **next** milestone as
`activities` (`analysis_started`, `files_changed`, `command_executed`, `tests_started`,
`tests_passed`, `tests_failed`, `commit_created`, `review_requested`, `note`, `error`). Say only
what you did: an event you did not observe is not evidence.

The single-purpose tools (`set_task_branch`, `change_task_status`, `add_test_step`,
`update_acceptance_criterion`, `log_activity`, …) remain for corrections and for what the
grouped call does not cover — `attach_commit`, `fail_execution`, directives, media upload.

## Governed transitions

Before a move that carries proofs or a human actor (read once from `get_workflow`), call
**`get_transition_policy({ id, toStatus, reason? })`**: it changes nothing and returns `missing`
(everything the move still lacks) and `wouldBlock`. An unguarded move needs no dry-run — and a
refused `status` inside `sync_milestone` already names what is missing. The server refuses a
move whose policy is not met, so satisfy what it lists first:

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

## Presence — optional

`start_session` / `heartbeat_task` / `end_session` show you online on a task. They cost one
call each, every ping: use them only when a human is watching the task live or when you hold a
lease from `claim_next_task` you must keep fresh — and then ping at milestones, not on a timer.
A task you stop pinging shows stale, then offline, on its own.

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

- Send the steps in the PR-opened milestone's `testSteps` (ordered as listed, targeted at the
  task): `instruction`, optional `expectedResult`, `criterionKeys` it covers, `status`, `media`.
  A human later moves each step's `status` `pending → passed | failed | skipped`. A plan on the
  **request** rather than a task is the one case for `add_test_step` (`targetType: request`).
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
