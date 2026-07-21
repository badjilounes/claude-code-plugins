---
name: codboard-watch
description: >-
  Run the CodBoard watch loop — drain the two inboxes (comments and agent directives) and act
  on them, and apply the project's auto-create / auto-merge policy to task PRs. Use when
  watching the board, polling for new comments or directives, or deciding whether to open or
  merge a task's PR. Uses the automation policy loaded by the codboard-workflow skill.
---

# CodBoard — watch loop

Loop while you have active tasks; follow `automation.watch.pollHint` (from `get_workflow`)
for cadence. Each poll drains **two inboxes** — comments (free-form) and directives
(structured) — then applies the **standing policy** (config). CodBoard records intentions and
your declarations; **it never touches the forge** — you execute (ADR 0007/0010).

## Comments — free-form inbox

For each task / request you handle, re-read its comments with `list_comments`. When a new
comment asks for something, do it, then reflect the result on CodBoard — a status change, a
reply comment, or a work note.

## Directives — structured inbox (the one-off trigger)

Call `list_pending_directives(projectId)` each poll. A directive is a recorded intention you
execute, then resolve:

- **`create_pr`** on a task — open the PR yourself (e.g. `gh pr create`, base = the
  repository main branch), declare it with
  `set_task_pull_request({ pullRequestUrl, pullRequestStatus: "open" })` + attach a
  `change_request` artifact, then `resolve_task_directive(id)`.
- **`merge_pr`** (only ever recorded when the PR is open) — verify CI exactly as
  `automation.autoMergeMode` requires (see below), `gh pr merge`, declare
  `set_task_pull_request({ pullRequestStatus: "merged" })`, move the task to the terminal
  status, then `resolve_task_directive(id)`. Attach the same `ci` evidence as an auto-merge.
- **`approve_transition`** — a governed transition awaiting **human** approval (you proposed
  it). Do **not** resolve it yourself — a human decides. Skip it in the drain loop and keep
  polling; once a human resolves it, retry the `change_task_status` it gates.
- Use `cancel_task_directive(id)` for a directive that should no longer run.

Request-level mass actions (`fan_out_request_directives`) simply fan these out to every
eligible task; drain the resulting per-task directives the same way.

## Standing policy — `automation.autoCreatePr` + `automation.autoMergeMode`

The config is the **permanent trigger** — the same execution as a directive, driven by policy
instead of a one-off ask. If `automation.autoCreatePr` is true, open the PR for each ready
task without one (as above) without waiting for a directive.

Then apply `automation.autoMergeMode` to each task whose PR is open.

CodBoard never reads your CI and never merges — **you** do.

**A configured non-`none` `autoMergeMode` IS the user's standing authorization to merge.**
The moment the mode's evidence (below) is satisfied, **merge the PR — do not stop to ask the
user "should I merge?"**. The project set this mode precisely so a satisfied auto-merge
happens on its own; turning it into a confirmation question defeats the config. Ask only when
the mode is `none` (the owner merges) or when the evidence is **not** satisfied — and even
then you don't ask *whether to merge*, you don't merge: you report/fix why the barrier failed
(e.g. CI red).

In every non-`none` case, once the evidence holds, you merge the PR yourself (e.g.
`gh pr merge`), attach a `ci` artifact with source `observed` on the task's execution, then
move the task to the workflow's terminal status; CodBoard records the merge.

- **none** — never auto-merge; the owner merges.
- **ci_green** — check the remote CI in your environment (`gh pr checks <pr>`; if
  `automation.ciCheckName` is set, look at that check); merge (without asking) as soon as it
  is green. Evidence: `{ status: "success" }`.
- **local_ci_green** — the remote CI may be unavailable; run CI locally
  (e.g. `nx affected -t lint test build`); merge (without asking) as soon as it passes.
  Evidence: `{ status: "success", ranLocally: true }`.
- **without_ci** — merge the mergeable PR immediately, no barrier, no confirmation.
  Evidence: `{ status: "not_required" }`.
