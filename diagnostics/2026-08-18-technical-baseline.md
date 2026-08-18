# HaorGrix SEO — technical baseline, 18 Aug 2026 (day 21)

Captured by `diagnostics/crawl-baseline.mjs` against production. Every URL in all four
live sitemaps plus the `/tools` catalogue — **516 unique URLs**. No credentials required,
so this is reproducible by anyone at any time.

**This is half a baseline.** Impressions, clicks, average position, indexed counts,
coverage states, sessions and conversions are only obtainable through Search Console and
GA4, and no credentials were available. Those rows are marked BLOCKED rather than
estimated. See "What is still missing".

## Indexability

| Sitemap | URLs | HTTP 200 | Errors | noindex | Missing canonical | Missing meta description |
|---|---|---|---|---|---|---|
| `pages.xml` | 144 | 144 | 0 | 0 | 0 | 0 |
| `blog.xml` | 14 | 14 | 0 | 0 | 0 | 0 |
| `geo.xml` | 267 | 267 | 0 | 0 | 0 | 0 |
| `tools.xml` | 7 | 3 | **4** | 0 | 1 | 0 |
| `/tools` catalogue (live) | 84 | 84 | 0 | 0 | 0 | 0 |

Two things worth stating plainly:

- **The geo pages are clean.** All 267 return 200 with no `noindex`. The audit's
  "recovered geo pages excluded by noindex" is fixed *at the source*. Whether Google has
  re-crawled them is a different question and needs Search Console to answer.
- **Everything except the tools sitemap is healthy.** 425 of 432 sitemap URLs are 200
  with canonical and description present. There is no site-wide indexability problem.

## Findings

### 1. The tools sitemap advertised 7 URLs, 4 of them dead — and none of the 84 real tools

```
/tools/pdf-tools              404
/tools/saas-cost-estimator    404
/tools/business-card-maker    404
/tools/certificate-generator  404
```

`src/app/sitemap.ts` carried a hand-written list of legacy slugs and never consulted the
tool registry. Search engines were being told the tool suite is three working URLs.

This is the largest single obstacle to the "all tools indexed" goal — the pages were
de-orphaned and given internal links in Phase 1, but were never *submitted*.

Fixed in `HaorGrix/website` PR #16: slugs are read from the built export, so the sitemap
tracks what actually shipped. 7 URLs → 85.

### 2. Tool `SoftwareApplication` schema was live on 0 pages, not 336

Verified on production: `json-formatter`, `bmi-calculator` and `compress-pdf` all return
0 hits. Across all 516 URLs, `SoftwareApplication` appears on exactly one — `/labs`.

The markup sits in `src/app/tools/[slug]`, the Next route nginx shadows. It builds 336
pages, which is where the number came from; none are reachable.

Fixed in `HaorGrix/website` PR #17, in the export that is actually served.

### 3. Structured data everywhere else is in good shape

| Type | Pages |
|---|---|
| `FAQPage` | 380 |
| `Organization` + `WebSite` + `BreadcrumbList` on tool pages | 86 |
| `Article` on blog posts | 12 of 12 |

The Phase-1 schema work is confirmed live. Blog `Article` coverage is complete — the
audit's "blog emits zero Article schema" was true of exactly one bespoke post, now fixed.

## What is still missing, and why

| Metric | Status |
|---|---|
| Impressions/day, clicks, average position | **BLOCKED** — needs Search Console |
| Tools indexed (true index state) | **BLOCKED** — needs the URL Inspection API |
| `heic-to-jpg` 747live.bet canonical | **BLOCKED** — only visible in Search Console |
| Recovered-geo coverage state | **BLOCKED** — source is clean; index state needs GSC |
| Sessions, `tool_used` volume, conversions by page | **BLOCKED** — needs GA4 |
| Referring domains, Domain Rating | **BLOCKED** — needs Ahrefs/Moz accounts |
| Field Core Web Vitals (CrUX) | **BLOCKED** — PageSpeed anonymous quota exhausted; needs an API key |

The last one has a consequence beyond this document: the decision to defer critical-CSS
inlining was explicitly "revisit only if CrUX field data shows real users still hitting
poor LCP". That decision cannot be revisited by anyone until field data can be pulled.

`diagnostics/kpi-pull.ts` is written and ready for all of the Google-side rows. It exits
non-zero with an explanation when credentials are absent, rather than printing zeros that
would read as real measurements.

## Reproducing

```bash
node diagnostics/crawl-baseline.mjs   # writes crawl.json
```

Polite by construction: 3 concurrent requests, 250 ms apart, exponential backoff on 429.
An earlier attempt at 10 concurrent was throttled by production and produced ~30 false
error readings. Do not raise it — a crawler that trips the rate limiter measures the rate
limiter.
