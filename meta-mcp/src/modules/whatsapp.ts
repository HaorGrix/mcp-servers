/** WhatsApp Business Platform (Cloud API): WABA, phone numbers, templates, sending, business profile, analytics, webhooks. */
import { z } from "zod";
import type { Register } from "../context.js";
import { guarded } from "../respond.js";
import { assertConfirmed, assertWrites, resolveId } from "../guard.js";

export const registerWhatsApp: Register = ({ server, client, config }) => {
  const waba = (id?: string) => resolveId(id, config.defaults.wabaId, "wabaId", "META_WABA_ID");
  const requireMgmt = () => client.requireScopes("whatsapp_business_management");

  const firstPhone = async (wabaId: string): Promise<string> => {
    const r = await client.get<{ data: Array<{ id: string }> }>(`${wabaId}/phone_numbers`, { fields: "id" });
    const id = r.data[0]?.id;
    if (!id) throw new Error(`No phone numbers on WABA ${wabaId}`);
    return id;
  };

  server.tool("meta_wa_account", "WABA detail: name, currency, timezone, template namespace, review status, ownership.", { wabaId: z.string().optional() }, guarded(async ({ wabaId }) => {
    await requireMgmt();
    return client.get(waba(wabaId), { fields: "id,name,currency,timezone_id,message_template_namespace,account_review_status,business_verification_status,ownership_type" });
  }));

  server.tool("meta_wa_phone_numbers", "Phone numbers on the WABA: display number, verified name, quality rating, messaging limit, status, throughput.", { wabaId: z.string().optional() }, guarded(async ({ wabaId }) => {
    await requireMgmt();
    return client.getAll(`${waba(wabaId)}/phone_numbers`, { fields: "id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,status,code_verification_status,name_status,platform_type,throughput,is_official_business_account,account_mode" });
  }));

  server.tool("meta_wa_business_profile", "Get the business profile shown to customers (about, address, email, website, vertical, photo).", { phoneNumberId: z.string().optional(), wabaId: z.string().optional() }, guarded(async ({ phoneNumberId, wabaId }) => {
    const pn = phoneNumberId ?? (await firstPhone(waba(wabaId)));
    return client.get(`${pn}/whatsapp_business_profile`, { fields: "about,address,description,email,profile_picture_url,websites,vertical,messaging_product" });
  }));

  server.tool("meta_wa_business_profile_update", "Update the WhatsApp business profile.", { phoneNumberId: z.string().optional(), wabaId: z.string().optional(), about: z.string().optional(), address: z.string().optional(), description: z.string().optional(), email: z.string().optional(), websites: z.array(z.string()).optional(), vertical: z.string().optional() }, guarded(async ({ phoneNumberId, wabaId, ...body }) => {
    assertWrites(config, "Update WA profile");
    const pn = phoneNumberId ?? (await firstPhone(waba(wabaId)));
    return client.post(`${pn}/whatsapp_business_profile`, { messaging_product: "whatsapp", ...body });
  }));

  // ── Templates ─────────────────────────────────────────────────────────────
  server.tool("meta_wa_templates", "Message templates with status (APPROVED/PENDING/REJECTED), category, language and components.", { wabaId: z.string().optional(), status: z.string().optional(), name: z.string().optional() }, guarded(async ({ wabaId, status, name }) => {
    await requireMgmt();
    return client.getAll(`${waba(wabaId)}/message_templates`, { fields: "id,name,status,category,language,components,quality_score,rejected_reason,previous_category", status, name });
  }));

  server.tool(
    "meta_wa_template_create",
    "Create a message template (goes to Meta review). components follow the Cloud API shape: [{type:'HEADER',format:'TEXT',text:'...'},{type:'BODY',text:'Hi {{1}}'},{type:'FOOTER',text:'...'},{type:'BUTTONS',buttons:[...]}].",
    { wabaId: z.string().optional(), name: z.string().regex(/^[a-z0-9_]+$/), category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]), language: z.string().default("en_US"), components: z.array(z.record(z.unknown())), allowCategoryChange: z.boolean().optional() },
    guarded(async ({ wabaId, name, category, language, components, allowCategoryChange }) => {
      assertWrites(config, "Create WA template");
      await requireMgmt();
      return client.post(`${waba(wabaId)}/message_templates`, { name, category, language, components, allow_category_change: allowCategoryChange });
    }),
  );

  server.tool("meta_wa_template_delete", "Delete a template by name (all languages) or by id+name. Requires confirm=true.", { wabaId: z.string().optional(), name: z.string(), templateId: z.string().optional(), confirm: z.boolean().optional() }, guarded(async ({ wabaId, name, templateId, confirm }) => {
    assertConfirmed(config, confirm, "Delete WA template");
    return client.delete(`${waba(wabaId)}/message_templates`, { name, hsm_id: templateId });
  }));

  // ── Sending ───────────────────────────────────────────────────────────────
  server.tool(
    "meta_wa_send",
    "Send a WhatsApp message via Cloud API. kind=template (required outside the 24h window; pass templateName, language, and components with parameters), text, image/video/document/audio by URL, location, contacts, or interactive (buttons / list). Recipient in E.164 without '+'.",
    {
      phoneNumberId: z.string().optional(), wabaId: z.string().optional(),
      to: z.string().describe("e.g. 8801521725028"),
      kind: z.enum(["template", "text", "image", "video", "document", "audio", "location", "interactive"]),
      text: z.string().optional(), previewUrl: z.boolean().optional(),
      mediaUrl: z.string().optional(), caption: z.string().optional(), filename: z.string().optional(),
      templateName: z.string().optional(), language: z.string().optional(), components: z.array(z.record(z.unknown())).optional(),
      latitude: z.number().optional(), longitude: z.number().optional(), locationName: z.string().optional(), address: z.string().optional(),
      interactive: z.record(z.unknown()).optional().describe("Full Cloud API interactive object"),
      replyToMessageId: z.string().optional(),
      confirm: z.boolean().optional(),
    },
    guarded(async (a) => {
      assertConfirmed(config, a.confirm, "Send WhatsApp message");
      await client.requireScopes("whatsapp_business_messaging");
      const pn = a.phoneNumberId ?? (await firstPhone(waba(a.wabaId)));
      const body: Record<string, unknown> = { messaging_product: "whatsapp", recipient_type: "individual", to: a.to, type: a.kind };
      if (a.replyToMessageId) body["context"] = { message_id: a.replyToMessageId };
      switch (a.kind) {
        case "text": body["text"] = { body: a.text, preview_url: a.previewUrl ?? false }; break;
        case "template": body["template"] = { name: a.templateName, language: { code: a.language ?? "en_US" }, components: a.components }; break;
        case "image": case "video": case "document": case "audio":
          body[a.kind] = { link: a.mediaUrl, caption: a.caption, filename: a.filename }; break;
        case "location": body["location"] = { latitude: a.latitude, longitude: a.longitude, name: a.locationName, address: a.address }; break;
        case "interactive": body["interactive"] = a.interactive; break;
      }
      return client.post(`${pn}/messages`, body);
    }),
  );

  server.tool("meta_wa_mark_read", "Mark an inbound message as read (blue ticks).", { phoneNumberId: z.string().optional(), wabaId: z.string().optional(), messageId: z.string() }, guarded(async ({ phoneNumberId, wabaId, messageId }) => {
    assertWrites(config, "Mark read");
    const pn = phoneNumberId ?? (await firstPhone(waba(wabaId)));
    return client.post(`${pn}/messages`, { messaging_product: "whatsapp", status: "read", message_id: messageId });
  }));

  server.tool("meta_wa_media_url", "Resolve a media id from an inbound webhook to a download URL (valid 5 minutes).", { mediaId: z.string() }, guarded(async ({ mediaId }) => client.get(mediaId, { fields: "url,mime_type,sha256,file_size" })));

  // ── Analytics ─────────────────────────────────────────────────────────────
  server.tool("meta_wa_analytics", "Message volume (sent/delivered) and conversation analytics (cost by category) for a date range.", { wabaId: z.string().optional(), since: z.string(), until: z.string(), granularity: z.enum(["HALF_HOUR", "DAY", "MONTH"]).optional(), kind: z.enum(["messages", "conversations"]).optional() }, guarded(async ({ wabaId, since, until, granularity, kind }) => {
    await requireMgmt();
    const s = Math.floor(new Date(since).getTime() / 1000), u = Math.floor(new Date(until).getTime() / 1000);
    const g = granularity ?? "DAY";
    const field = kind === "conversations"
      ? `conversation_analytics.start(${s}).end(${u}).granularity(${g === "HALF_HOUR" ? "HALF_HOUR" : g === "MONTH" ? "MONTHLY" : "DAILY"}).dimensions(["CONVERSATION_CATEGORY","CONVERSATION_TYPE","COUNTRY"])`
      : `analytics.start(${s}).end(${u}).granularity(${g})`;
    return client.get(waba(wabaId), { fields: field });
  }));

  server.tool("meta_wa_phone_register", "Register/deregister a phone number on Cloud API (needs 6-digit PIN for 2-step).", { phoneNumberId: z.string(), action: z.enum(["register", "deregister"]), pin: z.string().optional(), confirm: z.boolean().optional() }, guarded(async ({ phoneNumberId, action, pin, confirm }) => {
    assertConfirmed(config, confirm, `${action} phone number`);
    return action === "register" ? client.post(`${phoneNumberId}/register`, { messaging_product: "whatsapp", pin }) : client.post(`${phoneNumberId}/deregister`, {});
  }));

  server.tool("meta_wa_subscribed_apps", "Apps receiving webhooks for this WABA; subscribe or unsubscribe the current app.", { wabaId: z.string().optional(), action: z.enum(["list", "subscribe", "unsubscribe"]).optional() }, guarded(async ({ wabaId, action }) => {
    const w = waba(wabaId);
    if (!action || action === "list") return client.get(`${w}/subscribed_apps`, {});
    assertWrites(config, "WABA subscription");
    return action === "subscribe" ? client.post(`${w}/subscribed_apps`, {}) : client.delete(`${w}/subscribed_apps`);
  }));

  // ── Templates: edit & analytics ───────────────────────────────────────────
  server.tool("meta_wa_template_update", "Edit an existing template's components or category (re-enters review; max 10 edits/month per template).", { templateId: z.string(), components: z.array(z.record(z.unknown())).optional(), category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).optional() }, guarded(async ({ templateId, components, category }) => {
    assertWrites(config, "Update WA template");
    return client.post(templateId, { components, category });
  }));

  server.tool("meta_wa_template_analytics", "Per-template sent/delivered/read/clicked counts for a date range (enable analytics once via meta_wa_template_analytics_enable).", { wabaId: z.string().optional(), templateIds: z.array(z.string()).min(1).max(10), since: z.string(), until: z.string(), granularity: z.enum(["DAILY"]).default("DAILY") }, guarded(async ({ wabaId, templateIds, since, until, granularity }) => {
    await requireMgmt();
    return client.get(`${waba(wabaId)}/template_analytics`, { start: Math.floor(new Date(since).getTime() / 1000), end: Math.floor(new Date(until).getTime() / 1000), granularity, metric_types: "SENT,DELIVERED,READ,CLICKED", template_ids: JSON.stringify(templateIds) });
  }));

  server.tool("meta_wa_template_analytics_enable", "Turn on template analytics for the WABA (one-time).", { wabaId: z.string().optional() }, guarded(async ({ wabaId }) => {
    assertWrites(config, "Enable template analytics");
    return client.post(waba(wabaId), { is_enabled_for_insights: true });
  }));

  // ── Flows ─────────────────────────────────────────────────────────────────
  server.tool("meta_wa_flows", "WhatsApp Flows on the WABA (interactive forms/screens) with status and validation errors.", { wabaId: z.string().optional() }, guarded(async ({ wabaId }) => {
    await requireMgmt();
    return client.getAll(`${waba(wabaId)}/flows`, { fields: "id,name,status,categories,validation_errors,json_version,data_api_version,endpoint_uri,preview" });
  }));

  server.tool("meta_wa_flow_create", "Create a Flow (DRAFT). categories e.g. SIGN_UP, SIGN_IN, APPOINTMENT_BOOKING, LEAD_GENERATION, CONTACT_US, CUSTOMER_SUPPORT, SURVEY, OTHER. Upload the JSON with meta_wa_flow_update_json.", { wabaId: z.string().optional(), name: z.string(), categories: z.array(z.string()).min(1), endpointUri: z.string().optional(), cloneFlowId: z.string().optional() }, guarded(async ({ wabaId, name, categories, endpointUri, cloneFlowId }) => {
    assertWrites(config, "Create flow");
    return client.post(`${waba(wabaId)}/flows`, { name, categories, endpoint_uri: endpointUri, clone_flow_id: cloneFlowId });
  }));

  server.tool("meta_wa_flow_update_json", "Upload the Flow JSON definition from a local file (asset_type FLOW_JSON). Returns validation errors if any.", { flowId: z.string(), filePath: z.string() }, guarded(async ({ flowId, filePath }) => {
    assertWrites(config, "Update flow JSON");
    return client.upload(`${flowId}/assets`, filePath, "file", { name: "flow.json", asset_type: "FLOW_JSON" });
  }));

  server.tool("meta_wa_flow_action", "publish (irreversible: can no longer edit JSON), deprecate, or delete (drafts only) a Flow. Requires confirm=true.", { flowId: z.string(), action: z.enum(["publish", "deprecate", "delete"]), confirm: z.boolean().optional() }, guarded(async ({ flowId, action, confirm }) => {
    assertConfirmed(config, confirm, `Flow ${action}`);
    return action === "delete" ? client.delete(flowId) : client.post(`${flowId}/${action}`, {});
  }));

  server.tool("meta_wa_flow_preview", "Preview URL for a Flow (valid 30 days) for testing in a browser.", { flowId: z.string() }, guarded(async ({ flowId }) => client.get(flowId, { fields: "preview.invalidate(false)" })));

  // ── QR codes / deep links ─────────────────────────────────────────────────
  server.tool("meta_wa_qr_codes", "Message QR codes / wa.me deep links with prefilled text, for the phone number.", { phoneNumberId: z.string().optional(), wabaId: z.string().optional() }, guarded(async ({ phoneNumberId, wabaId }) => {
    const pn = phoneNumberId ?? (await firstPhone(waba(wabaId)));
    return client.get(`${pn}/message_qrdls`, { fields: "code,prefilled_message,deep_link_url,qr_image_url" });
  }));

  server.tool("meta_wa_qr_code_create", "Create a QR code / deep link with a prefilled customer message.", { phoneNumberId: z.string().optional(), wabaId: z.string().optional(), prefilledMessage: z.string(), imageFormat: z.enum(["SVG", "PNG"]).optional() }, guarded(async ({ phoneNumberId, wabaId, prefilledMessage, imageFormat }) => {
    assertWrites(config, "Create QR");
    const pn = phoneNumberId ?? (await firstPhone(waba(wabaId)));
    return client.post(`${pn}/message_qrdls`, { prefilled_message: prefilledMessage, generate_qr_image: imageFormat ?? "PNG" });
  }));

  server.tool("meta_wa_qr_code_delete", "Delete a QR code by its code. Requires confirm=true.", { phoneNumberId: z.string().optional(), wabaId: z.string().optional(), code: z.string(), confirm: z.boolean().optional() }, guarded(async ({ phoneNumberId, wabaId, code, confirm }) => {
    assertConfirmed(config, confirm, "Delete QR");
    const pn = phoneNumberId ?? (await firstPhone(waba(wabaId)));
    return client.delete(`${pn}/message_qrdls/${code}`);
  }));

  // ── Media, extra message kinds ────────────────────────────────────────────
  server.tool("meta_wa_media_upload", "Upload a local file to WhatsApp media storage; returns a media id to send with meta_wa_send_media_id.", { phoneNumberId: z.string().optional(), wabaId: z.string().optional(), filePath: z.string(), mimeType: z.string() }, guarded(async ({ phoneNumberId, wabaId, filePath, mimeType }) => {
    assertWrites(config, "Upload WA media");
    const pn = phoneNumberId ?? (await firstPhone(waba(wabaId)));
    return client.upload(`${pn}/media`, filePath, "file", { messaging_product: "whatsapp", type: mimeType });
  }));

  server.tool("meta_wa_media_delete", "Delete an uploaded media object. Requires confirm=true.", { mediaId: z.string(), confirm: z.boolean().optional() }, guarded(async ({ mediaId, confirm }) => {
    assertConfirmed(config, confirm, "Delete WA media");
    return client.delete(mediaId);
  }));

  server.tool("meta_wa_send_extra", "Send message kinds not covered by meta_wa_send: reaction (emoji to a message id), sticker, contacts (vCard-like objects), media by uploaded media id, or a Flow message.", {
    phoneNumberId: z.string().optional(), wabaId: z.string().optional(), to: z.string(),
    kind: z.enum(["reaction", "sticker", "contacts", "media_id", "flow"]),
    messageId: z.string().optional(), emoji: z.string().optional(),
    mediaId: z.string().optional(), mediaType: z.enum(["image", "video", "document", "audio", "sticker"]).optional(), caption: z.string().optional(),
    contacts: z.array(z.record(z.unknown())).optional(),
    flow: z.object({ flowId: z.string(), flowToken: z.string().optional(), header: z.string().optional(), body: z.string(), footer: z.string().optional(), ctaText: z.string(), screen: z.string().optional(), data: z.record(z.unknown()).optional(), mode: z.enum(["draft", "published"]).optional() }).optional(),
    confirm: z.boolean().optional(),
  }, guarded(async (a) => {
    assertConfirmed(config, a.confirm, "Send WhatsApp message");
    const pn = a.phoneNumberId ?? (await firstPhone(waba(a.wabaId)));
    const body: Record<string, unknown> = { messaging_product: "whatsapp", recipient_type: "individual", to: a.to };
    switch (a.kind) {
      case "reaction": body["type"] = "reaction"; body["reaction"] = { message_id: a.messageId, emoji: a.emoji ?? "" }; break;
      case "sticker": body["type"] = "sticker"; body["sticker"] = { id: a.mediaId }; break;
      case "contacts": body["type"] = "contacts"; body["contacts"] = a.contacts; break;
      case "media_id": body["type"] = a.mediaType ?? "image"; body[a.mediaType ?? "image"] = { id: a.mediaId, caption: a.caption }; break;
      case "flow": {
        if (!a.flow) throw new Error("flow required");
        body["type"] = "interactive";
        body["interactive"] = { type: "flow", header: a.flow.header ? { type: "text", text: a.flow.header } : undefined, body: { text: a.flow.body }, footer: a.flow.footer ? { text: a.flow.footer } : undefined, action: { name: "flow", parameters: { flow_message_version: "3", flow_id: a.flow.flowId, flow_token: a.flow.flowToken ?? `t_${Date.now()}`, flow_cta: a.flow.ctaText, mode: a.flow.mode ?? "published", flow_action: a.flow.screen ? "navigate" : undefined, flow_action_payload: a.flow.screen ? { screen: a.flow.screen, data: a.flow.data } : undefined } } };
      }
    }
    return client.post(`${pn}/messages`, body);
  }));

  // ── Phone number lifecycle ────────────────────────────────────────────────
  server.tool("meta_wa_phone_add", "Add a new phone number to the WABA (then request/verify code and register).", { wabaId: z.string().optional(), countryCode: z.string(), phoneNumber: z.string(), verifiedName: z.string() }, guarded(async ({ wabaId, countryCode, phoneNumber, verifiedName }) => {
    assertWrites(config, "Add phone number");
    return client.post(`${waba(wabaId)}/phone_numbers`, { cc: countryCode, phone_number: phoneNumber, verified_name: verifiedName });
  }));

  server.tool("meta_wa_phone_verify", "Request an SMS/voice verification code for a number, or submit the code.", { phoneNumberId: z.string(), action: z.enum(["request_code", "verify_code"]), method: z.enum(["SMS", "VOICE"]).optional(), language: z.string().optional(), code: z.string().optional() }, guarded(async ({ phoneNumberId, action, method, language, code }) => {
    assertWrites(config, "Phone verification");
    return action === "request_code" ? client.post(`${phoneNumberId}/request_code`, { code_method: method ?? "SMS", language: language ?? "en_US" }) : client.post(`${phoneNumberId}/verify_code`, { code });
  }));

  server.tool("meta_wa_phone_two_step_pin", "Set or change the two-step verification PIN for a number. Requires confirm=true.", { phoneNumberId: z.string(), pin: z.string().length(6), confirm: z.boolean().optional() }, guarded(async ({ phoneNumberId, pin, confirm }) => {
    assertConfirmed(config, confirm, "Set 2-step PIN");
    return client.post(phoneNumberId, { pin });
  }));

  server.tool("meta_wa_phone_settings", "Get or update per-number settings: calling (enable/disable, call icon, hours), and the display name.", { phoneNumberId: z.string().optional(), wabaId: z.string().optional(), calling: z.record(z.unknown()).optional(), displayName: z.string().optional() }, guarded(async ({ phoneNumberId, wabaId, calling, displayName }) => {
    const pn = phoneNumberId ?? (await firstPhone(waba(wabaId)));
    if (!calling && !displayName) return client.get(`${pn}/settings`, { include_sip_credentials: false }).catch(async () => client.get(pn, { fields: "id,verified_name,name_status,new_name_status,display_phone_number" }));
    assertWrites(config, "Update phone settings");
    const out: Record<string, unknown> = {};
    if (calling) out["settings"] = await client.post(`${pn}/settings`, { calling });
    if (displayName) out["name"] = await client.post(pn, { new_display_name: displayName });
    return out;
  }));

  server.tool("meta_wa_block_users", "List blocked numbers, or block/unblock numbers on the phone.", { phoneNumberId: z.string().optional(), wabaId: z.string().optional(), action: z.enum(["list", "block", "unblock"]).optional(), numbers: z.array(z.string()).optional(), confirm: z.boolean().optional() }, guarded(async ({ phoneNumberId, wabaId, action, numbers, confirm }) => {
    const pn = phoneNumberId ?? (await firstPhone(waba(wabaId)));
    if (!action || action === "list") return client.get(`${pn}/block_users`, {});
    if (action === "block") assertConfirmed(config, confirm, "Block users"); else assertWrites(config, "Unblock");
    const body = { messaging_product: "whatsapp", block_users: (numbers ?? []).map((user) => ({ user })) };
    return action === "block" ? client.post(`${pn}/block_users`, body) : client.delete(`${pn}/block_users`, { block_users: JSON.stringify(body.block_users) });
  }));

  // ── Commerce & pricing ────────────────────────────────────────────────────
  server.tool("meta_wa_commerce_settings", "Get or set WhatsApp commerce settings: catalog visibility and cart on the business profile.", { phoneNumberId: z.string().optional(), wabaId: z.string().optional(), catalogVisible: z.boolean().optional(), cartEnabled: z.boolean().optional() }, guarded(async ({ phoneNumberId, wabaId, catalogVisible, cartEnabled }) => {
    const pn = phoneNumberId ?? (await firstPhone(waba(wabaId)));
    if (catalogVisible === undefined && cartEnabled === undefined) return client.get(`${pn}/whatsapp_commerce_settings`, {});
    assertWrites(config, "Commerce settings");
    return client.post(`${pn}/whatsapp_commerce_settings`, { is_catalog_visible: catalogVisible, is_cart_enabled: cartEnabled });
  }));

  server.tool("meta_wa_send_catalog_message", "Send a catalog or single/multi product message (WhatsApp commerce) referencing the connected catalog.", { phoneNumberId: z.string().optional(), wabaId: z.string().optional(), to: z.string(), kind: z.enum(["catalog", "product", "product_list"]), bodyText: z.string(), footerText: z.string().optional(), catalogId: z.string().optional(), productRetailerId: z.string().optional(), sections: z.array(z.object({ title: z.string(), product_items: z.array(z.object({ product_retailer_id: z.string() })) })).optional(), headerText: z.string().optional(), confirm: z.boolean().optional() }, guarded(async (a) => {
    assertConfirmed(config, a.confirm, "Send catalog message");
    const pn = a.phoneNumberId ?? (await firstPhone(waba(a.wabaId)));
    const interactive: Record<string, unknown> = { body: { text: a.bodyText }, footer: a.footerText ? { text: a.footerText } : undefined };
    if (a.kind === "catalog") { interactive["type"] = "catalog_message"; interactive["action"] = { name: "catalog_message", parameters: a.productRetailerId ? { thumbnail_product_retailer_id: a.productRetailerId } : undefined }; }
    else if (a.kind === "product") { interactive["type"] = "product"; interactive["action"] = { catalog_id: a.catalogId, product_retailer_id: a.productRetailerId }; }
    else { interactive["type"] = "product_list"; interactive["header"] = { type: "text", text: a.headerText ?? "Products" }; interactive["action"] = { catalog_id: a.catalogId, sections: a.sections }; }
    return client.post(`${pn}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", to: a.to, type: "interactive", interactive });
  }));

  server.tool("meta_wa_pricing_analytics", "Billable message volume and cost by pricing category / country for a date range.", { wabaId: z.string().optional(), since: z.string(), until: z.string(), granularity: z.enum(["DAILY", "MONTHLY"]).optional() }, guarded(async ({ wabaId, since, until, granularity }) => {
    await requireMgmt();
    const s = Math.floor(new Date(since).getTime() / 1000), u = Math.floor(new Date(until).getTime() / 1000);
    return client.get(waba(wabaId), { fields: `pricing_analytics.start(${s}).end(${u}).granularity(${granularity ?? "DAILY"}).dimensions(["PRICING_CATEGORY","PRICING_TYPE","COUNTRY"])` });
  }));

  server.tool("meta_wa_waba_health", "Messaging health status: can the WABA/phone send right now and what is limiting it (payment, verification, quality, limits).", { phoneNumberId: z.string().optional(), wabaId: z.string().optional() }, guarded(async ({ phoneNumberId, wabaId }) => {
    const pn = phoneNumberId ?? (await firstPhone(waba(wabaId)));
    return client.get(pn, { fields: "id,display_phone_number,health_status,quality_rating,messaging_limit_tier,status,code_verification_status,name_status,throughput" });
  }));
};
