---
description: Bind this repository to its CodBoard project — writes the .codboard/config.json pointer and enables the plugin, repairing either if it is missing. The only question is which project.
argument-hint: "[project name or id]"
allowed-tools: Bash(git remote:*), Read, Write, Edit
---

# Bind this repository to its CodBoard project

Write the committed **pointer** `.codboard/config.json` that ties this repo to its CodBoard
project. The plugin's hooks and skills read it at runtime; the workflow / automation /
testing / reporting configuration stays in CodBoard (source of truth via `get_workflow`),
never copied into the repo.

**Re-running this on an already-bound repo is the supported repair path**, not a no-op: a repo
initialised before the plugin was declared in `.claude/settings.json` carries the pointer and is
guarded by nothing, silently. Re-init resolves the same project without asking and writes back
whatever is missing.

**Keep it frictionless.** The **only** thing the user does is **select their project** (and
only if it can't be resolved automatically). Do not ask anything else. Write the file(s),
then stop — **do not `git add`, commit, merge, or open a PR**; leave everything in the
working tree for the user to review and commit themselves.

## 1. Check the connection

Confirm the `codboard` MCP tools are available (e.g. `list_projects`). If not, stop and
tell the user to authorise the CodBoard connector in the browser (first use of any codboard
tool triggers OAuth; interactive: `/mcp` → codboard → authenticate).

## 2. Select the project (the only interaction)

Resolve automatically when possible; ask the user to pick **only** if none of these settle it:

1. If `.codboard/config.json` already exists, reuse its `projectId` (re-init).
2. If `$ARGUMENTS` matches a project by name or id, use it.
3. `list_repositories` across projects and match this repo's `git remote get-url origin`.
4. If exactly one project exists, use it.
5. Otherwise show the project list and let the user select one.

Keep `projectId`, project name, and `workspaceId`.

## 3. Fill in the binding (no questions)

- `git remote get-url origin`, `list_repositories` for the project, match on the remote.
  If a repository matches, keep its `repositoryId`/name; if none does, `create_repository`
  from the remote and keep the new id (on failure, use `null`). No prompt.
- `get_workflow` for the project and keep its `workflowId`. (Do not copy any workflow
  values into the repo — the hooks re-read them via `get_workflow`.)

## 4. Write `.codboard/config.json` (+ gitignore the ledger, + enable the plugin)

Create the `.codboard/` folder and write `.codboard/config.json` (committed — no secrets,
auth is OAuth per user):

```json
{
  "projectId": "<step 2>",
  "projectName": "<step 2>",
  "workspaceId": "<step 2>",
  "repositoryId": "<step 3, or null>",
  "repositoryName": "<step 3>",
  "workflowId": "<step 3>",
  "boardUrl": "https://codboard.com/projects/<projectId>/board"
}
```

Ensure `.gitignore` contains `.codboard/session-state.json` (the hooks' local ledger — the
only part of `.codboard/` that must NOT be committed). Append the line if absent; create
`.gitignore` if missing.

Then **enable the plugin in the committed `.claude/settings.json`** — this is what makes
the binding survive. A `claude plugin install` writes to `~/.claude/`, which is **wiped
between hosted sessions** (Claude Code web runs each session in a fresh container): the
plugin silently is not there, no hook runs, and nothing reports the absence. A repo can
therefore carry `.codboard/config.json` and still be completely unguarded. Only this
committed file survives.

**Merge — never overwrite.** Read the existing file if there is one and preserve every
other key: a repo typically already declares other plugins and its own `hooks`. Add:

```json
{
  "extraKnownMarketplaces": {
    "badjilounes": { "source": { "source": "github", "repo": "badjilounes/claude-code-plugins" } }
  },
  "enabledPlugins": { "codboard@badjilounes": true }
}
```

Both keys are required: without `extraKnownMarketplaces`, `codboard@badjilounes` does not
resolve and the entry in `enabledPlugins` does nothing.

**Repair, every time.** Check both keys even when `.codboard/config.json` already exists, and
add whichever is missing. "The repo is already initialised" never means "nothing to do": the
repos that need this most are precisely the ones bound before the command wrote this file —
they carry the pointer, look configured, and run no hook at all.

Those three writes are the whole of it. Nothing else: no `CLAUDE.md` edit (the SessionStart
hook injects the pointer from `config.json` every session, so it is redundant), no PR
template, no `AGENTS.md` / `copilot-instructions.md` (a PR template is the client's own
choice; non-Claude agents are covered by their own per-provider CodBoard plugin).

## 5. Summarise

Report the resolved project / repo / workflow ids and the three files touched
(`.codboard/config.json`, the `.gitignore` line, `.claude/settings.json`) — naming, for a
re-init, which keys were already there and which ones you had to add. Then state the
manual next steps — **which this command does not perform**:

- **review and commit the three files** — until `.claude/settings.json` is committed and
  pushed, hosted sessions still start without the plugin and without any gate;
- authorise the OAuth connector once in the browser (Claude Code web also needs network
  access to `mcp.codboard.com` allowed).

Say plainly that `.claude/settings.json` changes the setup of everyone who clones the repo
— it is the intended effect (that is what "tracked on CodBoard" means for a team), but the
user should know it before committing.
