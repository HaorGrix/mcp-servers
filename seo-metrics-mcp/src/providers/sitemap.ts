/** Sitemap discovery and recursive parsing. Mirrors the Sitemap Explorer extension but
 * upgraded: discover via robots.txt plus /sitemap.xml fallbacks, then parse urlset /
 * sitemapindex / Atom feed, recurse through nested sitemap indexes with a visited-set and
 * a URL cap, gunzip .gz children, and extract loc/lastmod/changefreq/priority plus
 * image and hreflang-alternate counts. All client-side; no external service. */
import { gunzipSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";
import type { HttpResult } from "../http.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true });

function toArr<T>(x: T | T[] | undefined | null): T[] {
  return x == null ? [] : Array.isArray(x) ? x : [x];
}
function bareHost(input: string): string {
  return input.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
}

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/xml,text/xml,text/plain,*/*" } });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "";
  let text: string;
  if (url.endsWith(".gz") || ct.includes("gzip") || ((buf[0] ?? 0) === 0x1f && (buf[1] ?? 0) === 0x8b)) {
    try {
      text = gunzipSync(buf).toString("utf8");
    } catch {
      text = buf.toString("utf8");
    }
  } else {
    text = buf.toString("utf8");
  }
  return { status: res.status, text };
}

/** Find a domain's sitemaps: robots.txt declarations + common fallback paths. */
export async function discover(domain: string): Promise<HttpResult> {
  const host = bareHost(domain);
  const origin = `https://${host}`;
  const found = new Set<string>();
  let robotsFound = 0;
  try {
    const r = await fetchText(`${origin}/robots.txt`);
    if (r.status < 400) {
      const re = /Sitemap:\s*(\S+)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(r.text))) {
        const sm = m[1]?.trim();
        if (sm) {
          found.add(sm);
          robotsFound++;
        }
      }
    }
  } catch {
    /* robots.txt unreachable */
  }
  for (const p of ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"]) {
    try {
      const res = await fetch(`${origin}${p}`, { method: "GET", headers: { "User-Agent": UA } });
      if (res.ok) found.add(`${origin}${p}`);
    } catch {
      /* probe miss */
    }
  }
  return {
    ok: true,
    status: 200,
    body: { domain: host, declared_in_robots: robotsFound, sitemaps: [...found] },
  };
}

/** Parse a sitemap URL, recursing through nested indexes up to maxUrls. */
export async function parse(url: string, recursive = true, maxUrls = 5000): Promise<HttpResult> {
  const visited = new Set<string>();
  const indexes: string[] = [];
  const errors: { url: string; status?: number; error: string }[] = [];
  const urls: Record<string, unknown>[] = [];
  const queue = [url];

  while (queue.length && urls.length < maxUrls) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    let text: string;
    let status: number;
    try {
      const r = await fetchText(current);
      text = r.text;
      status = r.status;
    } catch (e) {
      errors.push({ url: current, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    if (status >= 400) {
      errors.push({ url: current, status, error: `HTTP ${status}` });
      continue;
    }

    let doc: any;
    try {
      doc = parser.parse(text);
    } catch (e) {
      errors.push({ url: current, error: `XML parse error: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }

    if (doc.sitemapindex) {
      indexes.push(current);
      for (const child of toArr<any>(doc.sitemapindex.sitemap)) {
        const loc = child.loc;
        if (!loc) continue;
        if (recursive) queue.push(loc);
        else urls.push({ type: "sitemap", loc, lastmod: child.lastmod });
      }
    } else if (doc.urlset) {
      for (const u of toArr<any>(doc.urlset.url)) {
        urls.push({
          loc: u.loc,
          lastmod: u.lastmod,
          changefreq: u.changefreq,
          priority: u.priority,
          images: u["image:image"] ? toArr(u["image:image"]).length : undefined,
          alternates: u["xhtml:link"]
            ? toArr<any>(u["xhtml:link"]).map((l) => ({ hreflang: l["@_hreflang"], href: l["@_href"] }))
            : undefined,
        });
        if (urls.length >= maxUrls) break;
      }
    } else if (doc.feed) {
      for (const e of toArr<any>(doc.feed.entry)) {
        urls.push({ loc: e.link?.["@_href"] ?? e.id, lastmod: e.updated });
        if (urls.length >= maxUrls) break;
      }
    } else {
      errors.push({ url: current, error: "unrecognized root element (expected urlset, sitemapindex or feed)" });
    }
  }

  return {
    ok: true,
    status: 200,
    body: {
      start: url,
      sitemap_indexes: indexes,
      url_count: urls.length,
      truncated: urls.length >= maxUrls,
      errors,
      urls,
    },
  };
}
