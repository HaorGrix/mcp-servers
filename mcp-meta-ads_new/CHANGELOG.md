# Changelog

## [2026-08-01] — 3.0.0 — Enterprise expansion (optimize / automate / react / scale / govern)

Full enterprise build on top of the v2.1 analytics layer. 39 tools with writes enabled
(27 read-only). Everything opt-in and safe: no tool auto-executes a mutation or spend.

Engine (src/graph.js):
- Rate-limit intelligence — parses x-app-usage / x-ad-account-usage /
  x-business-use-case-usage and auto-throttles (500ms >=80%, 2s >=95%). Verified live.
- Async insights reports (submit -> poll -> fetch) for heavy pulls that time out.

Governance & scale (src/govern.js, read): get_change_history (audit log),
get_recommendations (Meta's own suggestions), list_ad_rules, async_insights_report,
get_reach_frequency_prediction, get_rate_limit_status. All verified live.

Optimization & automation (src/optimize.js, behind META_ALLOW_WRITES):
capi_send_event, upload_offline_conversions, create_custom_audience, add_audience_users,
create_lookalike, create_ad_rule, bulk_update_status, duplicate_campaign. PII is
SHA-256 hashed locally; new objects created PAUSED/DISABLED. Built + syntax/boot verified;
not executed (no spend/mutation while unattended).

Real-time (webhook.js, standalone): push receiver for leadgen / messaging / account-change
events, with X-Hub-Signature-256 verification. Needs public HTTPS hosting + subscription.

Not yet wired (needs access/connection, documented): message content / contact identity
(WhatsApp Cloud API connection), leads_retrieval + pages_messaging + instagram scopes,
higher-privilege token for business-user/admin listing, cross-MCP GA4/GSC attribution.


## [2026-08-01] — 2.1.0 — Analytics expansion

Added 13 read-only analytics tools (`src/analytics.js`), wired into `index.js`
(now 21 tools total). All run on existing scopes (`ads_read`,
`pages_read_engagement`, `business_management`); no new permissions required.

New tools: `get_creative_breakdown`, `get_daypart`, `get_video_metrics`,
`get_quality_rankings`, `get_messaging_funnel`, `get_page`, `get_page_insights`,
`list_page_posts`, `list_audiences`, `estimate_audience`, `compare_accounts`,
`get_business_assets`, `full_analytics_snapshot`.

- Exported `assertAccountId`, `assertNodeId`, `insightsParams` from `src/tools.js`
  for reuse; added video/quality/page/audience field sets + `MESSAGING_ACTION_TYPES`
  to `src/fields.js`.
- Endpoints degrade to a clear error string where a scope is missing, so one
  permission gap never sinks a snapshot.
- Documented the WhatsApp wall: message content / contact identity / true unique-lead
  count need the number connected to the Business inbox (Cloud API), not an MCP change.
- Verified live against the Podium accounts (BD act_4366636926998849, US
  act_3492079200934757): messaging funnel, day-parting, video retention, quality
  rankings, page metadata, cross-account compare, and asset mapping all return real data.

## [2.0.0] — Rewrite

Paginated reads, insights with breakdowns, guarded (opt-in, always-PAUSED) writes.
