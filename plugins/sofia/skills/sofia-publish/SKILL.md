---
name: sofia-publish
description: >-
  Write and publish a social-media post with Sofia. Use when asked to post, draft, schedule or
  publish something to Instagram, X, LinkedIn, TikTok or Facebook, to reuse a media from the
  library, to connect a social network that is missing, or to check whether a post went out.
  Drives the Sofia MCP tools.
---

# Publishing with Sofia

The `sofia` tools come with this plugin. You do not add an MCP server, and there is no key to
paste: the first call returns a 401, Claude Code follows it to Sofia's consent screen, and the
user approves in their browser.

## Which establishment

Every tool takes an optional `establishmentId`. Omit it when the account has only one — Sofia
resolves it. If the account manages several, a tool answers `{ kind: "choose_establishment",
establishments: [...] }`. That is **not an error**: show the list, ask, then call again with the
chosen id. Never pick for the user.

## The order that works

1. **`get_sofia_profile`** — who this establishment is, its connected accounts, its campaign
   preferences, and the context Sofia gives its own models. Read it before writing copy; it is the
   difference between a post that sounds like the place and one that sounds like an AI.
2. **`list_connected_accounts`** — a platform is publishable only if it is `connected` **and** its
   `publishPermission` is not `missing`. The answer also lists `missingPlatforms`: the networks
   Sofia offers that this establishment has not connected yet. If the one the user wants is there,
   see **When a network is missing** below — do not give up.
3. **`get_publishing_options { platform }`** — formats, media requirements, caption limits for
   that network. Never guess them, and never carry a limit you learned on one platform over to
   another.
4. **Media** — `search_media` to reuse something already in the library, `get_media` for one item,
   `upload_media` to add one (`sourceUrl` for an https address Sofia will fetch itself, or
   `base64` up to 10 MB).
5. **`create_publication`** — the post itself.
6. **`publish_publication`** to send it now, or leave it scheduled.
7. **`get_publication`** to confirm what actually went out, per network.

## When a network is missing

The user connects a network **themselves, in their browser, on Sofia** — never in this
conversation. You never ask for a password, a code or a token, and none ever reaches you.

1. Call **`connect_social_account { platform }`** (same `establishmentId` as the rest of the
   conversation). It needs the `write` scope: connecting an account is not publishing.
2. Show the user the `url` it returns and relay its `instructions`: open the link, sign in to Sofia
   if asked, authorize the network, then come back and say it is done. The link opens Sofia on
   the right establishment and starts the network's authorization directly.
3. **Wait** for the user to confirm. Do not poll.
4. Call **`list_connected_accounts`** again. Continue only once the network is `connected` with a
   `publishPermission` that is not `missing`; otherwise say what is still wrong.

Two refusals are answers, not failures — say them, do not retry:

- `platform_already_connected` — the network is already there; read `list_connected_accounts`.
- `platform_not_offered` — Sofia does not offer that network; `get_supported_platforms` lists the
  ones it does.

## Media references travel whole

When you attach a media, pass the `{ id, url }` **exactly as Sofia gave them to you**. Do not
rebuild the URL, do not strip its query string, do not keep one from a previous session: media
addresses expire, and a reference whose id and object do not agree is refused.

## Scheduling

Two mutually exclusive fields — pass one, never both:

- `scheduledAt` — an absolute ISO instant, with its offset. Use it when the user names a UTC time
  or you already resolved the timezone.
- `scheduledLocal { dateTime, timeZone, disambiguation? }` — a wall-clock time in a named zone.
  Prefer this whenever the user says "Tuesday at 9" — that is what they mean.

Sofia refuses a naive datetime rather than guessing an offset. On the night a clock goes back, an
hour happens twice: Sofia answers `ambiguous` **with both candidate instants** — show them and ask.
On the night it goes forward, an hour does not exist: Sofia answers `skipped`, and the user must
pick another time.

**A scheduled post requires the `publish` scope**, even though nothing is sent yet: Sofia's
scheduler will send it on its own, and the user must have agreed to that. If the call comes back
`insufficient_scope`, ask the user to re-authorize with publishing.

## What requires the user's agreement

`publish_publication`, `validate_publication`, `reschedule_publication` and a scheduled
`create_publication` all need `publish`. The first refusal is normal and expected — it is how
Sofia asks the user to widen what they granted, one step at a time. Relay the request; never
work around it.

## Deleting

`delete_publication` is destructive and does not un-publish anything already sent to a network.
Say so before calling it.
