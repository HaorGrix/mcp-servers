/**
 * Governance, scale and intelligence read tools: change-log/audit, Meta's own
 * recommendations, automated ad rules (read), async historical reports, reach &
 * frequency prediction, and live rate-limit status. Read-only; existing scopes.
 */
import { GraphError } from "./graph.js";
import { assertAccountId, assertNodeId, insightsParams } from "./tools.js";
import { DATE_PRESETS } from "./fields.js";

const ACCOUNT_ID = { type: "string", description: "Ad account id, e.g. act_123456789." };
const PRESET = { type: "string", enum: DATE_PRESETS, description: "Default: maximum." };

/** @param {import("./graph.js").GraphClient} graph */
export function governTools(graph) {
  return [
    {
      name: "get_change_history",
      description:
        "Audit log of changes on an ad account (adactivity): who changed budgets, status, targeting, " +
        "bids, and when. Enterprise accountability. Optional since/until.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          since: { type: "string", description: "YYYY-MM-DD." },
          until: { type: "string", description: "YYYY-MM-DD." },
          limit: { type: "number", description: "Default 100." },
        },
        required: ["ad_account_id"],
      },
      handler: async (a) =>
        graph.paginate(`${assertAccountId(a.ad_account_id)}/activities`, {
          fields: "event_type,event_time,actor_name,actor_id,object_name,object_type,extra_data,translated_event_type",
          limit: a.limit ?? 100,
          ...(a.since && a.until ? { since: a.since, until: a.until } : {}),
        }),
    },
    {
      name: "get_recommendations",
      description:
        "Meta's own optimization recommendations for an account or campaign (delivery, creative, budget, " +
        "audience). Its native suggestions, surfaced programmatically.",
      inputSchema: {
        type: "object",
        properties: { target_id: { type: "string", description: "Account or campaign id." } },
        required: ["target_id"],
      },
      handler: async (a) => {
        const id = a.target_id.startsWith("act_") ? assertAccountId(a.target_id) : assertNodeId(a.target_id, "target_id");
        return graph.request(id, { fields: "recommendations" });
      },
    },
    {
      name: "list_ad_rules",
      description:
        "Automated ad rules configured on the account (auto-pause, auto-scale, dayparting): their conditions, " +
        "actions, schedule and status.",
      inputSchema: {
        type: "object",
        properties: { ad_account_id: ACCOUNT_ID },
        required: ["ad_account_id"],
      },
      handler: async (a) =>
        graph.paginate(`${assertAccountId(a.ad_account_id)}/adrules_library`, {
          fields: "id,name,status,evaluation_spec,execution_spec,schedule_spec,created_time,updated_time",
        }),
    },
    {
      name: "async_insights_report",
      description:
        "Heavy historical insights via Meta's async job API (submit → poll → fetch), for large date ranges " +
        "or ad-level pulls that time out synchronously. Same params as get_insights.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          level: { type: "string", enum: ["account", "campaign", "adset", "ad"], description: "Default: ad." },
          date_preset: PRESET, since: { type: "string" }, until: { type: "string" },
          time_increment: { type: "string" }, breakdowns: { type: "string" },
        },
        required: ["ad_account_id"],
      },
      handler: async (a) =>
        graph.asyncReport(`${assertAccountId(a.ad_account_id)}/insights`,
          insightsParams({ level: "ad", ...a })),
    },
    {
      name: "get_reach_frequency_prediction",
      description:
        "Reach & frequency prediction for a prospective buy: estimated reach for a budget over a date range " +
        "and targeting. For planning reserved/awareness campaigns.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          targeting: { type: "object", description: "Full targeting spec." },
          budget: { type: "number", description: "Budget in cents." },
          start_time: { type: "number", description: "Unix timestamp." },
          end_time: { type: "number", description: "Unix timestamp." },
          objective: { type: "string", description: "Default: REACH." },
        },
        required: ["ad_account_id", "targeting", "budget", "start_time", "end_time"],
      },
      handler: async (a) =>
        graph.request(`${assertAccountId(a.ad_account_id)}/reachfrequencypredictions`, {}, {
          method: "POST",
          body: {
            target_spec: a.targeting, budget: a.budget,
            start_time: a.start_time, end_time: a.end_time,
            objective: a.objective ?? "REACH", prediction_mode: 1,
          },
        }),
    },
    {
      name: "get_rate_limit_status",
      description:
        "Live Meta API usage the server has observed (app / ad-account / business-use-case, 0-100%). " +
        "Shows headroom before throttling; the client auto-slows above 80%.",
      inputSchema: { type: "object", properties: {}, required: [] },
      handler: async () => ({
        usage_pct: graph.usage,
        peak_pct: graph.peakUsage(),
        auto_throttle: "500ms delay >=80%, 2s delay >=95%",
        note: graph.usage.updatedAt ? "Live from last response headers." : "No request made yet this session.",
      }),
    },
  ];
}
