---
name: sofia-stats
description: >-
  Read Sofia's social-media statistics — reach, engagement, follower counts, per-post metrics,
  comments, content audit. Use when asked how a post or an account performed, or to compare
  networks. Drives the Sofia MCP statistics tools.
---

# Reading Sofia's statistics

Six tools: `get_cross_network_insights`, `get_network_insights`, `list_network_publications`,
`get_publication_metrics`, `list_post_comments`, `get_content_audit`. They need the `stats` scope,
granted separately — the first refusal is Sofia asking the user, not a bug.

## Read `status` before `value`

Every metric arrives as `{ status, value?, reason?, granularity? }`.

**`unavailable` is not zero.** It means Sofia could not read the figure — below the network's
follower threshold, permission not granted, not collected for that period. A model that reads
`value` without looking at `status` sees `undefined`, writes "0", and the user concludes their
campaign reached nobody. Say "unknown", and say why.

Never sum readings of different `granularity`. Never average a figure with a missing one.

## What you cannot ask for

- The period is one of **three** values, 28 days at most. A quarter is out of reach — say so
  instead of stitching windows together.
- There is no filter by account: one account per platform per establishment.
- There is no arbitrary date range.

Sending an unsupported parameter does not raise an error; you get something else back and build on
it without noticing. Ask only for what exists.

## Freshness

Figures are read live from the networks and cached five minutes. `fetchedAt` says when. When a
user asks "is this up to date?", quote `fetchedAt` rather than reassuring them.
