/** Similarweb free traffic feed. Unofficial, keyless, cookieless public endpoint used
 * by the Similarweb browser extension. One GET returns rank, estimated monthly visits,
 * engagement, traffic-source split, top countries, top keywords and AI-traffic. Values
 * are modeled estimates (N/A for low-traffic sites) and the feed is IP-rate-limited
 * (HTTP 403 when the weekly anonymous quota is hit). Treat as opportunistic enrichment;
 * use the ahrefs, opr and ke tools for backlinks, referring domains and guaranteed data. */
import { http, type HttpResult } from "../http.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function bareDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

/** GET https://data.similarweb.com/api/v1/data?domain=<domain> */
export async function traffic(domain: string): Promise<HttpResult> {
  const d = bareDomain(domain);
  const res = await http(`https://data.similarweb.com/api/v1/data?domain=${encodeURIComponent(d)}`, {
    headers: { "X-Extension-Version": "6.12.24", "User-Agent": UA, Accept: "application/json" },
    timeoutMs: 20000,
  });

  if (res.status === 403) {
    return {
      ok: false,
      status: 403,
      body: {
        domain: d,
        error:
          "Similarweb anonymous quota exceeded (HTTP 403). This is a free IP-rate-limited feed. Retry later, cache results, or use ahrefs_metrics / DataForSEO for guaranteed traffic data.",
      },
    };
  }
  if (!res.ok || typeof res.body !== "object" || res.body === null) return res;

  const s = res.body as Record<string, any>;
  const summary = {
    domain: d,
    siteName: s.SiteName ?? null,
    description: s.Description ?? null,
    category: s.Category ?? null,
    snapshotDate: s.SnapshotDate ?? null,
    isDataFromGa: s.IsDataFromGa ?? null,
    rank: {
      global: s.GlobalRank?.Rank ?? s.GlobalRank ?? null,
      country: s.CountryRank?.Rank ?? s.CountryRank ?? null,
      category: s.CategoryRank?.Rank ?? s.CategoryRank ?? null,
      globalCategory: s.GlobalCategoryRank ?? null,
    },
    estimatedMonthlyVisits: s.EstimatedMonthlyVisits ?? null,
    engagement: s.Engagements ?? s.Engagments ?? null,
    trafficSources: s.TrafficSources ?? null,
    topCountries: s.TopCountryShares ?? null,
    topKeywords: s.TopKeywords ?? null,
    aiTraffic: s.AiTrafficDetails ?? null,
    note: "Unofficial Similarweb estimate (free anonymous feed), modeled and often N/A for low-traffic sites. For backlinks, referring domains and competitors use ahrefs_* / opr_* / ke_*.",
  };
  return { ok: true, status: 200, body: summary };
}
