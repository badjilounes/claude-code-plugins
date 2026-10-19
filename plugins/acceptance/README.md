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

| Option | YouTrack | Azure DevOps |
| --- | --- | --- |
| `tracker` | `youtrack` | `azure-devops` |
| `trackerUrl` | `https://<org>.youtrack.cloud` | `https://dev.azure.com/<organization>` |
| `projects` | Short names tickets may be created in, the default first: `CORE,GROWTH` | — |
| `azureProject` | — | The project that holds the work items |
| `azureWorkItemType` | — | `User Story` by default (`Product Backlog Item`, `Issue`, `Task`…) |
| `token` | A permanent token | A personal access token with **Work Items (Read & write)** |
| Ticket IDs | `CORE-42` → branch `feature/CORE-42` | `1234` → branch `feature/1234`, shown as `#1234` |

The token is stored in secure storage. Leave it empty to read it from the `ACCEPTANCE_TRACKER_TOKEN` environment variable instead.

Without a configured tracker the plugin still negotiates rules and keeps proofs locally; they reach the ticket once it is configured.

## Tools Claude gets

| Tool | What it does |
| --- | --- |
| `mcp__acceptance__save_acceptance_criteria` | Saves the approved Gherkin locally and into the ticket description. |
| `mcp__acceptance__create_ticket` | Creates the ticket with its context and rules, then switches to `feature/<ID>` or `fix/<ID>`. |
| `mcp__acceptance__use_ticket` | Resumes an existing ticket on its branch. |
| `mcp__acceptance__add_evidence` | Adds a proof (capture, video, cURL, test, artifact, file) tied to a scenario. |

`/criteres` prints the ticket and the rules of the current branch.

## Local files

Everything is kept under `.claude/acceptance/` in the repository: `<branch>.feature`, `<branch>.evidence.json`, the proof files and the published pages. Add the folder to your `.gitignore`.

## Develop

```bash
claude plugin validate plugins/acceptance
```

```bash
claude plugin test plugins/acceptance
```

`hooks/tracker.ts` is the only file that knows a tracker: one pure adapter that builds the requests for YouTrack and Azure DevOps. Another tracker is a new `kind` there.
