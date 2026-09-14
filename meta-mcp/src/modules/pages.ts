/** Facebook Pages: profile, settings, roles, publishing, media, scheduling, comments, moderation, insights, events, live. */
import { z } from "zod";
import type { Register } from "../context.js";
import { guarded } from "../respond.js";
import { assertConfirmed, assertWrites, resolveId } from "../guard.js";

const PAGE_FIELDS =
  "id,name,username,about,description,category,category_list,fan_count,followers_count,link,website,phone,emails,location,hours,is_published,is_verified,verification_status,rating_count,overall_star_rating,talking_about_count,checkins,cover,picture{url},instagram_business_account{id,username},connected_instagram_account,whatsapp_number,messenger_ads_default_icebreakers,is_messenger_bot_get_started_enabled,page_token";

// Validated against Graph v23: page_impressions*, page_fans*, post_impressions*, post_engaged_users were removed by Meta.
const INSIGHT_METRICS_DEFAULT =
  "page_post_engagements,page_total_actions,page_actions_post_reactions_total,page_views_total,page_video_views,page_follows,page_daily_follows,page_daily_unfollows";
const POST_METRICS_DEFAULT = "post_clicks,post_reactions_by_type_total,post_video_views";

export const registerPages: Register = ({ server, client, config }) => {
  const pid = (id?: string) => resolveId(id, config.defaults.pageId, "pageId", "META_PAGE_ID");
  const withPage = async (id?: string) => {
    const p = pid(id);
    return { p, opts: { token: await client.pageToken(p) } };
  };

  // ── Read ──────────────────────────────────────────────────────────────────
  server.tool("meta_pages_list", "Pages the system user manages, with linked Instagram accounts.", {}, guarded(async () =>
    client.getAll("me/accounts", { fields: "id,name,category,fan_count,followers_count,is_published,instagram_business_account{id,username},tasks" }),
  ));

  server.tool("meta_page_get", "Full Page profile, contact, rating, verification, linked IG and WhatsApp.", { pageId: z.string().optional() }, guarded(async ({ pageId }) => {
    const { p, opts } = await withPage(pageId);
    const data = await client.get<Record<string, unknown>>(p, { fields: PAGE_FIELDS.replace(",page_token", "") }, opts);
    return data;
  }));

  server.tool(
    "meta_page_update",
    "Update Page profile fields: about, description, website, phone, emails, hours, username, category, cover/profile photo by URL.",
    {
      pageId: z.string().optional(),
      about: z.string().optional(),
      description: z.string().optional(),
      website: z.string().optional(),
      phone: z.string().optional(),
      emails: z.array(z.string()).optional(),
      hours: z.record(z.string()).optional().describe("e.g. {mon_1_open:'09:00',mon_1_close:'17:00'}"),
      coverPhotoUrl: z.string().optional(),
      profilePhotoUrl: z.string().optional(),
    },
    guarded(async ({ pageId, coverPhotoUrl, profilePhotoUrl, ...body }) => {
      assertWrites(config, "Page update");
      const { p, opts } = await withPage(pageId);
      const out: Record<string, unknown> = {};
      if (Object.values(body).some((v) => v !== undefined)) out["profile"] = await client.post(p, body, opts);
      if (coverPhotoUrl) out["cover"] = await client.post(`${p}/photos`, { url: coverPhotoUrl, published: false }, opts).then((r) => client.post(p, { cover: r.id }, opts));
      if (profilePhotoUrl) out["picture"] = await client.post(`${p}/picture`, { picture: profilePhotoUrl }, opts);
      return out;
    }),
  );

  server.tool("meta_page_roles", "People with roles on the Page (classic roles plus task-based access).", { pageId: z.string().optional() }, guarded(async ({ pageId }) => {
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/roles`, { fields: "id,name,tasks" }, opts);
  }));

  server.tool("meta_page_settings", "Page settings flags (messaging, reviews, age/country restrictions, etc.).", { pageId: z.string().optional() }, guarded(async ({ pageId }) => {
    const { p, opts } = await withPage(pageId);
    return client.get(`${p}/settings`, {}, opts);
  }));

  server.tool(
    "meta_page_update_setting",
    "Set a Page setting, e.g. USERS_CAN_POST, USERS_CAN_MESSAGE, PAGE_MODERATION_BLOCKLIST, SHOW_REVIEWS.",
    { pageId: z.string().optional(), setting: z.string(), value: z.union([z.boolean(), z.string(), z.array(z.string())]) },
    guarded(async ({ pageId, setting, value }) => {
      assertWrites(config, "Page setting");
      const { p, opts } = await withPage(pageId);
      return client.post(`${p}/settings`, { option: setting, value }, opts);
    }),
  );

  // ── Content ───────────────────────────────────────────────────────────────
  server.tool(
    "meta_page_posts",
    "Posts on the Page (published, scheduled, or all) with per-post reach, reactions, comments, shares.",
    { pageId: z.string().optional(), status: z.enum(["published", "scheduled", "drafts"]).optional(), limit: z.number().optional(), since: z.string().optional(), until: z.string().optional() },
    guarded(async ({ pageId, status, limit, since, until }) => {
      const { p, opts } = await withPage(pageId);
      const edge = status === "scheduled" ? "scheduled_posts" : status === "drafts" ? "promotable_posts" : "published_posts";
      const params: Record<string, string | number | undefined> = {
        fields: "id,message,story,created_time,scheduled_publish_time,permalink_url,status_type,is_published,attachments{media_type,url,title},shares,reactions.summary(true).limit(0),comments.summary(true).limit(0),insights.metric(post_clicks,post_reactions_by_type_total)",
        limit: limit ?? 25, since, until,
      };
      if (status === "drafts") params["is_published"] = "false";
      return client.getAll(`${p}/${edge}`, params, opts, Math.ceil((limit ?? 25) / 100) || 1);
    }),
  );

  server.tool("meta_page_post_get", "One post with full attachments, insights, comment and reaction counts.", { postId: z.string(), pageId: z.string().optional() }, guarded(async ({ postId, pageId }) => {
    const { opts } = await withPage(pageId);
    return client.get(postId, {
      fields: "id,message,story,created_time,permalink_url,is_published,scheduled_publish_time,attachments{media_type,url,title,description,subattachments},shares,reactions.summary(true).limit(0),comments.summary(true).limit(0),insights.metric(post_clicks,post_reactions_by_type_total,post_video_views)",
    }, opts);
  }));

  server.tool(
    "meta_page_publish_post",
    "Publish a text/link post now, or schedule it (10 min to 75 days out). Optionally attach up to 10 photos by URL, or one video by URL.",
    {
      pageId: z.string().optional(),
      message: z.string().optional(),
      link: z.string().optional(),
      photoUrls: z.array(z.string()).max(10).optional(),
      videoUrl: z.string().optional(),
      videoTitle: z.string().optional(),
      scheduledPublishTime: z.string().optional().describe("ISO 8601; sets the post as scheduled"),
      targetingCountries: z.array(z.string()).optional().describe("ISO country codes for audience restriction"),
    },
    guarded(async ({ pageId, message, link, photoUrls, videoUrl, videoTitle, scheduledPublishTime, targetingCountries }) => {
      assertWrites(config, "Publish post");
      const { p, opts } = await withPage(pageId);
      const schedule = scheduledPublishTime ? { published: false, scheduled_publish_time: Math.floor(new Date(scheduledPublishTime).getTime() / 1000) } : {};
      const targeting = targetingCountries?.length ? { targeting: { geo_locations: { countries: targetingCountries } } } : {};
      if (videoUrl) {
        return client.post(`${p}/videos`, { file_url: videoUrl, description: message, title: videoTitle, ...schedule }, { ...opts, host: `https://graph-video.facebook.com/${config.version}` });
      }
      if (photoUrls?.length === 1) {
        return client.post(`${p}/photos`, { url: photoUrls[0], message, ...schedule, ...targeting }, opts);
      }
      if (photoUrls && photoUrls.length > 1) {
        const ids = await Promise.all(photoUrls.map((url) => client.post<{ id: string }>(`${p}/photos`, { url, published: false, temporary: true }, opts)));
        return client.post(`${p}/feed`, { message, attached_media: ids.map((r) => ({ media_fbid: r.id })), ...schedule, ...targeting }, opts);
      }
      if (!message && !link) throw new Error("Provide message, link, photoUrls or videoUrl.");
      return client.post(`${p}/feed`, { message, link, ...schedule, ...targeting }, opts);
    }),
  );

  server.tool("meta_page_update_post", "Edit a post's message, or (un)pin it, or reschedule.", {
    postId: z.string(), pageId: z.string().optional(), message: z.string().optional(), isPinned: z.boolean().optional(), scheduledPublishTime: z.string().optional(), publishNow: z.boolean().optional(),
  }, guarded(async ({ postId, pageId, message, isPinned, scheduledPublishTime, publishNow }) => {
    assertWrites(config, "Update post");
    const { opts } = await withPage(pageId);
    const body: Record<string, unknown> = { message };
    if (isPinned !== undefined) body["is_pinned"] = isPinned;
    if (scheduledPublishTime) body["scheduled_publish_time"] = Math.floor(new Date(scheduledPublishTime).getTime() / 1000);
    if (publishNow) body["is_published"] = true;
    return client.post(postId, body, opts);
  }));

  server.tool("meta_page_delete_post", "Delete a Page post. Requires confirm=true.", { postId: z.string(), pageId: z.string().optional(), confirm: z.boolean().optional() }, guarded(async ({ postId, pageId, confirm }) => {
    assertConfirmed(config, confirm, "Delete post");
    const { opts } = await withPage(pageId);
    return client.delete(postId, {}, opts);
  }));

  server.tool("meta_page_photos", "Photos uploaded to the Page (albums and uploaded).", { pageId: z.string().optional(), albumId: z.string().optional(), limit: z.number().optional() }, guarded(async ({ pageId, albumId, limit }) => {
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${albumId ?? p}/photos`, { fields: "id,name,created_time,images,link,album", limit: limit ?? 50, type: albumId ? undefined : "uploaded" }, opts, 1);
  }));

  server.tool("meta_page_albums", "Albums on the Page.", { pageId: z.string().optional() }, guarded(async ({ pageId }) => {
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/albums`, { fields: "id,name,description,count,created_time,link,cover_photo" }, opts);
  }));

  server.tool("meta_page_create_album", "Create a photo album.", { pageId: z.string().optional(), name: z.string(), message: z.string().optional() }, guarded(async ({ pageId, name, message }) => {
    assertWrites(config, "Create album");
    const { p, opts } = await withPage(pageId);
    return client.post(`${p}/albums`, { name, message }, opts);
  }));

  server.tool("meta_page_videos", "Videos on the Page with views and status.", { pageId: z.string().optional(), limit: z.number().optional() }, guarded(async ({ pageId, limit }) => {
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/videos`, { fields: "id,title,description,created_time,length,permalink_url,status,views,live_status,thumbnails.limit(1)", limit: limit ?? 50 }, opts, 1);
  }));

  // ── Comments & moderation ─────────────────────────────────────────────────
  server.tool("meta_page_comments", "Comments on a post (or replies to a comment), with hidden state and author.", { objectId: z.string().describe("post id or comment id"), pageId: z.string().optional(), limit: z.number().optional(), order: z.enum(["chronological", "reverse_chronological"]).optional() }, guarded(async ({ objectId, pageId, limit, order }) => {
    const { opts } = await withPage(pageId);
    return client.getAll(`${objectId}/comments`, { fields: "id,message,from,created_time,like_count,comment_count,is_hidden,can_hide,can_remove,can_reply_privately,attachment,parent", limit: limit ?? 50, order: order ?? "reverse_chronological", filter: "stream" }, opts, 1);
  }));

  server.tool("meta_page_comment_reply", "Reply to a comment as the Page.", { commentId: z.string(), message: z.string(), pageId: z.string().optional() }, guarded(async ({ commentId, message, pageId }) => {
    assertWrites(config, "Reply to comment");
    const { opts } = await withPage(pageId);
    return client.post(`${commentId}/comments`, { message }, opts);
  }));

  server.tool("meta_page_comment_private_reply", "Send a private Messenger reply to a commenter (opens a conversation).", { commentId: z.string(), message: z.string(), pageId: z.string().optional() }, guarded(async ({ commentId, message, pageId }) => {
    assertWrites(config, "Private reply");
    const { opts } = await withPage(pageId);
    return client.post(`${commentId}/private_replies`, { message }, opts);
  }));

  server.tool("meta_page_comment_hide", "Hide or unhide a comment.", { commentId: z.string(), hidden: z.boolean(), pageId: z.string().optional() }, guarded(async ({ commentId, hidden, pageId }) => {
    assertWrites(config, "Hide comment");
    const { opts } = await withPage(pageId);
    return client.post(commentId, { is_hidden: hidden }, opts);
  }));

  server.tool("meta_page_comment_delete", "Delete a comment. Requires confirm=true.", { commentId: z.string(), pageId: z.string().optional(), confirm: z.boolean().optional() }, guarded(async ({ commentId, pageId, confirm }) => {
    assertConfirmed(config, confirm, "Delete comment");
    const { opts } = await withPage(pageId);
    return client.delete(commentId, {}, opts);
  }));

  server.tool("meta_page_like_comment", "Like or unlike a comment as the Page.", { commentId: z.string(), like: z.boolean(), pageId: z.string().optional() }, guarded(async ({ commentId, like, pageId }) => {
    assertWrites(config, "Like comment");
    const { opts } = await withPage(pageId);
    return like ? client.post(`${commentId}/likes`, {}, opts) : client.delete(`${commentId}/likes`, {}, opts);
  }));

  server.tool("meta_page_visitor_posts", "Posts by visitors on the Page timeline (needs pages_read_user_content).", { pageId: z.string().optional(), limit: z.number().optional() }, guarded(async ({ pageId, limit }) => {
    await client.requireScopes("pages_read_user_content");
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/visitor_posts`, { fields: "id,message,from,created_time,permalink_url,is_hidden", limit: limit ?? 25 }, opts, 1);
  }));

  server.tool("meta_page_ratings", "Reviews / recommendations left on the Page.", { pageId: z.string().optional(), limit: z.number().optional() }, guarded(async ({ pageId, limit }) => {
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/ratings`, { fields: "reviewer,rating,recommendation_type,review_text,created_time,has_rating,has_review", limit: limit ?? 50 }, opts, 1);
  }));

  server.tool("meta_page_blocked_users", "Users blocked from the Page.", { pageId: z.string().optional() }, guarded(async ({ pageId }) => {
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/blocked`, { fields: "id,name" }, opts);
  }));

  server.tool("meta_page_block_user", "Block or unblock a user from the Page. Blocking requires confirm=true.", { pageId: z.string().optional(), userId: z.string(), block: z.boolean(), confirm: z.boolean().optional() }, guarded(async ({ pageId, userId, block, confirm }) => {
    if (block) assertConfirmed(config, confirm, "Block user"); else assertWrites(config, "Unblock user");
    const { p, opts } = await withPage(pageId);
    return block ? client.post(`${p}/blocked`, { user: userId }, opts) : client.delete(`${p}/blocked`, { user: userId }, opts);
  }));

  // ── Insights ──────────────────────────────────────────────────────────────
  server.tool(
    "meta_page_insights",
    "Page Insights time series. Default metrics: post engagements, total actions, reactions, page views, video views, follows/unfollows. (Meta removed page_impressions/page_fans metrics in v23; use page_follows for the follower count.)",
    { pageId: z.string().optional(), metrics: z.array(z.string()).optional(), period: z.enum(["day", "week", "days_28", "month", "lifetime"]).optional(), since: z.string().optional(), until: z.string().optional() },
    guarded(async ({ pageId, metrics, period, since, until }) => {
      await client.requireScopes("read_insights");
      const { p, opts } = await withPage(pageId);
      return client.get(`${p}/insights`, { metric: (metrics ?? INSIGHT_METRICS_DEFAULT.split(",")).join(","), period: period ?? "day", since, until }, opts);
    }),
  );

  server.tool("meta_page_snapshot", "Compact 28-day summary: engagement, reactions, page views, video views, follows/unfollows, top posts.", { pageId: z.string().optional() }, guarded(async ({ pageId }) => {
    const { p, opts } = await withPage(pageId);
    const [insights, posts] = await Promise.all([
      client.get<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(`${p}/insights`, { metric: "page_post_engagements,page_total_actions,page_actions_post_reactions_total,page_views_total,page_video_views,page_follows,page_daily_follows,page_daily_unfollows", period: "days_28" }, opts).catch(() => ({ data: [] })),
      client.get<{ data: Array<Record<string, unknown>> }>(`${p}/published_posts`, { fields: "id,message,created_time,permalink_url,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0),insights.metric(post_clicks)", limit: 25 }, opts),
    ]);
    const summary = Object.fromEntries(insights.data.map((m) => [m.name, m.values.at(-1)?.value ?? 0]));
    return { last28Days: summary, recentPosts: posts.data };
  }));

  server.tool("meta_page_post_insights", "Insights for one post: clicks, reactions by type, video views (impressions/reach metrics were removed by Meta in v23; use the post's reactions/comments/shares summaries for engagement).", { postId: z.string(), pageId: z.string().optional(), metrics: z.array(z.string()).optional() }, guarded(async ({ postId, pageId, metrics }) => {
    const { opts } = await withPage(pageId);
    return client.get(`${postId}/insights`, { metric: (metrics ?? POST_METRICS_DEFAULT.split(",")).join(",") }, opts);
  }));

  // ── Events ────────────────────────────────────────────────────────────────
  server.tool("meta_page_events", "Events hosted by the Page. (Creating events via API was retired by Meta; create in the UI.)", { pageId: z.string().optional(), timeFilter: z.enum(["upcoming", "past"]).optional() }, guarded(async ({ pageId, timeFilter }) => {
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/events`, { fields: "id,name,description,start_time,end_time,place,attending_count,interested_count,is_online,ticket_uri,cover", time_filter: timeFilter }, opts);
  }));

  // ── Live ──────────────────────────────────────────────────────────────────
  server.tool("meta_page_live_videos", "Live videos on the Page with status and stream URLs.", { pageId: z.string().optional(), broadcastStatus: z.array(z.enum(["UNPUBLISHED", "LIVE", "LIVE_STOPPED", "PROCESSING", "VOD", "SCHEDULED_UNPUBLISHED", "SCHEDULED_LIVE"])).optional() }, guarded(async ({ pageId, broadcastStatus }) => {
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/live_videos`, { fields: "id,title,description,status,creation_time,planned_start_time,permalink_url,stream_url,secure_stream_url,live_views,embed_html", broadcast_status: broadcastStatus?.length ? JSON.stringify(broadcastStatus) : undefined }, opts);
  }));

  server.tool("meta_page_live_create", "Create a live broadcast (returns RTMP stream URL + key). status LIVE_NOW starts immediately; UNPUBLISHED prepares; add plannedStartTime to schedule.", {
    pageId: z.string().optional(), title: z.string().optional(), description: z.string().optional(), status: z.enum(["LIVE_NOW", "UNPUBLISHED", "SCHEDULED_UNPUBLISHED"]).optional(), plannedStartTime: z.string().optional(),
  }, guarded(async ({ pageId, title, description, status, plannedStartTime }) => {
    assertWrites(config, "Create live video");
    const { p, opts } = await withPage(pageId);
    return client.post(`${p}/live_videos`, { title, description, status: status ?? "UNPUBLISHED", planned_start_time: plannedStartTime ? Math.floor(new Date(plannedStartTime).getTime() / 1000) : undefined, fields: "id,stream_url,secure_stream_key,permalink_url" }, opts);
  }));

  server.tool("meta_page_live_end", "End a live broadcast. Requires confirm=true.", { liveVideoId: z.string(), pageId: z.string().optional(), confirm: z.boolean().optional() }, guarded(async ({ liveVideoId, pageId, confirm }) => {
    assertConfirmed(config, confirm, "End live video");
    const { opts } = await withPage(pageId);
    return client.post(liveVideoId, { end_live_video: true }, opts);
  }));
};
