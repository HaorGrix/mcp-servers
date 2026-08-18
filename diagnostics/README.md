# diagnostics/

The SEO scoreboard. Every gate review diffs against what is captured here.

## What is here

| File | What it is |
|---|---|
| `crawl-baseline.mjs` | Crawls every URL in the live sitemaps plus the `/tools` catalogue and records status, canonical, robots/noindex, title, meta description and the schema types each page emits. **Needs no credentials.** |
| `2026-08-18-technical-baseline.json` | Output of the above, captured 18 Aug 2026 (day 21). |
| `2026-08-18-technical-baseline.md` | The same, written up, with the findings it surfaced. |
| `kpi-pull.ts` | The daily KPI line. **Needs Google credentials — see below.** |

## Running the crawl

```bash
node diagnostics/crawl-baseline.mjs
```

It is deliberately polite: 3 concurrent requests, 250 ms apart, with exponential backoff
on 429. An earlier run at 10 concurrent was rate-limited by production and produced false
"error" readings for ~30 URLs. Do not raise the concurrency — a crawler that trips the
rate limiter measures the rate limiter, not the site.

## Running the KPI pull

Build the Search Console client once first — the script imports its compiled output:

```bash
npm --prefix google-search-console-mcp install
npm --prefix google-search-console-mcp run build
```

Then:

```bash
GSC_SITE_URL="https://haorgrix.com" \
GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json" \
GA4_PROPERTY_ID="<numeric id>" \
npx tsx diagnostics/kpi-pull.ts
```

**This is blocked without a service-account `credentials.json`** that has:

- Search Console read access to the `https://haorgrix.com/` property, and
- the Analytics Data API enabled, with the service account added as a Viewer on the GA4 property.

`credentials.json` is gitignored and must stay that way. Never paste it into Slack.

## Why the split

Everything in the crawl is measurable from outside with no permissions at all. Everything
in `kpi-pull.ts` — impressions, clicks, average position, indexed counts, coverage states,
sessions, conversions — is only obtainable through Google's APIs. Those two halves are kept
apart so the half that can always run is never blocked on the half that cannot.
