# ADR 0001 — A team defines its ticket workflow, the plugin enforces it

- **Status:** Accepted, implemented in 0.3.0
- **Date:** 2026-10-20
- **Scope:** `plugins/acceptance`

## Context

Acceptance already ties a branch to a ticket, negotiates Gherkin rules and attaches proofs. It does not say **how a team works a ticket**: who takes it, how it is split, how long each part took, what the pull request and the ticket comments look like, and which state the ticket ends in.

Teams want that process enforced, for two reasons:

1. **Consistency.** Every collaborator, and every Claude Code session, follows the same steps: take the ticket, split it per module, estimate, work one sub-task at a time, log time, open the PR from a template, document how to test, attach proofs, hand the ticket over.
2. **History for free.** If every step goes through the tracker with each person's own token ([Collaborate](../../README.md#collaborate)), the tracker records who did what and when: assignments, state changes, time logged per sub-task. "What did Alice do on 20 October" becomes a query on the tracker, with no separate journal.

No two teams share a process. Trackers differ:

- **States:** `In Progress` vs `Active`, `Fixed` vs `Resolved`.
- **Sub-tasks:** linked issues in YouTrack, child `Task` work items in Azure DevOps.
- **Estimates and time:** an `Estimation` field and author-dated work items in YouTrack; `Original Estimate`, `Remaining Work` and `Completed Work` fields in Azure DevOps.

Projects differ too, through custom states and fields. A built-in workflow would fit nobody.

## Decision

### 1. The workflow is a file the team commits

`.claude/acceptance-workflow.json`, next to `.claude/acceptance.json`, describes the team's workflow. It is data, not code. The plugin ships the **engine**, the repository holds the **workflow**. Without the file, the plugin behaves as today, and nothing is enforced.

A repository cannot use this file to send a token anywhere new. It only names states, fields, modules, gates and templates. Every request still goes to the approved tracker URL, with the user's own token.

### 2. The file describes steps, not just settings

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

- **`steps`** is an ordered list of **actions** taken from a closed vocabulary that the engine implements: `assign-ticket`, `set-ticket-state:<state key>`, `create-subtasks`, `estimate-subtasks`, `assign-subtask`, `set-subtask-state:<state key>`, `log-time`, `open-pr:<template>`, `comment:<template>`. A team reorders, removes or repeats steps. It cannot invent actions; a new action is a change to the plugin.
- **`requires`** makes the order explicit. The engine refuses a step whose requirements are not met, and says which step comes first.
- **`gates`** binds steps to what Claude does. The `tool.call` hooks refuse an edit, a commit or a pull request until the named step is done, and the refusal says which step to run. This extends the existing refusal of a branch without a ticket number.
- **`modules`** maps globs to module names. An edit is attributed to the module whose glob matches. `create-subtasks` creates one sub-task per module the plan touches, from a list Claude proposes and the user confirms.
- **`templates`** are Markdown files, committed in `.claude/acceptance-templates/` (`.claude/acceptance/` holds local working files and is git-ignored), with `{{placeholders}}`. The engine fills them from what it knows: `{{ticket.id}}`, `{{ticket.title}}`, `{{subtasks}}` (title, module, estimate, time spent), `{{scenarios}}` (the Gherkin rules with their proof status), `{{proofs}}` (images and videos with their descriptions), `{{branch}}`, `{{pr.url}}`, `{{author}}`, `{{ticket.url}}`, `{{ticket.type}}`, and `{{notes}}`, the text Claude passes to the step (how to test, what the proofs show). An unknown placeholder is an error when the workflow is validated, not when a comment is posted.

### 3. Time spent is measured and logged as it was

`log-time` logs the **measured** time from `set-subtask-state:active` to the `log-time` action for that sub-task, rounded up to `time.round` minutes. The user can correct it (`minutes` on the step): an interrupted session is not time spent.

The engine **never replaces the real time with the estimate**. A team that bills a fixed amount per sub-task sets `time.billable` and a separate `tracker.fields.billable`: the engine writes `max(spent, estimate)` there, and the real time in the time-spent field. The real time stays true and the billing rule stays visible. Writing an estimate as time spent would make the history, the very thing this ADR is for, wrong.

### 4. One engine, one adapter per tracker

`hooks/tracker.ts` stays the only file that knows a tracker. It gains the workflow actions, as pure request builders; `hooks/workflow.ts` holds the pure workflow logic (parsing, modules, requirements, gates, time, templates), `hooks/engine.ts` runs the steps, and `hooks/workflow-register.ts` wires the tools, commands and gates:

| Action | YouTrack | Azure DevOps |
| --- | --- | --- |
| assign | `customFields` Assignee = me (`/api/users/me`) | `System.AssignedTo` = me (`_apis/connectionData`) |
| set state | `customFields` State | `System.State` |
| create sub-task | issue + `subtask of` link | `Task` + `System.LinkTypes.Hierarchy-Reverse` |
| estimate | `Estimation` (period) | `Microsoft.VSTS.Scheduling.OriginalEstimate` (hours) |
| log time | work item (author, date, duration) | `CompletedWork` += h, `RemainingWork` −= h |
| comment | issue comment (Markdown) | work item comment (HTML) |

Field and state **names** come from `tracker` in the workflow file, never from the adapter. The adapter only knows how each tracker stores a state, a field, a link or a duration.

### 5. Creating a workflow is guided, not hand-written

Writing that JSON by hand against an unfamiliar tracker is the hard part. The plugin ships tools for it:

- **`/acceptance-workflow`** (command) starts a guided creation. It:
  1. reads the tracker's real vocabulary with the user's token: states, types, sub-task link types and time fields of the project (YouTrack project custom fields and issue link types, Azure DevOps `workitemtypes` with their states and fields);
  2. proposes the mapping and asks only what it cannot infer;
  3. proposes `modules` from the repository's layout (Nx projects, `apps/`, `libs/`, package manifests);
  4. hands over to Claude with the `acceptance-workflow-authoring` skill, which writes the files and validates them; `/acceptance-workflow init minimal|per-module|full` lays a preset and, for `full`, the three Markdown templates.
- **`/acceptance-workflow check`** validates the file against the schema **and against the tracker**. Every state, type, link and field must exist in the project, every placeholder must be known, and every `requires` must point to an existing step. It reports what is wrong, line by line.
- **`/acceptance-workflow dry-run <ticket>`** lists, without sending anything, the requests each step would make on that ticket.
- **A skill, `acceptance-workflow-authoring`**, holds the reference: the action vocabulary, the placeholders, each tracker's specifics, the presets, and worked examples for a YouTrack and an Azure DevOps project. Claude loads it when a team asks to create or change its workflow. The command is the guided path, the skill is the knowledge behind it and behind any hand edit.
- **A JSON Schema**, `plugins/acceptance/schema/workflow.schema.json`, gives editors completion and validation, beside the structural checks `check` runs.

### 6. The history and the summary come from the tracker

Because every step writes to the tracker under the person's identity, **`/acceptance-journal <person|me> <date> [date]`** and the `journal` tool read assignments, state changes and logged time from the tracker and add the person's commits; Claude summarizes them on request. The summary describes the work (tickets, sub-tasks, time, PRs, proven scenarios), never prompts or conversation.

- **YouTrack** gives author-dated work items and an activity stream, so per-person, per-day summaries are direct.
- **Azure DevOps** keeps `Completed Work` as a total. Per-person, per-day time comes from the work item revisions (`_apis/wit/workItems/{id}/updates`), which the journal reads.

## Consequences

- **Positive**
  - One process for the whole team, in every session. A history that needs no extra tool.
  - Teams own their workflow in their repository, reviewed like code.
  - A new tracker is a new adapter, not a new workflow format.
- **Negative**
  - The plugin grows from four tools to a workflow engine, which needs more tests and documentation.
  - Gates refuse work until the process is followed, which a team can feel as friction. `gates` is optional per gate, and the file is optional altogether.
- **Limits**
  - The engine only governs Claude Code sessions with the plugin. Someone editing the ticket in the tracker's UI, or coding without the plugin, is not stopped. A CI check, for example "a PR needs its sub-tasks closed", can close that gap and is out of scope here.
  - Tracker rights are each collaborator's: assigning, changing states and logging time need them on the project.
  - Custom processes vary widely. A team whose process needs an action outside the vocabulary asks for it, and it is added to the engine for everyone.

## Decisions on the open points

- **A session without a ticket** proposes to create one. With a workflow that gates edits, editing code on a branch without a ticket is refused, and the refusal proposes `create_ticket` or `use_ticket`.
- **Several people on one ticket** never share a sub-task: each person creates and works their own sub-tasks, one per module. `assign-ticket` leaves a ticket someone else holds with them.
- **A re-opened ticket** is worked through a new sub-task: the unit of work is always the sub-task, and closed ones stay closed. Gates ask for an open sub-task in the edited module.

## Delivery

Delivered in one change (0.3.0): the schema, the engine and its actions on both trackers, the gates, the templates, `/acceptance-workflow` with `init`, `check` and `dry-run`, the `tracker_vocabulary`, `check_workflow`, `workflow_step` and `journal` tools, `/acceptance-journal`, and the `acceptance-workflow-authoring` skill.

Known limits:

- Progress (steps done, sub-tasks, start times) is kept per person and per branch in `.claude/acceptance/<branch>.workflow.json`, beside the other local files: each person sees their own sub-tasks, which matches "one sub-task per person". A new clone or container starts with no local progress: run the steps again (a ticket already assigned or active is simply set again), and create a new sub-task for the remaining work.
- The journal reads up to 500 YouTrack entries and 100 Azure DevOps work items per query.
