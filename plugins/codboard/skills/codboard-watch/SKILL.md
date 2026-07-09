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

CodBoard never reads your CI and never merges — **you** do. In every non-`none` case you merge
the PR yourself (e.g. `gh pr merge`), attach a `ci` artifact with source `observed` on the
task's execution, then move the task to the workflow's terminal status; CodBoard records the
merge.

- **none** — never auto-merge.
- **ci_green** — check the remote CI in your environment (`gh pr checks <pr>`; if
  `automation.ciCheckName` is set, look at that check); merge only when it is green.
  Evidence: `{ status: "success" }`.
- **local_ci_green** — the remote CI may be unavailable; run CI locally
  (e.g. `nx affected -t lint test build`); merge only when it passes.
  Evidence: `{ status: "success", ranLocally: true }`.
- **without_ci** — merge the mergeable PR with no barrier.
  Evidence: `{ status: "not_required" }`.
