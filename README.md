# HaorGrix MCP Servers

A monorepo of the custom Model Context Protocol (MCP) servers HaorGrix maintains for agent-driven operations across marketing, hosting, publishing, and analytics platforms.

All six servers speak MCP over **stdio** and are registered in the local Claude client config.

## Servers

| Server | Path | Platform | Tools | Language |
| --- | --- | --- | --- | --- |
| Brevo | `brevo-mcp/` | Brevo (email marketing) | 21 | TypeScript |
| cPanel | `cpanel-mcp/` | cPanel UAPI | 51 | TypeScript |
| Google Analytics | `google-analytics-mcp/` | GA4 Data + Admin API | 18 | TypeScript |
| Google Search Console | `google-search-console-mcp/` | GSC + Indexing API | 10 | TypeScript |
| Meta Ads | `mcp-meta-ads_new/` | Meta Graph API | 12 | JavaScript (ESM) |
| WordPress | `wordpress-mcp/` | WP REST + WooCommerce + Cloudflare | 49 | TypeScript |

**161 tools total.** Superseded versions live in [`archive/`](archive/) and are not maintained.

Full product requirements for each server are in [`documentation/PRD/`](documentation/PRD/).

### 1. Brevo MCP (`brevo-mcp`)
Email marketing: account and sender checks, contact lists and imports, campaign lifecycle, and deliverability reporting.
* **Env**: `BREVO_API_KEY` (required), `BREVO_BASE_URL`, `BREVO_ENFORCE_SENDER`, `BREVO_AUDIT_LOG`
* **Safety**: dry-run mode, sender lock, rate limiting, audit log, and a `confirm` string gate on send/schedule.
* **Build/Run**: `npm run build && npm start` — tests via `npm test`

### 2. cPanel MCP (`cpanel-mcp`)
cPanel UAPI wrapper covering accounts, disk and bandwidth, PHP versions, SSL, email, domains and DNS, cron, backups, databases, and the file manager.
* **Env**: `CPANEL_HOST`, `CPANEL_USERNAME`, `CPANEL_PASSWORD`, `CPANEL_BASE_URL`
* **Note**: `cp_uapi_call` is an unbounded escape hatch to any UAPI module/function.
* **Build/Run**: `npm run build && npm start`

### 3. Google Analytics MCP (`google-analytics-mcp`)
GA4 realtime and historical reporting, metadata, plus Admin API management of custom dimensions, custom metrics, and conversion events.
* **Env**: `GOOGLE_APPLICATION_CREDENTIALS`, `GA4_PROPERTY_ID`
* **Build/Run**: `npm run build && npm start`

### 4. Google Search Console MCP (`google-search-console-mcp`)
Search analytics, URL inspection, sitemap management, Indexing API submission, and derived CTR-rescue / position-change analyses.
* **Env**: `GOOGLE_APPLICATION_CREDENTIALS`, `GSC_SITE_URL`
* **Note**: the Indexing API requires Owner permission on the property and is capped at roughly 200 requests/day.
* **Build/Run**: `npm run build && npm start`

### 5. Meta Ads MCP (`mcp-meta-ads_new`, v2)
Meta Graph API: ad accounts, campaigns, ad sets, ads, creatives, and insights with full pagination; campaign/ad-set/ad creation and status changes.
* **Env**: `META_ACCESS_TOKEN`, `META_API_VERSION`, `META_TIMEOUT_MS`, `META_MAX_RETRIES`, `META_PAGE_LIMIT`, `META_MAX_PAGES`, `META_ALLOW_WRITES`
* **Safety**: all write tools refuse unless `META_ALLOW_WRITES` is enabled.
* **Run**: `npm start` (no build step) — syntax check via `npm run check`

### 6. WordPress MCP (`wordpress-mcp`)
Posts, pages, media, users, comments, taxonomies and CPTs, WooCommerce products/orders/customers, multi-layer cache purging, Elementor CSS regeneration, and Cloudflare purge.
* **Env**: `WORDPRESS_URL`, `WORDPRESS_USERNAME`, `WORDPRESS_APP_PASSWORD`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`
* **Note**: `wp_get_post_meta`, `wp_update_post_meta`, and `wp_cache_status` require the *Agent Cache Control* mu-plugin, deployed by cPanel MCP's `cp_deploy_cache_helper`.
* **Build/Run**: `npm run build && npm start`

## Credentials

No secrets are committed. Each server ships a `.env.example`; the Google servers also ship `credentials.example.json`.

```bash
cd <server>
cp .env.example .env      # fill in real values
npm install && npm run build
```

`.env`, `credentials.json`, `*.pem`, and `*.key` are gitignored. Never commit a real service-account key — the two that were previously committed have been purged from history and must be treated as compromised until rotated.

## Registering with a Claude client

Point the client at the built entrypoint and pass credentials through `env`:

```json
"google-analytics": {
  "command": "node",
  "args": ["/absolute/path/to/MCP/google-analytics-mcp/dist/index.js"],
  "env": {
    "GOOGLE_APPLICATION_CREDENTIALS": "/absolute/path/to/MCP/google-analytics-mcp/credentials.json",
    "GA4_PROPERTY_ID": "123456789"
  }
}
```

Servers without a build step (Meta Ads) point directly at `index.js`.
