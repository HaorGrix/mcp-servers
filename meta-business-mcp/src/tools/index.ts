import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MetaClient } from "../client.js";

function ok(payload: unknown) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

export function registerTools(server: McpServer, client: MetaClient): void {
  // ── Overview ──────────────────────────────────────────────────────────────
  server.tool(
    "meta_whoami",
    "The token owner and its granted permissions. Run this first to see what the token can reach.",
    {},
    async () => {
      const me = await client.get("me", { fields: "id,name" });
      const perms = await client.get<{ data: Array<{ permission: string; status: string }> }>("me/permissions", {});
      const granted = perms.data.filter((p) => p.status === "granted").map((p) => p.permission);
      return ok({ me, granted });
    },
  );

  server.tool(
    "meta_business_overview",
    "One call that maps everything the token can see: businesses, pages, ad accounts and Instagram accounts.",
    {},
    async () => {
      const [businesses, pages, adaccounts] = await Promise.all([
        client.getAll("me/businesses", { fields: "id,name,verification_status" }).catch(() => []),
        client.getAll("me/accounts", { fields: "id,name,category,fan_count,followers_count,instagram_business_account" }),
        client.getAll("me/adaccounts", { fields: "account_id,name,currency,account_status,amount_spent" }),
      ]);
      return ok({ businesses, pages, adAccounts: adaccounts });
    },
  );

  // ── Businesses ────────────────────────────────────────────────────────────
  server.tool(
    "meta_list_businesses",
    "List Business Manager accounts the token can access.",
    {},
    async () => ok(await client.getAll("me/businesses", { fields: "id,name,verification_status,created_time" })),
  );

  server.tool(
    "meta_business_assets",
    "Owned and client assets for a business: ad accounts, pages, Instagram accounts, WhatsApp accounts.",
    {
      businessId: z.string().describe("Business Manager id"),
    },
    async ({ businessId }) => {
      const [ownedAds, clientAds, ownedPages, clientPages, ig, wa] = await Promise.all([
        client.getAll(`${businessId}/owned_ad_accounts`, { fields: "account_id,name,currency" }).catch(() => []),
        client.getAll(`${businessId}/client_ad_accounts`, { fields: "account_id,name,currency" }).catch(() => []),
        client.getAll(`${businessId}/owned_pages`, { fields: "id,name,fan_count" }).catch(() => []),
        client.getAll(`${businessId}/client_pages`, { fields: "id,name,fan_count" }).catch(() => []),
        client.getAll(`${businessId}/owned_instagram_accounts`, { fields: "id,username,followers_count" }).catch(() => []),
        client.getAll(`${businessId}/owned_whatsapp_business_accounts`, { fields: "id,name" }).catch(() => []),
      ]);
      return ok({ ownedAdAccounts: ownedAds, clientAdAccounts: clientAds, ownedPages, clientPages, instagram: ig, whatsapp: wa });
    },
  );

  server.tool(
    "meta_business_users",
    "People and system users on a business, with their roles.",
    { businessId: z.string() },
    async ({ businessId }) => {
      const [people, system] = await Promise.all([
        client.getAll(`${businessId}/business_users`, { fields: "id,name,email,role" }).catch(() => []),
        client.getAll(`${businessId}/system_users`, { fields: "id,name,role" }).catch(() => []),
      ]);
      return ok({ businessUsers: people, systemUsers: system });
    },
  );

  // ── Pages ─────────────────────────────────────────────────────────────────
  server.tool(
    "meta_list_pages",
    "Pages the token manages, with follower counts and any linked Instagram account.",
    {},
    async () => ok(await client.getAll("me/accounts", {
      fields: "id,name,category,fan_count,followers_count,link,instagram_business_account{id,username,followers_count}",
    })),
  );

  server.tool(
    "meta_page",
    "Full detail on one page: about, fans, followers, contact, hours, rating.",
    { pageId: z.string() },
    async ({ pageId }) => ok(await client.get(pageId, {
      fields: "id,name,about,category,fan_count,followers_count,link,phone,emails,website,location,rating_count,overall_star_rating,new_like_count",
    })),
  );

  server.tool(
    "meta_page_snapshot",
    "Current page health: fans, followers, people talking about it, new likes, check-ins, rating. " +
      "Meta deprecated the time-series page-insights metrics (impressions/reach over a period) in " +
      "recent Graph versions, so this returns the live counts, which is what still works reliably.",
    { pageId: z.string() },
    async ({ pageId }) => ok(await client.get(pageId, {
      fields: "id,name,fan_count,followers_count,talking_about_count,new_like_count,were_here_count,rating_count,overall_star_rating,checkins",
    })),
  );

  server.tool(
    "meta_page_posts",
    "Recent posts on a page with likes, comments and shares (counts via summary).",
    {
      pageId: z.string(),
      limit: z.number().int().min(1).max(50).optional().default(10),
    },
    async ({ pageId, limit }) => {
      const token = await client.pageToken(pageId);
      return ok(await client.get(`${pageId}/posts`, {
        fields: "id,message,created_time,permalink_url,shares,likes.summary(true).limit(0),comments.summary(true).limit(0)",
        limit,
        _token: token,
      }));
    },
  );

  // ── Instagram ───────────────────────────────────────────────────────────────
  server.tool(
    "meta_instagram",
    "Instagram business account profile: username, followers, media count, bio.",
    { igId: z.string().describe("Instagram business account id (from a page)") },
    async ({ igId }) => ok(await client.get(igId, {
      fields: "id,username,name,followers_count,follows_count,media_count,biography,profile_picture_url",
    })),
  );

  server.tool(
    "meta_instagram_insights",
    "Instagram account insights: reach, impressions, profile views, follower changes.",
    {
      igId: z.string(),
      period: z.enum(["day", "week", "days_28"]).optional().default("week"),
    },
    async ({ igId, period }) => ok(await client.get(`${igId}/insights`, {
      metric: "reach,impressions,profile_views,follower_count",
      period,
    })),
  );

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  server.tool(
    "meta_whatsapp_numbers",
    "Phone numbers under a WhatsApp Business Account, with quality rating and status.",
    { wabaId: z.string().describe("WhatsApp Business Account id") },
    async ({ wabaId }) => ok(await client.getAll(`${wabaId}/phone_numbers`, {
      fields: "id,display_phone_number,verified_name,quality_rating,status",
    })),
  );

  // ── Escape hatch ────────────────────────────────────────────────────────────
  server.tool(
    "meta_graph_get",
    "Read-only escape hatch for any Graph API GET not covered above. Provide the node/edge path and comma-separated fields.",
    {
      path: z.string().describe('e.g. "me/accounts" or "{page-id}/ratings"'),
      fields: z.string().optional().describe("Comma-separated field list"),
    },
    async ({ path, fields }) => ok(await client.get(path, fields ? { fields } : {})),
  );
}
