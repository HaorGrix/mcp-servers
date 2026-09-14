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
};
