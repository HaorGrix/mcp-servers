/** Commerce: product catalogs, products, product sets, feeds, diagnostics, commerce accounts. */
import { z } from "zod";
import type { Register } from "../context.js";
import { guarded } from "../respond.js";
import { assertConfirmed, assertWrites, resolveId } from "../guard.js";

const PRODUCT_FIELDS = "id,retailer_id,name,description,price,sale_price,currency,availability,condition,brand,url,image_url,additional_image_urls,product_type,category,review_status,visibility,inventory,gtin,mpn,custom_label_0";

export const registerCatalog: Register = ({ server, client, config }) => {
  const biz = (id?: string) => resolveId(id, config.defaults.businessId, "businessId", "META_BUSINESS_ID");
  const requireCat = () => client.requireScopes("catalog_management");

  server.tool("meta_catalogs", "Product catalogs owned by the portfolio.", { businessId: z.string().optional() }, guarded(async ({ businessId }) => {
    await requireCat();
    return client.getAll(`${biz(businessId)}/owned_product_catalogs`, { fields: "id,name,product_count,vertical,feed_count,is_catalog_segment,default_image_url" });
  }));

  server.tool("meta_catalog_create", "Create a catalog. vertical: commerce (products), hotels, flights, destinations, home_listings, vehicles, offline_commerce.", { businessId: z.string().optional(), name: z.string(), vertical: z.string().optional() }, guarded(async ({ businessId, name, vertical }) => {
    assertWrites(config, "Create catalog");
    return client.post(`${biz(businessId)}/owned_product_catalogs`, { name, vertical: vertical ?? "commerce" });
  }));

  server.tool("meta_catalog_delete", "Delete a catalog and everything in it. Requires confirm=true.", { catalogId: z.string(), confirm: z.boolean().optional() }, guarded(async ({ catalogId, confirm }) => {
    assertConfirmed(config, confirm, "Delete catalog");
    return client.delete(catalogId, { allow_delete_catalog_with_live_product_set: true });
  }));

  server.tool("meta_catalog_products", "Products in a catalog (optionally filtered with a JSON filter, e.g. {\"availability\":{\"eq\":\"in stock\"}}).", { catalogId: z.string(), filter: z.string().optional(), limit: z.number().optional() }, guarded(async ({ catalogId, filter, limit }) =>
    client.getAll(`${catalogId}/products`, { fields: PRODUCT_FIELDS, filter, limit: limit ?? 100 }, {}, Math.ceil((limit ?? 100) / 100)),
  ));

  server.tool("meta_catalog_product_get", "One product with review status and errors.", { productId: z.string() }, guarded(async ({ productId }) => client.get(productId, { fields: PRODUCT_FIELDS + ",errors,applinks,commerce_insights" })));

  server.tool(
    "meta_catalog_product_upsert",
    "Create or update a product by retailer_id. price as '19.99 USD' style is accepted as priceAmount (minor units) + currency.",
    { catalogId: z.string(), retailerId: z.string(), name: z.string().optional(), description: z.string().optional(), priceAmount: z.number().optional().describe("Minor units, e.g. 1999 for 19.99"), currency: z.string().optional(), salePriceAmount: z.number().optional(), availability: z.enum(["in stock", "out of stock", "preorder", "available for order", "discontinued"]).optional(), condition: z.enum(["new", "refurbished", "used"]).optional(), brand: z.string().optional(), url: z.string().optional(), imageUrl: z.string().optional(), additionalImageUrls: z.array(z.string()).optional(), category: z.string().optional(), inventory: z.number().optional(), gtin: z.string().optional(), visibility: z.enum(["published", "staging"]).optional(), customLabel0: z.string().optional() },
    guarded(async (a) => {
      assertWrites(config, "Upsert product");
      const body = { retailer_id: a.retailerId, name: a.name, description: a.description, price: a.priceAmount, currency: a.currency, sale_price: a.salePriceAmount, availability: a.availability, condition: a.condition, brand: a.brand, url: a.url, image_url: a.imageUrl, additional_image_urls: a.additionalImageUrls, category: a.category, inventory: a.inventory, gtin: a.gtin, visibility: a.visibility, custom_label_0: a.customLabel0 };
      const existing = await client.get<{ data: Array<{ id: string }> }>(`${a.catalogId}/products`, { fields: "id", filter: JSON.stringify({ retailer_id: { eq: a.retailerId } }) });
      const id = existing.data[0]?.id;
      return id ? client.post(id, body) : client.post(`${a.catalogId}/products`, body);
    }),
  );

  server.tool("meta_catalog_batch", "Bulk create/update/delete products via the items_batch API. requests: [{method:'UPDATE',data:{id:'sku1',title:'...',price:'19.99 USD',availability:'in stock',...}}]. Up to 5000 per call.", { catalogId: z.string(), requests: z.array(z.object({ method: z.enum(["CREATE", "UPDATE", "DELETE"]), data: z.record(z.unknown()) })).min(1).max(5000), confirm: z.boolean().optional() }, guarded(async ({ catalogId, requests, confirm }) => {
    if (requests.some((r) => r.method === "DELETE")) assertConfirmed(config, confirm, "Batch with deletes"); else assertWrites(config, "Catalog batch");
    return client.post(`${catalogId}/items_batch`, { item_type: "PRODUCT_ITEM", requests });
  }));

  server.tool("meta_catalog_product_delete", "Delete one product. Requires confirm=true.", { productId: z.string(), confirm: z.boolean().optional() }, guarded(async ({ productId, confirm }) => {
    assertConfirmed(config, confirm, "Delete product");
    return client.delete(productId);
  }));

  server.tool("meta_catalog_product_sets", "Product sets in a catalog with filters and counts.", { catalogId: z.string() }, guarded(async ({ catalogId }) => client.getAll(`${catalogId}/product_sets`, { fields: "id,name,filter,product_count,live_product_count" })));

  server.tool("meta_catalog_product_set_create", "Create a product set from a filter, e.g. {\"brand\":{\"i_contains\":\"acme\"}} or {\"retailer_id\":{\"is_any\":[\"sku1\",\"sku2\"]}}.", { catalogId: z.string(), name: z.string(), filter: z.record(z.unknown()) }, guarded(async ({ catalogId, name, filter }) => {
    assertWrites(config, "Create product set");
    return client.post(`${catalogId}/product_sets`, { name, filter });
  }));

  server.tool("meta_catalog_product_set_delete", "Delete a product set. Requires confirm=true.", { productSetId: z.string(), confirm: z.boolean().optional() }, guarded(async ({ productSetId, confirm }) => {
    assertConfirmed(config, confirm, "Delete product set");
    return client.delete(productSetId);
  }));

  server.tool("meta_catalog_feeds", "Scheduled product feeds and their last upload status/errors.", { catalogId: z.string() }, guarded(async ({ catalogId }) => client.getAll(`${catalogId}/product_feeds`, { fields: "id,name,schedule,latest_upload{id,start_time,end_time,error_count,warning_count,num_items_processed},product_count,file_name,encoding" })));

  server.tool("meta_catalog_feed_create", "Create a scheduled feed from a URL (CSV/TSV/XML/RSS). schedule e.g. {interval:'DAILY',hour:3}.", { catalogId: z.string(), name: z.string(), url: z.string(), schedule: z.object({ interval: z.enum(["HOURLY", "DAILY", "WEEKLY"]), hour: z.number().optional(), minute: z.number().optional(), day_of_week: z.string().optional() }), username: z.string().optional(), password: z.string().optional() }, guarded(async ({ catalogId, name, url, schedule, username, password }) => {
    assertWrites(config, "Create feed");
    return client.post(`${catalogId}/product_feeds`, { name, schedule: { ...schedule, url, username, password } });
  }));

  server.tool("meta_catalog_feed_upload_now", "Trigger an immediate fetch of a feed URL.", { feedId: z.string(), url: z.string().optional() }, guarded(async ({ feedId, url }) => {
    assertWrites(config, "Feed upload");
    return client.post(`${feedId}/uploads`, { url });
  }));

  server.tool("meta_catalog_diagnostics", "Catalog-level issues (missing fields, disapproved items, feed errors).", { catalogId: z.string() }, guarded(async ({ catalogId }) => client.get(`${catalogId}/diagnostics`, { fields: "type,title,description,affected_products_count,severity,sample_affected_products" }).catch(() => client.get(`${catalogId}/check_batch_request_status`, {}))));

  server.tool("meta_commerce_accounts", "Commerce (Shop) accounts visible to the token, with onboarding and payout status. Needs commerce_account_read_settings for full detail.", { businessId: z.string().optional() }, guarded(async ({ businessId }) =>
    client.getAll(`${biz(businessId)}/commerce_merchant_settings`, { fields: "id,display_name,merchant_page,onsite_commerce_merchant,setup_status,payment_provider,shops,checkout_config" }).catch((e: Error) => ({ error: e.message, note: "Shops/checkout require commerce_* scopes and a supported country; catalog tools work without them." })),
  ));
};
