/** On-page SEO audit of a live URL. Real HTTP fetch (optional Googlebot UA) so we get
 * the status, redirect chain, response headers and X-Robots-Tag that a DOM-only check
 * cannot see, plus a full parse of the returned HTML: title/meta/canonical/robots,
 * indexability verdict, H1-H6 outline, word count, images/alt, internal/external links
 * and nofollow, Open Graph, Twitter, hreflang, structured data (JSON-LD + Microdata +
 * RDFa), analytics/tag detection (GA4/GTM/Meta Pixel/etc.), and page byte size.
 * Mirrors the useful signals of the Detailed/Easy/Simple SEO Chrome extensions. */
import * as cheerio from "cheerio";
import type { HttpResult } from "../http.js";

const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface Fetched {
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  html: string;
  chain: { url: string; status: number; location?: string }[];
}

async function followChain(start: string, ua: string, maxHops = 10): Promise<Fetched> {
  const chain: { url: string; status: number; location?: string }[] = [];
  let current = start;
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml,*/*" },
    });
    const status = res.status;
    const location = res.headers.get("location") ?? undefined;
    chain.push({ url: current, status, ...(location ? { location } : {}) });
    if (status >= 300 && status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const html = await res.text();
    return { finalUrl: current, status, headers, html, chain };
  }
  return { finalUrl: current, status: 0, headers: {}, html: "", chain };
}

function toArr<T>(x: T | T[] | undefined | null): T[] {
  return x == null ? [] : Array.isArray(x) ? x : [x];
}

export async function audit(url: string, asGooglebot = false): Promise<HttpResult> {
  let target = url.trim();
  if (!/^https?:\/\//i.test(target)) target = "https://" + target;
  const ua = asGooglebot ? GOOGLEBOT : BROWSER;

  let f: Fetched;
  try {
    f = await followChain(target, ua);
  } catch (e) {
    return { ok: false, status: 0, body: null, error: e instanceof Error ? e.message : String(e) };
  }
  const { finalUrl, status, headers, html, chain } = f;
  if (!html) {
    return { ok: false, status, body: { url: target, finalUrl, status, redirect_chain: chain, error: "no HTML body returned" } };
  }

  const $ = cheerio.load(html);
  const host = new URL(finalUrl).hostname;
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  const title = $("title").first().text().trim() || null;
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() ?? null;
  const metaRobots = $('meta[name="robots"]').attr("content")?.trim() ?? null;
  const metaKeywords = $('meta[name="keywords"]').attr("content")?.trim() ?? null;
  const canonical = $('link[rel="canonical"]').attr("href") ?? null;
  const lang = $("html").attr("lang") ?? null;
  const viewport = $('meta[name="viewport"]').attr("content") ?? null;
  const xRobots = headers["x-robots-tag"] ?? null;

  const headings: Record<string, string[]> = {};
  for (const h of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
    headings[h] = $(h).map((_, e) => $(e).text().trim()).get().filter(Boolean);
  }

  const imgs = $("img");
  let missingAlt = 0;
  imgs.each((_, e) => {
    if (!($(e).attr("alt") ?? "").trim()) missingAlt++;
  });

  let internal = 0,
    external = 0,
    nofollow = 0;
  $("a[href]").each((_, e) => {
    const href = $(e).attr("href") ?? "";
    const rel = ($(e).attr("rel") ?? "").toLowerCase();
    if (rel.includes("nofollow")) nofollow++;
    try {
      const u = new URL(href, finalUrl);
      if (u.protocol.startsWith("http")) {
        if (u.hostname === host) internal++;
        else external++;
      }
    } catch {
      /* skip non-URL hrefs (mailto:, tel:, #anchors) */
    }
  });

  const og: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, e) => {
    const p = $(e).attr("property");
    if (p) og[p] = $(e).attr("content") ?? "";
  });
  const tw: Record<string, string> = {};
  $('meta[name^="twitter:"]').each((_, e) => {
    const n = $(e).attr("name");
    if (n) tw[n] = $(e).attr("content") ?? "";
  });

  const hreflang = $('link[rel="alternate"][hreflang]')
    .map((_, e) => ({ lang: $(e).attr("hreflang"), href: $(e).attr("href") }))
    .get();

  const jsonLdTypes: string[] = [];
  $('script[type="application/ld+json"]').each((_, e) => {
    try {
      const data = JSON.parse($(e).text());
      const collect = (o: any): void => {
        if (Array.isArray(o)) o.forEach(collect);
        else if (o && typeof o === "object") {
          if (o["@type"]) jsonLdTypes.push(...toArr<string>(o["@type"]));
          if (o["@graph"]) collect(o["@graph"]);
        }
      };
      collect(data);
    } catch {
      /* malformed JSON-LD block */
    }
  });
  const microdataTypes = $("[itemscope][itemtype]").map((_, e) => $(e).attr("itemtype")).get();
  const rdfaTypes = $("[typeof]").map((_, e) => $(e).attr("typeof")).get();

  const uniq = (re: RegExp) => Array.from(new Set(html.match(re) ?? []));
  const analytics = {
    ga4: uniq(/G-[A-Z0-9]{6,}/g),
    gtm: uniq(/GTM-[A-Z0-9]{4,}/g),
    universal_analytics: uniq(/UA-\d{4,}-\d+/g),
    meta_pixel: /connect\.facebook\.net\/[^"']+\/fbevents\.js|fbq\(/.test(html),
    tiktok_pixel: /analytics\.tiktok\.com/.test(html),
    hotjar: /static\.hotjar\.com|hjid/.test(html),
    microsoft_clarity: /clarity\.ms/.test(html),
    linkedin_insight: /snap\.licdn\.com/.test(html),
  };

  const robotsBlob = `${metaRobots ?? ""} ${xRobots ?? ""}`.toLowerCase();
  const noindex = robotsBlob.includes("noindex");
  let canonicalSelf: boolean | null = null;
  if (canonical) {
    try {
      canonicalSelf =
        new URL(canonical, finalUrl).toString().replace(/\/$/, "") === finalUrl.replace(/\/$/, "");
    } catch {
      canonicalSelf = null;
    }
  }
  const indexable = !noindex && canonicalSelf !== false;

  const body = {
    url: target,
    finalUrl,
    status,
    redirected: chain.length > 1,
    redirect_chain: chain,
    fetched_as: asGooglebot ? "Googlebot" : "browser",
    indexable,
    indexability_reason: noindex
      ? "noindex via meta robots or X-Robots-Tag"
      : canonicalSelf === false
        ? "canonical points to a different URL"
        : "indexable",
    title: { value: title, length: title ? title.length : 0 },
    meta_description: { value: metaDesc, length: metaDesc ? metaDesc.length : 0 },
    meta_robots: metaRobots,
    x_robots_tag: xRobots,
    meta_keywords: metaKeywords,
    canonical,
    canonical_self_referencing: canonicalSelf,
    lang,
    viewport,
    headings: {
      counts: Object.fromEntries(Object.entries(headings).map(([k, v]) => [k, v.length])),
      h1: headings.h1,
      h2: headings.h2,
    },
    word_count: wordCount,
    images: { total: imgs.length, missing_alt: missingAlt },
    links: { internal, external, nofollow },
    open_graph: og,
    twitter_card: tw,
    hreflang,
    structured_data: { json_ld_types: jsonLdTypes, microdata_types: microdataTypes, rdfa_types: rdfaTypes },
    analytics_tags: analytics,
    page_bytes: Buffer.byteLength(html, "utf8"),
    content_type: headers["content-type"] ?? null,
  };
  return { ok: status >= 200 && status < 400, status, body };
}
