---
name: acceptance-workflow-authoring
description: >-
  Create or change a team's ticket workflow for the Acceptance plugin (.claude/acceptance-workflow.json
  and its templates): map the tracker's real states, types and fields, define modules from the
  repository layout, order the steps, choose the gates and the time policy, write the PR and comment
  templates, and validate against the tracker. Use when asked to set up, write, adapt or debug an
  Acceptance workflow, after /acceptance-workflow, or when check_workflow reports problems — créer,
  écrire, adapter le workflow d'équipe, les sous-tâches, les états, les templates de PR.
---

# Authoring an Acceptance team workflow

The workflow is data the team commits: `.claude/acceptance-workflow.json` plus Markdown templates under `.claude/acceptance-templates/`. The plugin is the engine: it runs the steps against the tracker with each person's own token, and its hooks refuse edits, commits and pull requests until the step a gate names is done. Design reference: `plugins/acceptance/docs/adr/0001-a-team-defines-its-ticket-workflow.md`.

## The loop

1. **Read the tracker**: call `mcp__acceptance__tracker_vocabulary`. It returns the project's types, states, fields (names in YouTrack, reference names in Azure DevOps), YouTrack link names, and the repository's top folders. Never guess a state or field name: use these exact strings.
2. **Start from a preset** if no file exists: `/acceptance-workflow init minimal|per-module|full` (the user types it), or write the file yourself from the presets below.
3. **Ask only what you cannot infer**: which state means "being worked", "finished" and "delivered" per ticket type; which modules the team wants; whether time is billed. Propose a default for each question.
4. **Write** the file and the templates.
5. **Validate**: call `mcp__acceptance__check_workflow`. It checks the structure, the references between steps, the template placeholders, and every state, type, field and link against the tracker. Fix and repeat until it says valid.
6. **Preview**: suggest `/acceptance-workflow dry-run <ticket>`, which lists the requests each step would send, without sending anything.
7. Commit both the workflow file and `.claude/acceptance-templates/`.

## The file

```json
{
  "$schema": "https://raw.githubusercontent.com/badjilounes/claude-code-plugins/main/plugins/acceptance/schema/workflow.schema.json",
  "version": 1,
  "tracker": {
    "states": { "active": "In Progress", "closed": "Done", "done": { "Bug": "Fixed", "User Story": "Testable", "*": "Done" } },
    "subtask": { "type": "Task", "link": "subtask of" },
    "fields": { "estimate": "Estimation" }
  },
  "modules": { "back-end": ["apps/*-api/**", "libs/**/api/**"], "front-end": ["apps/*-web/**"], "design-system": ["libs/**/ui/**"] },
  "steps": [
    { "id": "take", "do": ["assign-ticket", "set-ticket-state:active"] },
    { "id": "plan", "do": ["create-subtasks", "estimate-subtasks"], "requires": ["take"] },
    { "id": "work", "repeat": "per-subtask", "do": ["assign-subtask", "set-subtask-state:active"], "requires": ["plan"] },
    { "id": "finish", "repeat": "per-subtask", "do": ["log-time", "set-subtask-state:closed"], "requires": ["work"] },
    { "id": "pull-request", "do": ["open-pr:pullRequest"], "requires": ["finish:all"] },
    { "id": "how-to-test", "do": ["comment:howToTest"], "requires": ["pull-request"] },
    { "id": "proofs", "do": ["comment:proofs"], "requires": ["pull-request"] },
    { "id": "hand-over", "do": ["set-ticket-state:done"], "requires": ["how-to-test", "proofs"] }
  ],
  "gates": { "edit": "work", "commit": "work", "pullRequest": "finish:all" },
  "time": { "round": 15 },
  "templates": {
    "pullRequest": ".claude/acceptance-templates/pull-request.md",
    "howToTest": ".claude/acceptance-templates/how-to-test.md",
    "proofs": ".claude/acceptance-templates/proofs.md"
  }
}
```

### Actions (closed vocabulary)

| Action | Does | Per sub-task |
| --- | --- | --- |
| `assign-ticket` | Assigns the ticket to me, unless someone else holds it (then I work through my own sub-tasks). | |
| `set-ticket-state:active\|closed\|done` | Moves the ticket. `done` uses `states.done` by ticket type. | |
| `create-subtasks` | Creates one sub-task per module given in the step's input, linked to the ticket. One open sub-task per module and person. | |
| `estimate-subtasks` | Writes each new sub-task's estimate (Azure DevOps: original and remaining). | |
| `assign-subtask` | Assigns the sub-task to me. | yes |
| `set-subtask-state:active\|closed` | Moves the sub-task; `active` starts the time measure, `closed` closes it. | yes |
| `log-time` | Logs the measured time, rounded up to `time.round` (YouTrack: a work item; Azure DevOps: Completed Work up, Remaining Work down). | yes |
| `open-pr:<template>` | Renders the PR description; Claude opens the PR with it. | |
| `comment:<template>` | Posts the rendered template as a ticket comment. | |

A step with any per-sub-task action needs `"repeat": "per-subtask"`. Teams reorder, drop or repeat steps; a missing action is a change to the plugin, not to the file.

### Requirements and gates

- `requires: ["take"]`: that step is done. For a per-sub-task step, `"work"` means "done for this sub-task"; `"finish:all"` means "done for every sub-task of the ticket".
- `gates.edit`: an edit is refused until that step is done. With a per-sub-task step, the edited file's module must have an open sub-task with that step done. Files under `.claude/` and outside the repository are never gated.
- `gates.commit`, `gates.pullRequest`: same, for `git commit` and for `gh pr create` or the GitHub MCP `create_pull_request`.
- Without a ticket on the branch, a gated edit is refused with a proposal to create the ticket or resume one.

### The rules the team chose

- **The unit of work is the sub-task.** One per module touched, created and worked by one person. Two people on a ticket each create their own.
- **A re-opened ticket gets a new sub-task.** The closed ones stay closed.
- **Time is the measured time.** The user may correct it (`minutes`) when a session was interrupted. To bill a fixed amount, set `time.billable: true` and `tracker.fields.billable`: that separate field gets max(real, estimate). Never write the estimate as time spent.

### Tracker specifics

| | YouTrack | Azure DevOps |
| --- | --- | --- |
| States | Values of the `State` field | States of each work item type (`New`, `Active`, `Resolved`, `Closed`…) |
| Sub-task type | A value of `Type` (`Task`) | A work item type (`Task`) |
| Link | `subtask of` (read `Liens` from the vocabulary) | Parent / child, fixed |
| Estimate | `Estimation` (period field) | `Microsoft.VSTS.Scheduling.OriginalEstimate` (hours) |
| Time spent | Work items, author-dated | `Microsoft.VSTS.Scheduling.CompletedWork` (hours) |
| Fields in the file | Field names | Reference names |

### Templates

Markdown, with these placeholders only: `{{ticket.id}}`, `{{ticket.title}}`, `{{ticket.url}}`, `{{ticket.type}}`, `{{branch}}`, `{{author}}`, `{{subtasks}}`, `{{scenarios}}` (Gherkin scenarios with their proof status), `{{proofs}}` (proofs with titles, scenarios and image links), `{{pr.url}}`, `{{notes}}` (the text Claude passes to the step: how to test, what the proofs show). Unknown placeholders fail `check_workflow`.

## Running it (for reference)

`mcp__acceptance__workflow_step` with no `step` shows progress and the next step. `step` runs one; `subtask` names the module for a per-sub-task step; `subtasks` (module, title, estimate in minutes) feeds `create-subtasks` — agree on the list with the user first; `notes` and `prUrl` feed the templates. `mcp__acceptance__journal` (or `/acceptance-journal <person|me> <date> [date]`) lists what someone did, from the tracker and git.
