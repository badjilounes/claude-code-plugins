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

```bash
claude plugin marketplace add badjilounes/claude-code-plugins
```

```bash
claude plugin install acceptance@badjilounes
```

The install asks for the options below; change them later from `/config`.

## Configure your tracker

Three steps: name the tracker in the repository, give the plugin your token, and approve the tracker for that token.

### 1. The tracker, once per repository

```text
/acceptance-setup https://<org>.youtrack.cloud CORE,GROWTH
/acceptance-setup https://dev.azure.com/<organization> "<project>" [work item type]
```

| Argument | YouTrack | Azure DevOps |
| --- | --- | --- |
| URL | `https://<org>.youtrack.cloud` | `https://dev.azure.com/<organization>` (detected from the host) |
| Then | Short names tickets may be created in, the default first: `CORE,GROWTH` | The project that holds the work items, then the work item type (`User Story` by default) |
| Ticket IDs | `CORE-42` → branch `feature/CORE-42` | `1234` → branch `feature/1234`, shown as `#1234` |

This command is the only way to set the tracker. It writes `.claude/acceptance.json` at the root of the git repository (the session folder outside one). Commit that file: every session, local or cloud, reads the tracker from it.

### 2. The token, where you work

The token never goes into the repository. Write it as `<tracker url> <token>` to bind it to that tracker (step 3 is then done):

| Where | How |
| --- | --- |
| Local | The plugin's `token` option, kept in secure storage. Paste the token alone at the prompt; the URL is added in front:<br>`read -rs T && printf '{"token":"https://<org>.youtrack.cloud %s"}' "$T" \| claude plugin configure acceptance@badjilounes --values-stdin; unset T`<br>Then restart Claude Code. `/config` sets the same option where your version lists plugin options. |
| Cloud | An environment variable of the cloud environment (environment menu → Edit), read when a session starts:<br>`ACCEPTANCE_TRACKER_TOKEN=https://<org>.youtrack.cloud perm:…` |

When both are set, the option wins. The tracker must be served over HTTPS: the token is only ever sent to the tracker's URL, and proof files are only downloaded from it.

### 3. The approval

The token is only sent to a tracker you approved: `.claude/acceptance.json` comes with the repository, and on its own it could point anywhere. A tracker is approved when:

- **the token is bound to it** (step 2 with the URL in front) and `.claude/acceptance.json` names that exact URL. A repository can override the variable, but only with a token of its own, so it never gets yours; or
- **you ran `/acceptance-setup` with that URL yourself**, on this machine. The approval covers the kind, the URL and the project, and is kept in the plugin's user store. Only a person typing the command (at the prompt or through Remote Control) approves; a cloud container starts with an empty store, so prefer the bound token there.

Only https URLs without credentials, query or fragment are accepted. When something is missing (URL, token or approval), the tools say which and how to fix it, instead of reporting the ticket as missing. The plugin still negotiates rules and keeps proofs locally; they reach the ticket once it is configured.

## Tools Claude gets

| Tool | What it does |
| --- | --- |
| `mcp__acceptance__save_acceptance_criteria` | Saves the approved Gherkin locally and into the ticket description. |
| `mcp__acceptance__create_ticket` | Creates the ticket with its context and rules, then switches to `feature/<ID>` or `fix/<ID>`. |
| `mcp__acceptance__use_ticket` | Resumes an existing ticket on its branch. |
| `mcp__acceptance__add_evidence` | Adds a proof (capture, video, cURL, test, artifact, file) tied to a scenario. |

`/acceptance-setup` configures the tracker; `/criteres` prints the ticket and the rules of the current branch.

## Local files

Everything is kept under `.claude/acceptance/` in the repository: `<branch>.feature`, `<branch>.evidence.json`, the proof files and the published pages. Add the folder to your `.gitignore` (but keep `.claude/acceptance.json`).

## Develop

```bash
claude plugin validate plugins/acceptance
```

```bash
claude plugin test plugins/acceptance
```

`hooks/tracker.ts` is the only file that knows a tracker: one pure adapter that builds the requests for YouTrack and Azure DevOps. Another tracker is a new `kind` there.
