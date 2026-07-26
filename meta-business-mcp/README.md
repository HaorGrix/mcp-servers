# meta-business-mcp

MCP server for the Meta Business Suite / Graph API. Sits a layer above the
ad-account MCP: businesses, owned and client assets, pages, Instagram, WhatsApp
accounts, and page/IG insights.

Uses the same `META_ACCESS_TOKEN` as `mcp-meta-ads_new`. Needs the scopes
`business_management`, `pages_show_list`, `pages_read_engagement`, `ads_read`.

## Setup

```bash
npm install
cp .env.example .env    # paste the token
npm run build
claude mcp add meta-business -- node /Users/musfiqurtuhin/Documents/HaorGrix/Tooling/MCP/meta-business-mcp/dist/index.js
```

## Tools

Overview
- `meta_whoami` — token owner and granted permissions
- `meta_business_overview` — one call mapping businesses, pages, ad accounts, IG

Businesses
- `meta_list_businesses`
- `meta_business_assets` — owned/client ad accounts, pages, IG, WhatsApp
- `meta_business_users` — people and system users with roles

Pages
- `meta_list_pages` — pages managed, followers, linked IG
- `meta_page` — full page detail, rating, contact
- `meta_page_snapshot` — impressions, reach, engagement, fan growth
- `meta_page_posts` — recent posts with per-post reach and engagement

Instagram
- `meta_instagram` — profile, followers, media count
- `meta_instagram_insights` — reach, impressions, profile views, follower change

WhatsApp
- `meta_whatsapp_numbers` — numbers under a WABA, quality rating, status

Escape hatch
- `meta_graph_get` — read-only, any Graph GET path + fields

## Notes

Read-only. Every tool is a Graph GET; there are no write/mutate operations, so
it can inspect the business but never change it.

The token in use is a user token not tied to a Business Manager object, so
`meta_list_businesses` returns empty. Page, Instagram and ad-account data all
work regardless. To reach business-level assets (system users, owned WhatsApp
accounts), generate a token from inside Business Manager or add the user to the
business, then the same tools fill in.

Transient Graph errors (codes 1, 2, 4, 17, 341, 613 and 5xx) are retried with
backoff. The access token is redacted from every error message.

## What works vs what Meta gates

Confirmed working with a standard user token:
- `meta_whoami`, `meta_business_overview` — full asset map
- `meta_list_pages`, `meta_page`, `meta_page_snapshot` — page health (fans, followers, talking-about, rating)
- ad-account listing with lifetime spend
- `meta_graph_get` for any valid GET

Restricted by Meta (not by this server):
- `meta_page_posts` needs the app to hold **Page Public Content Access** (app review).
- Time-series page/post insights (impressions/reach over a period) were deprecated
  in recent Graph versions; only live node counts remain.
- `meta_list_businesses` is empty unless the token belongs to a Business Manager.
