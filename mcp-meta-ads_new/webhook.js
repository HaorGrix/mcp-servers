#!/usr/bin/env node
/**
 * Standalone Meta webhook receiver — real-time push instead of pull.
 *
 * Subscribe to `leadgen` (a lead the instant it submits), `messages` (WhatsApp/Messenger
 * events once the number is on Cloud API), and ad-account change events. This is a SEPARATE
 * process from the stdio MCP: it needs a public HTTPS URL, so run it behind a tunnel or on
 * the VPS and register the URL + verify token in the Meta App -> Webhooks.
 *
 * Env:
 *   WEBHOOK_VERIFY_TOKEN   shared secret you also enter in the App Dashboard
 *   WEBHOOK_APP_SECRET     app secret, to verify the X-Hub-Signature-256 signature
 *   WEBHOOK_PORT           default 8787
 *   WEBHOOK_LOG            path to append received events as JSONL (default ./webhook-events.jsonl)
 *
 * It does not spend or mutate anything. It receives, verifies, logs, and (optionally) you
 * wire the `onEvent` hook to push leads into a sheet / CRM / Slack.
 */
import http from "node:http";
import crypto from "node:crypto";
import { appendFile } from "node:fs/promises";

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const APP_SECRET = process.env.WEBHOOK_APP_SECRET;
const PORT = Number(process.env.WEBHOOK_PORT ?? 8787);
const LOG = process.env.WEBHOOK_LOG ?? "./webhook-events.jsonl";

if (!VERIFY_TOKEN) {
  console.error("[webhook] WEBHOOK_VERIFY_TOKEN is required.");
  process.exit(1);
}

/** Constant-time check of Meta's payload signature so forged posts are rejected. */
function validSignature(rawBody, header) {
  if (!APP_SECRET) return true; // no secret configured -> skip (dev only)
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", APP_SECRET).update(rawBody).digest("hex");
  const got = header.slice("sha256=".length);
  const a = Buffer.from(expected), b = Buffer.from(got);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Override this to fan events out to Slack / a sheet / a CRM. */
async function onEvent(entry) {
  await appendFile(LOG, JSON.stringify({ received_at: new Date().toISOString(), ...entry }) + "\n");
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Verification handshake (GET) — Meta calls this once when you register the URL.
  if (req.method === "GET" && url.pathname === "/webhook") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(challenge ?? "");
    }
    res.writeHead(403);
    return res.end("forbidden");
  }

  // Event delivery (POST).
  if (req.method === "POST" && url.pathname === "/webhook") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      if (!validSignature(raw, req.headers["x-hub-signature-256"])) {
        res.writeHead(401);
        return res.end("bad signature");
      }
      // Ack fast — Meta retries if we are slow.
      res.writeHead(200);
      res.end("EVENT_RECEIVED");
      try {
        const body = JSON.parse(raw || "{}");
        for (const entry of body.entry ?? []) {
          await onEvent({ object: body.object, entry });
        }
      } catch (err) {
        console.error(`[webhook] handler error: ${err.message}`);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.error(`[webhook] listening on :${PORT} — GET/POST /webhook, logging to ${LOG}`);
});
