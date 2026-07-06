import "dotenv/config.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

const server = new Server({
  name: "meta-ads-local",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
  },
});

const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

if (!ACCESS_TOKEN || ACCESS_TOKEN === "PLACEHOLDER_INSERT_YOUR_META_ACCESS_TOKEN_HERE") {
  console.error("META_ACCESS_TOKEN environment variable is not set correctly.");
  process.exit(1);
}

// Pre-configure axios with the base URL and authorization header
const api = axios.create({
  baseURL: "https://graph.facebook.com/v20.0",
  headers: {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
  },
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_ad_accounts",
        description: "Fetch the list of ad accounts associated with the user/system user.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "list_campaigns",
        description: "Fetch campaigns for a given ad account ID.",
        inputSchema: {
          type: "object",
          properties: {
            ad_account_id: { type: "string", description: "The ID of the ad account (e.g. act_123456789)" },
          },
          required: ["ad_account_id"],
        },
      },
      {
        name: "get_insights",
        description: "Fetch insights/performance data for an ad account, campaign, or ad set.",
        inputSchema: {
          type: "object",
          properties: {
            target_id: { type: "string", description: "The ID of the ad account, campaign, ad set, or ad." },
            date_preset: { type: "string", description: "Date preset, e.g., 'maximum', 'last_30d', 'today'." },
          },
          required: ["target_id"],
        },
      },
      {
        name: "create_campaign_draft",
        description: "Creates a draft engagement campaign and ad set for Podium Tutoring in the given ad account.",
        inputSchema: {
          type: "object",
          properties: {
            ad_account_id: { type: "string", description: "The ID of the ad account (e.g. act_123456789)" },
            daily_budget: { type: "number", description: "Daily budget in cents (e.g. 1071 for $10.71)" }
          },
          required: ["ad_account_id", "daily_budget"],
        },
      },
      {
        name: "create_page_likes_draft",
        description: "Creates a draft engagement campaign specifically optimized for Page Likes.",
        inputSchema: {
          type: "object",
          properties: {
            ad_account_id: { type: "string", description: "The ID of the ad account" },
            daily_budget: { type: "number", description: "Daily budget in cents" },
            page_id: { type: "string", description: "The Facebook Page ID to promote" }
          },
          required: ["ad_account_id", "daily_budget", "page_id"],
        },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "list_ad_accounts") {
      const response = await api.get("/me/adaccounts", { params: { fields: "id,name,account_status,currency" } });
      return {
        content: [{ type: "text", text: JSON.stringify(response.data.data, null, 2) }],
      };
    } 
    
    else if (name === "list_campaigns") {
      const { ad_account_id } = args;
      const response = await api.get(`/${ad_account_id}/campaigns`, { params: { fields: "id,name,status,objective" } });
      return {
        content: [{ type: "text", text: JSON.stringify(response.data.data, null, 2) }],
      };
    } 
    
    else if (name === "get_insights") {
      const { target_id, date_preset = "maximum" } = args;
      const response = await api.get(`/${target_id}/insights`, { params: { date_preset } });
      return {
        content: [{ type: "text", text: JSON.stringify(response.data.data, null, 2) }],
      };
    }
    
    else if (name === "create_campaign_draft") {
      const { ad_account_id, daily_budget } = args;
      
      // 1. Create Campaign
      const campRes = await api.post(`/${ad_account_id}/campaigns`, {
        name: "Podium Tutoring - Engagement (June 17-30)",
        objective: "OUTCOME_ENGAGEMENT",
        status: "PAUSED",
        daily_budget: daily_budget,
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        special_ad_categories: ["NONE"]
      });
      const campaign_id = campRes.data.id;
      
      // 2. Create Ad Set
      const adsetRes = await api.post(`/${ad_account_id}/adsets`, {
        name: "Queens & LI Parents (Engagement)",
        campaign_id: campaign_id,
        start_time: "2026-06-17T12:00:00-0400",
        end_time: "2026-06-30T23:59:59-0400",
        optimization_goal: "POST_ENGAGEMENT",
        billing_event: "IMPRESSIONS",
        status: "PAUSED",
        targeting: {
          geo_locations: {
            custom_locations: [
              { radius: 10, distance_unit: "mile", latitude: 40.7282, longitude: -73.7949 }
            ]
          },
          age_min: 25,
          age_max: 54,
          targeting_automation: {
            advantage_audience: 0
          }
        }
      });
      
      return {
        content: [{ type: "text", text: JSON.stringify({ message: "Draft campaign and adset created successfully", campaign_id, adset_id: adsetRes.data.id }, null, 2) }],
      };
    }
    
    else if (name === "create_page_likes_draft") {
      const { ad_account_id, daily_budget, page_id } = args;
      
      // 1. Create Campaign
      const campRes = await api.post(`/${ad_account_id}/campaigns`, {
        name: "Podium Tutoring - Page Likes (June 17-30)",
        objective: "PAGE_LIKES",
        status: "PAUSED",
        daily_budget: daily_budget,
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        special_ad_categories: ["NONE"]
      });
      const campaign_id = campRes.data.id;
      
      // 2. Create Ad Set optimized for Page Likes
      const adsetRes = await api.post(`/${ad_account_id}/adsets`, {
        name: "Queens & LI Parents (Page Likes)",
        campaign_id: campaign_id,
        start_time: "2026-06-17T12:00:00-0400",
        end_time: "2026-06-30T23:59:59-0400",
        optimization_goal: "PAGE_LIKES",
        billing_event: "IMPRESSIONS",
        destination_type: "FACEBOOK_PAGE",
        promoted_object: {
          page_id: page_id
        },
        status: "PAUSED",
        targeting: {
          geo_locations: {
            custom_locations: [
              { radius: 10, distance_unit: "mile", latitude: 40.7282, longitude: -73.7949 }
            ]
          },
          age_min: 25,
          age_max: 54,
          targeting_automation: {
            advantage_audience: 0
          }
        }
      });
      
      return {
        content: [{ type: "text", text: JSON.stringify({ message: "Draft Page Likes campaign and adset created successfully", campaign_id, adset_id: adsetRes.data.id }, null, 2) }],
      };
    }

    throw new Error(`Tool not found: ${name}`);
  } catch (error) {
    const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    return {
      content: [{ type: "text", text: `Error calling Meta API: ${errorMsg}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Meta Ads Local MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
