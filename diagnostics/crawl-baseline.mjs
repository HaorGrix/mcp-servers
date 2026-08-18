// Technical/indexation baseline crawler. No credentials needed.
const CONC = 3;
const DELAY_MS = 250;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getSitemapUrls(name) {
  const r = await fetch(`https://haorgrix.com/sitemap/${name}.xml`);
  const t = await r.text();
  return [...t.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
}

async function getToolUrls() {
  const r = await fetch("https://haorgrix.com/tools/");
  const t = await r.text();
  return [...new Set([...t.matchAll(/href="(\/tools\/[a-z0-9-]+\/)"/g)].map(m => "https://haorgrix.com" + m[1]))];
}

function analyse(url, status, finalUrl, html) {
  const canonical = (html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/) || [])[1] || null;
  const robots = (html.match(/<meta[^>]+name="robots"[^>]+content="([^"]+)"/i) || [])[1] || null;
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || null;
  const desc = (html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i) || [])[1] || null;
  const schema = [...new Set([...html.matchAll(/"@type":\s*"([A-Za-z]+)"/g)].map(m => m[1]))];
  return {
    url, status, redirected: finalUrl !== url ? finalUrl : null,
    canonical, robots, noindex: /noindex/i.test(robots || ""),
    title, titleLen: title ? title.length : 0,
    hasDesc: !!desc, descLen: desc ? desc.length : 0,
    schema,
  };
}

// Polite: low concurrency, inter-request delay, and exponential backoff on 429 so
// we never degrade the live site or get throttled into false "error" readings.
async function check(url, attempt = 0) {
  try {
    const r = await fetch(url, { redirect: "follow" });
    if (r.status === 429 && attempt < 4) {
      await sleep(2000 * Math.pow(2, attempt));
      return check(url, attempt + 1);
    }
    const html = r.status === 200 ? await r.text() : "";
    return analyse(url, r.status, r.url, html);
  } catch (e) {
    if (attempt < 2) { await sleep(1500); return check(url, attempt + 1); }
    return { url, status: 0, error: String(e).slice(0, 80), schema: [] };
  }
}

async function pool(urls) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < urls.length) {
      const u = urls[i++];
      out.push(await check(u));
      await sleep(DELAY_MS);
      if (out.length % 50 === 0) console.error(`  ...${out.length}/${urls.length}`);
    }
  }));
  return out;
}

const groups = {};
for (const s of ["pages", "blog", "geo", "tools"]) groups[s] = await getSitemapUrls(s);
groups.toolsLive = await getToolUrls();

const all = [...new Set(Object.values(groups).flat())];
console.error(`crawling ${all.length} unique URLs...`);
const results = await pool(all);

const byUrl = Object.fromEntries(results.map(r => [r.url, r]));
const report = { generatedFor: "haorgrix.com", groups: {}, results };
for (const [g, urls] of Object.entries(groups)) {
  const rs = urls.map(u => byUrl[u]).filter(Boolean);
  report.groups[g] = {
    count: urls.length,
    ok200: rs.filter(r => r.status === 200).length,
    redirects: rs.filter(r => r.redirected).length,
    errors: rs.filter(r => r.status >= 400 || r.status === 0).map(r => `${r.status} ${r.url}`),
    noindex: rs.filter(r => r.noindex).map(r => r.url),
    missingCanonical: rs.filter(r => r.status === 200 && !r.canonical).length,
    missingDesc: rs.filter(r => r.status === 200 && !r.hasDesc).length,
  };
}
import fs from "fs";
fs.writeFileSync("crawl.json", JSON.stringify(report, null, 2));
for (const [g, s] of Object.entries(report.groups)) {
  console.log(`${g.padEnd(10)} n=${String(s.count).padStart(3)} 200=${String(s.ok200).padStart(3)} redir=${String(s.redirects).padStart(3)} err=${s.errors.length} noindex=${s.noindex.length} noCanon=${s.missingCanonical} noDesc=${s.missingDesc}`);
}
console.log("\nERRORS:");
for (const [g, s] of Object.entries(report.groups)) for (const e of s.errors) console.log(" ", g, e);
