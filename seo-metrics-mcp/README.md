# seo-metrics-mcp

MCP server for SEO authority and keyword data. Read-only. Three providers, one server.

## Providers and tools

**Open PageRank** (free, no card — the domain-authority proxy)
- `opr_get_pagerank` — 0-10 authority score, global rank, referring domains for up to 100 domains
- `opr_usage` — plan tier and remaining quota
- `opr_health` — service status

**Ahrefs API v3** (paid API add-on; `Authorization: Bearer`)
- `ahrefs_domain_rating` — DR (0-100) + Ahrefs rank
- `ahrefs_backlinks_stats` — backlink and referring-domain counts
- `ahrefs_refdomains` — referring domains ranked by DR
- `ahrefs_backlinks` — individual backlinks with anchor and nofollow flag
- `ahrefs_metrics` — organic traffic, keywords, traffic value
- `ahrefs_subscription_info` — API limits and usage
- `ahrefs_get` — generic v3 GET passthrough (reaches every endpoint: keywords-explorer, rank-tracker, site-audit, batch-analysis, ...)

**Keywords Everywhere** (credit-metered; `Authorization: Bearer`)
- `ke_keyword_data` — volume, CPC, competition, 12-month trend
- `ke_post` — generic v1 POST passthrough (related keywords, PASF, ...)

The `ahrefs_get` and `ke_post` passthroughs mean the full API surface of each provider is reachable without a tool per endpoint.

## Setup

```bash
pnpm install
cp .env.example .env   # fill in the three keys; .env is git-ignored, chmod 600
pnpm run build
pnpm run verify        # typecheck + build + MCP handshake
```

Registered in `~/.claude.json` under the HaorGrix project as `haorgrix-seo-metrics`; tools appear as `mcp__haorgrix-seo-metrics__*`. Keys are read from this package's `.env` at launch and never passed through the MCP config or echoed in tool output.

## Key status (as of 2026-09-29)

- Open PageRank: working.
- Keywords Everywhere: key valid, account out of credits (calls return 402 until topped up).
- Ahrefs: key rejected (Unauthorized) — regenerate in Ahrefs API settings and confirm the plan includes API access.

## Keyless analysis tools (added 2026-10-05)

No API key needed — these fetch and parse live pages/sitemaps directly. They fold in the
useful capabilities of popular SEO Chrome extensions (Detailed SEO, Easy SEO, Simple SEO,
Sitemap Explorer, Similarweb) so agents get on-page + sitemap + traffic analysis, not just
authority/keyword numbers.

- `onpage_audit <url> [as_googlebot]` — real HTTP fetch (optional Googlebot UA): status, redirect chain, response headers, X-Robots-Tag, indexability verdict, title/meta/canonical/robots, H1-H6 outline, word count, images + missing-alt, internal/external links + nofollow, Open Graph, Twitter, hreflang, structured data (JSON-LD + Microdata + RDFa), analytics/tag detection (GA4/GTM/UA/Meta Pixel/TikTok/Hotjar/Clarity/LinkedIn), page byte size.
- `hreflang_check <url>` — fetches each hreflang alternate and verifies the reciprocal return tag; flags missing-return-tag, 404 and rate-limited states.
- `sitemap_discover <domain>` — sitemaps from robots.txt + /sitemap.xml and /sitemap_index.xml fallbacks.
- `sitemap_parse <url> [recursive] [max_urls]` — recurses nested sitemap indexes (gzip-aware); extracts loc, lastmod, changefreq, priority, image and hreflang-alternate counts; handles urlset, sitemapindex and Atom feed.
- `traffic_estimate <domain>` — Similarweb free anonymous feed: global/country/category rank, estimated monthly visits, bounce rate, visit duration, pages-per-visit, traffic-source split (incl. Gen-AI), top countries, top keywords, AI-prompt traffic. Modeled estimates, IP-rate-limited (HTTP 403 at quota), often N/A for low-traffic sites; use ahrefs/opr for backlinks and guaranteed data.

Deps added: `cheerio` (HTML parse), `fast-xml-parser` (sitemap XML).
