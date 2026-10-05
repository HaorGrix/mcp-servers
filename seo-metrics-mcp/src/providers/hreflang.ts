/** Reciprocal hreflang validation. Fetches a page's hreflang alternates, then fetches
 * each alternate and checks that it declares a return link back to the source. Mirrors
 * the Detailed SEO extension's reciprocity checker, with 404/429/fetch states. A missing
 * return tag is a common, silent hreflang bug Google ignores the cluster for. */
import * as cheerio from "cheerio";
import type { HttpResult } from "../http.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function normalize(u: string): string {
  try {
    const x = new URL(u);
    return (x.origin + x.pathname).replace(/\/$/, "").toLowerCase();
  } catch {
    return u.replace(/\/$/, "").toLowerCase();
  }
}

async function getAlternates(url: string): Promise<{ lang: string; href: string }[]> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  return $('link[rel="alternate"][hreflang]')
    .map((_, e) => {
      const href = $(e).attr("href") ?? "";
      let abs = href;
      try {
        abs = new URL(href, url).toString();
      } catch {
        /* leave as-is */
      }
      return { lang: $(e).attr("hreflang") ?? "", href: abs };
    })
    .get()
    .filter((a) => a.href);
}

export async function check(url: string): Promise<HttpResult> {
  let target = url.trim();
  if (!/^https?:\/\//i.test(target)) target = "https://" + target;

  let alts: { lang: string; href: string }[];
  try {
    alts = await getAlternates(target);
  } catch (e) {
    return { ok: false, status: 0, body: null, error: e instanceof Error ? e.message : String(e) };
  }
  if (!alts.length) {
    return { ok: true, status: 200, body: { url: target, alternates: 0, note: "No hreflang alternates declared on this page." } };
  }

  const results: Record<string, unknown>[] = [];
  for (const a of alts) {
    try {
      const back = await getAlternates(a.href);
      const reciprocal = back.some((b) => normalize(b.href) === normalize(target));
      results.push({
        lang: a.lang,
        href: a.href,
        reciprocal,
        state: reciprocal ? "ok" : "missing-return-tag",
        alt_declares: back.length,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const state = msg.includes("404") ? "404" : msg.includes("429") ? "429-rate-limited" : "fetch-error";
      results.push({ lang: a.lang, href: a.href, reciprocal: false, state, error: msg });
    }
  }

  const issues = results.filter((r) => r.reciprocal !== true).length;
  return {
    ok: true,
    status: 200,
    body: { url: target, alternates: alts.length, reciprocal_issues: issues, results },
  };
}
