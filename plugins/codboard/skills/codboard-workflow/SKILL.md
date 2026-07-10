---
name: codboard-workflow
description: >-
  Load and drive the CodBoard LLM task-tracking workflow for this repository — become its
  watcher. Use at the start of any session that works CodBoard tickets, or when asked to
  watch the board, act as the board watcher, connect this repo to CodBoard, or process a
  ticket. Loads the per-project workflow (statuses, transitions, playbook, automation,
  reporting guidance) via get_workflow and orchestrates the codboard-task, codboard-watch and
  codboard-report skills.
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
2. `get_workflow` for that project. Read the whole definition and keep it for the session:
   - **statuses / transitions** — the state machine you must stay within.
   - **playbook** — how to decompose a request and drive work (events `request.created`,
     `task.started`, `task.finished`).
   - **automation** — `{ autoMergeMode, ciCheckName, watch { comments, pollHint }, reportingCadence }`
     — the policy you apply. Never hardcode it; it is per-project and can change.
   - **reportPrompt** — the user-configured reporting guidance you MUST follow.

These runtime values parameterize everything below. Re-read them each session rather than
assuming a fixed shape.

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
