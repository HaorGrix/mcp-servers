# Changelog

## [2026-08-15] — 3.1.0 — Billing & finance layer

Answers "what did this cost, do we still owe anything, and which card pays" — none of
which the previous 39 tools could do.

New (src/billing.js, 7 read-only tools):
- `get_billing_charges` — the real per-charge receipts: every card charge with transaction id,
  amount and timestamp, recovered from the adactivity audit log (`ad_account_billing_charge`)
  after Meta removed the /transactions edge. Asserts charges + outstanding == lifetime spend.
- `get_funding_history` — card add/remove events, prepaid top-ups and status transitions, so
  the number of cards an account has used over its life is recoverable.
- `get_billing_summary` — lifetime spend, outstanding balance, `account_status` decoded
  (nobody remembers that 3 = UNSETTLED), disable reason, funding source, prepay flag,
  spend cap, owning business.
- `get_spend_ledger` — daily spend with running total, reconciled against the account's
  own `lifetime_spend`; returns `reconciles_to_lifetime` plus a warning when it does not,
  so a partial ledger can't be mistaken for a complete one.
- `get_payment_methods` — current funding source, with the limitation stated in the payload.
- `list_unsettled_accounts` — sweeps visible accounts for balances owed or non-ACTIVE status.
- `check_scopes` — granted scopes mapped to capabilities. Meta returns an empty array rather
  than an error for a missing scope, so empty results were previously unexplainable.

Notes:
- Money fields are converted from Meta's minor units; `amount_spent: "31103"` now reads 311.03.
- Meta removed the `/transactions` edge (confirmed absent in v16-v23), and every other billing
  path probed (billing_transactions, payment_transactions, invoices, business_invoices,
  extendedcredits, payment_methods, billing, charges, receipts, statements) is dead too. The
  data was recovered from the audit log instead — an initial "not obtainable" conclusion that
  further probing disproved.
- Verified live against act_4366636926998849 (BD) and act_3492079200934757 (US): daily ledger
  reconciles to lifetime spend to the cent; BD charges 26 x $278.14 + $32.89 owed == $311.03
  spend; US 55 x $437.62 + $0 == $437.62. Sweep correctly flagged the $32.89 unsettled account.

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
