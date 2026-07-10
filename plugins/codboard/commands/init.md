---
description: Bind this repository to its CodBoard project by writing the .codboard/config.json pointer. The only question is which project.
argument-hint: "[project name or id]"
allowed-tools: Bash(git remote:*), Read, Write, Edit
---

# Bind this repository to its CodBoard project

Write the committed **pointer** `.codboard/config.json` that ties this repo to its CodBoard
project. The plugin's hooks and skills read it at runtime; the workflow / automation /
testing / reporting configuration stays in CodBoard (source of truth via `get_workflow`),
never copied into the repo.

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

## 4. Write `.codboard/config.json` (+ gitignore the ledger)

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
  "boardUrl": "https://app.codboard.com/projects/<projectId>"
}
```

Ensure `.gitignore` contains `.codboard/session-state.json` (the hooks' local ledger — the
only part of `.codboard/` that must NOT be committed). Append the line if absent; create
`.gitignore` if missing. This is the only other write.

Nothing else is written: no `CLAUDE.md` edit (the SessionStart hook injects the pointer
from `config.json` every session, so it is redundant), no PR template, no `AGENTS.md` /
`copilot-instructions.md` (a PR template is the client's own choice; non-Claude agents are
covered by their own per-provider CodBoard plugin).

## 5. Summarise

Report the resolved project / repo / workflow ids and that `.codboard/config.json` (+ the
`.gitignore` line) was written. Then state the manual next steps — **which this command
does not perform**:

- authorise the OAuth connector once in the browser (Claude Code web also needs network
  access to `mcp.codboard.com` allowed);
- review and commit `.codboard/config.json` yourself;
- optional, to enable the plugin for the whole team on clone, add to a committed
  `.claude/settings.json`: `extraKnownMarketplaces.badjilounes` →
  `{ "source": { "source": "github", "repo": "badjilounes/claude-code-plugins" } }` and
  `enabledPlugins["codboard@badjilounes"] = true`.
