import { GoogleSearchConsoleClient } from "./src/client.js";

async function main() {
  const client = new GoogleSearchConsoleClient();
  
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  console.log(`Fetching GSC data from ${startDate} to ${endDate}...`);
  
  try {
    const data = await client.querySearchAnalytics({
      startDate,
      endDate,
      dimensions: ['query'],
      rowLimit: 20
    });
    console.log("=== TOP QUERIES ===");
    console.log(JSON.stringify(data.rows, null, 2));

    const pages = await client.querySearchAnalytics({
      startDate,
      endDate,
      dimensions: ['page'],
      rowLimit: 20
    });
    console.log("\n=== TOP PAGES ===");
    console.log(JSON.stringify(pages.rows, null, 2));
  } catch (err: any) {
    console.error("Error fetching GSC data:", err.message);
  }
}

main().catch(console.error);
