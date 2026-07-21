/**
 * Default field sets. Meta returns a thin default projection (often just id + a couple
 * of columns), so every read tool asks for a full set explicitly.
 */

export const ACCOUNT_FIELDS = [
  "id", "account_id", "name", "account_status", "currency", "timezone_name",
  "amount_spent", "balance", "spend_cap", "business_name", "created_time",
  "funding_source_details", "disable_reason", "age",
].join(",");

export const CAMPAIGN_FIELDS = [
  "id", "name", "status", "effective_status", "objective", "buying_type",
  "bid_strategy", "daily_budget", "lifetime_budget", "budget_remaining", "spend_cap",
  "start_time", "stop_time", "created_time", "updated_time", "special_ad_categories",
  "pacing_type", "source_campaign_id",
].join(",");

export const ADSET_FIELDS = [
  "id", "name", "campaign_id", "status", "effective_status", "daily_budget",
  "lifetime_budget", "budget_remaining", "billing_event", "optimization_goal",
  "bid_amount", "bid_strategy", "start_time", "end_time", "created_time",
  "updated_time", "destination_type", "attribution_spec", "promoted_object", "targeting",
].join(",");

export const AD_FIELDS = [
  "id", "name", "adset_id", "campaign_id", "status", "effective_status",
  "created_time", "updated_time", "creative",
].join(",");

export const CREATIVE_FIELDS = [
  "id", "name", "title", "body", "object_story_spec", "thumbnail_url", "image_url",
  "video_id", "call_to_action_type", "effective_object_story_id", "link_url", "status",
].join(",");

/** Full insights projection — spend, delivery, efficiency, conversions, quality. */
export const INSIGHTS_FIELDS = [
  "account_id", "account_name", "campaign_id", "campaign_name", "adset_id",
  "adset_name", "ad_id", "ad_name", "impressions", "reach", "frequency", "clicks",
  "unique_clicks", "inline_link_clicks", "ctr", "inline_link_click_ctr", "cpc", "cpm",
  "cpp", "spend", "actions", "action_values", "cost_per_action_type", "conversions",
  "objective", "optimization_goal", "quality_ranking", "engagement_rate_ranking",
  "conversion_rate_ranking",
].join(",");

/**
 * Reduced projection used when the full one trips Meta's generic aggregation error
 * (code 1 / subcode 99), which it does on high-cardinality ad-level daily queries.
 */
export const INSIGHTS_FIELDS_LITE = [
  "campaign_name", "adset_name", "ad_id", "ad_name", "impressions", "reach",
  "frequency", "clicks", "inline_link_clicks", "ctr", "cpc", "cpm", "spend", "actions",
].join(",");

export const INSIGHT_LEVELS = ["account", "campaign", "adset", "ad"];

export const DATE_PRESETS = [
  "today", "yesterday", "this_month", "last_month", "this_quarter", "maximum",
  "last_3d", "last_7d", "last_14d", "last_28d", "last_30d", "last_90d",
  "last_quarter", "last_year", "this_week_mon_today", "last_week_mon_sun",
  "this_year",
];
