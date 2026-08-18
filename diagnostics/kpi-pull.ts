/**
 * The daily KPI line for #agents-haorgrix-seo.
 *
 *   impr/day · non-brand clicks · avg position · tools indexed · leads
 *
 * Requires a Google service account with Search Console read access and Viewer on the
 * GA4 property. See diagnostics/README.md. Without it this exits non-zero and says so,
 * rather than printing zeros that would read as real measurements.
 */
import { GoogleSearchConsoleClient } from "../google-search-console-mcp/dist/client.js";

const SITE = process.env.GSC_SITE_URL || "https://haorgrix.com/";
/** Queries containing these count as brand traffic and are excluded from non-brand clicks. */
const BRAND_TERMS = ["haorgrix", "haor grix", "haorgix"];

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().split("T")[0];
}

function requireCredentials(): void {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      "GOOGLE_APPLICATION_CREDENTIALS is not set — cannot reach Search Console.\n" +
        "See diagnostics/README.md. Refusing to emit a KPI line with no data behind it."
    );
    process.exit(1);
  }
}

async function main() {
  requireCredentials();
  const client = new GoogleSearchConsoleClient();

  // GSC data lags ~2 days; ending "today" silently under-reports.
  const endDate = daysAgo(2);
  const startDate = daysAgo(9);

  const byDate = await client.querySearchAnalytics({
    startDate, endDate, dimensions: ["date"], rowLimit: 100,
  });
  const rows = byDate.rows ?? [];
  const days = rows.length || 1;
  const impressions = rows.reduce((a: number, r: any) => a + (r.impressions ?? 0), 0);
  const clicks = rows.reduce((a: number, r: any) => a + (r.clicks ?? 0), 0);
  const position =
    rows.reduce((a: number, r: any) => a + (r.position ?? 0) * (r.impressions ?? 0), 0) /
    (impressions || 1);

  const byQuery = await client.querySearchAnalytics({
    startDate, endDate, dimensions: ["query"], rowLimit: 5000,
  });
  const nonBrandClicks = (byQuery.rows ?? [])
    .filter((r: any) => !BRAND_TERMS.some((b) => String(r.keys?.[0] ?? "").toLowerCase().includes(b)))
    .reduce((a: number, r: any) => a + (r.clicks ?? 0), 0);

  const byPage = await client.querySearchAnalytics({
    startDate, endDate, dimensions: ["page"], rowLimit: 5000,
  });
  const toolsWithImpressions = new Set(
    (byPage.rows ?? [])
      .map((r: any) => String(r.keys?.[0] ?? ""))
      .filter((u: string) => u.includes("/tools/") && !u.endsWith("/tools/"))
  ).size;

  console.log(JSON.stringify({
    window: { startDate, endDate, days },
    impressionsPerDay: +(impressions / days).toFixed(1),
    clicksTotal: clicks,
    nonBrandClicksPerWeek: nonBrandClicks,
    avgPosition: +position.toFixed(1),
    // Pages with impressions, i.e. Google has them. Not the same as GSC's "indexed"
    // count, which needs the Inspection API per URL — labelled so it is not misread.
    toolPagesWithImpressions: toolsWithImpressions,
    site: SITE,
  }, null, 2));
}

main().catch((e) => {
  console.error("KPI pull failed:", e?.message ?? e);
  process.exit(1);
});
