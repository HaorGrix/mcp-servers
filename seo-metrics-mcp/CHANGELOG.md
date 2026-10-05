# Changelog

## [2026-09-29] Initial release
- New MCP server exposing Open PageRank, Ahrefs API v3, and Keywords Everywhere.
- 12 tools: 3 Open PageRank, 7 Ahrefs (incl. `ahrefs_get` generic passthrough), 2 Keywords Everywhere (incl. `ke_post` generic passthrough).
- Read-only. Keys loaded from git-ignored `.env` (chmod 600); never echoed in output or stored in MCP config.
- Registered in `~/.claude.json` (HaorGrix project) as `haorgrix-seo-metrics`.
- Verified: typecheck clean, build ok, handshake enumerates all 12 tools. Open PageRank returns live data; Ahrefs key rejected and Keywords Everywhere account out of credits (both light up once fixed).

## [2026-10-05] — Keyless analysis tools
- Added 5 tools folding in SEO Chrome-extension capabilities: onpage_audit, hreflang_check, sitemap_discover, sitemap_parse, traffic_estimate (Similarweb free feed). No API keys required. Deps: cheerio, fast-xml-parser. Tool count 12 -> 17.
