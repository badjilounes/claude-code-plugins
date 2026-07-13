---
name: sofia-campaign
description: >-
  Create and publish social-media campaigns with Sofia from Claude Code. Use when asked to
  create a campaign or mission, draft or schedule posts, or publish to Instagram / X /
  LinkedIn / TikTok / Facebook via Sofia. Drives the Sofia MCP tools: discover capabilities,
  create a mission, validate the AI-proposed plan, then create and publish publications.
---

# Sofia campaigns

The `sofia` MCP tools are provided by this plugin — you do not need to add an MCP server.

## Always start with discovery

Call `get_sofia_capabilities` first. It returns, from the Sofia backend, the supported
platforms, the available mission templates, and the valid control levels and tones. Use
those exact values — never guess a platform name, tone or control level.

Then `list_connected_accounts` to know which platforms the user can actually post to and
each account's `socialAccountId`.

## Running an AI campaign (mission)

1. `create_mission` with an `objective` (natural language), a `tone`, and a `controlLevel`
   (`manual` keeps a human in the loop; `full_auto` lets Sofia run).
2. The plan is generated asynchronously — poll `get_mission` until a plan appears with a
   proposed status.
3. Present the plan to the user. On approval call `accept_mission_plan`; otherwise
   `reject_mission_plan` with a reason to steer the regenerated plan.

## Posting directly

For a one-off post, `create_publication` with one `platformPublications` entry per target
(each needs a `platform` and a `socialAccountId` from `list_connected_accounts`), then
`publish_publication`.

## Notes

- The acting identity is the account configured in the plugin's environment — every action
  is on that user's behalf.
- X and LinkedIn have no native scheduling; Sofia handles timing server-side.
