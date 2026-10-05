/** Keywords Everywhere provider. Auth: Authorization: Bearer <key>. Credit-metered —
 * get_keyword_data spends credits per keyword and a 402 means the account is out of credits.
 * Typed helper for keyword volume/CPC/competition plus `raw` passthrough for the rest of the
 * v1 surface (related keywords, PASF, etc.). Docs: https://api.keywordseverywhere.com/docs/ */
import { http, type HttpResult } from "../http.js";

const BASE = "https://api.keywordseverywhere.com";

function key(): string | undefined {
  return process.env.KEYWORDS_EVERYWHERE_API_KEY?.trim() || undefined;
}

function auth(): Record<string, string> {
  const k = key();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

export function configured(): boolean {
  return Boolean(key());
}

/** POST /v1/get_keyword_data — volume, CPC, competition, monthly trend per keyword. */
export async function keywordData(
  keywords: string[],
  country: string,
  currency: string,
  dataSource: "gkp" | "cli",
): Promise<HttpResult> {
  return http(`${BASE}/v1/get_keyword_data`, {
    method: "POST",
    headers: auth(),
    form: { "kw[]": keywords, country, currency, dataSource },
  });
}

/** Generic passthrough for any other v1 endpoint (POST form-encoded). */
export async function raw(endpoint: string, form: Record<string, string | string[]>): Promise<HttpResult> {
  const clean = endpoint.replace(/^\/+/, "").replace(/^v1\//, "");
  return http(`${BASE}/v1/${clean}`, { method: "POST", headers: auth(), form });
}
