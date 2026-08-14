/**
 * Advanced read tools: creative-level, day-parting, video retention, quality
 * rankings, messaging/WhatsApp funnel, Page + organic data, audiences, delivery
 * estimates, cross-account comparison, and business asset mapping.
 *
 * Everything here is read-only and runs on the scopes the token already has
 * (ads_read, pages_read_engagement, business_management). Endpoints that need a
 * scope we may not hold degrade to a clear error string rather than throwing, so
 * one missing permission never sinks a whole snapshot.
 */
import { GraphError } from "./graph.js";
import {
  ACCOUNT_FIELDS, CREATIVE_FIELDS, VIDEO_INSIGHTS_FIELDS, QUALITY_INSIGHTS_FIELDS,
  PAGE_FIELDS, PAGE_POST_FIELDS, AUDIENCE_FIELDS, MESSAGING_ACTION_TYPES, DATE_PRESETS,
} from "./fields.js";
import { assertAccountId, assertNodeId, insightsParams } from "./tools.js";

const ACCOUNT_ID = { type: "string", description: "Ad account id, e.g. act_123456789." };
const PRESET = { type: "string", enum: DATE_PRESETS, description: "Default: maximum." };

/** Pulls the messaging action tallies out of an insights row into a flat object. */
function messagingActions(row) {
  const out = {};
  for (const a of row.actions ?? []) {
    if (MESSAGING_ACTION_TYPES.includes(a.action_type)) {
      out[a.action_type.replace("onsite_conversion.", "")] = Number(a.value);
    }
  }
  return out;
}

/** Shared date handling: explicit since/until wins over a preset. */
function windowParams(a) {
  if (a.since || a.until) {
    if (!a.since || !a.until) throw new GraphError("since and until must be supplied together.");
    return { time_range: JSON.stringify({ since: a.since, until: a.until }) };
  }
  const preset = a.date_preset ?? "maximum";
  if (!DATE_PRESETS.includes(preset)) throw new GraphError(`Unknown date_preset "${preset}".`);
  return { date_preset: preset };
}

/**
 * @param {import("./graph.js").GraphClient} graph
 */
export function analyticsTools(graph) {
  return [
    {
      name: "get_creative_breakdown",
      description:
        "Ad-level performance joined with each ad's creative (headline, body, CTA, image/video). " +
        "Answers 'which exact ad/creative drove the results', ranked by spend.",
      inputSchema: {
        type: "object",
        properties: { ad_account_id: ACCOUNT_ID, date_preset: PRESET,
          since: { type: "string" }, until: { type: "string" } },
        required: ["ad_account_id"],
      },
      handler: async (a) => {
        const id = assertAccountId(a.ad_account_id);
        const [ins, ads] = await Promise.all([
          graph.paginate(`${id}/insights`, insightsParams({ level: "ad", ...a })),
          graph.paginate(`${id}/ads`, { fields: `id,name,creative{${CREATIVE_FIELDS}}` }),
        ]);
        const creativeByAd = new Map(ads.data.map((ad) => [ad.id, ad.creative]));
        const rows = ins.data
          .map((r) => ({
            ad_id: r.ad_id, ad_name: r.ad_name, campaign_name: r.campaign_name,
            spend: Number(r.spend ?? 0), impressions: Number(r.impressions ?? 0),
            clicks: Number(r.clicks ?? 0), ctr: Number(r.ctr ?? 0),
            messaging: messagingActions(r),
            creative: creativeByAd.get(r.ad_id) ?? null,
          }))
          .sort((x, y) => y.spend - x.spend);
        return { count: rows.length, ads: rows };
      },
    },
    {
      name: "get_daypart",
      description:
        "Conversations, clicks and spend broken down by hour of day (viewer timezone). " +
        "Shows when leads actually come in, so budget can be timed.",
      inputSchema: {
        type: "object",
        properties: { target_id: { type: "string", description: "Account, campaign, ad set or ad id." },
          date_preset: PRESET, since: { type: "string" }, until: { type: "string" } },
        required: ["target_id"],
      },
      handler: async (a) => {
        const target = a.target_id.startsWith("act_") ? assertAccountId(a.target_id)
          : assertNodeId(a.target_id, "target_id");
        const res = await graph.paginate(`${target}/insights`, insightsParams({
          level: "account", breakdowns: "hourly_stats_aggregated_by_audience_time_zone", ...a,
        }));
        return {
          by_hour: res.data.map((r) => ({
            hour: r.hourly_stats_aggregated_by_audience_time_zone,
            spend: Number(r.spend ?? 0), impressions: Number(r.impressions ?? 0),
            clicks: Number(r.clicks ?? 0), messaging: messagingActions(r),
          })),
        };
      },
    },
    {
      name: "get_video_metrics",
      description:
        "Video retention per ad: plays, thruplays, 25/50/75/95/100% completion and average watch time. " +
        "Tells you which creative actually holds attention.",
      inputSchema: {
        type: "object",
        properties: { ad_account_id: ACCOUNT_ID, date_preset: PRESET,
          since: { type: "string" }, until: { type: "string" } },
        required: ["ad_account_id"],
      },
      handler: async (a) => {
        const id = assertAccountId(a.ad_account_id);
        const res = await graph.paginate(`${id}/insights`,
          insightsParams({ level: "ad", fields: VIDEO_INSIGHTS_FIELDS, ...a }));
        const pick = (arr) => Number(arr?.[0]?.value ?? 0);
        return {
          ads: res.data.map((r) => ({
            ad_name: r.ad_name, campaign_name: r.campaign_name, spend: Number(r.spend ?? 0),
            plays: pick(r.video_play_actions), thruplays: pick(r.video_thruplay_watched_actions),
            p25: pick(r.video_p25_watched_actions), p50: pick(r.video_p50_watched_actions),
            p75: pick(r.video_p75_watched_actions), p95: pick(r.video_p95_watched_actions),
            p100: pick(r.video_p100_watched_actions),
            avg_seconds: pick(r.video_avg_time_watched_actions),
          })).filter((r) => r.plays > 0),
        };
      },
    },
    {
      name: "get_quality_rankings",
      description:
        "Meta's quality, engagement-rate and conversion-rate rankings per ad (how each ranks vs " +
        "competitors). Only populated after ~500 impressions.",
      inputSchema: {
        type: "object",
        properties: { ad_account_id: ACCOUNT_ID, date_preset: PRESET },
        required: ["ad_account_id"],
      },
      handler: async (a) => {
        const id = assertAccountId(a.ad_account_id);
        const res = await graph.paginate(`${id}/insights`,
          insightsParams({ level: "ad", fields: QUALITY_INSIGHTS_FIELDS, ...a }));
        return {
          ads: res.data.map((r) => ({
            ad_name: r.ad_name, campaign_name: r.campaign_name,
            impressions: Number(r.impressions ?? 0), spend: Number(r.spend ?? 0),
            quality: r.quality_ranking, engagement: r.engagement_rate_ranking,
            conversion: r.conversion_rate_ranking,
          })),
        };
      },
    },
    {
      name: "get_messaging_funnel",
      description:
        "WhatsApp / Messenger funnel: conversations started, first replies, and depth-2/3/5 message " +
        "sends, with optional demographic or placement breakdown. Quantifies lead quality from the ad side. " +
        "Note: message content and contact identity are NOT available here — that needs the WhatsApp " +
        "number connected to the Business inbox / Cloud API.",
      inputSchema: {
        type: "object",
        properties: {
          target_id: { type: "string", description: "Account, campaign, ad set or ad id." },
          breakdowns: { type: "string", description: 'Optional, e.g. "age,gender" or "publisher_platform,platform_position".' },
          date_preset: PRESET, since: { type: "string" }, until: { type: "string" },
        },
        required: ["target_id"],
      },
      handler: async (a) => {
        const target = a.target_id.startsWith("act_") ? assertAccountId(a.target_id)
          : assertNodeId(a.target_id, "target_id");
        const res = await graph.paginate(`${target}/insights`, insightsParams({
          level: "account", ...(a.breakdowns ? { breakdowns: a.breakdowns } : {}), ...a,
        }));
        const seg = res.data
          .map((r) => {
            const m = messagingActions(r);
            const started = m.messaging_conversation_started_7d ?? 0;
            return {
              ...(a.breakdowns ? Object.fromEntries(a.breakdowns.split(",").map((k) => [k, r[k]])) : {}),
              spend: Number(r.spend ?? 0), conversations_started: started,
              first_replies: m.messaging_first_reply ?? 0,
              depth_2: m.messaging_user_depth_2_message_send ?? 0,
              depth_3: m.messaging_user_depth_3_message_send ?? 0,
              depth_5: m.messaging_user_depth_5_message_send ?? 0,
              cost_per_conversation: started ? Number((Number(r.spend ?? 0) / started).toFixed(2)) : null,
            };
          })
          .filter((r) => r.conversations_started > 0 || !a.breakdowns);
        return {
          note: "Counts are conversation threads, not unique people or messages. Identity/content require an inbox connection.",
          segments: seg,
        };
      },
    },
    {
      name: "get_page",
      description: "Facebook Page metadata: followers, new likes, rating, category, contact, linked Instagram.",
      inputSchema: {
        type: "object",
        properties: { page_id: { type: "string" }, fields: { type: "string" } },
        required: ["page_id"],
      },
      handler: async (a) =>
        graph.request(assertNodeId(a.page_id, "page_id"), { fields: a.fields ?? PAGE_FIELDS }),
    },
    {
      name: "get_page_insights",
      description:
        "Organic Page insights over time (impressions, engaged users, follower growth, views, CTA clicks). " +
        "Needs pages_read_engagement / read_insights.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          metrics: { type: "string", description: "Comma-separated metric names. Sensible default provided." },
          period: { type: "string", enum: ["day", "week", "days_28"], description: "Default: day." },
          date_preset: PRESET, since: { type: "string" }, until: { type: "string" },
        },
        required: ["page_id"],
      },
      handler: async (a) => {
        const metrics = a.metrics ??
          "page_impressions,page_impressions_unique,page_post_engagements,page_fans," +
          "page_fan_adds,page_views_total,page_total_actions";
        return graph.request(`${assertNodeId(a.page_id, "page_id")}/insights`, {
          metric: metrics, period: a.period ?? "day", ...windowParams(a),
        });
      },
    },
    {
      name: "list_page_posts",
      description:
        "Organic Page posts with reach, engagement, clicks and reaction/comment/share counts. " +
        "Surfaces the best organic content to inform paid creative.",
      inputSchema: {
        type: "object",
        properties: { page_id: { type: "string" }, limit: { type: "number", description: "Default 25." } },
        required: ["page_id"],
      },
      handler: async (a) =>
        graph.paginate(`${assertNodeId(a.page_id, "page_id")}/published_posts`, {
          fields: PAGE_POST_FIELDS, limit: a.limit ?? 25,
        }),
    },
    {
      name: "list_audiences",
      description:
        "Custom, lookalike and saved audiences for an account: size, fill status, retention. " +
        "Shows retargeting pools as they fill.",
      inputSchema: {
        type: "object",
        properties: { ad_account_id: ACCOUNT_ID },
        required: ["ad_account_id"],
      },
      handler: async (a) =>
        graph.paginate(`${assertAccountId(a.ad_account_id)}/customaudiences`, { fields: AUDIENCE_FIELDS }),
    },
    {
      name: "estimate_audience",
      description: "Reach/size estimate for a targeting spec (delivery_estimate), for sizing new ad sets.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          targeting: { type: "object", description: "Full Graph targeting spec." },
          optimization_goal: { type: "string", description: "Default: REACH." },
        },
        required: ["ad_account_id", "targeting"],
      },
      handler: async (a) =>
        graph.request(`${assertAccountId(a.ad_account_id)}/delivery_estimate`, {
          targeting_spec: JSON.stringify(a.targeting),
          optimization_goal: a.optimization_goal ?? "REACH",
        }),
    },
    {
      name: "compare_accounts",
      description:
        "Side-by-side lifetime (or windowed) totals for two or more ad accounts: spend, impressions, " +
        "clicks, CTR, and messaging conversations. For BD vs US account comparison.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_ids: { type: "array", items: { type: "string" }, description: "e.g. [\"act_1\",\"act_2\"]." },
          date_preset: PRESET, since: { type: "string" }, until: { type: "string" },
        },
        required: ["ad_account_ids"],
      },
      handler: async (a) => {
        const results = await Promise.allSettled(
          a.ad_account_ids.map(async (raw) => {
            const id = assertAccountId(raw);
            const [meta, ins] = await Promise.all([
              graph.request(id, { fields: "name,currency,amount_spent,business" }),
              graph.paginate(`${id}/insights`, insightsParams({ level: "account", ...a })),
            ]);
            const r = ins.data[0] ?? {};
            return {
              account: id, name: meta.name, business: meta.business?.name ?? null,
              currency: meta.currency, lifetime_spent: Number(meta.amount_spent ?? 0) / 100,
              window_spend: Number(r.spend ?? 0), impressions: Number(r.impressions ?? 0),
              clicks: Number(r.clicks ?? 0), ctr: Number(r.ctr ?? 0),
              messaging: messagingActions(r),
            };
          }),
        );
        return { accounts: results.map((x) => x.status === "fulfilled" ? x.value : { error: String(x.reason?.message ?? x.reason) }) };
      },
    },
    {
      name: "get_business_assets",
      description:
        "Business portfolios the token can see, plus owned/client ad accounts and pages, for mapping " +
        "who owns what. Degrades gracefully where the token lacks user-listing permission.",
      inputSchema: {
        type: "object",
        properties: { business_id: { type: "string", description: "Optional. Omit to list businesses the token can reach." } },
        required: [],
      },
      handler: async (a) => {
        if (!a.business_id) {
          const [businesses, adaccounts] = await Promise.allSettled([
            graph.paginate("me/businesses", { fields: "id,name,created_time" }),
            graph.paginate("me/adaccounts", { fields: "account_id,name,business{id,name},currency,amount_spent" }),
          ]);
          const u = (r) => (r.status === "fulfilled" ? r.value : { error: String(r.reason?.message ?? r.reason) });
          return { businesses: u(businesses), reachable_ad_accounts: u(adaccounts) };
        }
        const bid = assertNodeId(a.business_id, "business_id");
        const [biz, owned, client, pages, users] = await Promise.allSettled([
          graph.request(bid, { fields: "id,name,primary_page,created_time" }),
          graph.paginate(`${bid}/owned_ad_accounts`, { fields: "account_id,name,currency" }),
          graph.paginate(`${bid}/client_ad_accounts`, { fields: "account_id,name,currency" }),
          graph.paginate(`${bid}/owned_pages`, { fields: "id,name" }),
          graph.paginate(`${bid}/business_users`, { fields: "name,role,email" }),
        ]);
        const u = (r) => (r.status === "fulfilled" ? r.value : { error: String(r.reason?.message ?? r.reason) });
        return {
          business: u(biz), owned_ad_accounts: u(owned), client_ad_accounts: u(client),
          owned_pages: u(pages), users: u(users),
        };
      },
    },
    {
      name: "full_analytics_snapshot",
      description:
        "One-shot deep pull for an account: account meta, ad-level insights, creative breakdown, " +
        "day-parting, video retention, quality rankings, messaging funnel (overall + by age/gender + " +
        "by placement), and demographic/placement/device breakdowns. The everything view.",
      inputSchema: {
        type: "object",
        properties: { ad_account_id: ACCOUNT_ID, date_preset: PRESET },
        required: ["ad_account_id"],
      },
      handler: async (a) => {
        const id = assertAccountId(a.ad_account_id);
        const preset = a.date_preset ?? "maximum";
        const ins = (extra) => graph.paginate(`${id}/insights`, insightsParams({ date_preset: preset, ...extra }));
        const [
          account, adLevel, video, quality, daypart, msgAll, msgAge, msgPlace, ageGender, placement, device,
        ] = await Promise.allSettled([
          graph.request(id, { fields: ACCOUNT_FIELDS }),
          ins({ level: "ad" }),
          ins({ level: "ad", fields: VIDEO_INSIGHTS_FIELDS }),
          ins({ level: "ad", fields: QUALITY_INSIGHTS_FIELDS }),
          ins({ level: "account", breakdowns: "hourly_stats_aggregated_by_audience_time_zone" }),
          ins({ level: "account" }),
          ins({ level: "account", breakdowns: "age,gender" }),
          ins({ level: "account", breakdowns: "publisher_platform,platform_position" }),
          ins({ level: "account", breakdowns: "age,gender" }),
          ins({ level: "account", breakdowns: "publisher_platform,platform_position" }),
          ins({ level: "account", breakdowns: "device_platform" }),
        ]);
        const u = (r) => (r.status === "fulfilled" ? r.value : { error: String(r.reason?.message ?? r.reason) });
        const msg = (r) => (r.status === "fulfilled" ? r.value.data.map((row) => ({
          ...Object.fromEntries(Object.entries(row).filter(([k]) => ["age", "gender", "publisher_platform", "platform_position"].includes(k))),
          spend: Number(row.spend ?? 0), messaging: messagingActions(row),
        })) : { error: String(r.reason?.message ?? r.reason) });
        return {
          pulled_at_date_preset: preset,
          account: u(account),
          insights_ad_level: u(adLevel),
          video_retention: u(video),
          quality_rankings: u(quality),
          day_parting: u(daypart),
          messaging_funnel: { overall: msg(msgAll), by_age_gender: msg(msgAge), by_placement: msg(msgPlace) },
          breakdowns: { age_gender: u(ageGender), placement: u(placement), device: u(device) },
        };
      },
    },
  ];
}
