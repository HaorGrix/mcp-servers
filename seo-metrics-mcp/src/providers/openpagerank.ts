/** Open PageRank provider. Free, no card. Gives a 0-10 authority score (open_page_rank),
 * a global rank, and referring-domain count derived from the Common Crawl web graph.
 * Data refreshes ~monthly, so it lags new backlinks by weeks. Base host moved under
 * keywordseverywhere.com in 2026. Docs: https://openpagerank.keywordseverywhere.com/docs */
import { http, type HttpResult } from "../http.js";

const BASE = "https://openpagerank.keywordseverywhere.com";

function key(): string | undefined {
  return process.env.OPR_API_KEY?.trim() || undefined;
}

function auth(): Record<string, string> {
  const k = key();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

export function configured(): boolean {
  return Boolean(key());
}

/** POST /v1/domains/bulk — up to 100 domains per call. */
export async function getPageRank(domains: string[], includeHistory: boolean): Promise<HttpResult> {
  return http(`${BASE}/v1/domains/bulk`, {
    method: "POST",
    headers: auth(),
    json: { domains, include_history: includeHistory },
  });
}

/** GET /v1/usage — plan tier and remaining quota. */
export async function usage(): Promise<HttpResult> {
  return http(`${BASE}/v1/usage`, { headers: auth() });
}

/** GET /v1/health — service status (no auth needed). */
export async function health(): Promise<HttpResult> {
  return http(`${BASE}/v1/health`);
}
