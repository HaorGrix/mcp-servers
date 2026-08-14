import { GraphError } from "./graph.js";
import {
  ACCOUNT_FIELDS, CAMPAIGN_FIELDS, ADSET_FIELDS, AD_FIELDS, CREATIVE_FIELDS,
  INSIGHTS_FIELDS, INSIGHTS_FIELDS_LITE, INSIGHT_LEVELS, DATE_PRESETS,
} from "./fields.js";

const ACCOUNT_ID = { type: "string", description: "Ad account id, e.g. act_123456789." };
const FIELDS_OVERRIDE = {
  type: "string",
  description: "Optional comma-separated field override. Omit to use the full default set.",
};

/** Ad account ids must be act_<digits>; anything else is a caller mistake. */
export function assertAccountId(id) {
  if (typeof id !== "string" || !/^act_\d+$/.test(id)) {
    throw new GraphError(`ad_account_id must look like "act_123456789", got "${id}".`);
  }
  return id;
}

export function assertNodeId(id, label) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_]+$/.test(id)) {
    throw new GraphError(`${label} must be a Graph node id, got "${id}".`);
  }
  return id;
}

/**
 * Builds the insights query shared by every insights tool.
 * @param {object} args
 */
export function insightsParams(args) {
  const {
    level = "account", date_preset = "maximum", time_increment, breakdowns,
    action_breakdowns, since, until, fields, filtering, use_lite_fields = false,
  } = args;

  if (!INSIGHT_LEVELS.includes(level)) {
    throw new GraphError(`level must be one of ${INSIGHT_LEVELS.join(", ")}, got "${level}".`);
  }

  const params = {
    level,
    fields: fields ?? (use_lite_fields ? INSIGHTS_FIELDS_LITE : INSIGHTS_FIELDS),
  };

  // An explicit since/until window always wins over a preset.
  if (since || until) {
    if (!since || !until) {
      throw new GraphError("since and until must be supplied together.");
    }
    params.time_range = JSON.stringify({ since, until });
  } else {
    if (!DATE_PRESETS.includes(date_preset)) {
      throw new GraphError(`Unknown date_preset "${date_preset}".`);
    }
    params.date_preset = date_preset;
  }

  if (time_increment) params.time_increment = time_increment;
  if (breakdowns) params.breakdowns = breakdowns;
  if (action_breakdowns) params.action_breakdowns = action_breakdowns;
  if (filtering) params.filtering = typeof filtering === "string" ? filtering : JSON.stringify(filtering);

  return params;
}

/**
 * Read-only tool definitions plus their handlers.
 * @param {import("./graph.js").GraphClient} graph
 */
export function readTools(graph) {
  return [
    {
      name: "list_ad_accounts",
      description: "List every ad account the token can reach, with status, currency and lifetime spend.",
      inputSchema: { type: "object", properties: {}, required: [] },
      handler: async () => graph.paginate("me/adaccounts", { fields: ACCOUNT_FIELDS }),
    },
    {
      name: "get_ad_account",
      description: "Full metadata for one ad account: balance, spend cap, funding source, timezone.",
      inputSchema: {
        type: "object",
        properties: { ad_account_id: ACCOUNT_ID, fields: FIELDS_OVERRIDE },
        required: ["ad_account_id"],
      },
      handler: async (a) =>
        graph.request(assertAccountId(a.ad_account_id), { fields: a.fields ?? ACCOUNT_FIELDS }),
    },
    {
      name: "list_campaigns",
      description: "All campaigns in an ad account, fully paginated, with budgets, objective and schedule.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          effective_status: {
            type: "array",
            items: { type: "string" },
            description: 'Optional status filter, e.g. ["ACTIVE","PAUSED"].',
          },
          fields: FIELDS_OVERRIDE,
        },
        required: ["ad_account_id"],
      },
      handler: async (a) =>
        graph.paginate(`${assertAccountId(a.ad_account_id)}/campaigns`, {
          fields: a.fields ?? CAMPAIGN_FIELDS,
          ...(a.effective_status ? { effective_status: JSON.stringify(a.effective_status) } : {}),
        }),
    },
    {
      name: "list_adsets",
      description: "All ad sets in an ad account (or one campaign), including full targeting specs.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          campaign_id: { type: "string", description: "Optional: scope to a single campaign." },
          fields: FIELDS_OVERRIDE,
        },
        required: ["ad_account_id"],
      },
      handler: async (a) => {
        const parent = a.campaign_id
          ? assertNodeId(a.campaign_id, "campaign_id")
          : assertAccountId(a.ad_account_id);
        return graph.paginate(`${parent}/adsets`, { fields: a.fields ?? ADSET_FIELDS });
      },
    },
    {
      name: "list_ads",
      description: "All ads in an ad account, campaign, or ad set, with their parent ids and creative id.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          campaign_id: { type: "string", description: "Optional: scope to a campaign." },
          adset_id: { type: "string", description: "Optional: scope to an ad set." },
          fields: FIELDS_OVERRIDE,
        },
        required: ["ad_account_id"],
      },
      handler: async (a) => {
        const parent = a.adset_id
          ? assertNodeId(a.adset_id, "adset_id")
          : a.campaign_id
            ? assertNodeId(a.campaign_id, "campaign_id")
            : assertAccountId(a.ad_account_id);
        return graph.paginate(`${parent}/ads`, { fields: a.fields ?? AD_FIELDS });
      },
    },
    {
      name: "list_creatives",
      description: "Ad creatives for an account: headline, body copy, CTA, image/video refs, story spec.",
      inputSchema: {
        type: "object",
        properties: { ad_account_id: ACCOUNT_ID, fields: FIELDS_OVERRIDE },
        required: ["ad_account_id"],
      },
      handler: async (a) =>
        graph.paginate(`${assertAccountId(a.ad_account_id)}/adcreatives`, {
          fields: a.fields ?? CREATIVE_FIELDS,
        }),
    },
    {
      name: "get_insights",
      description:
        "Performance data for any node (account, campaign, ad set, ad). Supports level, date presets " +
        "or explicit since/until, daily time_increment, and breakdowns. Fully paginated.",
      inputSchema: {
        type: "object",
        properties: {
          target_id: { type: "string", description: "Ad account, campaign, ad set, or ad id." },
          level: { type: "string", enum: INSIGHT_LEVELS, description: "Aggregation level. Default: account." },
          date_preset: { type: "string", enum: DATE_PRESETS, description: "Default: maximum." },
          since: { type: "string", description: "YYYY-MM-DD. Use with until; overrides date_preset." },
          until: { type: "string", description: "YYYY-MM-DD. Use with since." },
          time_increment: { type: "string", description: '"1" for daily rows, "monthly", or "all_days".' },
          breakdowns: { type: "string", description: 'e.g. "age,gender", "country", "device_platform".' },
          action_breakdowns: { type: "string", description: 'e.g. "action_type".' },
          filtering: { type: "string", description: "JSON filtering array, passed through to Graph." },
          use_lite_fields: {
            type: "boolean",
            description: "Use the reduced projection. Try this if a large query fails with code 1.",
          },
          fields: FIELDS_OVERRIDE,
        },
        required: ["target_id"],
      },
      handler: async (a) => {
        const target = a.target_id.startsWith("act_")
          ? assertAccountId(a.target_id)
          : assertNodeId(a.target_id, "target_id");
        try {
          return await graph.paginate(`${target}/insights`, insightsParams(a));
        } catch (err) {
          // Meta throws a contentless "code 1 / subcode 99" when a projection is too
          // heavy. Retrying lighter succeeds, so do it rather than surfacing a dead end.
          const tooHeavy = err instanceof GraphError && err.code === 1 && !a.use_lite_fields && !a.fields;
          if (!tooHeavy) throw err;
          const result = await graph.paginate(
            `${target}/insights`,
            insightsParams({ ...a, use_lite_fields: true }),
          );
          return { ...result, degraded: "Full field set failed (code 1); returned reduced projection." };
        }
      },
    },
    {
      name: "get_account_snapshot",
      description:
        "One-shot audit pull: account metadata, campaigns, ad sets, ads, creatives, lifetime insights " +
        "at every level, and age/gender + placement + device breakdowns. Use this to survey an account.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          date_preset: { type: "string", enum: DATE_PRESETS, description: "Default: maximum." },
        },
        required: ["ad_account_id"],
      },
      handler: async (a) => {
        const id = assertAccountId(a.ad_account_id);
        const preset = a.date_preset ?? "maximum";
        const ins = (extra) => graph.paginate(`${id}/insights`, insightsParams({ date_preset: preset, ...extra }));

        // Settled, not all — one bad breakdown must not sink the whole snapshot.
        const [account, campaigns, adsets, ads, creatives, byAccount, byCampaign, byAdset, byAd, ageGender, placement, device] =
          await Promise.allSettled([
            graph.request(id, { fields: ACCOUNT_FIELDS }),
            graph.paginate(`${id}/campaigns`, { fields: CAMPAIGN_FIELDS }),
            graph.paginate(`${id}/adsets`, { fields: ADSET_FIELDS }),
            graph.paginate(`${id}/ads`, { fields: AD_FIELDS }),
            graph.paginate(`${id}/adcreatives`, { fields: CREATIVE_FIELDS }),
            ins({ level: "account" }),
            ins({ level: "campaign" }),
            ins({ level: "adset" }),
            ins({ level: "ad" }),
            ins({ level: "account", breakdowns: "age,gender" }),
            ins({ level: "account", breakdowns: "publisher_platform,platform_position" }),
            ins({ level: "account", breakdowns: "device_platform" }),
          ]);

        const unwrap = (r) => (r.status === "fulfilled" ? r.value : { error: String(r.reason?.message ?? r.reason) });

        return {
          pulled_at_date_preset: preset,
          account: unwrap(account),
          campaigns: unwrap(campaigns),
          adsets: unwrap(adsets),
          ads: unwrap(ads),
          creatives: unwrap(creatives),
          insights: {
            account: unwrap(byAccount),
            campaign: unwrap(byCampaign),
            adset: unwrap(byAdset),
            ad: unwrap(byAd),
          },
          breakdowns: {
            age_gender: unwrap(ageGender),
            placement: unwrap(placement),
            device: unwrap(device),
          },
        };
      },
    },
  ];
}

/**
 * Write tools. Always create PAUSED objects — nothing here can start spending on its own.
 * @param {import("./graph.js").GraphClient} graph
 */
export function writeTools(graph) {
  return [
    {
      name: "create_campaign",
      description:
        "Create a PAUSED campaign. Never starts delivery. Requires META_ALLOW_WRITES=true.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          name: { type: "string", description: "Campaign name." },
          objective: { type: "string", description: "e.g. OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_TRAFFIC." },
          daily_budget: { type: "number", description: "Daily budget in minor units (cents)." },
          lifetime_budget: { type: "number", description: "Lifetime budget in cents. Use instead of daily." },
          bid_strategy: { type: "string", description: "Default: LOWEST_COST_WITHOUT_CAP." },
          special_ad_categories: {
            type: "array",
            items: { type: "string" },
            description: 'Default: ["NONE"]. Use ["EMPLOYMENT"] / ["HOUSING"] / ["CREDIT"] where required by law.',
          },
        },
        required: ["ad_account_id", "name", "objective"],
      },
      handler: async (a) => {
        if (!a.daily_budget && !a.lifetime_budget) {
          throw new GraphError("Supply either daily_budget or lifetime_budget (in cents).");
        }
        return graph.request(`${assertAccountId(a.ad_account_id)}/campaigns`, {}, {
          method: "POST",
          body: {
            name: a.name,
            objective: a.objective,
            status: "PAUSED",
            bid_strategy: a.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP",
            special_ad_categories: a.special_ad_categories ?? ["NONE"],
            ...(a.daily_budget ? { daily_budget: a.daily_budget } : {}),
            ...(a.lifetime_budget ? { lifetime_budget: a.lifetime_budget } : {}),
          },
        });
      },
    },
    {
      name: "create_adset",
      description:
        "Create a PAUSED ad set under an existing campaign, with caller-supplied targeting. " +
        "Requires META_ALLOW_WRITES=true.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          campaign_id: { type: "string", description: "Parent campaign id." },
          name: { type: "string", description: "Ad set name." },
          optimization_goal: { type: "string", description: "e.g. POST_ENGAGEMENT, LEAD_GENERATION, LINK_CLICKS." },
          billing_event: { type: "string", description: "Default: IMPRESSIONS." },
          daily_budget: { type: "number", description: "Daily budget in cents (omit if the campaign holds the budget)." },
          start_time: { type: "string", description: "ISO 8601, e.g. 2026-08-01T12:00:00-0400." },
          end_time: { type: "string", description: "ISO 8601." },
          targeting: { type: "object", description: "Full Graph targeting spec object." },
          promoted_object: { type: "object", description: "e.g. { page_id: \"...\" } for page-likes." },
          destination_type: { type: "string", description: "e.g. FACEBOOK_PAGE, MESSENGER, WEBSITE." },
        },
        required: ["ad_account_id", "campaign_id", "name", "optimization_goal", "targeting"],
      },
      handler: async (a) =>
        graph.request(`${assertAccountId(a.ad_account_id)}/adsets`, {}, {
          method: "POST",
          body: {
            name: a.name,
            campaign_id: assertNodeId(a.campaign_id, "campaign_id"),
            status: "PAUSED",
            optimization_goal: a.optimization_goal,
            billing_event: a.billing_event ?? "IMPRESSIONS",
            targeting: a.targeting,
            ...(a.daily_budget ? { daily_budget: a.daily_budget } : {}),
            ...(a.start_time ? { start_time: a.start_time } : {}),
            ...(a.end_time ? { end_time: a.end_time } : {}),
            ...(a.promoted_object ? { promoted_object: a.promoted_object } : {}),
            ...(a.destination_type ? { destination_type: a.destination_type } : {}),
          },
        }),
    },
    {
      name: "create_ad",
      description:
        "Create a PAUSED ad in an existing ad set. Either reuse an organic post " +
        "(object_story_id, which keeps its accumulated likes and comments) or supply a " +
        "creative_id. Requires META_ALLOW_WRITES=true.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          adset_id: { type: "string", description: "Parent ad set id." },
          name: { type: "string", description: "Ad name." },
          object_story_id: {
            type: "string",
            description: 'Existing post, formatted "<page_id>_<post_id>". Keeps its social proof.',
          },
          creative_id: { type: "string", description: "Existing ad creative id. Alternative to object_story_id." },
        },
        required: ["ad_account_id", "adset_id", "name"],
      },
      handler: async (a) => {
        if (!a.object_story_id && !a.creative_id) {
          throw new GraphError("Supply either object_story_id (an existing post) or creative_id.");
        }
        return graph.request(`${assertAccountId(a.ad_account_id)}/ads`, {}, {
          method: "POST",
          body: {
            name: a.name,
            adset_id: assertNodeId(a.adset_id, "adset_id"),
            status: "PAUSED",
            creative: a.creative_id
              ? { creative_id: a.creative_id }
              : { object_story_id: a.object_story_id },
          },
        });
      },
    },
    {
      name: "update_status",
      description:
        "Set status (ACTIVE / PAUSED / ARCHIVED) on a campaign, ad set, or ad. " +
        "Setting ACTIVE can start spending. Requires META_ALLOW_WRITES=true.",
      inputSchema: {
        type: "object",
        properties: {
          node_id: { type: "string", description: "Campaign, ad set, or ad id." },
          status: { type: "string", enum: ["ACTIVE", "PAUSED", "ARCHIVED"] },
        },
        required: ["node_id", "status"],
      },
      handler: async (a) => {
        if (!["ACTIVE", "PAUSED", "ARCHIVED"].includes(a.status)) {
          throw new GraphError(`status must be ACTIVE, PAUSED or ARCHIVED, got "${a.status}".`);
        }
        return graph.request(assertNodeId(a.node_id, "node_id"), {}, {
          method: "POST",
          body: { status: a.status },
        });
      },
    },
  ];
}
