/** Messenger Platform: inbox, sending, labels, messenger profile, handover, Meta Inbox view. */
import { z } from "zod";
import type { Register } from "../context.js";
import { guarded } from "../respond.js";
import { assertConfirmed, assertWrites, resolveId } from "../guard.js";

const MESSAGE_TAG = z.enum(["CONFIRMED_EVENT_UPDATE", "POST_PURCHASE_UPDATE", "ACCOUNT_UPDATE", "HUMAN_AGENT"]);

export const registerMessenger: Register = ({ server, client, config }) => {
  const withPage = async (id?: string) => {
    const p = resolveId(id, config.defaults.pageId, "pageId", "META_PAGE_ID");
    return { p, opts: { token: await client.pageToken(p) } };
  };

  server.tool(
    "meta_inbox_conversations",
    "Unified inbox: Messenger conversations (platform=messenger) or Instagram DMs (platform=instagram) for the Page, with participants, unread count and last message.",
    { pageId: z.string().optional(), platform: z.enum(["messenger", "instagram"]).optional(), folder: z.enum(["inbox", "other", "page_done", "spam", "pending"]).optional(), limit: z.number().optional() },
    guarded(async ({ pageId, platform, folder, limit }) => {
      await client.requireScopes("pages_messaging");
      const { p, opts } = await withPage(pageId);
      return client.getAll(`${p}/conversations`, {
        platform: platform ?? "messenger", folder,
        fields: "id,participants,senders,updated_time,unread_count,message_count,can_reply,snippet,link,messages.limit(1){message,from,created_time}",
        limit: limit ?? 25,
      }, opts, 1);
    }),
  );

  server.tool("meta_inbox_messages", "Messages in one conversation (either platform).", { conversationId: z.string(), pageId: z.string().optional(), limit: z.number().optional() }, guarded(async ({ conversationId, pageId, limit }) => {
    const { opts } = await withPage(pageId);
    return client.getAll(`${conversationId}/messages`, { fields: "id,message,from,to,created_time,attachments{name,mime_type,file_url,image_data},sticker,shares,tags", limit: limit ?? 50 }, opts, 1);
  }));

  server.tool(
    "meta_messenger_send",
    "Send a Messenger message to a PSID (recipient). Inside the 24h window use RESPONSE; outside it you must supply a message tag. Supports text, image/video/file by URL, quick replies, and generic-template buttons.",
    {
      pageId: z.string().optional(),
      recipientId: z.string().describe("PSID of the user"),
      text: z.string().optional(),
      attachmentUrl: z.string().optional(),
      attachmentType: z.enum(["image", "video", "audio", "file"]).optional(),
      quickReplies: z.array(z.object({ title: z.string(), payload: z.string() })).optional(),
      buttons: z.array(z.object({ type: z.enum(["web_url", "postback"]), title: z.string(), url: z.string().optional(), payload: z.string().optional() })).optional(),
      messagingType: z.enum(["RESPONSE", "UPDATE", "MESSAGE_TAG"]).optional(),
      tag: MESSAGE_TAG.optional(),
      confirm: z.boolean().optional(),
    },
    guarded(async ({ pageId, recipientId, text, attachmentUrl, attachmentType, quickReplies, buttons, messagingType, tag, confirm }) => {
      assertConfirmed(config, confirm, "Send Messenger message");
      await client.requireScopes("pages_messaging");
      const { p, opts } = await withPage(pageId);
      let message: Record<string, unknown>;
      if (buttons?.length) {
        message = { attachment: { type: "template", payload: { template_type: "button", text: text ?? "", buttons } } };
      } else if (attachmentUrl) {
        message = { attachment: { type: attachmentType ?? "image", payload: { url: attachmentUrl, is_reusable: true } } };
      } else if (text) {
        message = { text };
      } else throw new Error("Provide text, attachmentUrl or buttons.");
      if (quickReplies?.length) message["quick_replies"] = quickReplies.map((q) => ({ content_type: "text", ...q }));
      return client.post(`${p}/messages`, { recipient: { id: recipientId }, message, messaging_type: messagingType ?? (tag ? "MESSAGE_TAG" : "RESPONSE"), tag }, opts);
    }),
  );

  server.tool("meta_messenger_sender_action", "Mark seen / typing on / typing off for a recipient.", { pageId: z.string().optional(), recipientId: z.string(), action: z.enum(["mark_seen", "typing_on", "typing_off"]) }, guarded(async ({ pageId, recipientId, action }) => {
    assertWrites(config, "Sender action");
    const { p, opts } = await withPage(pageId);
    return client.post(`${p}/messages`, { recipient: { id: recipientId }, sender_action: action }, opts);
  }));

  server.tool("meta_messenger_user_profile", "Profile of a PSID: name, picture, locale, timezone.", { pageId: z.string().optional(), psid: z.string() }, guarded(async ({ pageId, psid }) => {
    const { opts } = await withPage(pageId);
    return client.get(psid, { fields: "id,name,first_name,last_name,profile_pic,locale,timezone,gender" }, opts);
  }));

  server.tool("meta_messenger_profile_get", "Messenger profile: greeting, get-started, persistent menu, ice breakers, whitelisted domains.", { pageId: z.string().optional() }, guarded(async ({ pageId }) => {
    const { p, opts } = await withPage(pageId);
    return client.get(`${p}/messenger_profile`, { fields: "greeting,get_started,persistent_menu,ice_breakers,whitelisted_domains,account_linking_url" }, opts);
  }));

  server.tool(
    "meta_messenger_profile_set",
    "Set Messenger profile elements: greeting text, get-started payload, persistent menu, ice breakers, whitelisted domains.",
    {
      pageId: z.string().optional(),
      greeting: z.string().optional(),
      getStartedPayload: z.string().optional(),
      persistentMenu: z.array(z.object({ type: z.enum(["web_url", "postback"]), title: z.string(), url: z.string().optional(), payload: z.string().optional() })).optional(),
      iceBreakers: z.array(z.object({ question: z.string(), payload: z.string() })).optional(),
      whitelistedDomains: z.array(z.string()).optional(),
    },
    guarded(async ({ pageId, greeting, getStartedPayload, persistentMenu, iceBreakers, whitelistedDomains }) => {
      assertWrites(config, "Messenger profile");
      const { p, opts } = await withPage(pageId);
      const body: Record<string, unknown> = {};
      if (greeting) body["greeting"] = [{ locale: "default", text: greeting }];
      if (getStartedPayload) body["get_started"] = { payload: getStartedPayload };
      if (persistentMenu) body["persistent_menu"] = [{ locale: "default", composer_input_disabled: false, call_to_actions: persistentMenu }];
      if (iceBreakers) body["ice_breakers"] = [{ locale: "default", call_to_actions: iceBreakers }];
      if (whitelistedDomains) body["whitelisted_domains"] = whitelistedDomains;
      return client.post(`${p}/messenger_profile`, body, opts);
    }),
  );

  server.tool("meta_messenger_profile_delete", "Remove Messenger profile fields (e.g. persistent_menu, ice_breakers). Requires confirm=true.", { pageId: z.string().optional(), fields: z.array(z.string()).min(1), confirm: z.boolean().optional() }, guarded(async ({ pageId, fields, confirm }) => {
    assertConfirmed(config, confirm, "Delete messenger profile fields");
    const { p, opts } = await withPage(pageId);
    return client.delete(`${p}/messenger_profile`, { fields: JSON.stringify(fields) }, opts);
  }));

  server.tool("meta_messenger_labels", "Custom labels for the Page (used to tag conversations).", { pageId: z.string().optional() }, guarded(async ({ pageId }) => {
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/custom_labels`, { fields: "id,page_label_name" }, opts);
  }));

  server.tool("meta_messenger_label_create", "Create a custom label.", { pageId: z.string().optional(), name: z.string() }, guarded(async ({ pageId, name }) => {
    assertWrites(config, "Create label");
    const { p, opts } = await withPage(pageId);
    return client.post(`${p}/custom_labels`, { page_label_name: name }, opts);
  }));

  server.tool("meta_messenger_label_user", "Attach or detach a label to/from a PSID.", { pageId: z.string().optional(), labelId: z.string(), psid: z.string(), attach: z.boolean() }, guarded(async ({ pageId, labelId, psid, attach }) => {
    assertWrites(config, "Label user");
    const { opts } = await withPage(pageId);
    return attach ? client.post(`${labelId}/label`, { user: psid }, opts) : client.delete(`${labelId}/label`, { user: psid }, opts);
  }));

  server.tool("meta_messenger_handover", "Pass thread control to another app (e.g. Page Inbox 263902037430900) or take it back.", { pageId: z.string().optional(), psid: z.string(), action: z.enum(["pass", "take"]), targetAppId: z.string().optional(), metadata: z.string().optional() }, guarded(async ({ pageId, psid, action, targetAppId, metadata }) => {
    assertWrites(config, "Handover");
    const { p, opts } = await withPage(pageId);
    const edge = action === "pass" ? "pass_thread_control" : "take_thread_control";
    return client.post(`${p}/${edge}`, { recipient: { id: psid }, target_app_id: action === "pass" ? (targetAppId ?? "263902037430900") : undefined, metadata }, opts);
  }));

  server.tool("meta_messenger_subscribed_apps", "Apps subscribed to this Page's webhooks and their fields.", { pageId: z.string().optional() }, guarded(async ({ pageId }) => {
    const { p, opts } = await withPage(pageId);
    return client.get(`${p}/subscribed_apps`, { fields: "id,name,subscribed_fields" }, opts);
  }));

  // ── Rich sends & attachments ──────────────────────────────────────────────
  server.tool("meta_messenger_upload_attachment", "Upload a reusable attachment (by URL or local file) and get an attachment_id to reuse in sends.", { pageId: z.string().optional(), type: z.enum(["image", "video", "audio", "file"]), url: z.string().optional(), filePath: z.string().optional() }, guarded(async ({ pageId, type, url, filePath }) => {
    assertWrites(config, "Upload attachment");
    const { p, opts } = await withPage(pageId);
    if (filePath) return client.upload(`${p}/message_attachments`, filePath, "filedata", { message: { attachment: { type, payload: { is_reusable: true } } } }, opts);
    return client.post(`${p}/message_attachments`, { message: { attachment: { type, payload: { url, is_reusable: true } } } }, opts);
  }));

  server.tool(
    "meta_messenger_send_template",
    "Send a structured template: generic (carousel of cards with image/title/subtitle/buttons), media (image/video with buttons), receipt, or a raw template payload.",
    { pageId: z.string().optional(), recipientId: z.string(), template: z.enum(["generic", "media", "receipt", "raw"]), elements: z.array(z.record(z.unknown())).optional(), payload: z.record(z.unknown()).optional(), tag: MESSAGE_TAG.optional(), confirm: z.boolean().optional() },
    guarded(async ({ pageId, recipientId, template, elements, payload, tag, confirm }) => {
      assertConfirmed(config, confirm, "Send template");
      const { p, opts } = await withPage(pageId);
      const tpl = template === "raw" ? payload : { template_type: template, elements, ...(payload ?? {}) };
      return client.post(`${p}/messages`, { recipient: { id: recipientId }, message: { attachment: { type: "template", payload: tpl } }, messaging_type: tag ? "MESSAGE_TAG" : "RESPONSE", tag }, opts);
    }),
  );

  server.tool("meta_messenger_send_by_attachment_id", "Send a previously uploaded reusable attachment.", { pageId: z.string().optional(), recipientId: z.string(), type: z.enum(["image", "video", "audio", "file"]), attachmentId: z.string(), confirm: z.boolean().optional() }, guarded(async ({ pageId, recipientId, type, attachmentId, confirm }) => {
    assertConfirmed(config, confirm, "Send attachment");
    const { p, opts } = await withPage(pageId);
    return client.post(`${p}/messages`, { recipient: { id: recipientId }, message: { attachment: { type, payload: { attachment_id: attachmentId } } } }, opts);
  }));

  server.tool("meta_messenger_reaction", "React to or unreact from a message.", { pageId: z.string().optional(), recipientId: z.string(), messageId: z.string(), reaction: z.string().optional() }, guarded(async ({ pageId, recipientId, messageId, reaction }) => {
    assertWrites(config, "Reaction");
    const { p, opts } = await withPage(pageId);
    return client.post(`${p}/messages`, { recipient: { id: recipientId }, sender_action: reaction ? "react" : "unreact", payload: { message_id: messageId, reaction } }, opts);
  }));

  // ── Recurring notifications (re-engagement outside 24h) ──────────────────
  server.tool("meta_messenger_notification_optin_request", "Ask a user to opt in to recurring notifications (daily/weekly/monthly). Returns a notification_messages_token via webhook once they accept.", { pageId: z.string().optional(), recipientId: z.string(), title: z.string(), imageUrl: z.string().optional(), frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).default("WEEKLY"), payload: z.string().optional(), confirm: z.boolean().optional() }, guarded(async ({ pageId, recipientId, title, imageUrl, frequency, payload, confirm }) => {
    assertConfirmed(config, confirm, "Send opt-in request");
    const { p, opts } = await withPage(pageId);
    return client.post(`${p}/messages`, { recipient: { id: recipientId }, message: { attachment: { type: "template", payload: { template_type: "notification_messages", title, image_url: imageUrl, notification_messages_frequency: frequency, payload } } } }, opts);
  }));

  server.tool("meta_messenger_send_notification", "Send a recurring-notification message using an opt-in token (bypasses the 24h window until the token expires).", { pageId: z.string().optional(), notificationToken: z.string(), text: z.string().optional(), imageUrl: z.string().optional(), confirm: z.boolean().optional() }, guarded(async ({ pageId, notificationToken, text, imageUrl, confirm }) => {
    assertConfirmed(config, confirm, "Send notification");
    const { p, opts } = await withPage(pageId);
    const message = imageUrl ? { attachment: { type: "image", payload: { url: imageUrl } } } : { text };
    return client.post(`${p}/messages`, { recipient: { notification_messages_token: notificationToken }, message }, opts);
  }));

  // ── Handover & thread control ─────────────────────────────────────────────
  server.tool("meta_messenger_thread_owner", "Which app currently owns a conversation thread (handover protocol).", { pageId: z.string().optional(), psid: z.string() }, guarded(async ({ pageId, psid }) => {
    const { p, opts } = await withPage(pageId);
    return client.get(`${p}/thread_owner`, { recipient: psid }, opts);
  }));

  server.tool("meta_messenger_request_thread_control", "Ask the current thread owner app to hand a conversation to this app.", { pageId: z.string().optional(), psid: z.string(), metadata: z.string().optional() }, guarded(async ({ pageId, psid, metadata }) => {
    assertWrites(config, "Request thread control");
    const { p, opts } = await withPage(pageId);
    return client.post(`${p}/request_thread_control`, { recipient: { id: psid }, metadata }, opts);
  }));

  server.tool("meta_inbox_conversation_by_user", "Find the conversation with a specific PSID / IGSID.", { pageId: z.string().optional(), userId: z.string(), platform: z.enum(["messenger", "instagram"]).optional() }, guarded(async ({ pageId, userId, platform }) => {
    const { p, opts } = await withPage(pageId);
    return client.get(`${p}/conversations`, { user_id: userId, platform: platform ?? "messenger", fields: "id,updated_time,unread_count,message_count,messages.limit(5){message,from,created_time}" }, opts);
  }));

  server.tool("meta_messenger_delete_label", "Delete a custom label. Requires confirm=true.", { labelId: z.string(), pageId: z.string().optional(), confirm: z.boolean().optional() }, guarded(async ({ labelId, pageId, confirm }) => {
    assertConfirmed(config, confirm, "Delete label");
    const { opts } = await withPage(pageId);
    return client.delete(labelId, {}, opts);
  }));

  server.tool("meta_messenger_user_labels", "Labels attached to a PSID.", { psid: z.string(), pageId: z.string().optional() }, guarded(async ({ psid, pageId }) => {
    const { opts } = await withPage(pageId);
    return client.getAll(`${psid}/custom_labels`, { fields: "id,page_label_name" }, opts);
  }));
};
