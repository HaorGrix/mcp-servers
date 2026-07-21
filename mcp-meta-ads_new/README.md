# Meta Ads MCP — ACTIVE COPY (v2.0.0)

MCP server over the Meta Marketing (Graph) API. Read-only by default; writes are opt-in
and always create PAUSED objects.

The retired duplicate lives at [`../archive/mcp-meta-ads-v1-deprecated/`](../archive/mcp-meta-ads-v1-deprecated/) —
kept for reference, superseded by this rewrite.

- **Graph API:** v23.0 (configurable)
- **Registered** in `~/.claude.json` as `meta-ads`
- **Transport:** stdio

## Tools

### Read (always available)

| Tool | Returns |
|---|---|
| `list_ad_accounts` | Every account the token reaches — status, currency, lifetime spend |
| `get_ad_account` | One account: balance, spend cap, funding source, timezone |
| `list_campaigns` | All campaigns, paginated; budgets, objective, schedule. Optional `effective_status` filter |
| `list_adsets` | Ad sets for an account or one campaign, including full targeting specs |
| `list_ads` | Ads for an account, campaign, or ad set |
| `list_creatives` | Headlines, body copy, CTAs, image/video refs, story specs |
| `get_insights` | Performance at any level, with date ranges, daily rows, and breakdowns |
| `get_account_snapshot` | One-shot audit: everything above in a single call |

### Write (only when `META_ALLOW_WRITES=true`)

| Tool | Effect |
|---|---|
| `create_campaign` | Creates a **PAUSED** campaign |
| `create_adset` | Creates a **PAUSED** ad set with caller-supplied targeting |
| `update_status` | ACTIVE / PAUSED / ARCHIVED on any node. **ACTIVE can start spending** |

When writes are disabled the tools are not registered at all, so a caller cannot invoke
them by guessing the name.

## `get_insights` parameters

| Param | Notes |
|---|---|
| `target_id` | Account, campaign, ad set, or ad id (**required**) |
| `level` | `account` \| `campaign` \| `adset` \| `ad` |
| `date_preset` | `maximum`, `last_30d`, `last_quarter`, … |
| `since` / `until` | `YYYY-MM-DD`; must be supplied together, overrides `date_preset` |
| `time_increment` | `"1"` for daily rows, `monthly`, `all_days` |
| `breakdowns` | `age,gender` · `country` · `region` · `device_platform` · `publisher_platform,platform_position` |
| `action_breakdowns` | e.g. `action_type` |
| `filtering` | JSON filter array, passed through |
| `fields` | Comma-separated override |
| `use_lite_fields` | Reduced projection for heavy queries |

## What v2 fixes

The v1 server silently returned incomplete data. Verified against the Podium account:

| | v1 | v2 |
|---|---|---|
| Pagination | **none — page 1 only** (returned 25 of 31 campaigns) | follows `paging.next` to exhaustion |
| Insights fields | Meta's thin default (**spend + impressions only**) | 29 fields incl. actions, CPC/CPM/CTR, rankings |
| `level` | **ignored** — every call returned account totals | honoured at all four levels |
| Breakdowns | not supported | age/gender, country, region, placement, device |
| Date ranges | `date_preset` only | presets **or** explicit `since`/`until`, daily increments |
| Entities | accounts, campaigns only | + ad sets, ads, creatives, snapshot |
| Graph version | v20.0 (EOL) | v23.0, configurable |
| Errors | thrown raw | typed, retried with backoff, trace ids surfaced |
| Write safety | always exposed | opt-in via env; PAUSED-only creates |
| Structure | one 220-line file | `src/config` · `src/graph` · `src/fields` · `src/tools` |

**Auto-degrade:** Meta answers heavy ad-level daily queries with a contentless
`code 1 / subcode 99`. v2 catches that, retries with the reduced projection, and flags the
response with `degraded` rather than failing.

## Setup

```bash
npm install
cp .env.example .env    # then put a real token in it
npm run check           # syntax gate
```

`.env` is gitignored. Never commit a token.

Register (already done):

```bash
claude mcp add meta-ads -- node "$(pwd)/index.js"
```

## Response shape

Paginated tools return `{ data: [...], pages: N, truncated: bool }`. Check `truncated` —
it means `META_MAX_PAGES` was hit and results are incomplete. Errors come back as MCP
`isError` results carrying the Graph code, subcode, and `fbtrace_id`.

## Token note

The token in `.env` is a **System User token** (app `podium_ads`, id `4340118169640058`)
that **does not expire** (`expires_at: 0`). Scopes: `ads_management`, `ads_read`,
`business_management`, `pages_manage_ads`, `pages_read_engagement`, `pages_show_list`,
`catalog_management`.

**Known limit:** the `podium_ads` app is in **Development mode**, so creative and ad
creation fail with *"Ads creative post was created by an app that is in development mode."*
Reads, campaigns and ad sets all work. Switch the app to Live at developers.facebook.com to
lift this, or build ads in Ads Manager instead.
