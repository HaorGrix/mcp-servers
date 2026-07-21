import { GoogleSearchConsoleClient } from '../google-search-console-mcp/src/client.js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

async function runDeepAudit() {
  const auditResults: any = {
    overview: {},
    queries: [],
    pages: [],
    countries: [],
    devices: [],
    dates: []
  };

  const endDate = new Date().toISOString().split('T')[0];
  // GSC API supports up to 16 months (~480 days)
  const startDate16M = new Date(Date.now() - 480 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`Fetching GSC Data from ${startDate16M} to ${endDate}...`);
  dotenv.config({ path: path.resolve(process.cwd(), '../google-search-console-mcp/.env'), override: true });
  
  try {
    const gsc = new GoogleSearchConsoleClient();
    
    // Overall stats (no dimensions)
    const overview = await gsc.querySearchAnalytics(startDate16M, endDate, []);
    auditResults.overview = overview.rows?.[0] || { clicks: 0, impressions: 0 };

    // Queries
    const queries = await gsc.querySearchAnalytics(startDate16M, endDate, ['query']);
    auditResults.queries = queries.rows || [];

    // Pages
    const pages = await gsc.querySearchAnalytics(startDate16M, endDate, ['page']);
    auditResults.pages = pages.rows || [];

    // Countries
    const countries = await gsc.querySearchAnalytics(startDate16M, endDate, ['country']);
    auditResults.countries = countries.rows || [];

    // Devices
    const devices = await gsc.querySearchAnalytics(startDate16M, endDate, ['device']);
    auditResults.devices = devices.rows || [];

    // Dates (Trend)
    const dates = await gsc.querySearchAnalytics(startDate16M, endDate, ['date']);
    auditResults.dates = dates.rows || [];

  } catch (e: any) {
    console.error("GSC Error:", e.message);
    auditResults.error = e.message;
  }

  fs.writeFileSync('deep_audit_results.json', JSON.stringify(auditResults, null, 2));
  console.log("Audit data saved to deep_audit_results.json");
}

runDeepAudit();
