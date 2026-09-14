/** Threads API (graph.threads.net). Needs its own token: THREADS_ACCESS_TOKEN (Threads app, threads_basic + threads_content_publish + threads_manage_insights + threads_manage_replies). */
import { z } from "zod";
import type { Register } from "../context.js";
import { guarded } from "../respond.js";
import { assertConfirmed, assertWrites } from "../guard.js";

const HOST = "https://graph.threads.net/v1.0";

export const registerThreads: Register = ({ server, client, config }) => {
  const token = process.env["THREADS_ACCESS_TOKEN"]?.trim();
  const opts = () => {
    if (!token) throw new Error("THREADS_ACCESS_TOKEN is not set. Create a Threads app use case in the App Dashboard, authorize via Threads Login, and put the long-lived token in .env.");
    return { token, host: HOST };
  };

  server.tool("meta_threads_profile", "Threads profile: username, bio, picture, and id.", {}, guarded(async () => client.get("me", { fields: "id,username,name,threads_profile_picture_url,threads_biography,is_verified" }, opts())));

  server.tool("meta_threads_posts", "Recent Threads posts with type, text, media, permalink.", { limit: z.number().optional(), since: z.string().optional(), until: z.string().optional() }, guarded(async ({ limit, since, until }) =>
    client.getAll("me/threads", { fields: "id,media_type,text,media_url,permalink,timestamp,is_quote_post,has_replies,reply_audience,topic_tag", limit: limit ?? 25, since, until }, opts(), 1),
  ));

  server.tool("meta_threads_publish", "Publish a Threads post: text, image, video, or carousel; optionally as a reply to a post. Two-step container flow with processing wait.", { kind: z.enum(["text", "image", "video", "carousel"]), text: z.string().optional(), imageUrl: z.string().optional(), videoUrl: z.string().optional(), items: z.array(z.object({ imageUrl: z.string().optional(), videoUrl: z.string().optional() })).optional(), replyToId: z.string().optional(), replyControl: z.enum(["everyone", "accounts_you_follow", "mentioned_only"]).optional(), topicTag: z.string().optional(), linkAttachment: z.string().optional(), confirm: z.boolean().optional() }, guarded(async (a) => {
    assertConfirmed(config, a.confirm, "Publish to Threads");
    const o = opts();
    const me = await client.get<{ id: string }>("me", { fields: "id" }, o);
    const wait = async (id: string) => { for (let i = 0; i < 30; i += 1) { const s = await client.get<{ status: string; error_message?: string }>(id, { fields: "status,error_message" }, o); if (s.status === "FINISHED") return; if (s.status === "ERROR") throw new Error(s.error_message ?? "container error"); await new Promise((r) => setTimeout(r, 3000)); } };
    const common = { text: a.text, reply_to_id: a.replyToId, reply_control: a.replyControl, topic_tag: a.topicTag, link_attachment: a.linkAttachment };
    let containerId: string;
    if (a.kind === "carousel") {
      const children: string[] = [];
      for (const it of a.items ?? []) { const c = await client.post<{ id: string }>(`${me.id}/threads`, it.videoUrl ? { media_type: "VIDEO", video_url: it.videoUrl, is_carousel_item: true } : { media_type: "IMAGE", image_url: it.imageUrl, is_carousel_item: true }, o); await wait(c.id); children.push(c.id); }
      containerId = (await client.post<{ id: string }>(`${me.id}/threads`, { media_type: "CAROUSEL", children: children.join(","), ...common }, o)).id;
    } else if (a.kind === "image") containerId = (await client.post<{ id: string }>(`${me.id}/threads`, { media_type: "IMAGE", image_url: a.imageUrl, ...common }, o)).id;
    else if (a.kind === "video") containerId = (await client.post<{ id: string }>(`${me.id}/threads`, { media_type: "VIDEO", video_url: a.videoUrl, ...common }, o)).id;
    else containerId = (await client.post<{ id: string }>(`${me.id}/threads`, { media_type: "TEXT", ...common }, o)).id;
    await wait(containerId);
    return client.post(`${me.id}/threads_publish`, { creation_id: containerId }, o);
  }));

  server.tool("meta_threads_replies", "Replies to a post (one level) or the full conversation tree.", { postId: z.string(), tree: z.boolean().optional() }, guarded(async ({ postId, tree }) => client.getAll(`${postId}/${tree ? "conversation" : "replies"}`, { fields: "id,text,username,timestamp,media_type,permalink,hide_status,has_replies,is_reply_owned_by_me" }, opts(), 1)));

  server.tool("meta_threads_hide_reply", "Hide or unhide a reply to your post.", { replyId: z.string(), hide: z.boolean() }, guarded(async ({ replyId, hide }) => { assertWrites(config, "Hide reply"); return client.post(`${replyId}/manage_reply`, { hide }, opts()); }));

  server.tool("meta_threads_insights", "Account insights (views, likes, replies, reposts, quotes, followers_count, follower_demographics) or a post's insights.", { postId: z.string().optional(), metrics: z.array(z.string()).optional(), since: z.string().optional(), until: z.string().optional() }, guarded(async ({ postId, metrics, since, until }) => {
    const o = opts();
    if (postId) return client.get(`${postId}/insights`, { metric: (metrics ?? ["views", "likes", "replies", "reposts", "quotes", "shares"]).join(",") }, o);
    const me = await client.get<{ id: string }>("me", { fields: "id" }, o);
    return client.get(`${me.id}/threads_insights`, { metric: (metrics ?? ["views", "likes", "replies", "reposts", "quotes", "followers_count"]).join(","), since, until }, o);
  }));

  server.tool("meta_threads_publishing_limit", "Posts and replies published via API in the last 24h vs quota.", {}, guarded(async () => { const o = opts(); const me = await client.get<{ id: string }>("me", { fields: "id" }, o); return client.get(`${me.id}/threads_publishing_limit`, { fields: "quota_usage,config,reply_quota_usage,reply_config" }, o); }));

  server.tool("meta_threads_delete_post", "Delete a Threads post. Requires confirm=true.", { postId: z.string(), confirm: z.boolean().optional() }, guarded(async ({ postId, confirm }) => { assertConfirmed(config, confirm, "Delete Threads post"); return client.delete(postId, {}, opts()); }));
};
