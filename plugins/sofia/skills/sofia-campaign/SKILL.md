---
name: sofia-campaign
description: >-
  Run a Sofia campaign — a series of posts around one objective. Use when asked to plan a
  campaign, propose a schedule of posts, or accept or reject a plan Sofia proposed. Drives the
  Sofia MCP campaign tools.
---

# Campaigns with Sofia

A campaign is one objective and a plan of publications. Two ways in, and the difference matters to
the user.

## Before either: know the ground

1. `get_sofia_profile` — the establishment, its connected accounts, its campaign preferences.
2. `get_sofia_capabilities` — templates, tones, narrative phases, formats per platform. Use those
   **exact** values; never invent a tone or a phase name.
3. `list_connected_accounts` — you cannot plan a post on a platform that is not connected with
   publishing permission.

## Mode A — you write the plan, Sofia judges it

`create_campaign { objective, tone, name?, context?, plan? }`, or `propose_campaign_plan` on an
existing campaign.

Sofia validates the plan before holding it, and refuses it whole with a named reason rather than
keeping half: a window that ends before it starts, a platform outside the campaign's channels, a
channel that is not connected, a date outside the window, a format the platform does not serve, a
caption too long. Fix and resubmit — do not strip the offending post silently, the user asked for
it.

`attach_campaign_media` adds a media to a planned publication; `remove_planned_publication` takes
one out.

## Mode B — Sofia writes the plan

`create_campaign` **without** `plan`. Sofia's planner proposes one; poll `get_campaign` until a
plan appears with a proposed status. Present it, then `accept_campaign_plan` or
`reject_campaign_plan` with a reason — the reason steers what gets regenerated, so a vague one
wastes a round.

## The control level is not yours

Sofia decides whether a campaign runs with a human in the loop or on its own, from the **account's
preference**, set in Sofia. There is no `controlLevel` argument on any tool, and the API refuses
the field outright when it comes from a connector.

This is deliberate, and worth saying to a user who asks for "fully automatic": an external agent
that could set that field would be granting itself permission to bypass the person it acts for. If
they want it, they change it in Sofia — one screen, thirty seconds, and it is their decision.

**When that preference is `auto`, creating a campaign requires the `publish` scope**, even without
a plan: Sofia will accept the plan and schedule the posts by itself, and that is publishing by
ricochet. A refusal here reads `insufficient_scope` — relay it, ask the user to re-authorize.
Accepting a plan (`accept_campaign_plan`) always requires `publish`.
