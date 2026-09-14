import { z } from "zod";
import type { Register } from "../context.js";
import { guarded } from "../respond.js";
import { assertConfirmed, assertWrites } from "../guard.js";

export const registerOverview: Register = ({ server, client, config }) => {
  server.tool(
    "meta_whoami",
    "Token identity, type, expiry, granted scopes and current rate-limit usage. Run first.",
    {},
    guarded(async () => {
      const [me, dbg] = await Promise.all([
        client.get<{ id: string; name: string }>("me", { fields: "id,name" }),
        client.get<{ data: Record<string, unknown> }>("debug_token", { input_token: config.token }),
      ]);
      const d = dbg.data;
      return {
        me,
        app: { id: d["app_id"], name: d["application"] },
        type: d["type"],
        expires: d["expires_at"] === 0 ? "never" : new Date(Number(d["expires_at"]) * 1000).toISOString(),
        scopes: (d["scopes"] as string[]).sort(),
        defaults: config.defaults,
        writesEnabled: config.allowWrites,
        usage: client.usage,
      };
    }),
  );

  server.tool(
    "meta_ecosystem_overview",
    "One call mapping every asset the token reaches: businesses, pages (+linked Instagram), ad accounts, WhatsApp accounts, catalogs, pixels.",
    {},
    guarded(async () => {
      const businesses = await client.getAll<{ id: string; name: string }>("me/businesses", { fields: "id,name,verification_status" }).catch(() => []);
      const perBusiness = await Promise.all(
        businesses.map(async (b) => {
          const edge = (e: string, fields: string) => client.getAll<Record<string, unknown>>(`${b.id}/${e}`, { fields }).catch(() => []);
          const [ads, cads, pages, cpages, ig, waba, cats, pixels, apps] = await Promise.all([
            edge("owned_ad_accounts", "id,name,currency,account_status"),
            edge("client_ad_accounts", "id,name,currency,account_status"),
            edge("owned_pages", "id,name,fan_count"),
            edge("client_pages", "id,name,fan_count"),
            edge("owned_instagram_accounts", "id,username,followers_count"),
            edge("owned_whatsapp_business_accounts", "id,name"),
            edge("owned_product_catalogs", "id,name,product_count"),
            edge("owned_pixels", "id,name,last_fired_time"),
            edge("owned_apps", "id,name"),
          ]);
          return { ...b, adAccounts: [...ads, ...cads], pages: [...pages, ...cpages], instagram: ig, whatsapp: waba, catalogs: cats, pixels, apps };
        }),
      );
      const pages = await client.getAll("me/accounts", { fields: "id,name,category,fan_count,instagram_business_account{id,username,followers_count}" });
      const adAccounts = await client.getAll("me/adaccounts", { fields: "id,name,currency,account_status,amount_spent" }).catch(() => []);
      return { businesses: perBusiness, pagesDirect: pages, adAccountsDirect: adAccounts };
    }),
  );

  server.tool(
    "meta_rate_limits",
    "Current Meta rate-limit usage percentages parsed from the last response headers (app, ad account, business use case).",
    {},
    guarded(async () => ({ ...client.usage, peak: client.peakUsage(), note: "Values are 0-100; the client auto-throttles above 80." })),
  );

  server.tool(
    "meta_graph_get",
    "Escape hatch: GET any Graph API path with fields/params. Use when no dedicated tool exists.",
    {
      path: z.string().describe("Graph path, e.g. '123/feed' or 'me/accounts'"),
      fields: z.string().optional(),
      params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe("Extra query params"),
      pageId: z.string().optional().describe("If set, call with this Page's token instead of the system user token"),
      all: z.boolean().optional().describe("Follow pagination and return every row (max 20 pages)"),
    },
    guarded(async ({ path, fields, params, pageId, all }) => {
      const opts = pageId ? { token: await client.pageToken(pageId) } : {};
      const p = { ...(params ?? {}), ...(fields ? { fields } : {}) };
      return all ? client.getAll(path, p, opts) : client.get(path, p, opts);
    }),
  );

  server.tool(
    "meta_graph_post",
    "Escape hatch: POST to any Graph API path. Writes must be enabled.",
    {
      path: z.string(),
      body: z.record(z.unknown()).describe("Form fields; nested objects are JSON-encoded"),
      pageId: z.string().optional().describe("Call with this Page's token"),
    },
    guarded(async ({ path, body, pageId }) => {
      assertWrites(config, `POST ${path}`);
      const opts = pageId ? { token: await client.pageToken(pageId) } : {};
      return client.post(path, body, opts);
    }),
  );

  server.tool(
    "meta_graph_delete",
    "Escape hatch: DELETE any Graph API node. Requires confirm=true.",
    { path: z.string(), pageId: z.string().optional(), confirm: z.boolean().optional() },
    guarded(async ({ path, pageId, confirm }) => {
      assertConfirmed(config, confirm, `DELETE ${path}`);
      const opts = pageId ? { token: await client.pageToken(pageId) } : {};
      return client.delete(path, {}, opts);
    }),
  );
};
