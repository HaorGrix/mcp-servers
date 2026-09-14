/** Marketing API: ad accounts, campaigns, ad sets, ads, creatives, insights, automated rules, audiences, pixels, Conversions API, offline conversions, attribution. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Register } from "../context.js";
import { guarded } from "../respond.js";
import { assertConfirmed, assertWrites, resolveId } from "../guard.js";

const STATUS = z.enum(["ACTIVE", "PAUSED", "ARCHIVED", "DELETED"]);
const LEVEL = z.enum(["account", "campaign", "adset", "ad"]);
const OBJECTIVE = z.enum(["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_APP_PROMOTION", "OUTCOME_SALES"]);
const INSIGHT_FIELDS = "campaign_name,adset_name,ad_name,impressions,reach,frequency,spend,clicks,cpc,cpm,ctr,actions,cost_per_action_type,conversions,purchase_roas,objective,date_start,date_stop";
const sha256 = (v: string) => createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

export const registerAds: Register = ({ server, client, config }) => {
  const act = (id?: string) => {
    const v = resolveId(id, config.defaults.adAccountId, "adAccountId", "META_AD_ACCOUNT_ID");
    return v.startsWith("act_") ? v : `act_${v}`;
  };
  const requireAds = () => client.requireScopes("ads_management");

  // ── Accounts ──────────────────────────────────────────────────────────────
  server.tool("meta_ad_accounts", "Ad accounts the token can reach with status, currency, spend, balance and funding source.", {}, guarded(async () =>
    client.getAll("me/adaccounts", { fields: "id,account_id,name,account_status,disable_reason,currency,timezone_name,amount_spent,balance,spend_cap,funding_source_details,business{id,name},min_daily_budget" }),
  ));

  server.tool("meta_ad_account_get", "Ad account detail incl. capabilities, tos status, attribution and owner business.", { adAccountId: z.string().optional() }, guarded(async ({ adAccountId }) =>
    client.get(act(adAccountId), { fields: "id,name,account_status,disable_reason,currency,timezone_name,amount_spent,balance,spend_cap,funding_source_details,business,capabilities,tos_accepted,is_prepay_account,min_campaign_group_spend_cap,default_dsa_beneficiary,default_dsa_payor,attribution_spec" }),
  ));

  server.tool("meta_ad_account_create", "Create a new ad account inside the portfolio.", { businessId: z.string().optional(), name: z.string(), currency: z.string().default("USD"), timezoneId: z.number().default(1), endAdvertiser: z.string().optional().describe("Page or business id the ads are for"), mediaAgency: z.string().optional(), partner: z.string().optional() }, guarded(async ({ businessId, name, currency, timezoneId, endAdvertiser, mediaAgency, partner }) => {
    assertWrites(config, "Create ad account");
    const b = resolveId(businessId, config.defaults.businessId, "businessId", "META_BUSINESS_ID");
    return client.post(`${b}/adaccount`, { name, currency, timezone_id: timezoneId, end_advertiser: endAdvertiser ?? b, media_agency: mediaAgency ?? "NONE", partner: partner ?? "NONE" });
  }));

  server.tool("meta_ad_account_activity", "Change history for the ad account (who changed what, budgets, statuses).", { adAccountId: z.string().optional(), since: z.string().optional(), limit: z.number().optional() }, guarded(async ({ adAccountId, since, limit }) =>
    client.getAll(`${act(adAccountId)}/activities`, { fields: "event_time,event_type,actor_name,object_name,object_type,extra_data", since, limit: limit ?? 50 }, {}, 1),
  ));

  // ── Structure ─────────────────────────────────────────────────────────────
  server.tool("meta_campaigns", "Campaigns with objective, status, budget, bid strategy, spend.", { adAccountId: z.string().optional(), effectiveStatus: z.array(STATUS).optional(), limit: z.number().optional() }, guarded(async ({ adAccountId, effectiveStatus, limit }) =>
    client.getAll(`${act(adAccountId)}/campaigns`, { fields: "id,name,objective,status,effective_status,daily_budget,lifetime_budget,budget_remaining,bid_strategy,buying_type,start_time,stop_time,created_time,special_ad_categories,is_adset_budget_sharing_enabled,smart_promotion_type", effective_status: effectiveStatus ? JSON.stringify(effectiveStatus) : undefined, limit: limit ?? 100 }),
  ));

  server.tool("meta_adsets", "Ad sets with targeting, optimization goal, budget, schedule, delivery.", { adAccountId: z.string().optional(), campaignId: z.string().optional(), effectiveStatus: z.array(STATUS).optional(), limit: z.number().optional() }, guarded(async ({ adAccountId, campaignId, effectiveStatus, limit }) =>
    client.getAll(`${campaignId ?? act(adAccountId)}/adsets`, { fields: "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,budget_remaining,bid_amount,bid_strategy,billing_event,optimization_goal,promoted_object,targeting,start_time,end_time,attribution_spec,learning_stage_info,destination_type,is_dynamic_creative", effective_status: effectiveStatus ? JSON.stringify(effectiveStatus) : undefined, limit: limit ?? 100 }),
  ));

  server.tool("meta_ads", "Ads with creative summary, status, review feedback, tracking.", { adAccountId: z.string().optional(), adsetId: z.string().optional(), campaignId: z.string().optional(), effectiveStatus: z.array(z.string()).optional(), limit: z.number().optional() }, guarded(async ({ adAccountId, adsetId, campaignId, effectiveStatus, limit }) =>
    client.getAll(`${adsetId ?? campaignId ?? act(adAccountId)}/ads`, { fields: "id,name,adset_id,campaign_id,status,effective_status,ad_review_feedback,creative{id,name,thumbnail_url,object_story_spec,effective_object_story_id},tracking_specs,preview_shareable_link,created_time,updated_time", effective_status: effectiveStatus ? JSON.stringify(effectiveStatus) : undefined, limit: limit ?? 100 }),
  ));

  server.tool("meta_creatives", "Ad creatives in the account (or one by id).", { adAccountId: z.string().optional(), creativeId: z.string().optional(), limit: z.number().optional() }, guarded(async ({ adAccountId, creativeId, limit }) => {
    const fields = "id,name,status,title,body,call_to_action_type,object_story_spec,asset_feed_spec,image_url,image_hash,video_id,thumbnail_url,link_url,url_tags,instagram_permalink_url,effective_object_story_id,degrees_of_freedom_spec";
    return creativeId ? client.get(creativeId, { fields }) : client.getAll(`${act(adAccountId)}/adcreatives`, { fields, limit: limit ?? 50 }, {}, 1);
  }));

  server.tool(
    "meta_campaign_create",
    "Create a campaign (created PAUSED unless status given). Use campaign budget (CBO) via dailyBudget/lifetimeBudget in minor units, or leave empty for ad-set budgets. Advantage+ shopping: set smartPromotionType=AUTOMATED_SHOPPING_ADS with OUTCOME_SALES.",
    { adAccountId: z.string().optional(), name: z.string(), objective: OBJECTIVE, status: z.enum(["ACTIVE", "PAUSED"]).optional(), dailyBudget: z.number().optional(), lifetimeBudget: z.number().optional(), bidStrategy: z.enum(["LOWEST_COST_WITHOUT_CAP", "LOWEST_COST_WITH_BID_CAP", "COST_CAP", "LOWEST_COST_WITH_MIN_ROAS"]).optional(), specialAdCategories: z.array(z.enum(["NONE", "HOUSING", "EMPLOYMENT", "CREDIT", "ISSUES_ELECTIONS_POLITICS", "FINANCIAL_PRODUCTS_SERVICES"])).optional(), smartPromotionType: z.enum(["GUIDED_CREATION", "SMART_APP_PROMOTION", "AUTOMATED_SHOPPING_ADS"]).optional(), startTime: z.string().optional(), stopTime: z.string().optional(), confirm: z.boolean().optional() },
    guarded(async (a) => {
      if (a.status === "ACTIVE") assertConfirmed(config, a.confirm, "Create ACTIVE campaign"); else assertWrites(config, "Create campaign");
      await requireAds();
      return client.post(`${act(a.adAccountId)}/campaigns`, { name: a.name, objective: a.objective, status: a.status ?? "PAUSED", daily_budget: a.dailyBudget, lifetime_budget: a.lifetimeBudget, bid_strategy: a.bidStrategy, special_ad_categories: a.specialAdCategories ?? ["NONE"], smart_promotion_type: a.smartPromotionType, start_time: a.startTime, stop_time: a.stopTime });
    }),
  );

  server.tool(
    "meta_adset_create",
    "Create an ad set. targeting is the Marketing API targeting spec (geo_locations, age_min/max, interests, custom_audiences, advantage_audience...). promotedObject e.g. {page_id} for engagement/leads, {pixel_id,custom_event_type:'PURCHASE'} for sales. Budget in minor units.",
    { adAccountId: z.string().optional(), campaignId: z.string(), name: z.string(), optimizationGoal: z.string(), billingEvent: z.enum(["IMPRESSIONS", "LINK_CLICKS", "THRUPLAY", "POST_ENGAGEMENT", "PAGE_LIKES"]).default("IMPRESSIONS"), dailyBudget: z.number().optional(), lifetimeBudget: z.number().optional(), bidAmount: z.number().optional(), bidStrategy: z.string().optional(), targeting: z.record(z.unknown()), promotedObject: z.record(z.unknown()).optional(), startTime: z.string().optional(), endTime: z.string().optional(), status: z.enum(["ACTIVE", "PAUSED"]).optional(), destinationType: z.string().optional(), attributionSpec: z.array(z.record(z.unknown())).optional(), isDynamicCreative: z.boolean().optional(), confirm: z.boolean().optional() },
    guarded(async (a) => {
      if (a.status === "ACTIVE") assertConfirmed(config, a.confirm, "Create ACTIVE ad set"); else assertWrites(config, "Create ad set");
      await requireAds();
      return client.post(`${act(a.adAccountId)}/adsets`, { campaign_id: a.campaignId, name: a.name, optimization_goal: a.optimizationGoal, billing_event: a.billingEvent, daily_budget: a.dailyBudget, lifetime_budget: a.lifetimeBudget, bid_amount: a.bidAmount, bid_strategy: a.bidStrategy, targeting: a.targeting, promoted_object: a.promotedObject, start_time: a.startTime, end_time: a.endTime, status: a.status ?? "PAUSED", destination_type: a.destinationType, attribution_spec: a.attributionSpec, is_dynamic_creative: a.isDynamicCreative });
    }),
  );

  server.tool(
    "meta_creative_create",
    "Create an ad creative. Either objectStorySpec (full spec: {page_id, link_data:{link,message,name,call_to_action:{type,value:{link}},image_hash|picture}} or video_data, or instagram_user_id) or promote an existing post via objectStoryId ('pageid_postid'). assetFeedSpec for dynamic/Advantage+ creative.",
    { adAccountId: z.string().optional(), name: z.string(), objectStorySpec: z.record(z.unknown()).optional(), objectStoryId: z.string().optional(), assetFeedSpec: z.record(z.unknown()).optional(), urlTags: z.string().optional(), degreesOfFreedomSpec: z.record(z.unknown()).optional().describe("Advantage+ creative enhancements") },
    guarded(async ({ adAccountId, name, objectStorySpec, objectStoryId, assetFeedSpec, urlTags, degreesOfFreedomSpec }) => {
      assertWrites(config, "Create creative");
      await requireAds();
      return client.post(`${act(adAccountId)}/adcreatives`, { name, object_story_spec: objectStorySpec, object_story_id: objectStoryId, asset_feed_spec: assetFeedSpec, url_tags: urlTags, degrees_of_freedom_spec: degreesOfFreedomSpec });
    }),
  );

  server.tool("meta_ad_image_upload", "Upload an image by URL to the ad account image library; returns image_hash for creatives.", { adAccountId: z.string().optional(), url: z.string(), name: z.string().optional() }, guarded(async ({ adAccountId, url, name }) => {
    assertWrites(config, "Upload ad image");
    return client.post(`${act(adAccountId)}/adimages`, { url, name });
  }));

  server.tool("meta_ad_video_upload", "Upload a video by URL to the ad account; returns video id (poll meta_graph_get <id>?fields=status until ready).", { adAccountId: z.string().optional(), fileUrl: z.string(), title: z.string().optional() }, guarded(async ({ adAccountId, fileUrl, title }) => {
    assertWrites(config, "Upload ad video");
    return client.post(`${act(adAccountId)}/advideos`, { file_url: fileUrl, title }, { host: `https://graph-video.facebook.com/${config.version}` });
  }));

  server.tool("meta_ad_create", "Create an ad from a creative in an ad set.", { adAccountId: z.string().optional(), adsetId: z.string(), name: z.string(), creativeId: z.string(), status: z.enum(["ACTIVE", "PAUSED"]).optional(), trackingSpecs: z.array(z.record(z.unknown())).optional(), confirm: z.boolean().optional() }, guarded(async ({ adAccountId, adsetId, name, creativeId, status, trackingSpecs, confirm }) => {
    if (status === "ACTIVE") assertConfirmed(config, confirm, "Create ACTIVE ad"); else assertWrites(config, "Create ad");
    await requireAds();
    return client.post(`${act(adAccountId)}/ads`, { adset_id: adsetId, name, creative: { creative_id: creativeId }, status: status ?? "PAUSED", tracking_specs: trackingSpecs });
  }));

  server.tool(
    "meta_ad_object_update",
    "Update a campaign / ad set / ad: name, status, budgets (minor units), bid, schedule, targeting. Activating or raising a budget requires confirm=true.",
    { objectId: z.string(), name: z.string().optional(), status: STATUS.optional(), dailyBudget: z.number().optional(), lifetimeBudget: z.number().optional(), bidAmount: z.number().optional(), startTime: z.string().optional(), endTime: z.string().optional(), targeting: z.record(z.unknown()).optional(), fields: z.record(z.unknown()).optional().describe("Any other raw fields"), confirm: z.boolean().optional() },
    guarded(async ({ objectId, name, status, dailyBudget, lifetimeBudget, bidAmount, startTime, endTime, targeting, fields, confirm }) => {
      const risky = status === "ACTIVE" || dailyBudget !== undefined || lifetimeBudget !== undefined;
      if (risky) assertConfirmed(config, confirm, "Activate / change budget"); else assertWrites(config, "Update ad object");
      await requireAds();
      return client.post(objectId, { name, status, daily_budget: dailyBudget, lifetime_budget: lifetimeBudget, bid_amount: bidAmount, start_time: startTime, end_time: endTime, targeting, ...(fields ?? {}) });
    }),
  );

  server.tool("meta_ad_object_delete", "Delete a campaign, ad set, ad or creative. Requires confirm=true.", { objectId: z.string(), confirm: z.boolean().optional() }, guarded(async ({ objectId, confirm }) => {
    assertConfirmed(config, confirm, "Delete ad object");
    return client.delete(objectId);
  }));

  server.tool("meta_ad_copy", "Duplicate a campaign / ad set / ad (deep copy optional), created PAUSED.", { objectId: z.string(), kind: z.enum(["campaign", "adset", "ad"]), deepCopy: z.boolean().optional(), renameSuffix: z.string().optional(), targetCampaignId: z.string().optional(), targetAdsetId: z.string().optional() }, guarded(async ({ objectId, kind, deepCopy, renameSuffix, targetCampaignId, targetAdsetId }) => {
    assertWrites(config, "Copy ad object");
    const rename = renameSuffix ? { rename_options: { rename_strategy: "ONLY_TOP_LEVEL_RENAME", rename_suffix: renameSuffix } } : {};
    const body: Record<string, unknown> = { status_option: "PAUSED", deep_copy: deepCopy ?? kind !== "ad", ...rename };
    if (kind === "adset" && targetCampaignId) body["campaign_id"] = targetCampaignId;
    if (kind === "ad" && targetAdsetId) body["adset_id"] = targetAdsetId;
    return client.post(`${objectId}/copies`, body);
  }));

  server.tool("meta_ad_preview", "Render an ad (or creative spec) preview for a placement format; returns iframe HTML.", { adId: z.string().optional(), adAccountId: z.string().optional(), creativeSpec: z.record(z.unknown()).optional(), format: z.string().default("MOBILE_FEED_STANDARD") }, guarded(async ({ adId, adAccountId, creativeSpec, format }) =>
    adId ? client.get(`${adId}/previews`, { ad_format: format }) : client.get(`${act(adAccountId)}/generatepreviews`, { creative: JSON.stringify(creativeSpec), ad_format: format }),
  ));

  server.tool("meta_ad_labels", "List or create ad labels for tagging campaigns/ad sets/ads.", { adAccountId: z.string().optional(), createName: z.string().optional() }, guarded(async ({ adAccountId, createName }) => {
    if (!createName) return client.getAll(`${act(adAccountId)}/adlabels`, { fields: "id,name" });
    assertWrites(config, "Create label");
    return client.post(`${act(adAccountId)}/adlabels`, { name: createName });
  }));

  // ── Insights & reporting ──────────────────────────────────────────────────
  server.tool(
    "meta_insights",
    "Performance report at any level. datePreset (today, yesterday, last_7d, last_14d, last_30d, this_month, last_month, maximum) or timeRange {since,until}. breakdowns e.g. age, gender, country, publisher_platform, platform_position, device_platform. timeIncrement 1 for daily rows. Returns rows with actions/cost_per_action arrays.",
    { objectId: z.string().optional().describe("act_/campaign/adset/ad id; defaults to the ad account"), level: LEVEL.optional(), fields: z.array(z.string()).optional(), datePreset: z.string().optional(), timeRange: z.object({ since: z.string(), until: z.string() }).optional(), breakdowns: z.array(z.string()).optional(), actionBreakdowns: z.array(z.string()).optional(), timeIncrement: z.union([z.number(), z.literal("monthly"), z.literal("all_days")]).optional(), filtering: z.array(z.record(z.unknown())).optional(), sort: z.string().optional(), limit: z.number().optional() },
    guarded(async (a) => {
      await client.requireScopes("ads_read");
      const id = a.objectId ?? act();
      return client.getAll(`${id}/insights`, { level: a.level ?? "campaign", fields: (a.fields ?? INSIGHT_FIELDS.split(",")).join(","), date_preset: a.timeRange ? undefined : (a.datePreset ?? "last_30d"), time_range: a.timeRange ? JSON.stringify(a.timeRange) : undefined, breakdowns: a.breakdowns?.join(","), action_breakdowns: a.actionBreakdowns?.join(","), time_increment: a.timeIncrement, filtering: a.filtering ? JSON.stringify(a.filtering) : undefined, sort: a.sort, limit: a.limit ?? 500 }, {}, 10);
    }),
  );

  server.tool("meta_insights_async", "Start an async insights report for large ranges; returns report_run_id. Poll with meta_insights_async_result.", { objectId: z.string().optional(), level: LEVEL.optional(), fields: z.array(z.string()).optional(), timeRange: z.object({ since: z.string(), until: z.string() }), breakdowns: z.array(z.string()).optional(), timeIncrement: z.number().optional() }, guarded(async (a) =>
    client.post(`${a.objectId ?? act()}/insights`, { level: a.level ?? "ad", fields: (a.fields ?? INSIGHT_FIELDS.split(",")).join(","), time_range: a.timeRange, breakdowns: a.breakdowns?.join(","), time_increment: a.timeIncrement }),
  ));

  server.tool("meta_insights_async_result", "Status and rows of an async report run.", { reportRunId: z.string() }, guarded(async ({ reportRunId }) => {
    const status = await client.get<{ async_status: string; async_percent_completion: number }>(reportRunId, { fields: "async_status,async_percent_completion" });
    if (status.async_status !== "Job Completed") return status;
    return { ...status, rows: await client.getAll(`${reportRunId}/insights`, {}, {}, 50) };
  }));

  server.tool("meta_account_snapshot", "Agency morning check: spend/results by campaign for a preset with pacing vs budget and delivery status.", { adAccountId: z.string().optional(), datePreset: z.string().optional() }, guarded(async ({ adAccountId, datePreset }) => {
    const id = act(adAccountId);
    const [account, campaigns, rows] = await Promise.all([
      client.get(id, { fields: "name,currency,amount_spent,balance,spend_cap,account_status" }),
      client.getAll<{ id: string; name: string; effective_status: string; daily_budget?: string; lifetime_budget?: string; budget_remaining?: string }>(`${id}/campaigns`, { fields: "id,name,effective_status,daily_budget,lifetime_budget,budget_remaining", effective_status: JSON.stringify(["ACTIVE", "PAUSED"]) }),
      client.getAll<Record<string, unknown>>(`${id}/insights`, { level: "campaign", fields: "campaign_id,campaign_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions,cost_per_action_type,purchase_roas", date_preset: datePreset ?? "last_7d" }),
    ]);
    const byId = new Map(rows.map((r) => [r["campaign_id"] as string, r]));
    return { account, campaigns: campaigns.map((c) => ({ ...c, performance: byId.get(c.id) ?? null })) };
  }));

  server.tool("meta_delivery_estimate", "Estimated audience size and reach for a targeting spec + optimization goal, before spending.", { adAccountId: z.string().optional(), targeting: z.record(z.unknown()), optimizationGoal: z.string().default("REACH") }, guarded(async ({ adAccountId, targeting, optimizationGoal }) =>
    client.get(`${act(adAccountId)}/delivery_estimate`, { targeting_spec: JSON.stringify(targeting), optimization_goal: optimizationGoal }),
  ));

  server.tool("meta_targeting_search", "Search interests, behaviors, demographics, locations, or get suggestions for targeting specs.", { adAccountId: z.string().optional(), query: z.string(), type: z.enum(["adinterest", "adinterestsuggestion", "adgeolocation", "adworkemployer", "adeducationschool", "adlocale", "adTargetingCategory"]).default("adinterest"), locationTypes: z.array(z.string()).optional(), limit: z.number().optional() }, guarded(async ({ adAccountId, query, type, locationTypes, limit }) =>
    type === "adTargetingCategory"
      ? client.get(`${act(adAccountId)}/targetingbrowse`, { limit_type: query })
      : client.get(`${act(adAccountId)}/targetingsearch`, { q: query, type, location_types: locationTypes ? JSON.stringify(locationTypes) : undefined, limit: limit ?? 25 }),
  ));

  // ── Automated rules ───────────────────────────────────────────────────────
  server.tool("meta_rules", "Automated rules on the account with evaluation spec, execution spec and schedule.", { adAccountId: z.string().optional() }, guarded(async ({ adAccountId }) =>
    client.getAll(`${act(adAccountId)}/adrules_library`, { fields: "id,name,status,entity_type,evaluation_spec,execution_spec,schedule_spec,created_by,created_time,updated_time" }),
  ));

  server.tool(
    "meta_rule_create",
    "Create an automated rule. Example: pause ad sets with CPA over 20 USD after 50 clicks: evaluationSpec {evaluation_type:'SCHEDULE',filters:[{field:'entity_type',operator:'EQUAL',value:'ADSET'},{field:'time_preset',operator:'EQUAL',value:'LAST_7D'},{field:'cost_per',operator:'GREATER_THAN',value:2000},{field:'clicks',operator:'GREATER_THAN',value:50}]} executionSpec {execution_type:'PAUSE'} scheduleSpec {schedule_type:'SEMI_HOURLY'}. Other execution types: UNPAUSE, CHANGE_BUDGET (with execution_options), CHANGE_BID, NOTIFICATION, ROTATE.",
    { adAccountId: z.string().optional(), name: z.string(), evaluationSpec: z.record(z.unknown()), executionSpec: z.record(z.unknown()), scheduleSpec: z.record(z.unknown()).optional(), status: z.enum(["ENABLED", "DISABLED"]).optional(), confirm: z.boolean().optional() },
    guarded(async ({ adAccountId, name, evaluationSpec, executionSpec, scheduleSpec, status, confirm }) => {
      assertConfirmed(config, confirm, "Create automated rule");
      return client.post(`${act(adAccountId)}/adrules_library`, { name, evaluation_spec: evaluationSpec, execution_spec: executionSpec, schedule_spec: scheduleSpec ?? { schedule_type: "DAILY" }, status: status ?? "ENABLED" });
    }),
  );

  server.tool("meta_rule_update", "Enable/disable or edit an automated rule.", { ruleId: z.string(), name: z.string().optional(), status: z.enum(["ENABLED", "DISABLED"]).optional(), evaluationSpec: z.record(z.unknown()).optional(), executionSpec: z.record(z.unknown()).optional(), scheduleSpec: z.record(z.unknown()).optional() }, guarded(async ({ ruleId, name, status, evaluationSpec, executionSpec, scheduleSpec }) => {
    assertWrites(config, "Update rule");
    return client.post(ruleId, { name, status, evaluation_spec: evaluationSpec, execution_spec: executionSpec, schedule_spec: scheduleSpec });
  }));

  server.tool("meta_rule_delete", "Delete an automated rule. Requires confirm=true.", { ruleId: z.string(), confirm: z.boolean().optional() }, guarded(async ({ ruleId, confirm }) => {
    assertConfirmed(config, confirm, "Delete rule");
    return client.delete(ruleId);
  }));

  server.tool("meta_rule_history", "Execution history of a rule (what it changed and when).", { ruleId: z.string(), limit: z.number().optional() }, guarded(async ({ ruleId, limit }) => client.getAll(`${ruleId}/history`, { fields: "evaluation_spec,exception_code,exception_message,execution_spec,is_manual,results,schedule_spec,timestamp", limit: limit ?? 50 }, {}, 1)));

  // ── Audiences ─────────────────────────────────────────────────────────────
  server.tool("meta_audiences", "Custom, lookalike and saved audiences with size, subtype, source and delivery status.", { adAccountId: z.string().optional(), kind: z.enum(["custom", "saved", "all"]).optional() }, guarded(async ({ adAccountId, kind }) => {
    const id = act(adAccountId);
    const custom = kind !== "saved" ? await client.getAll(`${id}/customaudiences`, { fields: "id,name,subtype,description,approximate_count_lower_bound,approximate_count_upper_bound,data_source,delivery_status,operation_status,lookalike_spec,rule,retention_days,time_updated,customer_file_source" }) : [];
    const saved = kind !== "custom" ? await client.getAll(`${id}/saved_audiences`, { fields: "id,name,targeting,approximate_count_lower_bound,approximate_count_upper_bound,time_updated" }) : [];
    return { custom, saved };
  }));

  server.tool(
    "meta_audience_create",
    "Create an audience. kind: customer_list (then upload via meta_audience_upload_users), website (rule on pixel events, e.g. {inclusions:{operator:'or',rules:[{event_sources:[{id:PIXEL,type:'pixel'}],retention_seconds:2592000,filter:{operator:'and',filters:[{field:'url',operator:'i_contains',value:'/pricing'}]}}]}}), engagement (page/IG/video/lead form engagers via rule with event_sources type page|ig_business|... ), app_activity, offline (offline dataset), lookalike (from sourceAudienceId + country + ratio), saved (targeting spec).",
    { adAccountId: z.string().optional(), kind: z.enum(["customer_list", "website", "engagement", "app_activity", "offline", "lookalike", "saved"]), name: z.string(), description: z.string().optional(), rule: z.record(z.unknown()).optional(), retentionDays: z.number().optional(), sourceAudienceId: z.string().optional(), lookalikeCountry: z.string().optional(), lookalikeRatio: z.number().optional(), targeting: z.record(z.unknown()).optional(), customerFileSource: z.enum(["USER_PROVIDED_ONLY", "PARTNER_PROVIDED_ONLY", "BOTH_USER_AND_PARTNER_PROVIDED"]).optional(), offlineDatasetId: z.string().optional() },
    guarded(async (a) => {
      assertWrites(config, "Create audience");
      await requireAds();
      const id = act(a.adAccountId);
      if (a.kind === "saved") return client.post(`${id}/saved_audiences`, { name: a.name, targeting: a.targeting });
      if (a.kind === "lookalike") return client.post(`${id}/customaudiences`, { name: a.name, subtype: "LOOKALIKE", origin_audience_id: a.sourceAudienceId, lookalike_spec: { type: "similarity", country: a.lookalikeCountry, ratio: a.lookalikeRatio ?? 0.01 } });
      const subtype = { customer_list: "CUSTOM", website: "WEBSITE", engagement: "ENGAGEMENT", app_activity: "APP", offline: "OFFLINE_CONVERSION" }[a.kind];
      return client.post(`${id}/customaudiences`, { name: a.name, description: a.description, subtype, rule: a.rule, retention_days: a.retentionDays, customer_file_source: a.kind === "customer_list" ? (a.customerFileSource ?? "USER_PROVIDED_ONLY") : undefined, prefill: a.kind === "website" || a.kind === "engagement" ? true : undefined, data_set_id: a.offlineDatasetId });
    }),
  );

  server.tool(
    "meta_audience_upload_users",
    "Add (or remove) people to a customer-list audience. Values are SHA-256 hashed here before sending. schema keys: EMAIL, PHONE (E.164 digits), FN, LN, CT, ST, ZIP, COUNTRY, MADID, EXTERN_ID.",
    { audienceId: z.string(), schema: z.array(z.string()).min(1), users: z.array(z.array(z.string())).min(1).max(10000), remove: z.boolean().optional(), confirm: z.boolean().optional() },
    guarded(async ({ audienceId, schema, users, remove, confirm }) => {
      if (remove) assertConfirmed(config, confirm, "Remove users from audience"); else assertWrites(config, "Upload audience users");
      const noHash = new Set(["MADID", "EXTERN_ID"]);
      const data = users.map((row) => row.map((v, i) => (noHash.has(schema[i] ?? "") ? v : sha256(v))));
      const payload = { schema: schema.length === 1 ? schema[0] : schema, data };
      return remove ? client.delete(`${audienceId}/users`, { payload: JSON.stringify(payload) }) : client.post(`${audienceId}/users`, { payload });
    }),
  );

  server.tool("meta_audience_share", "Share a custom audience with another ad account, or list where it is shared.", { audienceId: z.string(), targetAdAccountIds: z.array(z.string()).optional() }, guarded(async ({ audienceId, targetAdAccountIds }) => {
    if (!targetAdAccountIds?.length) return client.get(`${audienceId}/adaccounts`, {});
    assertWrites(config, "Share audience");
    return client.post(`${audienceId}/adaccounts`, { adaccounts: targetAdAccountIds.map((x) => x.replace(/^act_/, "")) });
  }));

  server.tool("meta_audience_delete", "Delete a custom or saved audience. Requires confirm=true.", { audienceId: z.string(), confirm: z.boolean().optional() }, guarded(async ({ audienceId, confirm }) => {
    assertConfirmed(config, confirm, "Delete audience");
    return client.delete(audienceId);
  }));

  // ── Pixel, Events Manager, Conversions API ────────────────────────────────
  server.tool("meta_pixels", "Pixels / datasets on the account with last-fired time, owner and automatic-matching settings.", { adAccountId: z.string().optional() }, guarded(async ({ adAccountId }) =>
    client.getAll(`${act(adAccountId)}/adspixels`, { fields: "id,name,code,last_fired_time,creation_time,owner_business,owner_ad_account,is_unavailable,data_use_setting,automatic_matching_fields,enable_automatic_matching,first_party_cookie_status,can_proxy" }),
  ));

  server.tool("meta_pixel_create", "Create a pixel (dataset) on the account.", { adAccountId: z.string().optional(), name: z.string() }, guarded(async ({ adAccountId, name }) => {
    assertWrites(config, "Create pixel");
    return client.post(`${act(adAccountId)}/adspixels`, { name });
  }));

  server.tool("meta_pixel_stats", "Events received by the pixel in a window (Events Manager overview): counts by event name and source.", { pixelId: z.string(), startTime: z.string().optional(), endTime: z.string().optional(), aggregation: z.enum(["event", "browser_type", "device_type", "host", "pixel_fire", "url", "event_source", "custom_data_field"]).optional() }, guarded(async ({ pixelId, startTime, endTime, aggregation }) =>
    client.get(`${pixelId}/stats`, { aggregation: aggregation ?? "event", start_time: startTime ? Math.floor(new Date(startTime).getTime() / 1000) : undefined, end_time: endTime ? Math.floor(new Date(endTime).getTime() / 1000) : undefined }),
  ));

  server.tool("meta_pixel_share", "Share a pixel with another ad account or business, or list sharing.", { pixelId: z.string(), adAccountId: z.string().optional(), businessId: z.string().optional() }, guarded(async ({ pixelId, adAccountId, businessId }) => {
    if (!adAccountId && !businessId) return { adAccounts: await client.getAll(`${pixelId}/shared_accounts`, {}), businesses: await client.getAll(`${pixelId}/shared_agencies`, {}).catch(() => []) };
    assertWrites(config, "Share pixel");
    return adAccountId ? client.post(`${pixelId}/shared_accounts`, { account_id: adAccountId.replace(/^act_/, ""), business: resolveId(businessId, config.defaults.businessId, "businessId", "META_BUSINESS_ID") }) : client.post(`${pixelId}/shared_agencies`, { business: businessId });
  }));

  server.tool(
    "meta_capi_send_events",
    "Conversions API: send server-side events to a pixel. Each event: {event_name:'Purchase', event_time (unix), action_source:'website', event_source_url, user_data:{em,ph,fn,ln,ct,st,zp,country,external_id,client_ip_address,client_user_agent,fbc,fbp}, custom_data:{currency,value,content_ids,...}, event_id}. PII fields in user_data are hashed here automatically. Pass testEventCode to route to Events Manager → Test Events.",
    { pixelId: z.string(), events: z.array(z.record(z.unknown())).min(1).max(1000), testEventCode: z.string().optional(), confirm: z.boolean().optional() },
    guarded(async ({ pixelId, events, testEventCode, confirm }) => {
      if (!testEventCode) assertConfirmed(config, confirm, "Send live CAPI events"); else assertWrites(config, "Send test CAPI events");
      const hashKeys = new Set(["em", "ph", "fn", "ln", "ct", "st", "zp", "country", "external_id", "ge", "db"]);
      const isHex64 = (v: string) => /^[a-f0-9]{64}$/.test(v);
      const data = events.map((e) => {
        const ud = { ...((e["user_data"] as Record<string, unknown>) ?? {}) };
        for (const [k, v] of Object.entries(ud)) {
          if (!hashKeys.has(k)) continue;
          const arr = Array.isArray(v) ? v : [v];
          ud[k] = arr.map((x) => (typeof x === "string" && !isHex64(x) ? sha256(k === "ph" ? x.replace(/\D/g, "") : x) : x));
        }
        return { event_time: Math.floor(Date.now() / 1000), action_source: "website", ...e, user_data: ud };
      });
      return client.post(`${pixelId}/events`, { data, test_event_code: testEventCode });
    }),
  );

  server.tool("meta_offline_datasets", "Offline event sets (offline conversions) in the portfolio, with upload stats.", { businessId: z.string().optional() }, guarded(async ({ businessId }) =>
    client.getAll(`${resolveId(businessId, config.defaults.businessId, "businessId", "META_BUSINESS_ID")}/owned_offline_conversion_data_sets`, { fields: "id,name,description,event_stats,last_upload_app,is_restricted_use,creation_time,valid_entries,matched_entries" }),
  ));

  server.tool("meta_offline_dataset_create", "Create an offline event set and assign it to an ad account.", { businessId: z.string().optional(), adAccountId: z.string().optional(), name: z.string(), description: z.string().optional() }, guarded(async ({ businessId, adAccountId, name, description }) => {
    assertWrites(config, "Create offline dataset");
    const b = resolveId(businessId, config.defaults.businessId, "businessId", "META_BUSINESS_ID");
    const ds = await client.post<{ id: string }>(`${b}/offline_conversion_data_sets`, { name, description });
    if (adAccountId || config.defaults.adAccountId) await client.post(`${ds.id}/adaccounts`, { account_id: act(adAccountId).replace(/^act_/, ""), business: b });
    return ds;
  }));

  server.tool("meta_offline_upload_events", "Upload offline conversions (in-store purchases, phone sales, CRM closes). Events: {event_name,event_time,match_keys:{email,phone,fn,ln,...},currency,value,order_id}. match_keys hashed here.", { datasetId: z.string(), uploadTag: z.string(), events: z.array(z.record(z.unknown())).min(1).max(2000), confirm: z.boolean().optional() }, guarded(async ({ datasetId, uploadTag, events, confirm }) => {
    assertConfirmed(config, confirm, "Upload offline events");
    const data = events.map((e) => {
      const mk = { ...((e["match_keys"] as Record<string, unknown>) ?? {}) };
      for (const [k, v] of Object.entries(mk)) {
        const arr = Array.isArray(v) ? v : [v];
        mk[k] = arr.map((x) => (typeof x === "string" && !/^[a-f0-9]{64}$/.test(x) ? sha256(k === "phone" ? x.replace(/\D/g, "") : x) : x));
      }
      return { ...e, match_keys: mk };
    });
    return client.post(`${datasetId}/events`, { upload_tag: uploadTag, data });
  }));

  server.tool("meta_attribution_settings", "Attribution windows in effect for the account and per ad set (attribution_spec).", { adAccountId: z.string().optional() }, guarded(async ({ adAccountId }) => {
    const id = act(adAccountId);
    const [account, adsets] = await Promise.all([client.get(id, { fields: "attribution_spec" }), client.getAll(`${id}/adsets`, { fields: "id,name,attribution_spec", limit: 100 }, {}, 1)]);
    return { account, adsets };
  }));
};
