---
name: codboard-workflow
description: >-
  Load and drive the CodBoard LLM task-tracking workflow for this repository — become its
  watcher. Use at the start of any session that works CodBoard tickets, or when asked to
  watch the board, act as the board watcher, connect this repo to CodBoard, or process a
  ticket. Loads the state machine via list_workflows / get_workflow, and the project and
  repository policies that go with it (report, work queue, watch, merge)
  and orchestrates the codboard-task, codboard-watch and codboard-report skills.
---

# CodBoard watcher

You drive this repository's work through **CodBoard**, our LLM task-tracking layer. The
`codboard` MCP tools are already available — this plugin provides the server, so you do
**not** need to add an MCP server or paste any setup prompt.

## At the start of every session — load the workflow

1. Resolve the project. If this repo has been initialised (`/codboard:init`), read
   `.codboard/config.json` at the repo root and use its `projectId` / `repositoryId`
   directly — that committed pointer is the binding, don't re-guess. It names no workflow:
   there is no such thing as *the* workflow of a repository (step 2 elects one). Only
   if it is missing, `list_projects` and pick the project this repository belongs to (and
   suggest running `/codboard:init` to make the binding permanent). Remember its `projectId`.
2. Read the configuration from **three** places. A workflow is a state machine and nothing
   else — the rest of the policy lives where it is true:
   - **`list_workflows({ projectId })` then `get_workflow({ workflowId })`** — a project holds
     several named workflows and **no default**. Pass `requestType` / `taskId` to read the one
     governing a specific ticket, and check `resolvedBy` to know which it picked; with no
     discriminant the call may legitimately return **nothing**, and a ticket no rule elects is
     simply ungoverned. You get **statuses / transitions** (the state machine you must stay
     within; each transition may carry an **execution policy** the server ENFORCES — read it
     before a move) and the **playbook** (how to decompose and drive work).
   - **`get_project({ id })`** — `reportPrompt` (the reporting guidance you MUST follow, always
     returned in its effective form), `reportingCadence`, `autoRun` (the work queue) and
     `watch` { comments, pollHint }. These are the project's, whatever workflow governs a ticket.
   - **`list_repositories({ projectId })`** — per repository, `automation` { `autoMergeMode`,
     `autoCreatePr`, `ciCheckName` }. Apply the policy of **the repository the task belongs
     to**: two repositories of one project may answer differently, and `ciCheckName` names a
     check of one of them.

These runtime values parameterize everything below. Re-read them each session rather than
assuming a fixed shape. When you work a specific task, resolve its workflow with
`get_workflow({ projectId, taskId })` so you read the right transition policy.

## The loop

While you have active tasks on this project:

- **Pick up / decompose / drive tasks** → skill **codboard-task**.
- **Watch comments & apply auto-merge** → skill **codboard-watch**.
- **Keep the day's report fresh** → skill **codboard-report**.

## State-machine invariants

- Only follow a transition that exists in this workflow.
- `in_progress → in_review` requires a `change_request` artifact.
- `→ blocked` requires a reason.
- CodBoard never reads your CI and never merges — **you** do, then record it (see codboard-watch).

## Transition execution policy — the server enforces it

A transition can carry a `policy` and an `actor`. On `change_task_status` the server now
**refuses** (not just advises) a move whose policy is not satisfied. Never discover that by
being refused: call **`get_transition_policy({ id, toStatus, reason? })`** first — it changes
nothing and answers what the move demands and what is still missing:

```
{ mode, actor, requires, proofs, performRoles,
  missing: ["branch", "pull request", "green tests", "settled acceptance criteria"],  // in reporting order
  approvalGranted, wouldBlock }
```

`missing` is your remaining definition of done for that move; `wouldBlock` tells you whether
the move would be refused as things stand. Pass the `reason` you intend to send, since a
`requires.reason` guard is only satisfiable at call time. Then act on what you read — a
refusal comes back as an error (`forbidden` = you may not; `invalid` = the world isn't ready
yet):

- **`actor: human_only`** — only a human can cross it. As an agent, do **not** attempt it;
  leave a comment asking the human to move it.
- **`actor: agent_only`** — the mirror case: the edge is automated and a human is refused on
  it. Nothing changes for you — cross it as usual.
- **`actor: human_approval`** — you *propose*, a human approves before it takes effect. Create
  an approval directive and wait (see codboard-task), then retry.
- **`policy.human.perform`** — restricts which project roles (admin/editor/viewer) may perform
  the move. Enforced from the authenticated caller, not something you can set.
- **`policy.proofs` { branch, pullRequest, tests, acceptanceCriteria }** — required observed
  evidence before the move. Under a `strict` transition a missing proof **blocks**; under
  `advisory` it is only audited. Attach the branch / open the PR / make tests green first.
  `acceptanceCriteria` is satisfied once the request carries at least one criterion and none
  is left `pending` or `failed` — settle each one (`update_acceptance_criterion`) rather than
  closing the ticket over an unanswered criterion. A `waived` criterion counts as settled,
  since it already carries its reason.

## Auto-run — does this project hand out work?

`autoRun` on the **project** (`get_project`) says whether an agent may claim work from its
queue, and how:

- **`mode`** — `off` (default: nothing is claimable) | `on_demand` (only tasks a human queued)
  | `eligible` (any task sitting in one of `statuses`).
- **`leaseMinutes`** — how long a claim holds before the task returns to the queue (30 by default).
- **`maxConcurrent`** — ceiling on tasks held simultaneously across the project.
- **`statuses`** — which statuses are claimable in `eligible` mode.

Enforced server-side: claiming is refused when the mode is `off` or the ceiling is reached.
CodBoard never starts an agent and never reassigns a task — see codboard-task › "Take work
from the queue".
