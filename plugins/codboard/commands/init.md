---
description: Bind this repository to its CodBoard project so every session (and every contributor) syncs strongly and automatically.
argument-hint: "[project name or id]"
allowed-tools: Bash(git remote:*), Bash(git config:*), Read, Write, Edit
---

# Initialise strong CodBoard sync for this repository

Goal: make this repo **strongly and automatically** tracked on CodBoard, for every
agent and every human — not by copying the workflow into repo files, but by writing a
small committed **pointer** the plugin's hooks and skills read at runtime. The workflow,
automation, testing and reporting configuration stays in CodBoard (source of truth, read
via `get_workflow`); this repo only stores *which* project/repo/workflow it maps to.

Do the steps below in order. Confirm before writing files. Argument `$ARGUMENTS`, if
given, is the target project name or id — use it to skip the picker.

## 1. Check the connection

Confirm the `codboard` MCP tools are available (e.g. `list_projects`). If they are not,
stop and tell the user to authorise the CodBoard connector in the browser (first use of
any codboard tool triggers OAuth; in an interactive session `/mcp` → codboard →
authenticate). Do not continue without a working connection.

## 2. Resolve the CodBoard project

- `list_projects`. If `$ARGUMENTS` matches one by name or id, pick it. If exactly one
  project exists, pick it. Otherwise show the list and ask the user which one.
- Keep its `projectId`, project name, and `workspaceId`.

## 3. Resolve the repository binding

- `git remote get-url origin` to read this repo's remote.
- `list_repositories` for the project and match on the remote (provider + owner/name).
- If a matching repository exists, keep its `repositoryId` and name.
- If none matches, offer to `create_repository` for this project from the remote, then
  keep the new id. If the user declines, record `repositoryId` as `null` and note it.

## 4. Read the workflow (do NOT copy its values)

- `get_workflow` for the project. Keep only its `workflowId`.
- Read `statuses`, `transitions`, `playbook`, `automation` (incl. `autoMergeMode`),
  `testing` and `reportPrompt` **for this session's own use** — but never write any of
  these values into repo files. They are per-project and change; the hooks and skills
  re-read them via `get_workflow` each session.

## 5. Write the committed pointer `.codboard/config.json`

Create `.codboard/config.json` (this file IS committed — it contains no secrets; auth is
OAuth per user):

```json
{
  "projectId": "<from step 2>",
  "projectName": "<from step 2>",
  "workspaceId": "<from step 2>",
  "repositoryId": "<from step 3, or null>",
  "repositoryName": "<from step 3>",
  "workflowId": "<from step 4>",
  "boardUrl": "https://app.codboard.com/projects/<projectId>"
}
```

## 6. Keep session state out of git

Ensure `.gitignore` contains `\.codboard/session-state.json` (the hooks' local ledger —
never committed). Create `.gitignore` if missing; append the line if absent. Do not
ignore `.codboard/config.json`.

## 7. Insert the managed pointer block in `CLAUDE.md`

If `CLAUDE.md` exists, insert (or refresh, idempotently) this block between the markers.
If it exists already, replace everything between the markers rather than duplicating.
**The block contains only pointers — never the workflow parameters themselves.**

```markdown
<!-- codboard:begin -->
## CodBoard sync (MANDATORY)

This repository is tracked on CodBoard, project **<projectName>** (see
`.codboard/config.json`). The CodBoard plugin drives the sync.

The **four** config areas below live **in CodBoard** and are the source of truth. Read
them at the start of a session with `get_workflow` and follow them. **Never copy their
values into this file or any repo file** — they are per-project and change.

- **Workflow** — `statuses`, `transitions` (guarded), `playbook`.
- **Automation** — `autoMergeMode`, `watch`, `autoCreatePr`, `ciCheckName`.
- **Testing** — `testing.testPlans` (never|when_possible|always), `testing.capture.{screenshots,video}` (off|when_possible|required).
- **Report** — `reportPrompt` + `automation.reportingCadence` (on_task_finished|on_each_note|manual).

Push every dev milestone to CodBoard the moment it happens (branch, PR, status, test plan,
capture, done, report) — do not batch it to the end. Do not merge a PR unless
`automation.autoMergeMode` allows it; when it is `none`, the owner merges.

Plugin hooks enforce this deterministically: the turn is blocked from ending while a
created branch/PR is unmirrored (Workflow), a finished task lacks a required test plan or
capture (Testing), or the daily report is stale versus the cadence (Report); and a merge
that violates `autoMergeMode` (Automation) is blocked.
<!-- codboard:end -->
```

If `CLAUDE.md` does not exist, offer to create a minimal one containing just this block.

## 8. Offer the non-Claude agent + PR pointers (ask first)

These help agents and humans that never read `CLAUDE.md`. Offer to create/refresh, only
with the user's ok:

- `AGENTS.md` (Codex CLI and other agents) and `.github/copilot-instructions.md` — short
  pointers to `.codboard/config.json` + the "sync at every milestone, don't copy the
  workflow into repo files" rule. Again: pointers only, no workflow parameters.
- `.github/PULL_REQUEST_TEMPLATE.md` — add one checklist line if the file exists (create
  only if the user wants it): `- [ ] CodBoard task up to date (branch, PR, status, test plan) — or N/A`.

## 9. Offer team-wide enablement via committed `.claude/settings.json` (ask first)

So the whole team gets the plugin on clone (CLI and Claude Code web), offer to add to a
committed `.claude/settings.json` (merge, do not clobber existing keys):

```json
{
  "extraKnownMarketplaces": {
    "badjilounes": { "source": { "source": "github", "repo": "badjilounes/claude-code-plugins" } }
  },
  "enabledPlugins": { "codboard@badjilounes": true }
}
```

Mention that Claude Code web also needs network access to `mcp.codboard.com` allowed in
the environment, and OAuth authorised once in the browser.

## 10. Summarise

Report what was written (`.codboard/config.json`, `.gitignore` line, CLAUDE.md block, and
any optional files), the resolved project/repo/workflow ids, and the two remaining manual
steps: authorise the OAuth connector once in the browser, and commit these files so the
whole team is covered. Suggest committing on a branch + PR per the repo's own workflow.
