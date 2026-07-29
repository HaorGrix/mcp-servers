# Changelog

All notable changes to the consolidated MCP servers workspace will be documented in this file.

## [Unreleased]
### Security
- **The compromised Google service-account key is now rotated — closing the open action from
  [2026-07-22].** Both `google-analytics-mcp` and `google-search-console-mcp` authenticate on a
  freshly issued key for `search-console-mcp@haorgrix-mcp.iam.gserviceaccount.com`
  (`private_key_id b6065946…`), verified by a live Google token exchange before anything was
  removed. The two superseded key ids (`631156c63fa808681f10f3466368aee91335db27`,
  `5a393106448c92a76ae4c0f5fd6af88ae4a401d6`) were then deleted in Google Cloud IAM. The
  credential that was purged from git history on 2026-07-22 — and independently harvested in the
  2026-06-24 server breach — no longer authenticates anywhere.
- **Known gap, unchanged by the rotation:** both Google servers still share a *single* credential
  covering GA4 Admin and Search Console. The rotation replaced one shared key with one shared key.
  Splitting it into two scoped keys is still open and needs an owner ruling.

## [2026-07-22]
### Security
- **Purged two committed Google service-account private keys from git history**
  (`google-analytics-mcp/credentials.json`, `google-search-console-mcp/credentials.json`)
  with `git-filter-repo` before the repository was published. Both keys must be treated
  as compromised and rotated in Google Cloud.
- `.gitignore` now excludes `credentials.json`, `*service-account*.json` and local API
  result dumps; `credentials.example.json` added for both Google servers.
- `google-search-console-mcp/.env.example` added — it was the only server without one.

### Added
- Product Requirements Documents for all six servers plus a portfolio index, in
  `documentation/PRD/`. Generated from source via `python3 documentation/PRD/_build/build.py`.

### Changed
- Published as the private monorepo `HaorGrix/mcp-servers`.
- Meta Ads v1 moved to `archive/mcp-meta-ads-v1-deprecated/` with an archive README.
- Root `README.md` rewritten: all six servers, tool counts, env vars, and credential setup.

## [2026-07-21]
### Changed
- **meta-ads MCP rewritten to v2.0.0** (`mcp-meta-ads_new/`). The v1 server returned
  incomplete data: `list_campaigns` never paginated (25 of 31 campaigns on the Podium
  account) and `get_insights` ignored `level`, returning only spend + impressions.
- Graph API bumped v20.0 (EOL) -> v23.0, now configurable via `META_API_VERSION`.
- Split the single 220-line `index.js` into `src/config.js`, `src/graph.js`,
  `src/fields.js`, `src/tools.js`; `index.js` is now transport + dispatch only.
- Replaced axios with native fetch; dependency dropped.

### Added
- Cursor pagination to exhaustion, with `truncated` flag on the page cap.
- Retry with exponential backoff + jitter on retryable Graph codes and 5xx/429.
- `get_insights`: `level`, `since`/`until`, `time_increment`, `breakdowns`,
  `action_breakdowns`, `filtering`, field overrides, 29-field default projection.
- Auto-degrade: heavy queries failing Meta's `code 1 / subcode 99` retry with a reduced
  projection and return a `degraded` marker instead of erroring.
- New tools: `get_ad_account`, `list_adsets`, `list_ads`, `list_creatives`,
  `get_account_snapshot`, `create_adset`, `update_status`.
- `.env.example` documenting every config key.

### Security
- Write tools are opt-in via `META_ALLOW_WRITES` and unregistered when disabled, so they
  cannot be invoked by guessing a tool name. Creates are always PAUSED.
- Input validation on account and node ids before any request is issued.
- Config validation at boot: the server exits rather than starting with a placeholder token.

### Deprecated
- `mcp-meta-ads/` renamed to `mcp-meta-ads_OLD-do-not-use/` with a README explaining why.
  Nothing deleted.

## [2026-07-07]
### Added
- Created the centralized `MCP/` repository workspace.
- Consolidated `mcp-meta-ads` from `/Users/musfiqurtuhin/Documents/MusfiqurTuhin/WorkSpace/mcp-meta-ads`.
- Consolidated `wordpress-mcp` from `/Users/musfiqurtuhin/Documents/MusfiqurTuhin/Dev/automation/wordpress-mcp`.
- Consolidated `cpanel-mcp` from `/Users/musfiqurtuhin/Documents/MusfiqurTuhin/Dev/automation/cpanel-mcp`.
- Built and integrated a new `google-analytics-mcp` server supporting GA4 reporting and admin tools.
- Created root `.gitignore` file to securely ignore `.env` files, build output folders, and `node_modules`.
- Created unified `README.md` with descriptions and instructions for all MCP servers.
- Initialized local Git repository for version control.

### Changed
- Updated `/Users/musfiqurtuhin/Library/Application Support/Claude/claude_desktop_config.json` to point to the new consolidated paths for the WordPress and cPanel MCP servers, and registered the new `google-analytics` MCP server.

## [2026-07-07] — Enterprise Growth Acceleration Sprint

### MCP Server Enhancements
- **GSC MCP v2.0.0**: Expanded from 2 to 10 tools — added `inspect_url`, `list_sitemaps`, `submit_sitemap`, `delete_sitemap`, `submit_url_for_indexing`, `get_indexing_status`, `get_ctr_rescue_candidates`, `get_position_changes`. Added advanced search analytics with 25K row limit, search type filtering, dimension filters, and aggregation modes.
- **GA MCP**: Added 4 new tools — `ga_get_top_conversion_paths`, `ga_get_landing_page_performance`, `ga_get_user_acquisition`, `ga_get_event_breakdown` for conversion funnel analysis and attribution.

### Conversion Infrastructure (server/haorgrix)
- **ExitIntent.tsx**: New exit-intent popup for BOFU pages. Desktop mouseout + mobile scroll-up detection. Session-gated, delay-activated, auto-adapts variant (audit vs. book call) based on B2B cookie.
- **StickyBottomCTA.tsx**: New persistent bottom CTA bar. Scroll-triggered, dismissible, mobile-safe with 44px+ tap targets. Promotes free AI audit.
- **ContentGate.tsx**: New email-gated content download component. Captures leads via /api/contact, auto-triggers download, tracks GA4 generate_lead conversion.
- **Contact API**: Added honeypot spam trap, UTM parameter extraction (source/medium/campaign/term/content), referrer tracking, landing page attribution, timezone detection, user-agent capture.

### SEO Architecture
- **middleware.ts**: Expanded matcher to /book, /contact, /blog, /free-audit, /growth-report. Added X-Robots-Tag noindex for non-semantic geo pages.
- **layout.tsx JSON-LD**: Added SearchAction (sitelinks search box), SpeakableSpecification (AI citation), areaServed, knowsAbout, OfferCatalog, foundingDate, numberOfEmployees.
- **next.config.mjs**: Added experimental.optimizePackageImports for lucide-react and framer-motion.

### Analytics Instrumentation
- **WhaleTracker.tsx**: Extended from BOFU-only to site-wide tracking. Added rage-click detection, form abandonment tracking (120s timer).
- **analytics.ts**: Added LinkedIn Insight Tag, Microsoft Clarity custom tags, GA4 Enhanced Conversions data layer, booking intent tracker, exit intent tracker.

## [2026-07-27] — Team handoff docs

- Added `documentation/TEAM-SETUP.md`: build, credential, and MCP registration steps for a fresh machine.
- Added `documentation/config/mcp.template.json`: portable 10-entry config with `__MCP_ROOT__` placeholder (no secrets).
- Documented that the sending machine`s Claude Desktop config still points at the pre-move `HaorGrix/MCP/...` path.

## [2026-07-27] — Handoff tooling and repo corrections

- Added `bootstrap.sh`: one-command install (creds, build, config, register, verify). `creds.txt` optional when `.env` files already exist.
- Added `AGENT-SETUP.md`: clone-to-working guide with failure table and production-access rules.
- Committed `meta-business-mcp` (13 tools) and `zoho-mail-mcp` (14 tools), previously untracked.
- README corrected: 6 servers / 161 tools -> 8 servers / 188 tools.
- Set `META_ALLOW_WRITES=false` in meta-ads and meta-business `.env` (was `true`; could activate campaigns and start real spend).
