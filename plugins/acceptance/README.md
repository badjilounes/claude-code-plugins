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

1. Install the plugin:

   ```bash
   claude plugin marketplace add badjilounes/claude-code-plugins
   claude plugin install acceptance@badjilounes
   ```

   Already installed? `claude plugin update acceptance@badjilounes`.

2. Save your token, bound to the tracker, in the plugin's `token` option (secure storage). Paste the token alone when the command waits; it adds the URL in front:

   ```bash
   read -rs T && printf '{"token":"https://<org>.youtrack.cloud %s"}' "$T" | claude plugin configure acceptance@badjilounes --values-stdin; unset T
   ```

   `claude plugin configure acceptance@badjilounes` (without `--values-stdin`) shows which options are set. If your version says `unknown command 'configure'`, run `claude update` first.

3. Restart Claude Code (`/exit`, then `claude`).

4. Check: ask Claude to resume a ticket (`use_ticket CORE-42`). It switches to `feature/CORE-42`.

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

3. Start a **new** session: variables are read when a session starts.

4. Check: ask Claude to resume a ticket (`use_ticket CORE-42`).

### Troubleshooting

The tools say exactly what is missing instead of calling the ticket missing:

| Message | Fix |
| --- | --- |
| `n'est pas configuré : URL (/acceptance-setup)` | No `.claude/acceptance.json` at the repository root: step 1, then commit it. |
| `n'est pas configuré : jeton` | No token where this session runs: step 2a or 2b. In the cloud, start a new session after adding the variable. |
| `n'a pas été approuvé sur cette machine` | The token has no URL in front, or a different one: write it as `<tracker url> <token>`, with the exact URL of `.claude/acceptance.json`. Or type `/acceptance-setup <url> <projects>` yourself, which approves the tracker on this machine only. |
| `inaccessible sur <url> : … 401` / `404` | The tracker refused the token, or the ticket does not exist for that account: check the token's rights on the project. |

Without a configured tracker the plugin still negotiates rules and keeps proofs locally; they reach the ticket once it is configured.

### Why the URL goes with the token

`.claude/acceptance.json` comes with the repository, so on its own it could point anywhere. The token is therefore only sent to a tracker you approved:

- **A bound token** (`<tracker url> <token>`, in the option or the variable) approves exactly that URL. A repository can override the variable, but only with a token of its own, so it never gets yours.
- **`/acceptance-setup` typed by you** approves the tracker (kind, URL, project) in the plugin's user store on this machine. Only a person typing the command (at the prompt or through Remote Control) approves. A cloud container starts with an empty store, which is why the cloud uses a bound token.

Only https URLs without credentials, query or fragment are accepted, and proof files are only downloaded from the tracker's URL. When both the option and the variable are set, the option wins.

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
