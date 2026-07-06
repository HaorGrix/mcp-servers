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
