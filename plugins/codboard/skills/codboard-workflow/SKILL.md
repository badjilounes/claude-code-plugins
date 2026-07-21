---
name: codboard-workflow
description: >-
  Load and drive the CodBoard LLM task-tracking workflow for this repository — become its
  watcher. Use at the start of any session that works CodBoard tickets, or when asked to
  watch the board, act as the board watcher, connect this repo to CodBoard, or process a
  ticket. Loads the per-project workflow (statuses, transitions, playbook, automation,
  reporting guidance, and the per-transition execution policy) via get_workflow / list_workflows
  and orchestrates the codboard-task, codboard-watch and codboard-report skills.
---

# CodBoard watcher

You drive this repository's work through **CodBoard**, our LLM task-tracking layer. The
`codboard` MCP tools are already available — this plugin provides the server, so you do
**not** need to add an MCP server or paste any setup prompt.

## At the start of every session — load the workflow

1. Resolve the project. If this repo has been initialised (`/codboard:init`), read
   `.codboard/config.json` at the repo root and use its `projectId` / `workflowId` /
   `repositoryId` directly — that committed pointer is the binding, don't re-guess. Only
   if it is missing, `list_projects` and pick the project this repository belongs to (and
   suggest running `/codboard:init` to make the binding permanent). Remember its `projectId`.
2. `get_workflow` for that project. A project can hold **several named workflows** (e.g. a
   default, a `support` one). `get_workflow({ projectId })` returns the project default;
   pass `workflowId`, or `requestType` / `taskId`, to read the one governing a specific
   ticket, and check `resolvedBy` to know which it picked. `list_workflows({ projectId })`
   enumerates them all (id, name, slug, isDefault, bound request types, counts). Read the
   whole definition and keep it for the session:
   - **statuses / transitions** — the state machine you must stay within. Each transition may
     carry an **execution policy** the server ENFORCES (see below) — read it before a move.
   - **playbook** — how to decompose a request and drive work (events `request.created`,
     `task.started`, `task.finished`).
   - **automation** — `{ autoCreatePr, autoMergeMode, ciCheckName, watch { comments, pollHint }, reportingCadence }`
     — the policy you apply. Never hardcode it; it is per-project and can change.
   - **reportPrompt** — the user-configured reporting guidance you MUST follow.

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
**refuses** (not just advises) a move whose policy is not satisfied. Read the policy first and
act accordingly — a refusal comes back as an error (`forbidden` = you may not; `invalid` =
the world isn't ready yet):

- **`actor: human_only`** — only a human can cross it. As an agent, do **not** attempt it;
  leave a comment asking the human to move it.
- **`actor: human_approval`** — you *propose*, a human approves before it takes effect. Create
  an approval directive and wait (see codboard-task), then retry.
- **`policy.human.perform` / `.approve`** — restricts which project roles (admin/editor/viewer)
  may perform/approve. Enforced from the authenticated caller, not something you can set.
- **`policy.agent.agentId`** — the transition is pinned to one registered agent. Pass that
  agent's id as `agentId` on `change_task_status`; another agent is refused.
- **`policy.agent.capabilities` / `.execution`** — **guidance only**, never blocking
  (capabilities are matching, not a security boundary). Use them to pick the right agent.
- **`policy.proofs` { branch, pullRequest, tests }** — required observed evidence before the
  move. Under a `strict` transition a missing proof **blocks**; under `advisory` it is only
  audited. Attach the branch / open the PR / make tests green first.
