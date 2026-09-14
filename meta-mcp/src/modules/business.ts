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

  // ── Partners, credit, experiments, tokens ────────────────────────────────
  server.tool("meta_business_partners", "Agencies that work on this portfolio's assets and clients whose assets this portfolio manages.", { businessId: z.string().optional() }, guarded(async ({ businessId }) => {
    const b = biz(businessId);
    const [agencies, clients, clientApps] = await Promise.all([
      client.getAll(`${b}/agencies`, { fields: "id,name,link,verification_status" }).catch(() => []),
      client.getAll(`${b}/clients`, { fields: "id,name,link,verification_status" }).catch(() => []),
      client.getAll(`${b}/client_apps`, { fields: "id,name" }).catch(() => []),
    ]);
    return { agencies, clients, clientApps };
  }));

  server.tool("meta_business_share_asset_with_agency", "Give a partner business (agency) access to a page or ad account with permitted tasks.", { businessId: z.string().optional(), assetType: z.enum(["page", "ad_account"]), assetId: z.string(), agencyBusinessId: z.string(), permittedTasks: z.array(z.string()).min(1) }, guarded(async ({ businessId, assetType, assetId, agencyBusinessId, permittedTasks }) => {
    assertWrites(config, "Share asset with agency");
    return client.post(`${assetId}/agencies`, { business: agencyBusinessId, permitted_tasks: permittedTasks, ...(assetType === "page" ? {} : {}) , owner_business: biz(businessId) });
  }));

  server.tool("meta_business_credit_lines", "Extended credit lines (invoicing) on the portfolio with balance and limits.", { businessId: z.string().optional() }, guarded(async ({ businessId }) =>
    client.getAll(`${biz(businessId)}/extendedcredits`, { fields: "id,legal_entity_name,balance,credit_available,max_balance,allocated_amount,last_payment_time,owning_business,partition_from,receiving_credit_allocation_config" }),
  ));

  server.tool("meta_business_invoices", "Monthly invoices for credit-line billing.", { businessId: z.string().optional(), since: z.string().optional(), until: z.string().optional() }, guarded(async ({ businessId, since, until }) =>
    client.getAll(`${biz(businessId)}/business_invoices`, { fields: "id,billing_period,invoice_id,amount_due,amount,payment_status,due_date,invoice_date,download_uri", start_date: since, end_date: until }).catch((e: Error) => ({ error: e.message, note: "Invoices exist only for accounts on a credit line." })),
  ));

  server.tool("meta_experiments", "Experiments (A/B tests, conversion lift studies) on the portfolio.", { businessId: z.string().optional() }, guarded(async ({ businessId }) =>
    client.getAll(`${biz(businessId)}/ad_studies`, { fields: "id,name,description,type,start_time,end_time,cells{id,name,treatment_percentage,campaigns{id,name}},created_time,updated_time,results_first_available_date" }),
  ));

  server.tool("meta_experiment_create", "Create an A/B test between campaigns (SPLIT_TEST) or a conversion-lift study. cells: [{name,treatment_percentage,campaigns:[id]}]. Requires confirm=true.", { businessId: z.string().optional(), name: z.string(), description: z.string().optional(), type: z.enum(["SPLIT_TEST", "LIFT"]).default("SPLIT_TEST"), startTime: z.string(), endTime: z.string(), cells: z.array(z.object({ name: z.string(), treatment_percentage: z.number(), campaigns: z.array(z.string()).optional(), adsets: z.array(z.string()).optional() })).min(2), confirm: z.boolean().optional() }, guarded(async ({ businessId, name, description, type, startTime, endTime, cells, confirm }) => {
    assertConfirmed(config, confirm, "Create experiment");
    return client.post(`${biz(businessId)}/ad_studies`, { name, description, type, start_time: Math.floor(new Date(startTime).getTime() / 1000), end_time: Math.floor(new Date(endTime).getTime() / 1000), cells });
  }));

  server.tool("meta_system_user_generate_token", "Mint a System User access token via API for a given app + scopes (needs META_APP_SECRET and the app must be owned by the portfolio). Returns the token once; store it in .env yourself. Requires confirm=true.", { systemUserId: z.string(), appId: z.string().optional(), scopes: z.array(z.string()).min(1), setTokenExpiresIn60Days: z.boolean().optional(), confirm: z.boolean().optional() }, guarded(async ({ systemUserId, appId, scopes, setTokenExpiresIn60Days, confirm }) => {
    assertConfirmed(config, confirm, "Generate system user token");
    if (!config.appSecret) throw new Error("META_APP_SECRET is required for token generation.");
    const app = resolveId(appId, config.defaults.appId, "appId", "META_APP_ID");
    return client.post<{ access_token: string }>(`${systemUserId}/access_tokens`, { business_app: app, scope: scopes.join(","), set_token_expires_in_60_days: setTokenExpiresIn60Days ?? false });
  }));

  server.tool("meta_business_pending_asset_claims", "Pages and ad accounts with pending ownership or client-access claims into this portfolio.", { businessId: z.string().optional() }, guarded(async ({ businessId }) => {
    const b = biz(businessId);
    const e = (x: string) => client.getAll(`${b}/${x}`, { fields: "id,name" }).catch(() => []);
    const [ownedPages, clientPages, clientAds, ownedAds] = await Promise.all([e("pending_owned_pages"), e("pending_client_pages"), e("pending_client_ad_accounts"), e("pending_owned_ad_accounts")]);
    return { pendingOwnedPages: ownedPages, pendingClientPages: clientPages, pendingClientAdAccounts: clientAds, pendingOwnedAdAccounts: ownedAds };
  }));

  server.tool("meta_business_create_pixel", "Create a pixel/dataset owned by the portfolio (not tied to one ad account).", { businessId: z.string().optional(), name: z.string() }, guarded(async ({ businessId, name }) => {
    assertWrites(config, "Create business pixel");
    return client.post(`${biz(businessId)}/adspixels`, { name });
  }));

  server.tool("meta_business_instagram_accounts", "Instagram accounts connected to the portfolio (owned and via Pages).", { businessId: z.string().optional() }, guarded(async ({ businessId }) => {
    const b = biz(businessId);
    const [owned, viaPages] = await Promise.all([
      client.getAll(`${b}/owned_instagram_accounts`, { fields: "id,username,followers_count,media_count,profile_picture_url" }).catch(() => []),
      client.getAll(`${b}/instagram_accounts`, { fields: "id,username,followed_by_count" }).catch(() => []),
    ]);
    return { owned, viaPages };
  }));
};
