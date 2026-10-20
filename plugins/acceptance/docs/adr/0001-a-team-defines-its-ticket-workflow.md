# ADR 0001 — A team defines its ticket workflow, the plugin enforces it

- **Status:** Proposed
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

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/badjilounes/claude-code-plugins/main/plugins/acceptance/schema/workflow.schema.json",
  "version": 1,

  // Tracker vocabulary, mapped once. Values are the tracker's own names.
  "tracker": {
    "states": {
      "active": "In Progress",
      "closed": "Done",
      "done": { "Bug": "Fixed", "User Story": "Testable", "*": "Done" }
    },
    "types": { "bug": ["Bug"], "story": ["User Story", "Feature"] },
    "subtask": { "type": "Task", "link": "subtask of" },
    "fields": { "estimate": "Estimation", "spent": "Spent time" }
  },

  // Modules a change can touch, detected from the paths it edits.
  "modules": {
    "back-end": ["apps/*-api/**", "libs/**/api/**", "libs/**/domain*/**"],
    "front-end": ["apps/*-web/**", "libs/**/feature-*/**", "libs/**/data-access/**"],
    "design-system": ["libs/**/ui/**", "tailwind.config.ts"]
  },

  // The steps, in order. Each names what it does and what it requires.
  "steps": [
    { "id": "take", "do": ["assign-ticket", "set-ticket-state:active"] },
    { "id": "plan", "do": ["create-subtasks:per-module", "estimate-subtasks"], "requires": ["take"] },
    { "id": "work", "repeat": "per-subtask", "do": ["assign-subtask", "set-subtask-state:active"], "requires": ["plan"] },
    { "id": "finish-subtask", "repeat": "per-subtask", "do": ["log-time", "set-subtask-state:closed"] },
    { "id": "pull-request", "do": ["open-pr:pullRequest"], "requires": ["finish-subtask:all"] },
    { "id": "how-to-test", "do": ["comment:howToTest"], "requires": ["pull-request"] },
    { "id": "proofs", "do": ["comment:proofs"], "requires": ["pull-request"] },
    { "id": "hand-over", "do": ["set-ticket-state:done"], "requires": ["how-to-test", "proofs"] }
  ],

  // What the hooks refuse until a step is done.
  "gates": {
    "edit": "work",            // editing a module's files needs its sub-task active and assigned to me
    "commit": "work",
    "pullRequest": "finish-subtask:all"
  },

  // How time is logged.
  "time": { "measure": "active-subtask", "round": "15m", "billable": { "field": "Billable time", "atLeast": "estimate" } },

  // Markdown templates, committed beside the file.
  "templates": {
    "pullRequest": ".claude/acceptance-templates/pull-request.md",
    "howToTest": ".claude/acceptance-templates/how-to-test.md",
    "proofs": ".claude/acceptance-templates/proofs.md"
  }
}
```

- **`steps`** is an ordered list of **actions** taken from a closed vocabulary that the engine implements: `assign-ticket`, `set-ticket-state:<state key>`, `create-subtasks:per-module|manual`, `estimate-subtasks`, `assign-subtask`, `set-subtask-state:<state key>`, `log-time`, `open-pr:<template>`, `comment:<template>`. A team reorders, removes or repeats steps. It cannot invent actions; a new action is a change to the plugin.
- **`requires`** makes the order explicit. The engine refuses a step whose requirements are not met, and says which step comes first.
- **`gates`** binds steps to what Claude does. The `tool.call` hooks refuse an edit, a commit or a pull request until the named step is done, and the refusal says which step to run. This extends the existing refusal of a branch without a ticket number.
- **`modules`** maps globs to module names. An edit is attributed to the module whose glob matches. `create-subtasks:per-module` proposes one sub-task per module the plan touches, and the user confirms the list.
- **`templates`** are Markdown files, committed in `.claude/acceptance-templates/` (`.claude/acceptance/` holds local working files and is git-ignored), with `{{placeholders}}`. The engine fills them from what it knows: `{{ticket.id}}`, `{{ticket.title}}`, `{{subtasks}}` (title, module, estimate, time spent), `{{scenarios}}` (the Gherkin rules with their proof status), `{{proofs}}` (images and videos with their descriptions), `{{branch}}`, `{{pr.url}}`, `{{author}}`. An unknown placeholder is an error when the workflow is validated, not when a comment is posted.

### 3. Time spent is measured and logged as it was

`log-time` logs the **measured** time between `set-subtask-state:active` and `set-subtask-state:closed` for that sub-task, rounded as configured. The user can correct it before it is sent: an interrupted session is not time spent.

The engine **never replaces the real time with the estimate**. A team that bills a fixed amount per sub-task declares a separate `billable` field: the engine writes `max(spent, estimate)` there, and the real time in the time-spent field. The real time stays true and the billing rule stays visible. Writing an estimate as time spent would make the history, the very thing this ADR is for, wrong.

### 4. One engine, one adapter per tracker

`hooks/tracker.ts` stays the only file that knows a tracker. It gains the workflow actions, as pure request builders:

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
  1. reads the tracker's real vocabulary with the user's token: states, types, sub-task link types and time fields of the project (YouTrack `customFieldSettings`, Azure DevOps process `workItemTypes/{type}/states` and `fields`);
  2. proposes the mapping and asks only what it cannot infer;
  3. proposes `modules` from the repository's layout (Nx projects, `apps/`, `libs/`, package manifests);
  4. proposes a starting template among a few presets (`minimal`, `per-module`, `full`) and the three Markdown templates;
  5. writes the files and validates them.
- **`/acceptance-workflow check`** validates the file against the schema **and against the tracker**. Every state, type, link and field must exist in the project, every placeholder must be known, and every `requires` must point to an existing step. It reports what is wrong, line by line.
- **`/acceptance-workflow dry-run <ticket>`** lists, without sending anything, the requests each step would make on that ticket.
- **A skill, `acceptance-workflow-authoring`**, holds the reference: the action vocabulary, the placeholders, each tracker's specifics, the presets, and worked examples for a YouTrack and an Azure DevOps project. Claude loads it when a team asks to create or change its workflow. The command is the guided path, the skill is the knowledge behind it and behind any hand edit.
- **A JSON Schema**, `plugins/acceptance/schema/workflow.schema.json`, gives editors completion and validation, and is what `check` runs first.

### 6. The history and the summary come from the tracker

Because every step writes to the tracker under the person's identity, a later **`/acceptance-journal <person> <date|range>`** (separate ADR) reads assignments, state changes and logged time from the tracker, adds the person's commits and pull requests, and has the model summarize them. The summary describes the work (tickets, sub-tasks, time, PRs, proven scenarios), never prompts or conversation.

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

## Delivery

Each phase is one pull request, tested on both trackers, with the README and the skill updated in the same change.

1. **Schema and authoring tools.** `workflow.schema.json`, `/acceptance-workflow` (guided creation), `check` and `dry-run`, the skill, and the `minimal` preset. No enforcement yet: teams can write and validate their file.
2. **Take and hand over.** `assign-ticket`, `set-ticket-state`, done-by-type, gate `edit` on `take`.
3. **Sub-tasks and time.** `create-subtasks`, `estimate-subtasks`, `assign-subtask`, `set-subtask-state`, `log-time` (with `billable`), module detection, gates `edit` and `commit` on `work`.
4. **Templates.** `open-pr`, `comment:howToTest`, `comment:proofs`, the placeholders, the gate `pullRequest`.
5. **Journal.** `/acceptance-journal`, in its own ADR.

## Open questions

- **Sessions without a ticket** (exploration, review): outside the workflow, or a lightweight "no ticket" step that logs time on a team-chosen ticket?
- **Several people on one ticket:** sub-tasks are assigned per person, but who runs `hand-over`? The ticket's assignee, or whoever closes the last sub-task?
- **Re-opened tickets:** resume at `work`, or start again at `take`?
