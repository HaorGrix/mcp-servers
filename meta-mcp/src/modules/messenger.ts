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
};
