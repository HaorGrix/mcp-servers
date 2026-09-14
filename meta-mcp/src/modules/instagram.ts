/** Instagram Professional account: profile, media, insights, publishing (feed/carousel/Reels/Stories), comments, hashtags, mentions, product tagging, DMs. */
import { z } from "zod";
import type { Register } from "../context.js";
import { guarded } from "../respond.js";
import { assertConfirmed, assertWrites, resolveId } from "../guard.js";

const MEDIA_FIELDS = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,is_comment_enabled,username,children{id,media_type,media_url}";

export const registerInstagram: Register = ({ server, client, config }) => {
  const ig = (id?: string) => resolveId(id, config.defaults.igUserId, "igUserId", "META_IG_USER_ID");
  const requireIg = () => client.requireScopes("instagram_basic");

  // ── Profile & media ───────────────────────────────────────────────────────
  server.tool("meta_ig_profile", "IG professional account profile: followers, following, media count, bio, website.", { igUserId: z.string().optional() }, guarded(async ({ igUserId }) => {
    await requireIg();
    return client.get(ig(igUserId), { fields: "id,username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count,ig_id" });
  }));

  server.tool("meta_ig_media", "Recent media with engagement counts. Includes Reels and carousels.", { igUserId: z.string().optional(), limit: z.number().optional(), since: z.string().optional(), until: z.string().optional() }, guarded(async ({ igUserId, limit, since, until }) => {
    await requireIg();
    return client.getAll(`${ig(igUserId)}/media`, { fields: MEDIA_FIELDS, limit: limit ?? 25, since, until }, {}, Math.ceil((limit ?? 25) / 100) || 1);
  }));

  server.tool("meta_ig_media_get", "One media item with full fields.", { mediaId: z.string() }, guarded(async ({ mediaId }) => client.get(mediaId, { fields: MEDIA_FIELDS + ",owner,shortcode,boost_eligibility_info" })));

  server.tool("meta_ig_stories", "Currently live Stories (24h).", { igUserId: z.string().optional() }, guarded(async ({ igUserId }) => client.getAll(`${ig(igUserId)}/stories`, { fields: "id,media_type,media_url,permalink,timestamp" })));

  server.tool("meta_ig_media_update", "Enable/disable comments on a media item.", { mediaId: z.string(), commentEnabled: z.boolean() }, guarded(async ({ mediaId, commentEnabled }) => {
    assertWrites(config, "Update media");
    return client.post(mediaId, { comment_enabled: commentEnabled });
  }));

  server.tool("meta_ig_media_delete", "Delete an IG media item. Requires confirm=true.", { mediaId: z.string(), confirm: z.boolean().optional() }, guarded(async ({ mediaId, confirm }) => {
    assertConfirmed(config, confirm, "Delete IG media");
    return client.delete(mediaId);
  }));

  // ── Insights ──────────────────────────────────────────────────────────────
  server.tool(
    "meta_ig_account_insights",
    "Account insights. Time series metrics (period day): reach, follower_count. Total-value metrics (metric_type=total_value): impressions, profile_views, accounts_engaged, total_interactions, likes, comments, shares, saves, replies, follows_and_unfollows, website_clicks, profile_links_taps. Demographics: follower_demographics / engaged_audience_demographics with breakdown age|gender|city|country.",
    { igUserId: z.string().optional(), metrics: z.array(z.string()).optional(), period: z.enum(["day", "week", "days_28", "lifetime"]).optional(), metricType: z.enum(["time_series", "total_value"]).optional(), breakdown: z.string().optional(), since: z.string().optional(), until: z.string().optional() },
    guarded(async ({ igUserId, metrics, period, metricType, breakdown, since, until }) => {
      await client.requireScopes("instagram_manage_insights");
      const m = metrics ?? ["reach", "follower_count"];
      return client.get(`${ig(igUserId)}/insights`, { metric: m.join(","), period: period ?? "day", metric_type: metricType, breakdown, since, until });
    }),
  );

  server.tool("meta_ig_snapshot", "Compact summary: profile, 28-day reach/impressions/profile views/engaged accounts, follower demographics, top recent posts.", { igUserId: z.string().optional() }, guarded(async ({ igUserId }) => {
    const id = ig(igUserId);
    const totals = (metric: string, extra: Record<string, string> = {}) => client.get<{ data: Array<{ name: string; total_value?: { value: number } }> }>(`${id}/insights`, { metric, period: "day", metric_type: "total_value", ...extra }).then((r) => Object.fromEntries(r.data.map((d) => [d.name, d.total_value?.value ?? null]))).catch((e: Error) => ({ error: e.message }));
    const [profile, totals28, reach, demo, media] = await Promise.all([
      client.get(id, { fields: "id,username,followers_count,follows_count,media_count" }),
      totals("reach,profile_views,accounts_engaged,total_interactions,likes,comments,shares,saves,website_clicks", { since: String(Math.floor(Date.now() / 1000) - 28 * 86400) }),
      client.get(`${id}/insights`, { metric: "reach", period: "days_28" }).catch(() => null),
      client.get(`${id}/insights`, { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown: "country" }).catch(() => null),
      client.get<{ data: Array<Record<string, unknown>> }>(`${id}/media`, { fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count", limit: 20 }),
    ]);
    return { profile, last28Days: totals28, reach28: reach, followerCountries: demo, recentMedia: media.data };
  }));

  server.tool("meta_ig_media_insights", "Insights for one media item. Feed/carousel: impressions, reach, saved, likes, comments, shares, total_interactions. Reels: plays, reach, likes, comments, shares, saved, total_interactions, ig_reels_avg_watch_time. Story: impressions, reach, replies, navigation.", { mediaId: z.string(), metrics: z.array(z.string()).optional(), breakdown: z.string().optional() }, guarded(async ({ mediaId, metrics, breakdown }) => {
    await client.requireScopes("instagram_manage_insights");
    const m = metrics ?? ["reach", "saved", "likes", "comments", "shares", "total_interactions"];
    return client.get(`${mediaId}/insights`, { metric: m.join(","), breakdown });
  }));

  server.tool("meta_ig_publishing_limit", "How many posts published via API in the last 24h vs the 50/day quota.", { igUserId: z.string().optional() }, guarded(async ({ igUserId }) => client.get(`${ig(igUserId)}/content_publishing_limit`, { fields: "config,quota_usage" })));

  // ── Publishing ────────────────────────────────────────────────────────────
  server.tool(
    "meta_ig_publish",
    "Publish to Instagram: single image, single video/Reel, Story, or carousel (2-10 items). Media must be on a public URL. Creates the container(s), waits for processing, then publishes. Optionally tag products from a catalog, add a location, or set a cover/thumb offset for Reels.",
    {
      igUserId: z.string().optional(),
      kind: z.enum(["image", "reel", "story_image", "story_video", "carousel"]),
      caption: z.string().optional(),
      imageUrl: z.string().optional(),
      videoUrl: z.string().optional(),
      carousel: z.array(z.object({ imageUrl: z.string().optional(), videoUrl: z.string().optional() })).min(2).max(10).optional(),
      coverUrl: z.string().optional(),
      thumbOffsetMs: z.number().optional(),
      shareToFeed: z.boolean().optional().describe("Reels only; default true"),
      locationId: z.string().optional(),
      userTags: z.array(z.object({ username: z.string(), x: z.number().optional(), y: z.number().optional() })).optional(),
      productTags: z.array(z.object({ product_id: z.string(), x: z.number().optional(), y: z.number().optional() })).optional(),
      collaborators: z.array(z.string()).optional(),
      confirm: z.boolean().optional(),
    },
    guarded(async (a) => {
      assertConfirmed(config, a.confirm, "Publish to Instagram");
      await client.requireScopes("instagram_content_publish");
      const id = ig(a.igUserId);
      const common: Record<string, unknown> = { caption: a.caption, location_id: a.locationId, user_tags: a.userTags, product_tags: a.productTags, collaborators: a.collaborators };

      const waitReady = async (containerId: string): Promise<void> => {
        for (let i = 0; i < 40; i += 1) {
          const s = await client.get<{ status_code: string; status?: string }>(containerId, { fields: "status_code,status" });
          if (s.status_code === "FINISHED") return;
          if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Container ${containerId} ${s.status_code}: ${s.status ?? ""}`);
          await new Promise((r) => setTimeout(r, 3000));
        }
        throw new Error(`Container ${containerId} still processing after 2 minutes; publish it later with meta_ig_publish_container.`);
      };

      let containerId: string;
      if (a.kind === "carousel") {
        if (!a.carousel) throw new Error("carousel items required");
        const children: string[] = [];
        for (const item of a.carousel) {
          const c = await client.post<{ id: string }>(`${id}/media`, item.videoUrl ? { video_url: item.videoUrl, media_type: "VIDEO", is_carousel_item: true } : { image_url: item.imageUrl, is_carousel_item: true });
          await waitReady(c.id);
          children.push(c.id);
        }
        containerId = (await client.post<{ id: string }>(`${id}/media`, { media_type: "CAROUSEL", children: children.join(","), ...common })).id;
      } else if (a.kind === "image") {
        if (!a.imageUrl) throw new Error("imageUrl required");
        containerId = (await client.post<{ id: string }>(`${id}/media`, { image_url: a.imageUrl, ...common })).id;
      } else if (a.kind === "reel") {
        if (!a.videoUrl) throw new Error("videoUrl required");
        containerId = (await client.post<{ id: string }>(`${id}/media`, { media_type: "REELS", video_url: a.videoUrl, cover_url: a.coverUrl, thumb_offset: a.thumbOffsetMs, share_to_feed: a.shareToFeed ?? true, ...common })).id;
      } else {
        const body = a.kind === "story_image" ? { media_type: "STORIES", image_url: a.imageUrl } : { media_type: "STORIES", video_url: a.videoUrl };
        containerId = (await client.post<{ id: string }>(`${id}/media`, body)).id;
      }
      await waitReady(containerId);
      const published = await client.post<{ id: string }>(`${id}/media_publish`, { creation_id: containerId });
      const media = await client.get<Record<string, unknown>>(published.id, { fields: "id,permalink,media_type,timestamp" }).catch(() => ({ id: published.id }));
      return { containerId, ...media };
    }),
  );

  server.tool("meta_ig_publish_container", "Publish a previously created container once its status is FINISHED.", { igUserId: z.string().optional(), containerId: z.string(), confirm: z.boolean().optional() }, guarded(async ({ igUserId, containerId, confirm }) => {
    assertConfirmed(config, confirm, "Publish container");
    return client.post(`${ig(igUserId)}/media_publish`, { creation_id: containerId });
  }));

  server.tool("meta_ig_container_status", "Processing status of a media container.", { containerId: z.string() }, guarded(async ({ containerId }) => client.get(containerId, { fields: "id,status_code,status" })));

  // ── Comments ──────────────────────────────────────────────────────────────
  server.tool("meta_ig_comments", "Comments on a media item (with replies).", { mediaId: z.string(), limit: z.number().optional() }, guarded(async ({ mediaId, limit }) => {
    await client.requireScopes("instagram_manage_comments");
    return client.getAll(`${mediaId}/comments`, { fields: "id,text,username,from,timestamp,like_count,hidden,replies{id,text,username,timestamp,hidden}", limit: limit ?? 50 }, {}, 1);
  }));

  server.tool("meta_ig_comment_reply", "Reply to an IG comment.", { commentId: z.string(), message: z.string() }, guarded(async ({ commentId, message }) => {
    assertWrites(config, "IG comment reply");
    return client.post(`${commentId}/replies`, { message });
  }));

  server.tool("meta_ig_comment_create", "Post a top-level comment on a media item as the account.", { mediaId: z.string(), message: z.string() }, guarded(async ({ mediaId, message }) => {
    assertWrites(config, "IG comment");
    return client.post(`${mediaId}/comments`, { message });
  }));

  server.tool("meta_ig_comment_hide", "Hide or unhide a comment.", { commentId: z.string(), hidden: z.boolean() }, guarded(async ({ commentId, hidden }) => {
    assertWrites(config, "Hide IG comment");
    return client.post(commentId, { hide: hidden });
  }));

  server.tool("meta_ig_comment_delete", "Delete an IG comment. Requires confirm=true.", { commentId: z.string(), confirm: z.boolean().optional() }, guarded(async ({ commentId, confirm }) => {
    assertConfirmed(config, confirm, "Delete IG comment");
    return client.delete(commentId);
  }));

  // ── Discovery ─────────────────────────────────────────────────────────────
  server.tool("meta_ig_hashtag_search", "Look up a hashtag id, then its recent and top media.", { igUserId: z.string().optional(), hashtag: z.string(), which: z.enum(["recent", "top"]).optional(), limit: z.number().optional() }, guarded(async ({ igUserId, hashtag, which, limit }) => {
    const id = ig(igUserId);
    const found = await client.get<{ data: Array<{ id: string }> }>("ig_hashtag_search", { user_id: id, q: hashtag.replace(/^#/, "") });
    const hid = found.data[0]?.id;
    if (!hid) return { hashtag, found: false };
    const media = await client.get(`${hid}/${which === "top" ? "top_media" : "recent_media"}`, { user_id: id, fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count", limit: limit ?? 25 });
    return { hashtagId: hid, media };
  }));

  server.tool("meta_ig_tagged_and_mentions", "Media where the account is tagged, plus recently mentioned-in comments/captions.", { igUserId: z.string().optional(), limit: z.number().optional() }, guarded(async ({ igUserId, limit }) => {
    const id = ig(igUserId);
    const [tags, mentions] = await Promise.all([
      client.getAll(`${id}/tags`, { fields: "id,caption,media_type,permalink,timestamp,username,like_count,comments_count", limit: limit ?? 25 }, {}, 1),
      client.get(id, { fields: "mentioned_media.limit(0)" }).catch(() => null),
    ]);
    return { taggedIn: tags, mentionsNote: mentions ? "Use meta_ig_mentioned_media with a media id from webhooks to inspect a mention." : undefined };
  }));

  server.tool("meta_ig_business_discovery", "Public profile + recent media of any other business/creator account by username (competitor lookup).", { igUserId: z.string().optional(), username: z.string(), mediaLimit: z.number().optional() }, guarded(async ({ igUserId, username, mediaLimit }) =>
    client.get(ig(igUserId), { fields: `business_discovery.username(${username}){id,username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,media.limit(${mediaLimit ?? 10}){id,caption,media_type,permalink,timestamp,like_count,comments_count}}` }),
  ));

  server.tool("meta_ig_product_tag_eligibility", "Catalogs available for product tagging and whether the account is shopping-enabled.", { igUserId: z.string().optional() }, guarded(async ({ igUserId }) => {
    await client.requireScopes("instagram_shopping_tag_products");
    return client.get(`${ig(igUserId)}/available_catalogs`, { fields: "catalog_id,catalog_name,shop_name,product_count" });
  }));

  server.tool("meta_ig_catalog_product_search", "Search products in the account's tagging catalog (for product_tags in meta_ig_publish).", { igUserId: z.string().optional(), catalogId: z.string(), query: z.string().optional() }, guarded(async ({ igUserId, catalogId, query }) =>
    client.get(`${ig(igUserId)}/catalog_product_search`, { catalog_id: catalogId, q: query, fields: "product_id,merchant_id,product_name,image_url,retailer_id,review_status,is_checkout_flow" }),
  ));

  // ── Branded content ───────────────────────────────────────────────────────
  server.tool("meta_ig_branded_content_settings", "Branded content: whether creators need approval to tag this brand, and the approved creator list.", { igUserId: z.string().optional() }, guarded(async ({ igUserId }) => {
    await client.requireScopes("instagram_branded_content_brand");
    return client.get(`${ig(igUserId)}/branded_content_advertisable_medias`, { fields: "id,permalink" }).catch(async () => client.get(ig(igUserId), { fields: "branded_content_ad_settings" }));
  }));

  server.tool("meta_ig_branded_content_approvals", "List / add / remove creators approved to tag this account as a brand partner.", { igUserId: z.string().optional(), action: z.enum(["list", "add", "remove"]), creatorUsername: z.string().optional() }, guarded(async ({ igUserId, action, creatorUsername }) => {
    const id = ig(igUserId);
    if (action === "list") return client.get(`${id}/branded_content_tag_approval`, {});
    assertWrites(config, "Branded content approval");
    if (!creatorUsername) throw new Error("creatorUsername required");
    return action === "add" ? client.post(`${id}/branded_content_tag_approval`, { creator_username: creatorUsername }) : client.delete(`${id}/branded_content_tag_approval`, { creator_username: creatorUsername });
  }));

  // ── Direct messages ───────────────────────────────────────────────────────
  server.tool(
    "meta_ig_dm_send",
    "Send an Instagram DM to an IGSID (from a conversation via meta_inbox_conversations platform=instagram). Text, image by URL, or a reaction / quick replies. Sent via the linked Page.",
    { pageId: z.string().optional(), recipientId: z.string(), text: z.string().optional(), imageUrl: z.string().optional(), quickReplies: z.array(z.object({ title: z.string(), payload: z.string() })).optional(), humanAgentTag: z.boolean().optional().describe("Use HUMAN_AGENT tag to reply within 7 days instead of 24h"), confirm: z.boolean().optional() },
    guarded(async ({ pageId, recipientId, text, imageUrl, quickReplies, humanAgentTag, confirm }) => {
      assertConfirmed(config, confirm, "Send IG DM");
      await client.requireScopes("instagram_manage_messages");
      const p = resolveId(pageId, config.defaults.pageId, "pageId", "META_PAGE_ID");
      const opts = { token: await client.pageToken(p) };
      const message: Record<string, unknown> = imageUrl ? { attachment: { type: "image", payload: { url: imageUrl } } } : { text };
      if (quickReplies?.length) message["quick_replies"] = quickReplies.map((q) => ({ content_type: "text", ...q }));
      return client.post(`${p}/messages`, { recipient: { id: recipientId }, message, ...(humanAgentTag ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {}) }, opts);
    }),
  );

  server.tool("meta_ig_dm_ice_breakers", "Get or set Instagram DM ice breakers (the suggested questions new users see).", { pageId: z.string().optional(), iceBreakers: z.array(z.object({ question: z.string(), payload: z.string() })).optional() }, guarded(async ({ pageId, iceBreakers }) => {
    const p = resolveId(pageId, config.defaults.pageId, "pageId", "META_PAGE_ID");
    const opts = { token: await client.pageToken(p) };
    if (!iceBreakers) return client.get(`${p}/messenger_profile`, { fields: "ice_breakers", platform: "instagram" }, opts);
    assertWrites(config, "Set IG ice breakers");
    return client.post(`${p}/messenger_profile`, { platform: "instagram", ice_breakers: [{ locale: "default", call_to_actions: iceBreakers }] }, opts);
  }));

  // ── Mentions, Live, misc ──────────────────────────────────────────────────
  server.tool("meta_ig_mentioned_media", "Inspect a media item or comment where the account was @mentioned (ids arrive via the 'mentions' webhook).", { igUserId: z.string().optional(), mediaId: z.string().optional(), commentId: z.string().optional() }, guarded(async ({ igUserId, mediaId, commentId }) => {
    const id = ig(igUserId);
    if (commentId) return client.get(id, { fields: `mentioned_comment.comment_id(${commentId}){id,text,username,timestamp,like_count,media{id,permalink}}` });
    if (mediaId) return client.get(id, { fields: `mentioned_media.media_id(${mediaId}){id,caption,media_type,permalink,username,timestamp,like_count,comments_count}` });
    throw new Error("mediaId or commentId required");
  }));

  server.tool("meta_ig_mention_reply", "Reply to a caption mention (comment on the media) or a comment mention.", { igUserId: z.string().optional(), mediaId: z.string(), commentId: z.string().optional(), message: z.string() }, guarded(async ({ igUserId, mediaId, commentId, message }) => {
    assertWrites(config, "Mention reply");
    return client.post(`${ig(igUserId)}/mentions`, { media_id: mediaId, comment_id: commentId, message });
  }));

  server.tool("meta_ig_live_media", "Live broadcasts currently running on the account (for reading live comments).", { igUserId: z.string().optional() }, guarded(async ({ igUserId }) => client.getAll(`${ig(igUserId)}/live_media`, { fields: "id,media_type,permalink,timestamp,comments_count" })));

  server.tool("meta_ig_live_comments", "Comments on a live broadcast (polled).", { liveMediaId: z.string(), limit: z.number().optional() }, guarded(async ({ liveMediaId, limit }) => client.getAll(`${liveMediaId}/comments`, { fields: "id,text,username,timestamp", limit: limit ?? 50 }, {}, 1)));

  server.tool("meta_ig_recent_hashtags", "Hashtags the account searched via the API in the last 7 days (30/week limit).", { igUserId: z.string().optional() }, guarded(async ({ igUserId }) => client.getAll(`${ig(igUserId)}/recently_searched_hashtags`, { fields: "id,name" })));

  server.tool("meta_ig_comment_private_reply", "Send a private DM in reply to a comment on a post or ad (opens a conversation, 7-day window).", { pageId: z.string().optional(), commentId: z.string(), text: z.string(), confirm: z.boolean().optional() }, guarded(async ({ pageId, commentId, text, confirm }) => {
    assertConfirmed(config, confirm, "IG private reply");
    await client.requireScopes("instagram_manage_messages");
    const p = resolveId(pageId, config.defaults.pageId, "pageId", "META_PAGE_ID");
    return client.post(`${p}/messages`, { recipient: { comment_id: commentId }, message: { text } }, { token: await client.pageToken(p) });
  }));

  server.tool("meta_ig_dm_reaction", "React to (or unreact from) an Instagram DM.", { pageId: z.string().optional(), recipientId: z.string(), messageId: z.string(), reaction: z.string().optional().describe("e.g. love; omit to unreact") }, guarded(async ({ pageId, recipientId, messageId, reaction }) => {
    assertWrites(config, "IG DM reaction");
    const p = resolveId(pageId, config.defaults.pageId, "pageId", "META_PAGE_ID");
    return client.post(`${p}/messages`, { recipient: { id: recipientId }, sender_action: reaction ? "react" : "unreact", payload: { message_id: messageId, reaction } }, { token: await client.pageToken(p) });
  }));

  server.tool("meta_ig_dm_persistent_menu", "Get or set the Instagram DM persistent menu.", { pageId: z.string().optional(), menu: z.array(z.object({ type: z.enum(["web_url", "postback"]), title: z.string(), url: z.string().optional(), payload: z.string().optional() })).optional() }, guarded(async ({ pageId, menu }) => {
    const p = resolveId(pageId, config.defaults.pageId, "pageId", "META_PAGE_ID");
    const opts = { token: await client.pageToken(p) };
    if (!menu) return client.get(`${p}/messenger_profile`, { fields: "persistent_menu", platform: "instagram" }, opts);
    assertWrites(config, "IG persistent menu");
    return client.post(`${p}/messenger_profile`, { platform: "instagram", persistent_menu: [{ locale: "default", call_to_actions: menu }] }, opts);
  }));

  server.tool("meta_ig_partnership_ad_permissions", "Creators who have allowed this brand to run partnership (formerly branded content) ads with their content; or request/remove permission.", { igUserId: z.string().optional(), action: z.enum(["list", "request", "remove"]).optional(), creatorIgId: z.string().optional() }, guarded(async ({ igUserId, action, creatorIgId }) => {
    const id = ig(igUserId);
    if (!action || action === "list") return client.get(`${id}/branded_content_ad_permissions`, { fields: "id,username,permission_status" }).catch(async () => client.get(`${id}/branded_content_ad_permissions`, {}));
    assertWrites(config, "Partnership ad permission");
    if (!creatorIgId) throw new Error("creatorIgId required");
    return action === "request" ? client.post(`${id}/branded_content_ad_permissions`, { creator_instagram_account: creatorIgId }) : client.delete(`${id}/branded_content_ad_permissions`, { creator_instagram_account: creatorIgId });
  }));

  server.tool("meta_ig_boost_eligibility", "Whether a media item can be boosted as an ad and why not if not.", { mediaId: z.string() }, guarded(async ({ mediaId }) => client.get(mediaId, { fields: "id,boost_eligibility_info,boost_ads_list" })));

  server.tool("meta_ig_media_children", "Items inside a carousel.", { mediaId: z.string() }, guarded(async ({ mediaId }) => client.getAll(`${mediaId}/children`, { fields: "id,media_type,media_url,thumbnail_url,permalink,timestamp" })));

  server.tool("meta_ig_insights_online_followers", "When followers are online (hour-of-day histogram, lifetime).", { igUserId: z.string().optional() }, guarded(async ({ igUserId }) => client.get(`${ig(igUserId)}/insights`, { metric: "online_followers", period: "lifetime" })));

  server.tool("meta_ig_conversations", "Instagram DM threads via the linked Page (shortcut for meta_inbox_conversations platform=instagram), optionally for one user.", { pageId: z.string().optional(), userId: z.string().optional(), limit: z.number().optional() }, guarded(async ({ pageId, userId, limit }) => {
    const p = resolveId(pageId, config.defaults.pageId, "pageId", "META_PAGE_ID");
    return client.getAll(`${p}/conversations`, { platform: "instagram", user_id: userId, fields: "id,participants,updated_time,unread_count,message_count,messages.limit(3){message,from,created_time}", limit: limit ?? 25 }, { token: await client.pageToken(p) }, 1);
  }));
};
