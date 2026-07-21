import { GoogleAnalyticsClient } from './google-analytics-mcp/src/client.js';
import { GoogleSearchConsoleClient } from './google-search-console-mcp/src/client.js';
import dotenv from 'dotenv';
import path from 'path';

async function run() {
  console.log("=== Testing Google Analytics ===");
  dotenv.config({ path: path.resolve(process.cwd(), 'google-analytics-mcp/.env') });
  try {
    const ga = new GoogleAnalyticsClient();
    const gaData = await ga.runReport('7daysAgo', 'today', ['date'], ['activeUsers', 'screenPageViews']);
    console.log(`Successfully fetched ${gaData.rows?.length || 0} rows of Analytics data!`);
    console.log(JSON.stringify(gaData.rows?.slice(0, 2), null, 2));
  } catch (e: any) {
    console.error("GA Error:", e.message);
  }

  console.log("\n=== Testing Google Search Console ===");
  dotenv.config({ path: path.resolve(process.cwd(), 'google-search-console-mcp/.env') });
  try {
    const gsc = new GoogleSearchConsoleClient();
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    console.log(`Fetching from ${startDate} to ${endDate}...`);
    const gscData = await gsc.querySearchAnalytics(startDate, endDate, ['query']);
    console.log(`Successfully fetched ${gscData.rows?.length || 0} rows of Search Console data!`);
    console.log(JSON.stringify(gscData.rows?.slice(0, 2), null, 2));
  } catch (e: any) {
    console.error("GSC Error:", e.message);
  }
}

run();
