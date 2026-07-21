#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { GoogleAnalyticsClient } from './client.js';

// Initialize the GA Client
const client = new GoogleAnalyticsClient();

// Initialize the MCP server
const server = new McpServer({
  name: 'google-analytics-mcp',
  version: '1.0.0',
});

// Helper Schemas for tool registrations
const DimensionSchema = z.object({
  name: z.string().describe("The name of the dimension (e.g. 'city', 'pagePath', 'sessionSource')")
});

const MetricSchema = z.object({
  name: z.string().describe("The name of the metric (e.g. 'activeUsers', 'screenPageViews', 'conversions')")
});

// ── 1. List Properties ───────────────────────────────────────────────────────
server.tool(
  'ga_list_properties',
  {
    accountId: z.string().optional().describe("Optional GA4 Account ID (e.g., 'accounts/12345' or just '12345') to filter properties for.")
  },
  async ({ accountId }) => {
    try {
      const data = await client.listProperties(accountId);
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }
);

// ── 2. Get Real-time Report ──────────────────────────────────────────────────
server.tool(
  'ga_get_realtime_report',
  {
    propertyId: z.string().optional().describe("GA4 Property ID (numeric, e.g. '123456789'). Defaults to the default property set in environment."),
    dimensions: z.array(DimensionSchema).optional().describe("The dimensions to request (e.g., city, deviceCategory). Defaults to 'country'."),
    metrics: z.array(MetricSchema).optional().describe("The metrics to request (e.g., activeUsers). Defaults to 'activeUsers'."),
    limit: z.number().optional().describe("Limit on the number of rows returned. Defaults to 50.")
  },
  async ({ propertyId, dimensions, metrics, limit }) => {
    try {
      const data = await client.getRealtimeReport({ propertyId, dimensions, metrics, limit });
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }
);

// ── 3. Run Custom Query Report ───────────────────────────────────────────────
server.tool(
  'ga_run_report',
  {
    propertyId: z.string().optional().describe("GA4 Property ID (numeric, e.g. '123456789'). Defaults to the default property set in environment."),
    startDate: z.string().describe("Start date for query. Format: 'YYYY-MM-DD' or relative (e.g., 'today', 'yesterday', '30daysAgo')."),
    endDate: z.string().describe("End date for query. Format: 'YYYY-MM-DD' or relative (e.g., 'today', 'yesterday')."),
    dimensions: z.array(DimensionSchema).describe("Dimensions to group data by (e.g., pagePath, sessionSource, date)."),
    metrics: z.array(MetricSchema).describe("Metrics to fetch (e.g., activeUsers, screenPageViews, conversions)."),
    limit: z.number().optional().describe("Limit on the number of rows returned. Defaults to 100.")
  },
  async ({ propertyId, startDate, endDate, dimensions, metrics, limit }) => {
    try {
      const data = await client.runReport({ propertyId, startDate, endDate, dimensions, metrics, limit });
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }
);

// ── 4. Get Metadata ──────────────────────────────────────────────────────────
server.tool(
  'ga_get_metadata',
  {
    propertyId: z.string().optional().describe("GA4 Property ID (numeric, e.g. '123456789') to inspect metadata fields for. Defaults to the default property set in environment.")
  },
  async ({ propertyId }) => {
    try {
      const data = await client.getMetadata(propertyId);
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }
);

// ── 5. Top Conversion Paths ──────────────────────────────────────────────────
server.tool(
  'ga_get_top_conversion_paths',
  {
    propertyId: z.string().optional().describe("GA4 Property ID."),
    startDate: z.string().describe("Start date (YYYY-MM-DD or relative like '30daysAgo')."),
    endDate: z.string().describe("End date (YYYY-MM-DD or relative like 'today')."),
    limit: z.number().optional().describe("Max rows. Default: 50.")
  },
  async ({ propertyId, startDate, endDate, limit }) => {
    try {
      const data = await client.runReport({
        propertyId,
        startDate,
        endDate,
        dimensions: [
          { name: 'sessionSource' },
          { name: 'sessionMedium' },
          { name: 'landingPagePlusQueryString' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'conversions' },
          { name: 'engagementRate' },
          { name: 'averageSessionDuration' },
        ],
        limit: limit || 50,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }
);

// ── 6. Landing Page Performance ──────────────────────────────────────────────
server.tool(
  'ga_get_landing_page_performance',
  {
    propertyId: z.string().optional().describe("GA4 Property ID."),
    startDate: z.string().describe("Start date (YYYY-MM-DD or relative)."),
    endDate: z.string().describe("End date (YYYY-MM-DD or relative)."),
    limit: z.number().optional().describe("Max rows. Default: 100.")
  },
  async ({ propertyId, startDate, endDate, limit }) => {
    try {
      const data = await client.runReport({
        propertyId,
        startDate,
        endDate,
        dimensions: [
          { name: 'landingPagePlusQueryString' },
        ],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
          { name: 'screenPageViewsPerSession' },
          { name: 'conversions' },
          { name: 'engagementRate' },
        ],
        limit: limit || 100,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }
);

// ── 7. User Acquisition Report ───────────────────────────────────────────────
server.tool(
  'ga_get_user_acquisition',
  {
    propertyId: z.string().optional().describe("GA4 Property ID."),
    startDate: z.string().describe("Start date."),
    endDate: z.string().describe("End date."),
    limit: z.number().optional().describe("Max rows. Default: 50.")
  },
  async ({ propertyId, startDate, endDate, limit }) => {
    try {
      const data = await client.runReport({
        propertyId,
        startDate,
        endDate,
        dimensions: [
          { name: 'firstUserSource' },
          { name: 'firstUserMedium' },
          { name: 'firstUserCampaignName' },
        ],
        metrics: [
          { name: 'newUsers' },
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'engagementRate' },
          { name: 'conversions' },
        ],
        limit: limit || 50,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }
);

// ── 8. Event Breakdown Report ────────────────────────────────────────────────
server.tool(
  'ga_get_event_breakdown',
  {
    propertyId: z.string().optional().describe("GA4 Property ID."),
    startDate: z.string().describe("Start date."),
    endDate: z.string().describe("End date."),
    limit: z.number().optional().describe("Max rows. Default: 100.")
  },
  async ({ propertyId, startDate, endDate, limit }) => {
    try {
      const data = await client.runReport({
        propertyId,
        startDate,
        endDate,
        dimensions: [
          { name: 'eventName' },
        ],
        metrics: [
          { name: 'eventCount' },
          { name: 'totalUsers' },
          { name: 'eventCountPerUser' },
          { name: 'conversions' },
        ],
        limit: limit || 100,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
//  ADMIN / WRITE TOOLS (GA4 Admin API) — require the service account to have
//  Editor or Administrator access on the target GA4 property.
// ═══════════════════════════════════════════════════════════════════════════

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const fail = (error: any) => ({ content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true });

// ── 9. List Custom Dimensions ────────────────────────────────────────────────
server.tool(
  'ga_list_custom_dimensions',
  {
    propertyId: z.string().optional().describe("GA4 Property ID (numeric). Defaults to GA4_PROPERTY_ID.")
  },
  async ({ propertyId }) => {
    try { return ok(await client.listCustomDimensions(propertyId)); } catch (e: any) { return fail(e); }
  }
);

// ── 10. Create Custom Dimension ──────────────────────────────────────────────
server.tool(
  'ga_create_custom_dimension',
  {
    propertyId: z.string().optional().describe("GA4 Property ID (numeric). Defaults to GA4_PROPERTY_ID."),
    parameterName: z.string().describe("The event parameter or user property name that feeds this dimension (e.g. 'lead_source'). Must already be sent by your tags."),
    displayName: z.string().describe("Human-readable name shown in the GA4 UI (e.g. 'Lead Source')."),
    scope: z.enum(["EVENT", "USER", "ITEM"]).optional().describe("Dimension scope. Defaults to EVENT."),
    description: z.string().optional().describe("Optional description."),
    disallowAdsPersonalization: z.boolean().optional().describe("If true, marks the dimension as NPA (no ads personalization). Defaults to false.")
  },
  async (args) => {
    try { return ok(await client.createCustomDimension(args)); } catch (e: any) { return fail(e); }
  }
);

// ── 11. Archive Custom Dimension ─────────────────────────────────────────────
server.tool(
  'ga_archive_custom_dimension',
  {
    propertyId: z.string().optional().describe("GA4 Property ID (numeric). Defaults to GA4_PROPERTY_ID."),
    name: z.string().describe("Custom dimension id or full resource name (e.g. '123' or 'properties/456/customDimensions/123').")
  },
  async (args) => {
    try { return ok(await client.archiveCustomDimension(args)); } catch (e: any) { return fail(e); }
  }
);

// ── 12. List Custom Metrics ──────────────────────────────────────────────────
server.tool(
  'ga_list_custom_metrics',
  {
    propertyId: z.string().optional().describe("GA4 Property ID (numeric). Defaults to GA4_PROPERTY_ID.")
  },
  async ({ propertyId }) => {
    try { return ok(await client.listCustomMetrics(propertyId)); } catch (e: any) { return fail(e); }
  }
);

// ── 13. Create Custom Metric ─────────────────────────────────────────────────
server.tool(
  'ga_create_custom_metric',
  {
    propertyId: z.string().optional().describe("GA4 Property ID (numeric). Defaults to GA4_PROPERTY_ID."),
    parameterName: z.string().describe("The event parameter name that feeds this metric (e.g. 'deal_value')."),
    displayName: z.string().describe("Human-readable name shown in the GA4 UI (e.g. 'Deal Value')."),
    measurementUnit: z.enum(["STANDARD", "CURRENCY", "FEET", "MILES", "METERS", "KILOMETERS", "MILLISECONDS", "SECONDS", "MINUTES", "HOURS"]).optional().describe("Measurement unit. Defaults to STANDARD."),
    description: z.string().optional().describe("Optional description.")
  },
  async (args) => {
    try { return ok(await client.createCustomMetric(args)); } catch (e: any) { return fail(e); }
  }
);

// ── 14. Archive Custom Metric ────────────────────────────────────────────────
server.tool(
  'ga_archive_custom_metric',
  {
    propertyId: z.string().optional().describe("GA4 Property ID (numeric). Defaults to GA4_PROPERTY_ID."),
    name: z.string().describe("Custom metric id or full resource name (e.g. '123' or 'properties/456/customMetrics/123').")
  },
  async (args) => {
    try { return ok(await client.archiveCustomMetric(args)); } catch (e: any) { return fail(e); }
  }
);

// ── 15. List Conversion Events ───────────────────────────────────────────────
server.tool(
  'ga_list_conversion_events',
  {
    propertyId: z.string().optional().describe("GA4 Property ID (numeric). Defaults to GA4_PROPERTY_ID.")
  },
  async ({ propertyId }) => {
    try { return ok(await client.listConversionEvents(propertyId)); } catch (e: any) { return fail(e); }
  }
);

// ── 16. Create Conversion Event (Key Event) ──────────────────────────────────
server.tool(
  'ga_create_conversion_event',
  {
    propertyId: z.string().optional().describe("GA4 Property ID (numeric). Defaults to GA4_PROPERTY_ID."),
    eventName: z.string().describe("The event name to mark as a conversion / key event (e.g. 'generate_lead')."),
    countingMethod: z.enum(["ONCE_PER_EVENT", "ONCE_PER_SESSION"]).optional().describe("How conversions are counted. Defaults to ONCE_PER_EVENT.")
  },
  async (args) => {
    try { return ok(await client.createConversionEvent(args)); } catch (e: any) { return fail(e); }
  }
);

// ── 17. Delete Conversion Event ──────────────────────────────────────────────
server.tool(
  'ga_delete_conversion_event',
  {
    propertyId: z.string().optional().describe("GA4 Property ID (numeric). Defaults to GA4_PROPERTY_ID."),
    name: z.string().describe("Conversion event id or full resource name (e.g. '123' or 'properties/456/conversionEvents/123').")
  },
  async (args) => {
    try { return ok(await client.deleteConversionEvent(args)); } catch (e: any) { return fail(e); }
  }
);

// ── 18. List Data Streams (surfaces Measurement IDs) ─────────────────────────
server.tool(
  'ga_list_data_streams',
  {
    propertyId: z.string().optional().describe("GA4 Property ID (numeric). Defaults to GA4_PROPERTY_ID.")
  },
  async ({ propertyId }) => {
    try { return ok(await client.listDataStreams(propertyId)); } catch (e: any) { return fail(e); }
  }
);

// Start StdIO Transport
const transport = new StdioServerTransport();

async function main(): Promise<void> {
  await server.connect(transport);
  console.error('[google-analytics-mcp] Server successfully connected to transport.');
}

process.on('SIGINT', () => {
  console.error('[google-analytics-mcp] Shutting down.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('[google-analytics-mcp] Shutting down.');
  process.exit(0);
});

main().catch((err: unknown) => {
  console.error('[google-analytics-mcp] Fatal error:', err);
  process.exit(1);
});
