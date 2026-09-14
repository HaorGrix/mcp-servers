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
};
