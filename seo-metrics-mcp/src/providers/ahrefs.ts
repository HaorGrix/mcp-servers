/** Ahrefs API v3 provider. Auth: Authorization: Bearer <key>. API access is a paid
 * add-on; Unauthorized means the plan lacks API or the key is stale. Base: api.ahrefs.com.
 * Typed helpers cover the common Site Explorer calls; `raw` is a generic GET passthrough so
 * the entire v3 surface (keywords-explorer, rank-tracker, site-audit, batch-analysis, etc.)
 * is reachable without adding a tool per endpoint. Docs: https://docs.ahrefs.com */
import { http, type HttpResult } from "../http.js";

const BASE = "https://api.ahrefs.com";

function key(): string | undefined {
  return process.env.AHREFS_API_KEY?.trim() || undefined;
}

function auth(): Record<string, string> {
  const k = key();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

export function configured(): boolean {
  return Boolean(key());
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.append(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Generic GET against any v3 endpoint, e.g. endpoint="site-explorer/metrics". */
export async function raw(endpoint: string, params: Record<string, string | number | undefined>): Promise<HttpResult> {
  const clean = endpoint.replace(/^\/+/, "").replace(/^v3\//, "");
  return http(`${BASE}/v3/${clean}${qs(params)}`, { headers: auth() });
}

export async function domainRating(target: string, date?: string): Promise<HttpResult> {
  return raw("site-explorer/domain-rating", { target, date: date ?? today() });
}

export async function backlinksStats(target: string, date?: string, mode = "subdomains"): Promise<HttpResult> {
  return raw("site-explorer/backlinks-stats", { target, date: date ?? today(), mode });
}

export async function refdomains(target: string, limit = 50, mode = "subdomains"): Promise<HttpResult> {
  return raw("site-explorer/refdomains", {
    target,
    limit,
    mode,
    order_by: "domain_rating:desc",
    select: "domain,domain_rating,dofollow_links,first_seen,links_to_target",
  });
}

export async function backlinks(target: string, limit = 50, mode = "subdomains"): Promise<HttpResult> {
  return raw("site-explorer/all-backlinks", {
    target,
    limit,
    mode,
    order_by: "domain_rating_source:desc",
    select: "url_from,url_to,domain_rating_source,anchor,nofollow,first_seen",
  });
}

export async function metrics(target: string, date?: string, mode = "subdomains"): Promise<HttpResult> {
  return raw("site-explorer/metrics", { target, date: date ?? today(), mode });
}

export async function subscriptionInfo(): Promise<HttpResult> {
  return raw("subscription-info/limits-and-usage", {});
}
