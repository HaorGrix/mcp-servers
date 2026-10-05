#!/usr/bin/env node
/** seo-metrics-mcp — SEO authority and keyword data over MCP.
 * Providers: Open PageRank (authority score), Ahrefs API v3 (DR, backlinks),
 * Keywords Everywhere (keyword volume/CPC). Read-only. Keys come from .env in this
 * package dir (git-ignored); nothing is written and no key is ever echoed back. */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { asToolResult } from "./http.js";
import * as opr from "./providers/openpagerank.js";
import * as ahrefs from "./providers/ahrefs.js";
import * as ke from "./providers/keywordseverywhere.js";
import * as onpage from "./providers/onpage.js";
import * as similarweb from "./providers/similarweb.js";
import * as sitemap from "./providers/sitemap.js";
import * as hreflang from "./providers/hreflang.js";

// Load .env from this package's own directory regardless of the launcher's CWD.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "..", ".env") });

const server = new McpServer({ name: "seo-metrics", version: "1.0.0" });

function notConfigured(provider: string, envVar: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { provider, ok: false, error: `${provider} not configured. Set ${envVar} in the server .env.` },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}

/* ─────────────── Open PageRank ─────────────── */

server.tool(
  "opr_get_pagerank",
  "Open PageRank authority score (0-10), global rank, and referring-domain count for up to 100 domains. Free, monthly-refreshed, Common-Crawl-derived (lags new backlinks by weeks). Best single 'domain authority' proxy available without a card.",
  {
    domains: z.array(z.string()).min(1).max(100).describe("Bare domains, e.g. ['haorgrix.com','filoix.com']"),
    include_history: z.boolean().default(false).describe("Include monthly score history per domain"),
  },
  async ({ domains, include_history }) => {
    if (!opr.configured()) return notConfigured("openpagerank", "OPR_API_KEY");
    return asToolResult("openpagerank", await opr.getPageRank(domains, include_history));
  },
);

server.tool(
  "opr_usage",
  "Open PageRank plan tier and remaining domain quota for the configured key.",
  {},
  async () => {
    if (!opr.configured()) return notConfigured("openpagerank", "OPR_API_KEY");
    return asToolResult("openpagerank", await opr.usage());
  },
);

server.tool(
  "opr_health",
  "Open PageRank service status (no auth).",
  {},
  async () => asToolResult("openpagerank", await opr.health()),
);

/* ─────────────── Ahrefs API v3 ─────────────── */

server.tool(
  "ahrefs_domain_rating",
  "Ahrefs Domain Rating (DR, 0-100) plus ahrefs_rank for a target, at a date (defaults today).",
  {
    target: z.string().describe("Domain or URL, e.g. haorgrix.com"),
    date: z.string().optional().describe("YYYY-MM-DD; defaults to today"),
  },
  async ({ target, date }) => {
    if (!ahrefs.configured()) return notConfigured("ahrefs", "AHREFS_API_KEY");
    return asToolResult("ahrefs", await ahrefs.domainRating(target, date));
  },
);

server.tool(
  "ahrefs_backlinks_stats",
  "Ahrefs backlink and referring-domain counts (live/all) for a target.",
  {
    target: z.string(),
    date: z.string().optional(),
    mode: z.enum(["exact", "prefix", "domain", "subdomains"]).default("subdomains"),
  },
  async ({ target, date, mode }) => {
    if (!ahrefs.configured()) return notConfigured("ahrefs", "AHREFS_API_KEY");
    return asToolResult("ahrefs", await ahrefs.backlinksStats(target, date, mode));
  },
);

server.tool(
  "ahrefs_refdomains",
  "Ahrefs referring domains for a target, ranked by DR, with dofollow counts and first-seen.",
  {
    target: z.string(),
    limit: z.number().int().min(1).max(1000).default(50),
    mode: z.enum(["exact", "prefix", "domain", "subdomains"]).default("subdomains"),
  },
  async ({ target, limit, mode }) => {
    if (!ahrefs.configured()) return notConfigured("ahrefs", "AHREFS_API_KEY");
    return asToolResult("ahrefs", await ahrefs.refdomains(target, limit, mode));
  },
);

server.tool(
  "ahrefs_backlinks",
  "Ahrefs individual backlinks for a target (source URL, anchor, DR, nofollow flag).",
  {
    target: z.string(),
    limit: z.number().int().min(1).max(1000).default(50),
    mode: z.enum(["exact", "prefix", "domain", "subdomains"]).default("subdomains"),
  },
  async ({ target, limit, mode }) => {
    if (!ahrefs.configured()) return notConfigured("ahrefs", "AHREFS_API_KEY");
    return asToolResult("ahrefs", await ahrefs.backlinks(target, limit, mode));
  },
);

server.tool(
  "ahrefs_metrics",
  "Ahrefs aggregate metrics for a target: organic traffic, keywords, traffic value.",
  {
    target: z.string(),
    date: z.string().optional(),
    mode: z.enum(["exact", "prefix", "domain", "subdomains"]).default("subdomains"),
  },
  async ({ target, date, mode }) => {
    if (!ahrefs.configured()) return notConfigured("ahrefs", "AHREFS_API_KEY");
    return asToolResult("ahrefs", await ahrefs.metrics(target, date, mode));
  },
);

server.tool(
  "ahrefs_subscription_info",
  "Ahrefs API subscription limits and current usage for the configured key.",
  {},
  async () => {
    if (!ahrefs.configured()) return notConfigured("ahrefs", "AHREFS_API_KEY");
    return asToolResult("ahrefs", await ahrefs.subscriptionInfo());
  },
);

server.tool(
  "ahrefs_get",
  "Generic Ahrefs v3 GET passthrough — reaches any endpoint not covered by a typed tool (keywords-explorer, rank-tracker, site-audit, batch-analysis, etc.). Provide the endpoint path after /v3/ and its query params.",
  {
    endpoint: z.string().describe("Path after /v3/, e.g. 'site-explorer/anchors' or 'keywords-explorer/overview'"),
    params: z.record(z.union([z.string(), z.number()])).default({}).describe("Query params as an object"),
  },
  async ({ endpoint, params }) => {
    if (!ahrefs.configured()) return notConfigured("ahrefs", "AHREFS_API_KEY");
    return asToolResult("ahrefs", await ahrefs.raw(endpoint, params));
  },
);

/* ─────────────── Keywords Everywhere ─────────────── */

server.tool(
  "ke_keyword_data",
  "Keywords Everywhere: search volume, CPC, competition, and 12-month trend for keywords. Spends account credits per keyword (a 402 means out of credits).",
  {
    keywords: z.array(z.string()).min(1).max(100),
    country: z.string().default("us").describe("2-letter country code, or 'global'"),
    currency: z.string().default("usd"),
    dataSource: z.enum(["gkp", "cli"]).default("gkp").describe("gkp = Google Keyword Planner, cli = clickstream"),
  },
  async ({ keywords, country, currency, dataSource }) => {
    if (!ke.configured()) return notConfigured("keywords_everywhere", "KEYWORDS_EVERYWHERE_API_KEY");
    return asToolResult("keywords_everywhere", await ke.keywordData(keywords, country, currency, dataSource));
  },
);

server.tool(
  "ke_post",
  "Generic Keywords Everywhere v1 POST passthrough for endpoints beyond get_keyword_data (related keywords, PASF, etc.). Form fields are sent url-encoded; array fields use keys ending in '[]'.",
  {
    endpoint: z.string().describe("Path after /v1/, e.g. 'get_related_keywords'"),
    form: z.record(z.union([z.string(), z.array(z.string())])).default({}),
  },
  async ({ endpoint, form }) => {
    if (!ke.configured()) return notConfigured("keywords_everywhere", "KEYWORDS_EVERYWHERE_API_KEY");
    return asToolResult("keywords_everywhere", await ke.raw(endpoint, form));
  },
);

/* ─────────────── On-page audit (no key needed) ─────────────── */

server.tool(
  "onpage_audit",
  "Full on-page SEO audit of a live URL via a real HTTP fetch: status + redirect chain + response headers + X-Robots-Tag, indexability verdict, title/meta/canonical/robots, H1-H6 outline, word count, images and missing-alt, internal/external links and nofollow, Open Graph, Twitter, hreflang, structured data (JSON-LD + Microdata + RDFa), analytics/tag detection (GA4/GTM/UA/Meta Pixel/TikTok/Hotjar/Clarity/LinkedIn), and page byte size. No API key required.",
  {
    url: z.string().describe("Page URL, e.g. 'https://haorgrix.com/pricing'"),
    as_googlebot: z.boolean().default(false).describe("Send the Googlebot User-Agent to surface cloaked/UA-gated content and real x-robots headers"),
  },
  async ({ url, as_googlebot }) => asToolResult("onpage", await onpage.audit(url, as_googlebot)),
);

server.tool(
  "hreflang_check",
  "Validate a page's hreflang alternates: fetch each alternate URL and confirm it declares a return link back to this page. Flags missing-return-tag, 404 and rate-limited states. No API key required.",
  { url: z.string().describe("Page URL whose hreflang cluster to validate") },
  async ({ url }) => asToolResult("hreflang", await hreflang.check(url)),
);

/* ─────────────── Sitemaps (no key needed) ─────────────── */

server.tool(
  "sitemap_discover",
  "Find a domain's sitemaps from robots.txt declarations plus /sitemap.xml and /sitemap_index.xml fallback probes. No API key required.",
  { domain: z.string().describe("Bare domain or URL, e.g. 'haorgrix.com'") },
  async ({ domain }) => asToolResult("sitemap", await sitemap.discover(domain)),
);

server.tool(
  "sitemap_parse",
  "Parse a sitemap URL, recursing through nested sitemap indexes (gzip-aware) and extracting loc, lastmod, changefreq, priority plus image and hreflang-alternate counts. Handles urlset, sitemapindex and Atom feed. No API key required.",
  {
    url: z.string().describe("Sitemap or sitemap-index URL, e.g. 'https://haorgrix.com/sitemap.xml'"),
    recursive: z.boolean().default(true).describe("Recurse into child sitemaps of a sitemap index"),
    max_urls: z.number().int().min(1).max(50000).default(5000).describe("Cap on URLs collected"),
  },
  async ({ url, recursive, max_urls }) => asToolResult("sitemap", await sitemap.parse(url, recursive, max_urls)),
);

/* ─────────────── Traffic estimate (Similarweb free feed) ─────────────── */

server.tool(
  "traffic_estimate",
  "Estimated traffic and engagement for a domain from Similarweb's free anonymous feed: global/country/category rank, estimated monthly visits, bounce rate, visit duration, pages-per-visit, traffic-source split (incl. Gen-AI), top countries, top keywords (volume/CPC) and AI-prompt traffic. Modeled estimates, IP-rate-limited (HTTP 403 at quota), often N/A for low-traffic sites. No API key required; for backlinks/referring domains use ahrefs_*/opr_*.",
  { domain: z.string().describe("Bare domain or URL, e.g. 'haorgrix.com'") },
  async ({ domain }) => asToolResult("similarweb", await similarweb.traffic(domain)),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP uses stdout for protocol; log only to stderr.
  process.stderr.write("seo-metrics-mcp ready\n");
}

main().catch((err) => {
  process.stderr.write(`seo-metrics-mcp failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
