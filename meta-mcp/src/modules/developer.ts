/** Developer plane: app dashboard, webhooks subscriptions (app + page + IG + WABA), Ad Library archive. */
import { z } from "zod";
import type { Register } from "../context.js";
import { guarded } from "../respond.js";
import { assertConfirmed, assertWrites, resolveId } from "../guard.js";

const OBJECT = z.enum(["page", "instagram", "whatsapp_business_account", "user", "permissions", "application"]);

export const registerDeveloper: Register = ({ server, client, config }) => {
  const app = (id?: string) => resolveId(id, config.defaults.appId, "appId", "META_APP_ID");
  const appToken = () => {
    if (!config.appSecret) throw new Error("META_APP_SECRET is required for app-level webhook management (App Dashboard → Settings → Basic).");
    return `${app()}|${config.appSecret}`;
  };

  server.tool("meta_app_get", "App detail: name, namespace, mode, category, privacy/terms URLs, allowed domains, roles.", { appId: z.string().optional() }, guarded(async ({ appId }) =>
    client.get(app(appId), { fields: "id,name,namespace,category,link,privacy_policy_url,terms_of_service_url,app_domains,website_url,contact_email,restrictions,supported_platforms,creator_uid,company" }),
  ));

  server.tool("meta_app_roles", "People with roles on the app (admin/developer/tester).", { appId: z.string().optional() }, guarded(async ({ appId }) => client.getAll(`${app(appId)}/roles`, { fields: "user,role" }, { token: appToken() })));

  server.tool("meta_app_update", "Update app settings: domains, privacy URL, terms URL, contact email, website.", { appId: z.string().optional(), appDomains: z.array(z.string()).optional(), privacyPolicyUrl: z.string().optional(), termsOfServiceUrl: z.string().optional(), contactEmail: z.string().optional(), websiteUrl: z.string().optional() }, guarded(async ({ appId, appDomains, privacyPolicyUrl, termsOfServiceUrl, contactEmail, websiteUrl }) => {
    assertWrites(config, "Update app");
    return client.post(app(appId), { app_domains: appDomains, privacy_policy_url: privacyPolicyUrl, terms_of_service_url: termsOfServiceUrl, contact_email: contactEmail, website_url: websiteUrl });
  }));

  server.tool("meta_webhook_app_subscriptions", "Webhook subscriptions configured on the app (per object: callback URL, fields, active).", { appId: z.string().optional() }, guarded(async ({ appId }) =>
    client.get(`${app(appId)}/subscriptions`, {}, { token: appToken() }),
  ));

  server.tool(
    "meta_webhook_app_subscribe",
    "Create/update an app-level webhook subscription for an object. Meta will GET the callback with hub.challenge, so it must be live and echo the challenge with the verifyToken.",
    { appId: z.string().optional(), object: OBJECT, callbackUrl: z.string().url(), verifyToken: z.string(), fields: z.array(z.string()).min(1), includeValues: z.boolean().optional() },
    guarded(async ({ appId, object, callbackUrl, verifyToken, fields, includeValues }) => {
      assertWrites(config, "Webhook subscribe");
      return client.post(`${app(appId)}/subscriptions`, { object, callback_url: callbackUrl, verify_token: verifyToken, fields: fields.join(","), include_values: includeValues ?? true }, { token: appToken() });
    }),
  );

  server.tool("meta_webhook_app_unsubscribe", "Remove app-level subscription for an object (or specific fields). Requires confirm=true.", { appId: z.string().optional(), object: OBJECT, fields: z.array(z.string()).optional(), confirm: z.boolean().optional() }, guarded(async ({ appId, object, fields, confirm }) => {
    assertConfirmed(config, confirm, "Webhook unsubscribe");
    return client.delete(`${app(appId)}/subscriptions`, { object, fields: fields?.join(",") }, { token: appToken() });
  }));

  server.tool("meta_webhook_page_subscribe", "Subscribe the app to a Page's events (feed, messages, leadgen, ratings, mention...). Required in addition to the app-level subscription.", { pageId: z.string().optional(), fields: z.array(z.string()).min(1).describe("e.g. feed, messages, messaging_postbacks, leadgen, ratings, mention, message_deliveries") }, guarded(async ({ pageId, fields }) => {
    assertWrites(config, "Page subscribe");
    const p = resolveId(pageId, config.defaults.pageId, "pageId", "META_PAGE_ID");
    return client.post(`${p}/subscribed_apps`, { subscribed_fields: fields.join(",") }, { token: await client.pageToken(p) });
  }));

  server.tool("meta_webhook_page_unsubscribe", "Unsubscribe the app from a Page's events. Requires confirm=true.", { pageId: z.string().optional(), confirm: z.boolean().optional() }, guarded(async ({ pageId, confirm }) => {
    assertConfirmed(config, confirm, "Page unsubscribe");
    const p = resolveId(pageId, config.defaults.pageId, "pageId", "META_PAGE_ID");
    return client.delete(`${p}/subscribed_apps`, {}, { token: await client.pageToken(p) });
  }));

  server.tool("meta_webhook_test", "Send a sample webhook payload to the app's callback for an object/field, to validate the receiver.", { appId: z.string().optional(), object: OBJECT, field: z.string() }, guarded(async ({ appId, object, field }) => {
    assertWrites(config, "Webhook test");
    return client.post(`${app(appId)}/subscriptions_sample`, { object_id: app(appId), object, field, custom_fields: {} }, { token: appToken() });
  }));

  server.tool("meta_app_access_token_debug", "Inspect any token: app, type, scopes, expiry, validity.", { token: z.string() }, guarded(async ({ token }) => client.get("debug_token", { input_token: token })));

  server.tool(
    "meta_ad_library_search",
    "Search the Ad Library archive. Only the political/issue archive is available via API unless the app has extended access; commercial ad search is UI-only (facebook.com/ads/library).",
    { searchTerms: z.string().optional(), pageIds: z.array(z.string()).optional(), countries: z.array(z.string()).min(1), adType: z.enum(["ALL", "POLITICAL_AND_ISSUE_ADS", "HOUSING_ADS", "EMPLOYMENT_ADS", "FINANCIAL_PRODUCTS_AND_SERVICES_ADS"]).optional(), activeStatus: z.enum(["ACTIVE", "INACTIVE", "ALL"]).optional(), limit: z.number().optional() },
    guarded(async ({ searchTerms, pageIds, countries, adType, activeStatus, limit }) =>
      client.get("ads_archive", { search_terms: searchTerms, search_page_ids: pageIds?.join(","), ad_reached_countries: JSON.stringify(countries), ad_type: adType ?? "ALL", ad_active_status: activeStatus ?? "ACTIVE", limit: limit ?? 25, fields: "id,page_id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,publisher_platforms,impressions,spend,currency" }),
    ),
  );

  // ── Tokens, test users, batch ─────────────────────────────────────────────
  server.tool("meta_token_exchange_long_lived", "Exchange a short-lived user token for a 60-day long-lived one (Facebook Login flows). Needs META_APP_SECRET.", { shortLivedToken: z.string(), appId: z.string().optional() }, guarded(async ({ shortLivedToken, appId }) => {
    if (!config.appSecret) throw new Error("META_APP_SECRET required");
    return client.get("oauth/access_token", { grant_type: "fb_exchange_token", client_id: app(appId), client_secret: config.appSecret, fb_exchange_token: shortLivedToken });
  }));

  server.tool("meta_app_test_users", "Test users on the app (for Login/Messenger testing); create one with optional permissions.", { appId: z.string().optional(), create: z.boolean().optional(), permissions: z.array(z.string()).optional(), name: z.string().optional() }, guarded(async ({ appId, create, permissions, name }) => {
    const a = app(appId);
    if (!create) return client.getAll<Record<string, unknown>>(`${a}/accounts`, { fields: "id,login_url,access_token" }, { token: appToken() }).then((r) => r.map((u) => ({ ...u, access_token: u["access_token"] ? "***" : undefined })));
    assertWrites(config, "Create test user");
    return client.post(`${a}/accounts`, { installed: true, permissions: permissions?.join(","), name }, { token: appToken() });
  }));

  server.tool("meta_app_permissions_status", "Permissions the app has been granted (standard vs advanced access) as Meta reports them, plus the current token's scopes.", { appId: z.string().optional() }, guarded(async ({ appId }) => {
    const scopes = [...(await client.grantedScopes())].sort();
    const appPerms = await client.get(`${app(appId)}/permissions`, {}, { token: config.appSecret ? appToken() : undefined }).catch((e: Error) => ({ error: e.message }));
    return { tokenScopes: scopes, appPermissions: appPerms };
  }));

  server.tool("meta_graph_batch", "Run up to 50 Graph requests in one round trip. Each: {method, relative_url, body?, name?, depends_on?}. Use for bulk reads/writes (e.g. pause 30 ad sets).", { requests: z.array(z.object({ method: z.enum(["GET", "POST", "DELETE"]), relative_url: z.string(), body: z.record(z.unknown()).optional(), name: z.string().optional(), depends_on: z.string().optional() })).min(1).max(50), pageId: z.string().optional(), confirm: z.boolean().optional() }, guarded(async ({ requests, pageId, confirm }) => {
    if (requests.some((r) => r.method === "DELETE")) assertConfirmed(config, confirm, "Batch with deletes");
    else if (requests.some((r) => r.method === "POST")) assertWrites(config, "Batch writes");
    return client.batch(requests, pageId ? { token: await client.pageToken(pageId) } : {});
  }));

  server.tool("meta_webhook_ig_subscribe", "Subscribe the app to Instagram events for the linked Page (comments, mentions, messages, story_insights). Page subscription carries IG fields.", { pageId: z.string().optional() }, guarded(async ({ pageId }) => {
    assertWrites(config, "IG subscribe");
    const p = resolveId(pageId, config.defaults.pageId, "pageId", "META_PAGE_ID");
    return client.post(`${p}/subscribed_apps`, { subscribed_fields: "feed,messages,messaging_postbacks,message_reactions,message_reads,messaging_seen,leadgen,ratings,mention,message_deliveries" }, { token: await client.pageToken(p) });
  }));

  server.tool("meta_app_insights", "App-level analytics events exposed to the Graph (API calls, errors) for the last 7 days where available.", { appId: z.string().optional() }, guarded(async ({ appId }) => client.get(`${app(appId)}/insights`, { metric: "api_calls,api_errors" }, { token: config.appSecret ? appToken() : undefined }).catch((e: Error) => ({ error: e.message, note: "App insights need an app token (META_APP_SECRET)." }))));
};
