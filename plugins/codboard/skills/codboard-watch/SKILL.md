---
name: codboard-watch
description: >-
  Run the CodBoard watch loop — re-read task and request comments and act on them, and apply
  the project's auto-merge policy to open PRs. Use when watching the board, polling for new
  comments, or deciding whether to merge a task's PR. Uses the automation policy loaded by
  the codboard-workflow skill.
---

# CodBoard — watch loop

Loop while you have active tasks; follow `automation.watch.pollHint` (from `get_workflow`)
for cadence.

## Comments

For each task / request you handle, re-read its comments with `list_comments`. When a new
comment asks for something, do it, then reflect the result on CodBoard — a status change, a
reply comment, or a work note.

## Auto-merge — apply `automation.autoMergeMode`

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
