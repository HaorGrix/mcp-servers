import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleSearchConsoleClient } from "./client.js";

const client = new GoogleSearchConsoleClient();

const server = new Server(
  {
    name: "google-search-console-mcp",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_sites",
        description: "List all Google Search Console sites the service account has access to.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get_search_analytics",
        description: "Query search traffic data (clicks, impressions, CTR, position) with advanced filtering. Supports up to 25,000 rows, search type filtering, dimension filters, and aggregation modes.",
        inputSchema: {
          type: "object",
          properties: {
            startDate: {
              type: "string",
              description: "Start date in YYYY-MM-DD format (e.g. 2024-01-01)",
            },
            endDate: {
              type: "string",
              description: "End date in YYYY-MM-DD format (e.g. 2024-01-31)",
            },
            dimensions: {
              type: "array",
              items: { type: "string" },
              description: "Dimensions to group by: 'query', 'page', 'country', 'device', 'date', 'searchAppearance'. Combine for cross-analysis.",
            },
            rowLimit: {
              type: "number",
              description: "Max rows to return (1-25000, default: 1000). Use higher values for comprehensive analysis.",
            },
            startRow: {
              type: "number",
              description: "Starting row for pagination (0-indexed). Use with rowLimit for paginated queries.",
            },
            searchType: {
              type: "string",
              enum: ["web", "image", "video", "news", "discover", "googleNews"],
              description: "Type of search results to query. Default: 'web'.",
            },
            aggregationType: {
              type: "string",
              enum: ["auto", "byPage", "byProperty"],
              description: "How to aggregate data. 'byPage' shows per-URL metrics, 'byProperty' aggregates across all URLs.",
            },
            filters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  dimension: { type: "string", description: "Dimension to filter: 'query', 'page', 'country', 'device'" },
                  operator: { type: "string", enum: ["equals", "contains", "notContains", "includingRegex", "excludingRegex"] },
                  expression: { type: "string", description: "Filter value or regex pattern" },
                },
                required: ["dimension", "operator", "expression"],
              },
              description: "Filter results by dimension values. Example: filter pages containing '/blog/' or queries containing 'ai automation'.",
            },
          },
          required: ["startDate", "endDate"],
        },
      },
      {
        name: "inspect_url",
        description: "Inspect a URL's indexing status in Google Search Console. Returns crawl status, indexing status, rich results, mobile usability, and more.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The fully qualified URL to inspect (e.g. https://haorgrix.com/services/ai-automation-agency-bangladesh)",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "list_sitemaps",
        description: "List all sitemaps submitted to Google Search Console, including their status, error counts, and URL counts.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "submit_sitemap",
        description: "Submit a new sitemap URL to Google Search Console for processing.",
        inputSchema: {
          type: "object",
          properties: {
            feedpath: {
              type: "string",
              description: "Full URL of the sitemap (e.g. https://haorgrix.com/sitemap.xml)",
            },
          },
          required: ["feedpath"],
        },
      },
      {
        name: "delete_sitemap",
        description: "Remove a previously submitted sitemap from Google Search Console.",
        inputSchema: {
          type: "object",
          properties: {
            feedpath: {
              type: "string",
              description: "Full URL of the sitemap to remove",
            },
          },
          required: ["feedpath"],
        },
      },
      {
        name: "submit_url_for_indexing",
        description: "Submit a URL to Google's Indexing API for immediate re-crawl. Requires the service account to have Search Console Owner permissions. Limited to ~200 requests/day.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The fully qualified URL to submit (e.g. https://haorgrix.com/blog/new-post)",
            },
            type: {
              type: "string",
              enum: ["URL_UPDATED", "URL_DELETED"],
              description: "Notification type. URL_UPDATED for new/changed content, URL_DELETED for removed pages. Default: URL_UPDATED.",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "get_indexing_status",
        description: "Check the last indexing notification status for a specific URL via the Indexing API.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL to check indexing status for",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "get_ctr_rescue_candidates",
        description: "Find queries with high impressions but near-zero CTR — these are pages ranking on page 1-2 but failing to get clicks. These are the highest-ROI optimization targets (fix title tags and meta descriptions).",
        inputSchema: {
          type: "object",
          properties: {
            startDate: {
              type: "string",
              description: "Start date in YYYY-MM-DD format",
            },
            endDate: {
              type: "string",
              description: "End date in YYYY-MM-DD format",
            },
            maxPosition: {
              type: "number",
              description: "Maximum average position to include (default: 20). Lower = stricter filter for page 1-2 only.",
            },
            maxCTR: {
              type: "number",
              description: "Maximum CTR threshold (default: 0.02 = 2%). Queries below this are rescue candidates.",
            },
          },
          required: ["startDate", "endDate"],
        },
      },
      {
        name: "get_position_changes",
        description: "Compare search performance between two date ranges to identify position gains and losses. Useful for tracking SEO progress or detecting ranking drops.",
        inputSchema: {
          type: "object",
          properties: {
            period1Start: { type: "string", description: "First period start date (YYYY-MM-DD)" },
            period1End: { type: "string", description: "First period end date" },
            period2Start: { type: "string", description: "Second period start date" },
            period2End: { type: "string", description: "Second period end date" },
            dimension: {
              type: "string",
              enum: ["query", "page"],
              description: "Compare by query or by page URL. Default: 'page'.",
            },
          },
          required: ["period1Start", "period1End", "period2Start", "period2End"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const args = request.params.arguments as Record<string, unknown>;

    switch (request.params.name) {
      case "list_sites": {
        const data = await client.listSites();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
      
      case "get_search_analytics": {
        const filters = args.filters as { dimension: string; operator: string; expression: string }[] | undefined;
        const data = await client.querySearchAnalytics({
          startDate: args.startDate as string,
          endDate: args.endDate as string,
          dimensions: args.dimensions as string[] | undefined,
          rowLimit: args.rowLimit as number | undefined,
          startRow: args.startRow as number | undefined,
          searchType: args.searchType as 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews' | undefined,
          aggregationType: args.aggregationType as 'auto' | 'byPage' | 'byProperty' | undefined,
          dimensionFilterGroups: filters ? [{
            filters: filters.map(f => ({
              dimension: f.dimension,
              operator: f.operator as 'equals' | 'contains' | 'notContains' | 'includingRegex' | 'excludingRegex',
              expression: f.expression,
            })),
          }] : undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "inspect_url": {
        const data = await client.inspectUrl(args.url as string);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "list_sitemaps": {
        const data = await client.listSitemaps();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "submit_sitemap": {
        await client.submitSitemap(args.feedpath as string);
        return { content: [{ type: "text", text: `Sitemap submitted successfully: ${args.feedpath}` }] };
      }

      case "delete_sitemap": {
        await client.deleteSitemap(args.feedpath as string);
        return { content: [{ type: "text", text: `Sitemap deleted successfully: ${args.feedpath}` }] };
      }

      case "submit_url_for_indexing": {
        const data = await client.submitUrlForIndexing(
          args.url as string,
          (args.type as 'URL_UPDATED' | 'URL_DELETED') || 'URL_UPDATED'
        );
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "get_indexing_status": {
        const data = await client.getUrlNotificationStatus(args.url as string);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "get_ctr_rescue_candidates": {
        const data = await client.getCTRRescueCandidates(
          args.startDate as string,
          args.endDate as string,
          args.maxPosition as number | undefined,
          args.maxCTR as number | undefined,
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalCandidates: data.length,
              description: "Queries ranking on page 1-2 with near-zero CTR. Fix title tags and meta descriptions for these.",
              candidates: data,
            }, null, 2),
          }],
        };
      }

      case "get_position_changes": {
        const data = await client.getPositionChanges(
          args.period1Start as string,
          args.period1End as string,
          args.period2Start as string,
          args.period2End as string,
          (args.dimension as 'query' | 'page') || 'page',
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalCompared: data.length,
              description: "Negative 'change' = position dropped (got worse). Positive = improved.",
              changes: data,
            }, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
