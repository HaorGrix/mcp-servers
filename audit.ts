import { GoogleAnalyticsClient } from './google-analytics-mcp/src/client.ts';
import { GoogleSearchConsoleClient } from './google-search-console-mcp/src/client.ts';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

async function runAudit() {
  const auditResults: any = {
    searchConsole: {},
    analytics: {}
  };

  const endDate = new Date().toISOString().split('T')[0];
  const startDate30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // GSC
  console.log("Fetching GSC Data...");
  dotenv.config({ path: path.resolve(process.cwd(), 'google-search-console-mcp/.env') });
  try {
    const gsc = new GoogleSearchConsoleClient();
    
    // Top Queries
    const queries = await gsc.querySearchAnalytics(startDate30, endDate, ['query']);
    auditResults.searchConsole.topQueries = queries.rows || [];

    // Top Pages
    const pages = await gsc.querySearchAnalytics(startDate30, endDate, ['page']);
    auditResults.searchConsole.topPages = pages.rows || [];

  } catch (e: any) {
    console.error("GSC Error:", e.message);
    auditResults.searchConsole.error = e.message;
  }

  // GA4
  console.log("Fetching GA4 Data...");
  dotenv.config({ path: path.resolve(process.cwd(), 'google-analytics-mcp/.env') });
  try {
    const ga = new GoogleAnalyticsClient();
    
    // Sessions over time
    const traffic = await ga.runReport({
      startDate: '30daysAgo',
      endDate: 'today',
      dimensions: [{name: 'date'}],
      metrics: [{name: 'sessions'}, {name: 'engagedSessions'}],
    });
    auditResults.analytics.traffic = traffic.rows || [];

    // Top Pages
    const pages = await ga.runReport({
      startDate: '30daysAgo',
      endDate: 'today',
      dimensions: [{name: 'pagePath'}],
      metrics: [{name: 'screenPageViews'}, {name: 'activeUsers'}],
    });
    auditResults.analytics.topPages = pages.rows || [];

  } catch (e: any) {
    console.error("GA Error:", e.message);
    auditResults.analytics.error = e.message;
  }

  fs.writeFileSync('audit_results.json', JSON.stringify(auditResults, null, 2));
  console.log("Audit data saved to audit_results.json");
}

runAudit();
