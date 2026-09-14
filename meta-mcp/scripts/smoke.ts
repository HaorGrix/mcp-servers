/** Spawns the built server over stdio and exercises read tools against live assets. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const only = process.argv.slice(2);
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], stderr: "pipe" }));

const { tools } = await client.listTools();
console.log(`tools registered: ${tools.length}`);

const calls: Array<[string, Record<string, unknown>]> = [
  ["meta_whoami", {}],
  ["meta_ecosystem_overview", {}],
  ["meta_business_get", {}],
  ["meta_business_assets", {}],
  ["meta_business_users", {}],
  ["meta_pages_list", {}],
  ["meta_page_get", {}],
  ["meta_page_roles", {}],
  ["meta_page_settings", {}],
  ["meta_page_posts", { limit: 3 }],
  ["meta_page_insights", { metrics: ["page_post_engagements", "page_follows"], period: "days_28" }],
  ["meta_page_snapshot", {}],
  ["meta_page_events", {}],
  ["meta_page_live_videos", {}],
  ["meta_page_ratings", {}],
  ["meta_inbox_conversations", { platform: "messenger", limit: 3 }],
  ["meta_inbox_conversations", { platform: "instagram", limit: 3 }],
  ["meta_messenger_profile_get", {}],
  ["meta_messenger_labels", {}],
  ["meta_ig_profile", {}],
  ["meta_ig_media", { limit: 3 }],
  ["meta_ig_account_insights", { metrics: ["reach", "follower_count"], period: "day" }],
  ["meta_ig_account_insights", { metrics: ["profile_views", "accounts_engaged"], metricType: "total_value", period: "day" }],
  ["meta_ig_snapshot", {}],
  ["meta_ig_publishing_limit", {}],
  ["meta_ig_stories", {}],
  ["meta_ig_business_discovery", { username: "instagram", mediaLimit: 1 }],
  ["meta_ig_hashtag_search", { hashtag: "bangladesh", limit: 2 }],
  ["meta_ig_dm_ice_breakers", {}],
  ["meta_wa_account", {}],
  ["meta_wa_phone_numbers", {}],
  ["meta_wa_business_profile", {}],
  ["meta_wa_templates", {}],
  ["meta_wa_subscribed_apps", {}],
  ["meta_lead_forms", {}],
  ["meta_page_all_leads", {}],
  ["meta_catalogs", {}],
  ["meta_app_get", {}],
  ["meta_messenger_subscribed_apps", {}],
  ["meta_ad_accounts", {}],
  ["meta_rate_limits", {}],
];

let pass = 0, fail = 0;
for (const [name, args] of calls) {
  if (only.length && !only.includes(name)) continue;
  const t0 = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
  const ms = Date.now() - t0;
  if (res.isError) { fail += 1; console.log(`✗ ${name} (${ms}ms): ${text.slice(0, 200)}`); }
  else { pass += 1; console.log(`✓ ${name} (${ms}ms) ${text.replace(/\s+/g, " ").slice(0, 140)}`); }
}
console.log(`\npass=${pass} fail=${fail}`);
await client.close();
process.exit(fail ? 1 : 0);
