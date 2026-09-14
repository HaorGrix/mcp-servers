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

  // ── Reels & Stories ───────────────────────────────────────────────────────
  server.tool("meta_page_reels", "Facebook Reels on the Page with views and status.", { pageId: z.string().optional(), limit: z.number().optional() }, guarded(async ({ pageId, limit }) => {
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/video_reels`, { fields: "id,title,description,created_time,length,permalink_url,status,views,post_views,thumbnails.limit(1)", limit: limit ?? 25 }, opts, 1);
  }));

  server.tool(
    "meta_page_publish_reel",
    "Publish a Facebook Reel from a public video URL or a local file (3-step resumable upload). Optionally schedule.",
    { pageId: z.string().optional(), videoUrl: z.string().optional(), filePath: z.string().optional(), description: z.string().optional(), title: z.string().optional(), scheduledPublishTime: z.string().optional(), confirm: z.boolean().optional() },
    guarded(async ({ pageId, videoUrl, filePath, description, title, scheduledPublishTime, confirm }) => {
      assertConfirmed(config, confirm, "Publish Reel");
      const { p, opts } = await withPage(pageId);
      const start = await client.post<{ video_id: string; upload_url: string }>(`${p}/video_reels`, { upload_phase: "start" }, opts);
      const headers: Record<string, string> = { Authorization: `OAuth ${opts.token}` };
      if (filePath) {
        const { readFile } = await import("node:fs/promises");
        const buf = await readFile(filePath);
        await client.uploadBinary(`https://rupload.facebook.com/video-upload/${config.version}/${start.video_id}`, buf, { ...headers, offset: "0", file_size: String(buf.length) });
      } else if (videoUrl) {
        await client.uploadBinary(`https://rupload.facebook.com/video-upload/${config.version}/${start.video_id}`, Buffer.alloc(0), { ...headers, file_url: videoUrl });
      } else throw new Error("videoUrl or filePath required");
      for (let i = 0; i < 40; i += 1) {
        const st = await client.get<{ status: { uploading_phase?: { status: string }; processing_phase?: { status: string } } }>(start.video_id, { fields: "status" }, opts);
        if (st.status.uploading_phase?.status === "complete") break;
        if (st.status.uploading_phase?.status === "error") throw new Error(`Upload failed: ${JSON.stringify(st.status)}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
      const schedule = scheduledPublishTime ? { video_state: "SCHEDULED", scheduled_publish_time: Math.floor(new Date(scheduledPublishTime).getTime() / 1000) } : { video_state: "PUBLISHED" };
      const fin = await client.post(`${p}/video_reels`, { upload_phase: "finish", video_id: start.video_id, description, title, ...schedule }, opts);
      return { videoId: start.video_id, ...fin };
    }),
  );

  server.tool("meta_page_stories", "Active Facebook Page Stories.", { pageId: z.string().optional() }, guarded(async ({ pageId }) => {
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/stories`, { fields: "post_id,status,creation_time,media_type,media_id,url" }, opts);
  }));

  server.tool("meta_page_publish_story", "Publish a Page Story from a photo URL/local file or a video URL/local file.", { pageId: z.string().optional(), kind: z.enum(["photo", "video"]), url: z.string().optional(), filePath: z.string().optional(), confirm: z.boolean().optional() }, guarded(async ({ pageId, kind, url, filePath, confirm }) => {
    assertConfirmed(config, confirm, "Publish Story");
    const { p, opts } = await withPage(pageId);
    if (kind === "photo") {
      const photo = filePath ? await client.upload<{ id: string }>(`${p}/photos`, filePath, "source", { published: false }, opts) : await client.post<{ id: string }>(`${p}/photos`, { url, published: false }, opts);
      return client.post(`${p}/photo_stories`, { photo_id: photo.id }, opts);
    }
    const start = await client.post<{ video_id: string; upload_url: string }>(`${p}/video_stories`, { upload_phase: "start" }, opts);
    const headers: Record<string, string> = { Authorization: `OAuth ${opts.token}` };
    if (filePath) { const { readFile } = await import("node:fs/promises"); const buf = await readFile(filePath); await client.uploadBinary(start.upload_url, buf, { ...headers, offset: "0", file_size: String(buf.length) }); }
    else if (url) await client.uploadBinary(start.upload_url, Buffer.alloc(0), { ...headers, file_url: url });
    else throw new Error("url or filePath required");
    await new Promise((r) => setTimeout(r, 5000));
    return client.post(`${p}/video_stories`, { upload_phase: "finish", video_id: start.video_id }, opts);
  }));

  // ── Local file uploads ────────────────────────────────────────────────────
  server.tool("meta_page_upload_photo_file", "Upload a local image file as a Page photo post (or unpublished for later use).", { pageId: z.string().optional(), filePath: z.string(), message: z.string().optional(), published: z.boolean().optional(), albumId: z.string().optional() }, guarded(async ({ pageId, filePath, message, published, albumId }) => {
    assertWrites(config, "Upload photo");
    const { p, opts } = await withPage(pageId);
    return client.upload(`${albumId ?? p}/photos`, filePath, "source", { message, published: published ?? true }, opts);
  }));

  server.tool("meta_page_upload_video_file", "Upload a local video file to the Page (single request, up to ~1GB).", { pageId: z.string().optional(), filePath: z.string(), title: z.string().optional(), description: z.string().optional(), scheduledPublishTime: z.string().optional() }, guarded(async ({ pageId, filePath, title, description, scheduledPublishTime }) => {
    assertWrites(config, "Upload video");
    const { p, opts } = await withPage(pageId);
    const schedule = scheduledPublishTime ? { published: false, scheduled_publish_time: Math.floor(new Date(scheduledPublishTime).getTime() / 1000) } : {};
    return client.upload(`${p}/videos`, filePath, "source", { title, description, ...schedule }, { ...opts, host: `https://graph-video.facebook.com/${config.version}` });
  }));

  server.tool("meta_page_video_insights", "Insights for one video: views, 3s/10s/complete views, avg watch time, reactions, shares, retention.", { videoId: z.string(), pageId: z.string().optional(), metrics: z.array(z.string()).optional() }, guarded(async ({ videoId, pageId, metrics }) => {
    const { opts } = await withPage(pageId);
    return client.get(`${videoId}/video_insights`, { metric: metrics?.join(",") ?? "total_video_views,total_video_views_unique,total_video_10s_views,total_video_complete_views,total_video_avg_time_watched,total_video_impressions,total_video_reactions_by_type_total,total_video_stories_by_action_type" }, opts);
  }));

  server.tool("meta_page_video_crosspost", "Allow another Page to crosspost this video, or list crosspost partners.", { videoId: z.string(), pageId: z.string().optional(), targetPageIds: z.array(z.string()).optional() }, guarded(async ({ videoId, pageId, targetPageIds }) => {
    const { opts } = await withPage(pageId);
    if (!targetPageIds?.length) return client.get(videoId, { fields: "crosspost_original_video,crossposted_video_ids,is_crosspost_video,is_crossposting_eligible" }, opts);
    assertWrites(config, "Crosspost");
    return client.post(videoId, { allow_crossposting_for_pages: targetPageIds.map((id) => ({ page_id: id, allow: true })) }, opts);
  }));

  // ── Post detail ───────────────────────────────────────────────────────────
  server.tool("meta_page_post_reactions", "Who reacted to a post, by reaction type.", { postId: z.string(), pageId: z.string().optional(), type: z.enum(["LIKE", "LOVE", "WOW", "HAHA", "SAD", "ANGRY", "CARE"]).optional(), limit: z.number().optional() }, guarded(async ({ postId, pageId, type, limit }) => {
    const { opts } = await withPage(pageId);
    return client.getAll(`${postId}/reactions`, { fields: "id,name,type", type, limit: limit ?? 100 }, opts, 1);
  }));

  server.tool("meta_page_post_shares", "Public reshares of a post.", { postId: z.string(), pageId: z.string().optional() }, guarded(async ({ postId, pageId }) => {
    const { opts } = await withPage(pageId);
    return client.getAll(`${postId}/sharedposts`, { fields: "id,from,created_time,message,permalink_url" }, opts, 1);
  }));

  server.tool("meta_page_dark_posts", "Unpublished (dark) posts created for ads on the Page.", { pageId: z.string().optional(), limit: z.number().optional() }, guarded(async ({ pageId, limit }) => {
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/ads_posts`, { fields: "id,message,created_time,is_published,permalink_url,admin_creator", limit: limit ?? 25 }, opts, 1);
  }));

  server.tool("meta_page_create_dark_post", "Create an unpublished post (for ads / boosting) without it appearing on the timeline.", { pageId: z.string().optional(), message: z.string().optional(), link: z.string().optional(), photoUrl: z.string().optional(), callToAction: z.object({ type: z.string(), value: z.record(z.unknown()) }).optional() }, guarded(async ({ pageId, message, link, photoUrl, callToAction }) => {
    assertWrites(config, "Create dark post");
    const { p, opts } = await withPage(pageId);
    if (photoUrl) return client.post(`${p}/photos`, { url: photoUrl, message, published: false, unpublished_content_type: "ADS_POST" }, opts);
    return client.post(`${p}/feed`, { message, link, published: false, unpublished_content_type: "ADS_POST", call_to_action: callToAction }, opts);
  }));

  server.tool("meta_page_rating_reply", "Reply to a review/recommendation as the Page (via its open_graph_story).", { pageId: z.string().optional(), reviewerId: z.string().optional(), storyId: z.string().optional(), message: z.string() }, guarded(async ({ pageId, reviewerId, storyId, message }) => {
    assertWrites(config, "Rating reply");
    const { p, opts } = await withPage(pageId);
    let target = storyId;
    if (!target) {
      const ratings = await client.getAll<{ reviewer?: { id: string }; open_graph_story?: { id: string } }>(`${p}/ratings`, { fields: "reviewer,open_graph_story" }, opts);
      target = ratings.find((r) => r.reviewer?.id === reviewerId)?.open_graph_story?.id;
      if (!target) throw new Error("Review not found for that reviewerId; pass storyId from meta_page_ratings (field open_graph_story).");
    }
    return client.post(`${target}/comments`, { message }, opts);
  }));

  // ── Page config ───────────────────────────────────────────────────────────
  server.tool("meta_page_cta_button", "Get the Page's call-to-action button, or set one (type e.g. MESSAGE, CALL_NOW, BOOK_NOW, SHOP_NOW, SIGN_UP, WHATSAPP_MESSAGE, LEARN_MORE; web_destination_type EMAIL_US/WEBSITE/...).", { pageId: z.string().optional(), type: z.string().optional(), webUrl: z.string().optional(), phoneNumber: z.string().optional(), email: z.string().optional(), remove: z.boolean().optional() }, guarded(async ({ pageId, type, webUrl, phoneNumber, email, remove }) => {
    const { p, opts } = await withPage(pageId);
    const existing = await client.getAll<{ id: string; type: string }>(`${p}/call_to_actions`, { fields: "id,type,web_destination_type,web_url,phone_number,email_address,status" }, opts);
    if (!type && !remove) return existing;
    assertWrites(config, "Page CTA");
    if (remove) return Promise.all(existing.map((c) => client.delete(c.id, {}, opts)));
    const body = { type, web_destination_type: webUrl ? "WEBSITE" : email ? "EMAIL" : undefined, web_url: webUrl, phone_number: phoneNumber, email_address: email };
    return client.post(`${p}/call_to_actions`, body, opts);
  }));

  server.tool("meta_page_locations", "Location Pages under a main brand Page (multi-location businesses).", { pageId: z.string().optional() }, guarded(async ({ pageId }) => {
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/locations`, { fields: "id,name,location,phone,hours,is_permanently_closed,store_number,store_location_descriptor" }, opts);
  }));

  server.tool("meta_page_backed_instagram", "Page-backed Instagram accounts (used to run IG ads without a real IG account); create one if none exists.", { pageId: z.string().optional(), create: z.boolean().optional() }, guarded(async ({ pageId, create }) => {
    const { p, opts } = await withPage(pageId);
    const existing = await client.getAll(`${p}/page_backed_instagram_accounts`, { fields: "id,username" }, opts);
    if (existing.length || !create) return existing;
    assertWrites(config, "Create PBIA");
    return client.post(`${p}/page_backed_instagram_accounts`, {}, opts);
  }));

  server.tool("meta_page_agencies", "Agencies (partner businesses) with access to the Page, and their permitted tasks.", { pageId: z.string().optional() }, guarded(async ({ pageId }) => {
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/agencies`, { fields: "id,name,permitted_tasks,access_status" }, opts);
  }));

  server.tool("meta_pages_snapshot_all", "28-day snapshot for every Page the system user manages, one call.", {}, guarded(async () => {
    const pages = await client.getAll<{ id: string; name: string }>("me/accounts", { fields: "id,name" });
    return Promise.all(pages.map(async (pg) => {
      const opts = { token: await client.pageToken(pg.id) };
      const ins = await client.get<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(`${pg.id}/insights`, { metric: "page_post_engagements,page_views_total,page_video_views,page_follows,page_daily_follows,page_daily_unfollows", period: "days_28" }, opts).catch(() => ({ data: [] }));
      return { ...pg, last28Days: Object.fromEntries(ins.data.map((m) => [m.name, m.values.at(-1)?.value ?? 0])) };
    }));
  }));
};
