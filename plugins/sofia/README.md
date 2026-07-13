# Sofia (Claude Code plugin)

Drive **Sofia**, the multi-channel AI social-publishing platform, from Claude Code.

## What you get

- The **Sofia MCP server** (local, stdio) exposing 11 tools: discovery, connected
  accounts, missions (AI campaigns) and publications.
- A **sofia-campaign** skill that walks Claude through the campaign loop.

## Setup

The MCP server ships inside the Sofia monorepo (`apps/sophia-mcp-server`); it is not
published to npm. Build it once, then point the plugin at the built entry:

```bash
# in the playground-factory (Sofia) checkout
npx nx build sophia-mcp-server
# → dist/apps/sophia-mcp-server/main.js
```

Set these environment variables (read by the plugin's `.mcp.json`):

| Variable | Purpose |
| --- | --- |
| `SOFIA_MCP_SERVER_PATH` | Absolute path to the built `main.js` |
| `SOPHIA_API_URL` | Sofia API base URL incl. `/api` (default `http://localhost:3000/api`) |
| `SOPHIA_EMAIL` / `SOPHIA_PASSWORD` | The Sofia account the server acts as |

The server signs in via `POST /auth/login`, caches the JWT and refreshes it — the Sofia
API has no API-key, so it authenticates as this one account.

## Install

```bash
claude plugin marketplace add badjilounes/claude-code-plugins
claude plugin install sofia@badjilounes
```

## Tools

- `get_sofia_capabilities` · `get_supported_platforms` · `list_connected_accounts`
- `list_missions` · `get_mission` · `create_mission` · `accept_mission_plan` · `reject_mission_plan`
- `list_publications` · `create_publication` · `publish_publication`

Design rationale: [ADR 0025](https://github.com/badjilounes/playground-factory/blob/main/docs/adr/0025-sofia-mcp-server-surface.md) in the Sofia repo.
