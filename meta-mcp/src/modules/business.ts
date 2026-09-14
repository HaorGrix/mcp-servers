/** Business Manager / Business Portfolio: assets, people, permissions, verification, domains. */
import { z } from "zod";
import type { Register } from "../context.js";
import { guarded } from "../respond.js";
import { assertConfirmed, assertWrites, resolveId } from "../guard.js";

const ROLE = z.enum(["ADMIN", "EMPLOYEE", "FINANCE_ANALYST", "FINANCE_EDITOR", "DEVELOPER"]);
const ASSET_TYPE = z.enum(["page", "ad_account", "instagram_account", "whatsapp_business_account", "product_catalog", "pixel", "app"]);

const ASSET_EDGE: Record<z.infer<typeof ASSET_TYPE>, { list: string; assign: string; idField: string }> = {
  page: { list: "owned_pages", assign: "assigned_users", idField: "page" },
  ad_account: { list: "owned_ad_accounts", assign: "assigned_users", idField: "adaccount" },
  instagram_account: { list: "owned_instagram_accounts", assign: "assigned_users", idField: "instagram_account" },
  whatsapp_business_account: { list: "owned_whatsapp_business_accounts", assign: "assigned_users", idField: "whatsapp_business_account" },
  product_catalog: { list: "owned_product_catalogs", assign: "assigned_users", idField: "product_catalog" },
  pixel: { list: "owned_pixels", assign: "assigned_users", idField: "pixel" },
  app: { list: "owned_apps", assign: "assigned_users", idField: "app" },
};

export const registerBusiness: Register = ({ server, client, config }) => {
  const biz = (id?: string) => resolveId(id, config.defaults.businessId, "businessId", "META_BUSINESS_ID");

  server.tool(
    "meta_business_list",
    "Business portfolios the token can see.",
    {},
    guarded(async () => client.getAll("me/businesses", { fields: "id,name,verification_status,created_time,primary_page,link,timezone_id,vertical" })),
  );

  server.tool(
    "meta_business_get",
    "Portfolio detail: verification status, primary page, 2FA requirement, creator, timezone.",
    { businessId: z.string().optional() },
    guarded(async ({ businessId }) =>
      client.get(biz(businessId), {
        fields: "id,name,verification_status,primary_page,created_time,created_by,two_factor_type,timezone_id,vertical,link,is_hidden,profile_picture_uri",
      }),
    ),
  );

  server.tool(
    "meta_business_update",
    "Update portfolio name, vertical, or timezone.",
    { businessId: z.string().optional(), name: z.string().optional(), vertical: z.string().optional(), timezone_id: z.number().optional() },
    guarded(async ({ businessId, ...body }) => {
      assertWrites(config, "Business update");
      return client.post(biz(businessId), body);
    }),
  );

  server.tool(
    "meta_business_assets",
    "All owned and client assets in a portfolio: ad accounts, pages, Instagram, WhatsApp, catalogs, pixels, apps.",
    { businessId: z.string().optional() },
    guarded(async ({ businessId }) => {
      const b = biz(businessId);
      const edge = (e: string, fields: string) => client.getAll<Record<string, unknown>>(`${b}/${e}`, { fields }).catch((err: Error) => ({ error: err.message }));
      const [ownedAds, clientAds, ownedPages, clientPages, ig, waba, cats, pixels, apps, offline] = await Promise.all([
        edge("owned_ad_accounts", "id,name,currency,account_status,amount_spent,business_country_code"),
        edge("client_ad_accounts", "id,name,currency,account_status"),
        edge("owned_pages", "id,name,fan_count,category,is_published"),
        edge("client_pages", "id,name,fan_count"),
        edge("owned_instagram_accounts", "id,username,followers_count,media_count"),
        edge("owned_whatsapp_business_accounts", "id,name,currency,timezone_id,message_template_namespace"),
        edge("owned_product_catalogs", "id,name,product_count,vertical"),
        edge("owned_pixels", "id,name,last_fired_time,creation_time"),
        edge("owned_apps", "id,name,link"),
        edge("owned_offline_conversion_data_sets", "id,name"),
      ]);
      return { adAccounts: { owned: ownedAds, client: clientAds }, pages: { owned: ownedPages, client: clientPages }, instagram: ig, whatsapp: waba, catalogs: cats, pixels, apps, offlineDatasets: offline, note: "Domain verification has no Graph edge in v23; manage it in Business settings → Brand safety → Domains." };
    }),
  );

  server.tool(
    "meta_business_users",
    "People in the portfolio with roles, plus system users and pending invitations.",
    { businessId: z.string().optional() },
    guarded(async ({ businessId }) => {
      const b = biz(businessId);
      const [users, systemUsers, pending] = await Promise.all([
        client.getAll(`${b}/business_users`, { fields: "id,name,email,role,title,pending_email,first_name,last_name" }),
        client.getAll(`${b}/system_users`, { fields: "id,name,role,created_by,created_time" }).catch(() => []),
        client.getAll(`${b}/pending_users`, { fields: "id,email,role,invite_link,expiration_time,status" }).catch(() => []),
      ]);
      return { users, systemUsers, pending };
    }),
  );

  server.tool(
    "meta_business_invite_user",
    "Invite a person to the portfolio by email with a role.",
    { businessId: z.string().optional(), email: z.string().email(), role: ROLE },
    guarded(async ({ businessId, email, role }) => {
      assertWrites(config, "Invite user");
      return client.post(`${biz(businessId)}/business_users`, { email, role });
    }),
  );

  server.tool(
    "meta_business_update_user_role",
    "Change a business user's role.",
    { businessUserId: z.string(), role: ROLE },
    guarded(async ({ businessUserId, role }) => {
      assertWrites(config, "Update user role");
      return client.post(businessUserId, { role });
    }),
  );

  server.tool(
    "meta_business_remove_user",
    "Remove a person from the portfolio. Requires confirm=true.",
    { businessUserId: z.string(), confirm: z.boolean().optional() },
    guarded(async ({ businessUserId, confirm }) => {
      assertConfirmed(config, confirm, "Remove business user");
      return client.delete(businessUserId);
    }),
  );

  server.tool(
    "meta_business_create_system_user",
    "Create a system user (ADMIN or EMPLOYEE) in the portfolio. Token generation for it is UI-only.",
    { businessId: z.string().optional(), name: z.string(), role: z.enum(["ADMIN", "EMPLOYEE"]) },
    guarded(async ({ businessId, name, role }) => {
      assertWrites(config, "Create system user");
      return client.post(`${biz(businessId)}/system_users`, { name, role });
    }),
  );

  server.tool(
    "meta_asset_users",
    "Who has access to an asset (page, ad account, IG, WABA, catalog, pixel) and with what tasks.",
    { businessId: z.string().optional(), assetId: z.string() },
    guarded(async ({ businessId, assetId }) =>
      client.getAll(`${assetId}/assigned_users`, { business: biz(businessId), fields: "id,name,tasks,role" }),
    ),
  );

  server.tool(
    "meta_asset_assign_user",
    "Grant a business user or system user tasks on an asset. Tasks e.g. MANAGE, ADVERTISE, ANALYZE, CREATE_CONTENT, MODERATE, MESSAGING.",
    { businessId: z.string().optional(), assetId: z.string(), userId: z.string(), tasks: z.array(z.string()).min(1) },
    guarded(async ({ businessId, assetId, userId, tasks }) => {
      assertWrites(config, "Assign asset");
      return client.post(`${assetId}/assigned_users`, { user: userId, tasks, business: biz(businessId) });
    }),
  );

  server.tool(
    "meta_asset_unassign_user",
    "Remove a user's access to an asset. Requires confirm=true.",
    { businessId: z.string().optional(), assetId: z.string(), userId: z.string(), confirm: z.boolean().optional() },
    guarded(async ({ businessId, assetId, userId, confirm }) => {
      assertConfirmed(config, confirm, "Unassign asset");
      return client.delete(`${assetId}/assigned_users`, { user: userId, business: biz(businessId) });
    }),
  );

  server.tool(
    "meta_business_claim_asset",
    "Claim ownership of a page, ad account, Instagram account, pixel or app into the portfolio. The asset must be one the token's user already administers.",
    { businessId: z.string().optional(), assetType: ASSET_TYPE, assetId: z.string() },
    guarded(async ({ businessId, assetType, assetId }) => {
      assertWrites(config, "Claim asset");
      const edge = ASSET_EDGE[assetType];
      const key = assetType === "ad_account" ? "adaccount_id" : assetType === "page" ? "page_id" : assetType === "app" ? "app_id" : assetType === "pixel" ? "pixel_id" : `${edge.idField}_id`;
      return client.post(`${biz(businessId)}/${edge.list}`, { [key]: assetId });
    }),
  );

  server.tool(
    "meta_business_request_client_asset",
    "Request client access to another business's page or ad account (agency partner flow).",
    { businessId: z.string().optional(), assetType: z.enum(["page", "ad_account"]), assetId: z.string(), permittedTasks: z.array(z.string()).min(1) },
    guarded(async ({ businessId, assetType, assetId, permittedTasks }) => {
      assertWrites(config, "Request client asset");
      const edge = assetType === "page" ? "client_pages" : "client_ad_accounts";
      const key = assetType === "page" ? "page_id" : "adaccount_id";
      return client.post(`${biz(businessId)}/${edge}`, { [key]: assetId, permitted_tasks: permittedTasks });
    }),
  );

  server.tool(
    "meta_business_pending_requests",
    "Pending client asset requests and pending shared-asset invitations.",
    { businessId: z.string().optional() },
    guarded(async ({ businessId }) => {
      const b = biz(businessId);
      const [clientRequests, received, shared] = await Promise.all([
        client.getAll(`${b}/pending_client_ad_accounts`, { fields: "id,name" }).catch(() => []),
        client.getAll(`${b}/received_audience_sharing_requests`, {}).catch(() => []),
        client.getAll(`${b}/pending_shared_pixels`, {}).catch(() => []),
      ]);
      return { clientRequests, receivedAudienceSharing: received, pendingSharedPixels: shared };
    }),
  );

  server.tool(
    "meta_business_verification_status",
    "Business verification state and what is blocking it, when Meta exposes it.",
    { businessId: z.string().optional() },
    guarded(async ({ businessId }) => client.get(biz(businessId), { fields: "id,name,verification_status,two_factor_type,created_time" })),
  );
};
