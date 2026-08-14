/**
 * Optimization & automation WRITE tools. Only registered when META_ALLOW_WRITES=true.
 *
 * This is the "make the ads smarter" layer, not just observe:
 *  - Conversions API + offline conversions: feed real outcomes (enrolled / junk) back
 *    to Meta so it optimizes toward customers, not just clicks.
 *  - Custom + lookalike audiences from a CRM list.
 *  - Automated ad rules (auto-pause losers, auto-scale winners, dayparting).
 *  - Bulk status changes and campaign duplication (e.g. BD winner -> US account).
 *
 * PII is SHA-256 hashed locally before it ever leaves this process, per Meta's spec.
 * Nothing here starts spending on its own; new objects are created PAUSED, and status
 * changes are explicit and caller-driven.
 */
import { createHash } from "node:crypto";
import { GraphError } from "./graph.js";
import { assertAccountId, assertNodeId } from "./tools.js";

const ACCOUNT_ID = { type: "string", description: "Ad account id, e.g. act_123456789." };

/** Meta requires lowercase, trimmed, SHA-256 hex for all user-identifier fields. */
function hash(value) {
  return createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");
}

/** @param {import("./graph.js").GraphClient} graph */
export function optimizeTools(graph) {
  return [
    {
      name: "capi_send_event",
      description:
        "Send a server-side event to a Pixel/dataset via the Conversions API (Lead, Purchase, Schedule, " +
        "CompleteRegistration, etc.). Emails/phones are SHA-256 hashed locally before sending. Use to feed " +
        "real conversion signals (a WhatsApp lead, a booked assessment) back to Meta. Requires a pixel_id.",
      inputSchema: {
        type: "object",
        properties: {
          pixel_id: { type: "string", description: "Pixel / dataset id that receives the event." },
          event_name: { type: "string", description: "e.g. Lead, Schedule, CompleteRegistration, Purchase." },
          event_time: { type: "number", description: "Unix seconds. Defaults to now on Meta's side if omitted." },
          action_source: { type: "string", description: "e.g. business_messaging, phone_call, website, system_generated. Default: business_messaging." },
          email: { type: "string", description: "Raw email; hashed locally." },
          phone: { type: "string", description: "Raw phone (digits, country code); hashed locally." },
          value: { type: "number", description: "Optional conversion value." },
          currency: { type: "string", description: "e.g. USD. Required if value is set." },
          event_id: { type: "string", description: "Optional dedup id." },
          test_event_code: { type: "string", description: "Optional TESTxxxx code to route to Test Events." },
        },
        required: ["pixel_id", "event_name"],
      },
      handler: async (a) => {
        const user_data = {};
        if (a.email) user_data.em = [hash(a.email)];
        if (a.phone) user_data.ph = [hash(String(a.phone).replace(/[^0-9]/g, ""))];
        if (!a.email && !a.phone) {
          throw new GraphError("Provide at least one identifier (email or phone) for matching.");
        }
        const event = {
          event_name: a.event_name,
          event_time: a.event_time ?? Math.floor(Date.now() / 1000),
          action_source: a.action_source ?? "business_messaging",
          user_data,
          ...(a.value !== undefined ? { custom_data: { value: a.value, currency: a.currency ?? "USD" } } : {}),
          ...(a.event_id ? { event_id: a.event_id } : {}),
        };
        return graph.request(`${assertNodeId(a.pixel_id, "pixel_id")}/events`, {}, {
          method: "POST",
          body: { data: [event], ...(a.test_event_code ? { test_event_code: a.test_event_code } : {}) },
        });
      },
    },
    {
      name: "upload_offline_conversions",
      description:
        "Batch-upload offline conversions (e.g. enrolled students, closed sales) to an offline event set, so " +
        "Meta optimizes toward real outcomes. Each row: {event_name, event_time, email?/phone?, value?, currency?}. " +
        "PII hashed locally.",
      inputSchema: {
        type: "object",
        properties: {
          offline_event_set_id: { type: "string", description: "Offline event set id." },
          events: { type: "array", items: { type: "object" }, description: "Array of conversion rows (see description)." },
        },
        required: ["offline_event_set_id", "events"],
      },
      handler: async (a) => {
        if (!Array.isArray(a.events) || a.events.length === 0) {
          throw new GraphError("events must be a non-empty array.");
        }
        const data = a.events.map((e) => {
          const match_keys = {};
          if (e.email) match_keys.email = [hash(e.email)];
          if (e.phone) match_keys.phone = [hash(String(e.phone).replace(/[^0-9]/g, ""))];
          return {
            match_keys,
            event_name: e.event_name,
            event_time: e.event_time ?? Math.floor(Date.now() / 1000),
            ...(e.value !== undefined ? { value: e.value, currency: e.currency ?? "USD" } : {}),
          };
        });
        return graph.request(`${assertNodeId(a.offline_event_set_id, "offline_event_set_id")}/events`, {}, {
          method: "POST",
          body: { upload_tag: `mcp_${Math.floor(Date.now() / 1000)}`, data: JSON.stringify(data) },
        });
      },
    },
    {
      name: "create_custom_audience",
      description:
        "Create an (empty) custom audience to later fill from a CRM list. subtype CUSTOM. " +
        "Add users with add_audience_users.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          name: { type: "string" },
          description: { type: "string" },
          customer_file_source: { type: "string", description: "USER_PROVIDED_ONLY | PARTNER_PROVIDED_ONLY | BOTH_USER_AND_PARTNER_PROVIDED. Default USER_PROVIDED_ONLY." },
        },
        required: ["ad_account_id", "name"],
      },
      handler: async (a) =>
        graph.request(`${assertAccountId(a.ad_account_id)}/customaudiences`, {}, {
          method: "POST",
          body: {
            name: a.name, subtype: "CUSTOM",
            description: a.description ?? "Created via MCP",
            customer_file_source: a.customer_file_source ?? "USER_PROVIDED_ONLY",
          },
        }),
    },
    {
      name: "add_audience_users",
      description:
        "Add users to a custom audience by email and/or phone. Values are SHA-256 hashed locally before upload. " +
        "Pass emails and/or phones as arrays.",
      inputSchema: {
        type: "object",
        properties: {
          audience_id: { type: "string" },
          emails: { type: "array", items: { type: "string" } },
          phones: { type: "array", items: { type: "string" } },
        },
        required: ["audience_id"],
      },
      handler: async (a) => {
        const emails = a.emails ?? [], phones = a.phones ?? [];
        if (emails.length === 0 && phones.length === 0) {
          throw new GraphError("Provide emails and/or phones to add.");
        }
        const schema = [];
        if (emails.length) schema.push("EMAIL");
        if (phones.length) schema.push("PHONE");
        const rows = Math.max(emails.length, phones.length);
        const data = [];
        for (let i = 0; i < rows; i++) {
          const row = [];
          if (emails.length) row.push(emails[i] ? hash(emails[i]) : "");
          if (phones.length) row.push(phones[i] ? hash(String(phones[i]).replace(/[^0-9]/g, "")) : "");
          data.push(row);
        }
        return graph.request(`${assertNodeId(a.audience_id, "audience_id")}/users`, {}, {
          method: "POST",
          body: { payload: { schema, data } },
        });
      },
    },
    {
      name: "create_lookalike",
      description:
        "Create a lookalike audience from a source custom audience — target parents who resemble your actual " +
        "enrolled families. ratio 0.01-0.20 (1%-20%).",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          name: { type: "string" },
          source_audience_id: { type: "string" },
          country: { type: "string", description: "e.g. US." },
          ratio: { type: "number", description: "0.01 = closest 1%. Default 0.03." },
        },
        required: ["ad_account_id", "name", "source_audience_id", "country"],
      },
      handler: async (a) =>
        graph.request(`${assertAccountId(a.ad_account_id)}/customaudiences`, {}, {
          method: "POST",
          body: {
            name: a.name, subtype: "LOOKALIKE",
            origin_audience_id: assertNodeId(a.source_audience_id, "source_audience_id"),
            lookalike_spec: JSON.stringify({ type: "similarity", country: a.country, ratio: a.ratio ?? 0.03 }),
          },
        }),
    },
    {
      name: "create_ad_rule",
      description:
        "Create an automated ad rule (auto-pause losers, auto-scale winners, dayparting). Supply Meta " +
        "evaluation_spec and execution_spec objects. Runs on Meta's schedule, no server needed.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          name: { type: "string" },
          evaluation_spec: { type: "object", description: "Meta evaluation_spec (evaluation_type + filters)." },
          execution_spec: { type: "object", description: "Meta execution_spec (execution_type, e.g. PAUSE, CHANGE_BUDGET)." },
          schedule_spec: { type: "object", description: "Optional schedule_spec. Defaults to semi-hourly." },
          status: { type: "string", enum: ["ENABLED", "DISABLED"], description: "Default DISABLED (safe)." },
        },
        required: ["ad_account_id", "name", "evaluation_spec", "execution_spec"],
      },
      handler: async (a) =>
        graph.request(`${assertAccountId(a.ad_account_id)}/adrules_library`, {}, {
          method: "POST",
          body: {
            name: a.name,
            evaluation_spec: a.evaluation_spec,
            execution_spec: a.execution_spec,
            schedule_spec: a.schedule_spec ?? { schedule_type: "SEMI_HOURLY" },
            status: a.status ?? "DISABLED",
          },
        }),
    },
    {
      name: "bulk_update_status",
      description:
        "Set the same status (ACTIVE / PAUSED / ARCHIVED) on many campaigns / ad sets / ads at once. " +
        "ACTIVE can start spending. Returns per-id results.",
      inputSchema: {
        type: "object",
        properties: {
          node_ids: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["ACTIVE", "PAUSED", "ARCHIVED"] },
        },
        required: ["node_ids", "status"],
      },
      handler: async (a) => {
        if (!["ACTIVE", "PAUSED", "ARCHIVED"].includes(a.status)) {
          throw new GraphError(`status must be ACTIVE, PAUSED or ARCHIVED, got "${a.status}".`);
        }
        const results = await Promise.allSettled(
          a.node_ids.map((id) =>
            graph.request(assertNodeId(id, "node_id"), {}, { method: "POST", body: { status: a.status } })
              .then((r) => ({ id, ok: true, result: r }))),
        );
        return { status: a.status, results: results.map((r) => r.status === "fulfilled" ? r.value : { ok: false, error: String(r.reason?.message ?? r.reason) }) };
      },
    },
    {
      name: "duplicate_campaign",
      description:
        "Deep-copy a campaign (ad sets + ads) into the same or another ad account — e.g. clone the winning BD " +
        "campaign into the US account. The copy is created PAUSED.",
      inputSchema: {
        type: "object",
        properties: {
          campaign_id: { type: "string" },
          target_ad_account_id: { type: "string", description: "Optional destination account (act_...). Omit to copy within the same account." },
          rename_prefix: { type: "string", description: "Optional name prefix for the copy." },
        },
        required: ["campaign_id"],
      },
      handler: async (a) =>
        graph.request(`${assertNodeId(a.campaign_id, "campaign_id")}/copies`, {}, {
          method: "POST",
          body: {
            deep_copy: true,
            status_option: "PAUSED",
            ...(a.target_ad_account_id ? { copied_campaign_to_ad_account_id: assertAccountId(a.target_ad_account_id) } : {}),
            ...(a.rename_prefix ? { rename_options: { rename_strategy: "ONLY_TOP_LEVEL", rename_prefix: a.rename_prefix } } : {}),
          },
        }),
    },
  ];
}
