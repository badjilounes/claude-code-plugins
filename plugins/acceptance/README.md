# Acceptance

Acceptance criteria first, proofs last, and the ticket in between: Claude negotiates the rules with you in Gherkin before writing code, files the ticket in your tracker, names the branch after it, and collects every proof into that ticket.

- **Rules.** For any feature or fix, Claude rewrites the request as Gherkin scenarios grouped by subject (`Rule:`), asks the questions that change them, and waits for your go-ahead. The rules you approve go into the ticket description.
- **Ticket and branch.** With no ticket on the branch, Claude creates one with the full context (the request, the why, the decisions you made) and switches to `feature/<ID>` (`fix/<ID>` for a bug). Creating a branch without a ticket number is refused.
- **Proofs.** cURL calls, test runs, screenshots, screen recordings and artifacts are captured as they happen or added on purpose, each tied to the scenario it proves. Text proofs become `.txt` files; every file is attached to the ticket with a comment.
- **Three artifacts per ticket.** `<ID> — Ticket`, `<ID> — Règles` (a checklist by subject) and `<ID> — Preuves` (a gallery with a full-screen viewer) are published as private claude.ai artifacts and kept up to date.
- **A band above the prompt.** `Ticket <ID>` on the left, `Règles x/y` and `Preuves n` on the right, each opening its artifact (cmd+click or middle-click opens it in the browser).
- **Any session picks it up.** The branch name points to the ticket; a new session reads the rules and proofs back from it.
- **Final summary.** Claude ends the work by reporting each scenario with its proof and listing the three artifacts by name and link.

The criteria, prompts and artifacts are written in French.

## Install

Two things are set up separately:

- **The tracker** (which YouTrack or Azure DevOps, which projects): once per repository, in a committed file.
- **Your token**: once per place you work (your machine, a cloud environment). It never goes into the repository.

Write the token as `<tracker url> <token>`, for example `https://acme.youtrack.cloud perm:abc…`. This binds it to that tracker, and nothing else needs approving (see [Why the URL goes with the token](#why-the-url-goes-with-the-token)).

### 1. The tracker — once per repository

In a Claude Code session opened on the repository, type:

```text
/acceptance-setup https://<org>.youtrack.cloud CORE,GROWTH
```

or, for Azure DevOps:

```text
/acceptance-setup https://dev.azure.com/<organization> "<project>" [work item type]
```

| Argument | YouTrack | Azure DevOps |
| --- | --- | --- |
| URL | `https://<org>.youtrack.cloud` | `https://dev.azure.com/<organization>` (detected from the host) |
| Then | Short names tickets may be created in, the default first: `CORE,GROWTH` | The project that holds the work items, then the work item type (`User Story` by default) |
| Ticket IDs | `CORE-42` → branch `feature/CORE-42` | `1234` → branch `feature/1234`, shown as `#1234` |

The command writes `.claude/acceptance.json` at the root of the git repository. **Commit and push it**: every session, local or cloud, reads the tracker from it. This command is the only way to set the tracker.

### 2a. Local install — on your machine

Works the same in every local surface: the CLI, Claude Desktop and the IDE extensions.

1. Install the plugin:

   ```bash
   claude plugin marketplace add badjilounes/claude-code-plugins
   claude plugin install acceptance@badjilounes
   ```

   Already installed? `claude plugin marketplace update badjilounes && claude plugin update acceptance@badjilounes`.

2. Add your token, bound to its tracker, to `~/.config/acceptance/token`, readable by you only. The file holds **one line per tracker**, `<tracker url> <token>`; each repository gets the line whose URL matches its `.claude/acceptance.json`. Paste the token alone when the command waits; it adds the line with the URL in front:

   ```bash
   # YouTrack
   mkdir -p ~/.config/acceptance && read -rs T && printf 'https://<org>.youtrack.cloud %s\n' "$T" >> ~/.config/acceptance/token && chmod 600 ~/.config/acceptance/token; unset T
   # Azure DevOps (a personal access token with Work Items read & write)
   mkdir -p ~/.config/acceptance && read -rs T && printf 'https://dev.azure.com/<organization> %s\n' "$T" >> ~/.config/acceptance/token && chmod 600 ~/.config/acceptance/token; unset T
   ```

   Run one command per tracker you use (`>>` appends). The result looks like this; lines starting with `#` are ignored:

   ```text
   https://acme.youtrack.cloud perm:…
   https://dev.azure.com/acme 3x…
   ```

   To replace a token, edit its line. The URL must be exactly the one `/acceptance-setup` wrote (for Azure DevOps, the organization URL, without the project).

   The plugin reads this file itself, so it does not depend on how Claude Code was started. An app opened from the Dock or a launcher does not get the variables of your shell profile; this file does not need them.

3. Restart Claude Code: `/exit` then `claude` in the CLI, or quit the app completely (Cmd+Q / Alt+F4) and reopen it.

4. Check: in a session opened on the repository, ask Claude to resume a ticket (`use_ticket CORE-42`). It switches to `feature/CORE-42`.

<details>
<summary>Other places the token can go</summary>

Each place takes the same `<tracker url> <token>` form, several pairs separated by new lines or `;`. For a repository, the plugin uses the first pair whose URL matches its tracker, looking in this order:

1. The plugin's `token` option, kept in secure storage, set with `claude plugin configure acceptance@badjilounes --values-stdin` (JSON `{"token":"<url> <token>"}` on stdin) or `/config`. An option saved by one surface may not be seen by another (another copy of the plugin, for instance one synced from claude.ai), so prefer the file when you use several.
2. The `ACCEPTANCE_TRACKER_TOKEN` environment variable. In a cloud environment this is the way, see 2b.
3. The file `~/.config/acceptance/token` (`%USERPROFILE%\.config\acceptance\token` on Windows).

A token without a URL in front, left over from an earlier setup, is only a fallback, but it is sent to whichever tracker `/acceptance-setup` approved: clear it with `printf '{"token":""}' | claude plugin configure acceptance@badjilounes --values-stdin`.

</details>

### 2b. Cloud environment — claude.ai/code

1. Make the plugin available to cloud sessions. Either it is installed on your account, or the repository declares it in its committed `.claude/settings.json`:

   ```json
   {
     "extraKnownMarketplaces": { "badjilounes": { "source": { "source": "github", "repo": "badjilounes/claude-code-plugins" } } },
     "enabledPlugins": { "acceptance@badjilounes": true }
   }
   ```

2. Add the token to the cloud environment: environment menu in the session's title bar → **Edit** → environment variables. Add it as a plain variable, not under network secrets, and without quotes:

   ```text
   ACCEPTANCE_TRACKER_TOKEN=https://<org>.youtrack.cloud perm:…
   ```

   Several trackers in the same environment: separate the pairs with `;`, for example `https://<org>.youtrack.cloud perm:…; https://dev.azure.com/<organization> 3x…`.

3. Start a **new** session: variables are read when a session starts.

4. Check: ask Claude to resume a ticket (`use_ticket CORE-42`).

### Troubleshooting

The tools say exactly what is missing instead of calling the ticket missing:

| Message | Fix |
| --- | --- |
| `n'est pas configuré : URL (/acceptance-setup)` | No `.claude/acceptance.json` at the repository root: step 1, then commit it. |
| `n'est pas configuré : jeton` | No token where this session runs: step 2a or 2b. Locally, check `~/.config/acceptance/token` exists and restart the app; works in the CLI but not in Desktop usually means the token sat in the shell profile or in another surface's option, so move it to the file. In the cloud, start a new session after adding the variable. |
| `n'a pas été approuvé sur cette machine` | Either there is no token at all (fix the token first, the message above then shows), or the token has no URL in front, or a different one: write it as `<tracker url> <token>`, with the exact URL of `.claude/acceptance.json`. Or type `/acceptance-setup <url> <projects>` yourself, which approves the tracker on this machine only. |
| `inaccessible sur <url> : … 401` / `404` | The tracker refused the token, or the ticket does not exist for that account: check the token's rights on the project. |

Without a configured tracker the plugin still negotiates rules and keeps proofs locally; they reach the ticket once it is configured.

### Why the URL goes with the token

`.claude/acceptance.json` comes with the repository, so on its own it could point anywhere. The token is therefore only sent to a tracker you approved:

- **A bound token** (`<tracker url> <token>`, in the file, the option or the variable) approves exactly that URL. A repository can override the variable, but only with a token of its own, so it never gets yours; it cannot write your home folder or your plugin options.
- **`/acceptance-setup` typed by you** approves the tracker (kind, URL, project) in the plugin's user store on this machine. Only a person typing the command (at the prompt or through Remote Control) approves. A cloud container starts with an empty store, which is why the cloud uses a bound token.

Only https URLs without credentials, query or fragment are accepted, and proof files are only downloaded from the tracker's URL. When several places hold a token for the same tracker, the option wins, then the variable, then the file. A token without a URL in front is only used when no place holds one bound to the repository's tracker.

## Collaborate

Several people can work on the same repository, each with their own token. Nothing secret is shared.

**Shared, in the repository:**

- `.claude/acceptance.json`: the tracker kind, URL and project. No secret.
- `.claude/settings.json`: the marketplace and `"enabledPlugins": { "acceptance@badjilounes": true }`, so every session on the repository loads the plugin.

**Each collaborator, once, on their own machine:**

1. Install the plugin ([2a](#2a-local-install--on-your-machine), step 1).
2. Create **their own** token: a YouTrack permanent token, or an Azure DevOps personal access token with **Work Items (Read & write)**.
3. Add it to **their own** `~/.config/acceptance/token`, on the line of the repository's tracker ([2a](#2a-local-install--on-your-machine), step 2).
4. Restart Claude Code. No `/acceptance-setup` is needed: the tracker is already in the repository, and the token is bound to its URL.

**Each collaborator, in the cloud:** their **own** cloud environment, with their own `ACCEPTANCE_TRACKER_TOKEN` ([2b](#2b-cloud-environment--claudeaicode)). The variable belongs to the environment: people who share one environment share the token in it.

**What this gives you:**

| | |
| --- | --- |
| Traceability | Everyone acts under their own identity: tickets created, rules saved and proofs attached appear in the tracker under the name of whoever did the work. |
| Revocation | Revoking one collaborator's token affects nobody else. |
| Safety | A token never leaves its owner's machine and is only sent to the URL on its own line: a `.claude/acceptance.json` edited to point elsewhere gets nothing. |

**Tracker rights:** each collaborator needs to create and edit tickets in the project. In Azure DevOps, that is usually the project's **Contributors** group with a **Basic** access level. In YouTrack, a role that can create and update issues in the project.

## Team workflow

A team can make every session follow its own way of working a ticket: take it, split it into sub-tasks per module, estimate, work one sub-task at a time, log time, open the PR and post the "how to test" and proofs comments from templates, then hand the ticket over. Each step writes to the tracker with the person's own token, so the tracker becomes the history of who did what and when. Design: [ADR 0001](docs/adr/0001-a-team-defines-its-ticket-workflow.md).

Without a workflow file, nothing changes: the plugin works as described above.

### Set it up — once per repository

1. In a session on the repository, type `/acceptance-workflow`. It reads your tracker's real types, states and fields with your token, lists the repository's folders, and has Claude propose the workflow with the `acceptance-workflow-authoring` skill. Claude only asks what it cannot infer.

   Prefer to start from a preset? `/acceptance-workflow init minimal|per-module|full` writes `.claude/acceptance-workflow.json` (and, for `full`, the templates in `.claude/acceptance-templates/`) with `<placeholders>` to replace.

2. Check it: `/acceptance-workflow check` validates the file, its templates and every state, type, field and link against the tracker.

3. Preview it: `/acceptance-workflow dry-run <ticket>` lists the requests each step would send, without sending anything.

4. Commit `.claude/acceptance-workflow.json` and `.claude/acceptance-templates/`. Every collaborator and every session now follows it.

Editors get completion from the JSON Schema: put `"$schema": "https://raw.githubusercontent.com/badjilounes/claude-code-plugins/main/plugins/acceptance/schema/workflow.schema.json"` at the top of the file.

### What the file holds

| Key | What |
| --- | --- |
| `tracker` | The tracker's own names: the states for "being worked", "finished" and "delivered" (per ticket type), the sub-task type, and the fields when they differ from the defaults. |
| `modules` | Module name → globs, for example `"back-end": ["apps/*-api/**"]`. An edited file belongs to the first module that matches. |
| `steps` | The ordered steps, each a list of actions (`assign-ticket`, `set-ticket-state:active`, `create-subtasks`, `estimate-subtasks`, `assign-subtask`, `set-subtask-state:active`, `log-time`, `set-subtask-state:closed`, `open-pr:<template>`, `comment:<template>`, `set-ticket-state:done`), with `requires` and `"repeat": "per-subtask"` for the sub-task steps. |
| `gates` | What is refused until a step is done: `edit`, `commit`, `pullRequest`. |
| `time` | `round` (minutes, 15 by default) and `billable`. |
| `templates` | Markdown files with `{{ticket.id}}`, `{{subtasks}}`, `{{scenarios}}`, `{{proofs}}`, `{{notes}}`… |

The full reference, with each tracker's specifics, is the [authoring skill](skills/acceptance-workflow-authoring/SKILL.md).

### How it runs

- **One sub-task per person and module.** The unit of work is the sub-task. Two people on a ticket each create their own; a re-opened ticket gets a new sub-task. A ticket someone else holds stays assigned to them.
- **Gates.** Editing a module's files needs its open sub-task started, and a file outside every module needs at least one sub-task in progress; a commit needs a sub-task in progress; a pull request needs every sub-task finished (as the team sets `gates`). On a branch without a ticket, a gated edit is refused with a proposal to create the ticket or resume one. Files under `.claude/` are never gated.
- **Time.** The time logged is the time measured between starting a sub-task and logging it, rounded up. Claude can correct it when a session was interrupted. To bill a fixed amount, `time.billable` writes max(real time, estimate) to a separate field; the real time is never replaced.
- **Steps.** Claude runs them with `mcp__acceptance__workflow_step`; called with no step, it shows progress and what comes next.

### The journal

`/acceptance-journal <person|me> <YYYY-MM-DD> [YYYY-MM-DD]` lists what someone did: assignments, state changes and time logged in the tracker, plus their commits. Ask Claude "what did Alice do on 20 October?" and it summarizes it with the `journal` tool. YouTrack reads author-dated work items and activities; Azure DevOps reads the work items' revisions.

## Tools Claude gets

| Tool | What it does |
| --- | --- |
| `mcp__acceptance__save_acceptance_criteria` | Saves the approved Gherkin locally and into the ticket description. |
| `mcp__acceptance__create_ticket` | Creates the ticket with its context and rules, then switches to `feature/<ID>` or `fix/<ID>`. |
| `mcp__acceptance__use_ticket` | Resumes an existing ticket on its branch. |
| `mcp__acceptance__add_evidence` | Adds a proof (capture, video, cURL, test, artifact, file) tied to a scenario. |
| `mcp__acceptance__workflow_step` | Runs a step of the team workflow, or shows its progress. |
| `mcp__acceptance__tracker_vocabulary` | Reads the tracker's types, states, fields and links, and the repository's folders. |
| `mcp__acceptance__check_workflow` | Validates the workflow file and its templates against the tracker. |
| `mcp__acceptance__journal` | What a person did on a date or a period, from the tracker and git. |

`/acceptance-setup` configures the tracker; `/criteres` prints the ticket and the rules of the current branch; `/acceptance-workflow` creates, checks and previews the team workflow; `/acceptance-journal` prints someone's journal.

## Local files

Everything is kept under `.claude/acceptance/` in the repository: `<branch>.feature`, `<branch>.evidence.json`, `<branch>.workflow.json` (your progress in the team workflow: steps done, your sub-tasks, start times), the proof files and the published pages. Add the folder to your `.gitignore` (but keep `.claude/acceptance.json`, `.claude/acceptance-workflow.json` and `.claude/acceptance-templates/`).

## Design decisions

- [ADR 0001 — A team defines its ticket workflow, the plugin enforces it](docs/adr/0001-a-team-defines-its-ticket-workflow.md) (accepted)

## Develop

```bash
claude plugin validate plugins/acceptance
```

```bash
claude plugin test plugins/acceptance
```

`hooks/tracker.ts` is the only file that knows a tracker: one pure adapter that builds the requests for YouTrack and Azure DevOps. Another tracker is a new `kind` there.
