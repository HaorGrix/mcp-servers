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

### Analytics (always available — added v2.1.0)

Deeper reads across the Meta ecosystem, all on existing scopes (`ads_read`,
`pages_read_engagement`, `business_management`). Endpoints that need a scope the token
lacks return a clear error string instead of failing the whole call.

| Tool | Returns |
|---|---|
| `get_creative_breakdown` | Ad-level performance joined with each ad's creative — which exact creative drove results |
| `get_daypart` | Spend / clicks / conversations by hour of day (viewer timezone) |
| `get_video_metrics` | Video retention per ad: plays, thruplays, 25/50/75/95/100%, avg watch time |
| `get_quality_rankings` | Meta's quality / engagement / conversion rankings per ad |
| `get_messaging_funnel` | WhatsApp/Messenger: conversations, first replies, depth-2/3/5, cost per conversation, optional breakdown |
| `get_page` | Facebook Page metadata — followers, rating, contact, linked Instagram |
| `get_page_insights` | Organic Page insights over time (impressions, engaged users, follower growth, views) |
| `list_page_posts` | Organic posts with reach, engagement, clicks, reaction/comment/share counts |
| `list_audiences` | Custom / lookalike / saved audiences: size, fill status, retention |
| `estimate_audience` | Reach estimate for a targeting spec (`delivery_estimate`) |
| `compare_accounts` | Side-by-side totals for two+ accounts (BD vs US) |
| `get_business_assets` | Business portfolios + owned/client ad accounts and pages — ownership mapping |
| `full_analytics_snapshot` | One-shot deep pull: ad insights + creative + day-part + video + quality + messaging funnel + breakdowns |

**Wall (not a code problem):** WhatsApp message content, contact identity, and true
unique-lead count are **not** reachable from the ad account. They require the WhatsApp
number connected to the Business inbox / Cloud API (`whatsapp_business_management`), plus
that portfolio's admin approval. `get_messaging_funnel` returns the ad-side counts and
says so in a `note`.

### Governance, scale & intelligence (always available — added v3.0.0)

| Tool | Returns |
|---|---|
| `get_change_history` | Audit log (adactivity): who changed budgets/status/targeting and when |
| `get_recommendations` | Meta's own optimization suggestions for an account/campaign |
| `list_ad_rules` | Automated rules configured on the account (conditions, actions, schedule) |
| `async_insights_report` | Heavy historical pulls via Meta's async job API (submit → poll → fetch) |
| `get_reach_frequency_prediction` | Estimated reach for a budget/targeting over a window |
| `get_rate_limit_status` | Live API usage the server has observed; it auto-throttles above 80% |

The Graph client now parses Meta's usage headers (`x-app-usage`, `x-ad-account-usage`,
`x-business-use-case-usage`) and proactively slows down near the ceiling, so agency-scale
pulling doesn't hit a hard block.

### Billing & finance (always available — added v3.1.0)

| Tool | Returns |
|---|---|
| `get_billing_summary` | Lifetime spend, outstanding balance owed to Meta, status decoded to words, card on file, prepay/postpay, owning business |
| `get_billing_charges` | **Every real card charge** with transaction id, amount and timestamp; reconciles charges + balance against lifetime spend |
| `get_funding_history` | Card add/remove events, prepaid top-ups and every status transition — how many cards the account has actually used |
| `get_spend_ledger` | Day-by-day spend with a running total, reconciled against the account's own `lifetime_spend` |
| `get_payment_methods` | Current funding source (brand + last 4); states that card history is not retrievable |
| `list_unsettled_accounts` | Sweeps every visible account for unpaid balances or non-ACTIVE status |
| `check_scopes` | Which permissions the token actually holds, and which capabilities are therefore unavailable |

**Meta removed the `/transactions` edge** — verified absent in v16 through v23 — but the billing
data itself survived in the **adactivity audit log**. `ad_account_billing_charge` events carry a
`transaction_id`, amount and timestamp; `remove_funding_source` and `funding_event_successful`
record card swaps and prepaid top-ups. `get_billing_charges` and `get_funding_history` read those,
which is how per-charge receipts and card history are recovered without the removed edge.

Still not obtainable by any route: **which card paid which charge**, and the brand/last-4 of a
removed card (Meta redacts these to "Credit/debit card"). Only the current card's last 4 is exposed.

`check_scopes` exists because Meta returns an **empty array, not an error**, when a scope is
missing — so "no data" and "no permission" look identical. Run it before concluding an account
list is complete.

### Write (only when `META_ALLOW_WRITES=true`)

Standard object creation:

| Tool | Effect |
|---|---|
| `create_campaign` | Creates a **PAUSED** campaign |
| `create_adset` | Creates a **PAUSED** ad set with caller-supplied targeting |
| `create_ad` | Creates a **PAUSED** ad from a post or creative |
| `update_status` | ACTIVE / PAUSED / ARCHIVED on any node. **ACTIVE can start spending** |

Optimization & automation (added v3.0.0) — the "make the ads smarter" layer:

| Tool | Effect |
|---|---|
| `capi_send_event` | Conversions API: send a server-side event (Lead, Schedule, Purchase). PII SHA-256 hashed locally |
| `upload_offline_conversions` | Batch-upload real outcomes (enrolled students, closed sales) so Meta optimizes toward customers |
| `create_custom_audience` | Create an empty custom audience to fill from a CRM list |
| `add_audience_users` | Add hashed emails/phones to a custom audience |
| `create_lookalike` | Lookalike of enrolled families — target parents who resemble real customers |
| `create_ad_rule` | Automated rule (auto-pause losers, auto-scale winners, dayparting). Defaults to DISABLED |
| `bulk_update_status` | Same status across many nodes at once |
| `duplicate_campaign` | Deep-copy a campaign into the same or another account (e.g. BD winner → US). Copy is **PAUSED** |

All PII is SHA-256 hashed inside the process before any request leaves it. New objects are
created PAUSED / DISABLED; nothing here starts spending on its own.

### Real-time webhooks (`webhook.js` — separate process)

`node webhook.js` runs a standalone receiver for **push** events (leadgen the instant it
submits, messaging events once WhatsApp is on Cloud API, ad-account changes). It needs a
public HTTPS URL and the verify token / app secret in env, then register the URL in the
Meta App → Webhooks. It verifies `X-Hub-Signature-256`, acks fast, and appends events to a
JSONL log (swap the `onEvent` hook to fan out to Slack / a sheet / a CRM). Not started by
the MCP; deploy it where it can receive.

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
