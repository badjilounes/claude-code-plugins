# Sofia (Claude Code plugin)

Drive **Sofia**, the multi-channel AI social-publishing platform, from Claude Code.

## Install

```bash
claude plugin marketplace add badjilounes/claude-code-plugins
claude plugin install sofia@badjilounes
```

Then ask for anything Sofia does. The first call returns a 401, Claude Code follows it to Sofia's
consent screen, you approve in your browser, and that is the whole setup.

**No key to paste. No password in a config file.** The plugin's entire configuration is one URL:

```json
{ "mcpServers": { "sofia": { "type": "http", "url": "https://mcp.sofia-post.com/mcp" } } }
```

Any valid Sofia account works. There is no waiting list.

## What you are agreeing to

The consent screen names the application asking, the domain it will redirect to, and the
permissions it wants. Sofia asks for them **one at a time**, as they become necessary:

| Scope | What it opens |
| --- | --- |
| `read` | profile, connected accounts, media library, publications, campaigns |
| `write` | create and modify posts, campaigns and media — nothing is sent to a network |
| `publish` | send a post, schedule one, accept a campaign plan |
| `stats` | reach, engagement, per-post metrics, comments |

The first connection asks only for `read`. The day you ask for something to be published, Sofia
asks again, for `publish` alone. You always see what changed.

An application you do not recognise is flagged as such on the consent screen. A recognised
integration is only ever labelled recognised when **both** its declared identity and its
redirection match what Sofia expects — a familiar-looking domain is not enough.

## Revoking

**Sofia → Settings → Connected applications → Revoke.** It takes effect on the connector's next
call — not when some token expires. Signing out of all your devices on the web revokes your
connectors too; the reverse is not true.

## Choosing the establishment

If your account manages several establishments, you pick one **in the conversation**: the tool
answers `{ kind: "choose_establishment", establishments: [...] }`, the assistant shows you the
list and calls again with your answer. One establishment and it never asks. The consent you gave carries no
establishment — it says "this person, on whichever establishment they are currently a member of".
Leave one, and the connector loses it at the same moment you do.

## The tools

**Discovery** — `get_sofia_capabilities`, `get_supported_platforms`, `get_publishing_options`,
`list_establishments`, `get_establishment`, `list_connected_accounts`, `get_sofia_profile`

**Media** — `search_media`, `get_media`, `upload_media`

**Publications** — `create_publication`, `get_publication`, `list_publications`,
`update_publication`, `publish_publication`, `validate_publication`, `reschedule_publication`,
`delete_publication`

**Campaigns** — `create_campaign`, `propose_campaign_plan`, `list_campaigns`, `get_campaign`,
`accept_campaign_plan`, `reject_campaign_plan`, `remove_planned_publication`,
`attach_campaign_media`

**Statistics** — `get_cross_network_insights`, `get_network_insights`,
`list_network_publications`, `get_publication_metrics`, `list_post_comments`, `get_content_audit`

## Skills

- **`sofia-publish`** — profile → accounts → media → post → publish or schedule → verify.
  Scheduling in a named timezone, and what Sofia does on the two nights a year when an hour
  happens twice or not at all.
- **`sofia-campaign`** — the two modes (you write the plan, or Sofia does), and why the control
  level is a Sofia preference rather than an agent parameter.
- **`sofia-stats`** — read `status` before `value`; `unavailable` is not zero.

## Elsewhere than Claude Code

The same server works with any MCP client that speaks OAuth. The URL is always
`https://mcp.sofia-post.com/mcp`.

| Client | How |
| --- | --- |
| Claude Code | this plugin, or `claude mcp add --transport http sofia https://mcp.sofia-post.com/mcp` |
| claude.ai | Settings → Connectors → Add custom connector, paste the URL |
| Cursor | add an MCP server of type `http` with that URL |
| ChatGPT | developer mode → add a connector |
| Gemini | add an MCP server with that URL |

> **Interop is verified client by client, and this table says what is configured, not what was
> observed.** Each client's real behaviour — how it registers, whether it follows a step-up on
> `insufficient_scope`, how it handles refresh and revocation — is recorded in the Sofia
> repository as it is actually tested. Where a client has not been through that yet, expect the
> connection to work and the finer points to be unproven.

## Requires

Sofia 2026.09 or later, and a Claude Code that supports HTTP MCP servers with OAuth.
