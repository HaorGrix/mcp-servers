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

/** Video retention + play projection. Layered on top of the base insights fields. */
export const VIDEO_INSIGHTS_FIELDS = [
  "campaign_name", "adset_name", "ad_name", "spend", "impressions",
  "video_play_actions", "video_thruplay_watched_actions",
  "video_p25_watched_actions", "video_p50_watched_actions",
  "video_p75_watched_actions", "video_p95_watched_actions",
  "video_p100_watched_actions", "video_avg_time_watched_actions",
].join(",");

/** Quality/relevance diagnostics — only populated once an ad clears ~500 impressions. */
export const QUALITY_INSIGHTS_FIELDS = [
  "ad_id", "ad_name", "campaign_name", "impressions", "spend", "ctr",
  "quality_ranking", "engagement_rate_ranking", "conversion_rate_ranking",
].join(",");

/** Facebook Page metadata (needs pages_read_engagement). */
export const PAGE_FIELDS = [
  "id", "name", "username", "category", "fan_count", "followers_count",
  "new_like_count", "talking_about_count", "were_here_count", "rating_count",
  "overall_star_rating", "link", "website", "phone", "emails", "about",
  "single_line_address", "verification_status", "connected_instagram_account",
].join(",");

/** Organic Page post projection with engagement summaries. */
export const PAGE_POST_FIELDS = [
  "id", "message", "story", "created_time", "permalink_url", "status_type",
  "shares", "likes.summary(true).limit(0)", "comments.summary(true).limit(0)",
  "insights.metric(post_impressions,post_impressions_unique,post_engaged_users,post_clicks)",
].join(",");

/** Custom / lookalike / saved audiences. */
export const AUDIENCE_FIELDS = [
  "id", "name", "subtype", "description", "approximate_count_lower_bound",
  "approximate_count_upper_bound", "operation_status", "delivery_status",
  "retention_days", "rule", "time_created", "time_updated",
].join(",");

/** Every messaging action type Meta emits for click-to-message ads, WhatsApp included. */
export const MESSAGING_ACTION_TYPES = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.messaging_first_reply",
  "onsite_conversion.total_messaging_connection",
  "onsite_conversion.messaging_user_depth_2_message_send",
  "onsite_conversion.messaging_user_depth_3_message_send",
  "onsite_conversion.messaging_user_depth_5_message_send",
  "onsite_conversion.messaging_welcome_message_view",
  "onsite_conversion.messaging_block",
];

export const INSIGHT_LEVELS = ["account", "campaign", "adset", "ad"];

export const DATE_PRESETS = [
  "today", "yesterday", "this_month", "last_month", "this_quarter", "maximum",
  "last_3d", "last_7d", "last_14d", "last_28d", "last_30d", "last_90d",
  "last_quarter", "last_year", "this_week_mon_today", "last_week_mon_sun",
  "this_year",
];
