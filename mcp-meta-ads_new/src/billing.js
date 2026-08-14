/**
 * Billing and finance read tools: what an account has spent, what it still owes,
 * which card pays for it, and whether the token can even see the whole picture.
 *
 * Meta removed the /transactions edge (verified absent in v16-v23), but the billing
 * data is NOT gone — it lives in the adactivity audit log as `ad_account_billing_charge`
 * events carrying a transaction_id and amount, alongside `remove_funding_source` and
 * `funding_event_successful`. get_billing_charges and get_funding_history read those,
 * which is how per-charge receipts and card-change history are recovered.
 */
import { GraphError } from "./graph.js";
import { assertAccountId } from "./tools.js";

const ACCOUNT_ID = { type: "string", description: "Ad account id, e.g. act_123456789." };

/** Meta returns account_status as a bare integer; nobody remembers what 3 means. */
const ACCOUNT_STATUS = {
  1: "ACTIVE",
  2: "DISABLED",
  3: "UNSETTLED — unpaid balance, delivery stopped",
  7: "PENDING_RISK_REVIEW",
  8: "PENDING_SETTLEMENT",
  9: "IN_GRACE_PERIOD",
  100: "PENDING_CLOSURE",
  101: "CLOSED",
  201: "ANY_ACTIVE",
  202: "ANY_CLOSED",
};

const DISABLE_REASON = {
  0: "NONE",
  1: "ADS_INTEGRITY_POLICY",
  2: "ADS_IP_REVIEW",
  3: "RISK_PAYMENT",
  4: "GRAY_ACCOUNT_SHUT_DOWN",
  5: "ADS_AFC_REVIEW",
  6: "BUSINESS_INTEGRITY_RAR",
  7: "PERMANENT_CLOSE",
  8: "UNUSED_RESELLER_ACCOUNT",
  9: "UNUSED_ACCOUNT",
};

/** Billing fields worth pulling every time; kept here so one edit updates all tools. */
const BILLING_FIELDS = [
  "id", "account_id", "name", "account_status", "disable_reason", "currency",
  "business_country_code", "timezone_name", "created_time", "amount_spent", "balance",
  "spend_cap", "is_prepay_account", "funding_source_details", "business", "owner",
].join(",");

/**
 * Money comes back from Meta as an integer string in the currency's minor unit
 * (cents). Returning it raw is how "$311.03" becomes "31103" in a report.
 * @param {string | number | undefined | null} raw
 */
function money(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Number((n / 100).toFixed(2)) : null;
}

/** Audit-log extra_data is a JSON *string*, and occasionally not JSON at all. */
function parseExtra(raw) {
  if (typeof raw !== "string" || !raw.startsWith("{")) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Shapes one raw account node into the billing view every tool here returns. */
function billingView(acct) {
  const spent = money(acct.amount_spent);
  const owed = money(acct.balance);
  const cap = money(acct.spend_cap);
  return {
    ad_account_id: acct.id,
    name: acct.name,
    business: acct.business?.name ?? acct.business_name ?? null,
    business_id: acct.business?.id ?? acct.owner ?? null,
    country: acct.business_country_code ?? null,
    currency: acct.currency,
    status: ACCOUNT_STATUS[acct.account_status] ?? `UNKNOWN (${acct.account_status})`,
    status_code: acct.account_status,
    disable_reason: DISABLE_REASON[acct.disable_reason] ?? null,
    is_active: acct.account_status === 1,
    lifetime_spend: spent,
    outstanding_balance: owed,
    owes_money: (owed ?? 0) > 0,
    spend_cap: cap === 0 ? null : cap,
    prepaid: acct.is_prepay_account ?? null,
    payment_method: acct.funding_source_details?.display_string ?? null,
    payment_method_id: acct.funding_source_details?.id ?? null,
    created_time: acct.created_time,
  };
}

/** Scopes each capability actually needs, so an empty result can be explained. */
const SCOPE_MAP = [
  { capability: "Read ad accounts, campaigns, insights, spend ledger", scopes: ["ads_read"] },
  { capability: "Create/edit campaigns (write tools)", scopes: ["ads_management"] },
  { capability: "Discover ALL ad accounts via Business Manager", scopes: ["business_management"] },
  { capability: "Page insights and posts", scopes: ["pages_read_engagement"] },
  { capability: "Instagram account insights", scopes: ["instagram_basic", "instagram_manage_insights"] },
];

/** @param {import("./graph.js").GraphClient} graph */
export function billingTools(graph) {
  return [
    {
      name: "get_billing_summary",
      description:
        "Finance view of one ad account: lifetime spend, outstanding balance owed to Meta, account status " +
        "decoded to words, card/funding source on file, prepay vs postpay, spend cap and owning business. " +
        "Answers 'what did this cost and do we still owe anything'.",
      inputSchema: {
        type: "object",
        properties: { ad_account_id: ACCOUNT_ID },
        required: ["ad_account_id"],
      },
      handler: async (a) => {
        const acct = await graph.request(assertAccountId(a.ad_account_id), { fields: BILLING_FIELDS });
        return {
          ...billingView(acct),
          note:
            "Per-charge receipts ARE available via get_billing_charges (recovered from the adactivity " +
            "audit log after Meta removed the /transactions edge), and card-swap history via " +
            "get_funding_history. Use get_spend_ledger for daily spend.",
        };
      },
    },

    {
      name: "get_spend_ledger",
      description:
        "Day-by-day spend ledger for an ad account — the closest thing to a transaction list now that Meta " +
        "removed /transactions. Returns every billable day with a running total, and reconciles the sum " +
        "against the account's own lifetime_spend so the result proves its own completeness.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          since: { type: "string", description: "YYYY-MM-DD. Defaults to account creation date." },
          until: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        },
        required: ["ad_account_id"],
      },
      handler: async (a) => {
        const id = assertAccountId(a.ad_account_id);
        const acct = await graph.request(id, { fields: BILLING_FIELDS });

        const until = a.until ?? new Date().toISOString().slice(0, 10);
        const since = a.since ?? (acct.created_time ? acct.created_time.slice(0, 10) : "2000-01-01");
        if (since > until) {
          throw new GraphError(`since (${since}) is after until (${until}).`);
        }

        const page = await graph.paginate(`${id}/insights`, {
          time_range: JSON.stringify({ since, until }),
          time_increment: 1,
          fields: "date_start,spend,impressions,clicks",
        });

        let running = 0;
        const days = page.data.map((d) => {
          const spend = Number(d.spend) || 0;
          running = Number((running + spend).toFixed(2));
          return {
            date: d.date_start,
            spend,
            running_total: running,
            impressions: Number(d.impressions) || 0,
            clicks: Number(d.clicks) || 0,
          };
        });

        const windowTotal = running;
        const lifetime = billingView(acct).lifetime_spend;
        // A ledger that silently omits days is worse than no ledger, so state the gap.
        const coversLifetime = lifetime !== null && Math.abs(windowTotal - lifetime) < 0.01;

        return {
          ad_account_id: id,
          currency: acct.currency,
          window: { since, until },
          billable_days: days.length,
          window_total: windowTotal,
          lifetime_spend: lifetime,
          reconciles_to_lifetime: coversLifetime,
          unreconciled_difference: lifetime === null ? null : Number((lifetime - windowTotal).toFixed(2)),
          outstanding_balance: billingView(acct).outstanding_balance,
          payment_method: billingView(acct).payment_method,
          truncated: page.truncated,
          days,
          ...(coversLifetime
            ? {}
            : {
                warning:
                  "Ledger does not match lifetime_spend. Either the window excludes earlier spend " +
                  "(widen `since`), or some spend is not attributable at day level. Do not present " +
                  "this as the complete history until it reconciles.",
              }),
        };
      },
    },

    {
      name: "get_billing_charges",
      description:
        "REAL per-charge billing history: every card charge Meta made against the account, each with its " +
        "transaction id, amount and timestamp. Recovered from the adactivity audit log " +
        "(`ad_account_billing_charge`), which survived the removal of the /transactions edge. Reconciles " +
        "charges + outstanding balance against lifetime spend so gaps are visible rather than silent.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          since: { type: "string", description: "YYYY-MM-DD. Default: account creation date." },
          until: { type: "string", description: "YYYY-MM-DD. Default: today." },
        },
        required: ["ad_account_id"],
      },
      handler: async (a) => {
        const id = assertAccountId(a.ad_account_id);
        const acct = await graph.request(id, { fields: BILLING_FIELDS });
        const view = billingView(acct);
        const until = a.until ?? new Date().toISOString().slice(0, 10);
        const since = a.since ?? (acct.created_time ? acct.created_time.slice(0, 10) : "2000-01-01");

        const page = await graph.paginate(`${id}/activities`, {
          since, until,
          fields: "event_type,event_time,actor_name,extra_data",
          limit: 500,
        });

        const charges = page.data
          .filter((e) => e.event_type === "ad_account_billing_charge")
          .map((e) => {
            const x = parseExtra(e.extra_data);
            return {
              time: e.event_time,
              amount: money(x.new_value),
              currency: x.currency ?? acct.currency,
              transaction_id: x.transaction_id ?? null,
            };
          })
          .sort((p, q) => p.time.localeCompare(q.time));

        const charged = Number(charges.reduce((s, c) => s + (c.amount ?? 0), 0).toFixed(2));
        const owed = view.outstanding_balance ?? 0;
        const lifetime = view.lifetime_spend;
        // charged + still-owed should equal lifetime spend; if not, charges are missing.
        const reconciles = lifetime !== null && Math.abs(charged + owed - lifetime) < 0.01;

        return {
          ad_account_id: id,
          currency: acct.currency,
          window: { since, until },
          charge_count: charges.length,
          total_charged: charged,
          outstanding_balance: owed,
          lifetime_spend: lifetime,
          reconciles: reconciles,
          unexplained_difference:
            lifetime === null ? null : Number((lifetime - charged - owed).toFixed(2)),
          current_payment_method: view.payment_method,
          truncated: page.truncated,
          charges,
          ...(reconciles
            ? {}
            : {
                warning:
                  "total_charged + outstanding_balance does not equal lifetime_spend. Charges are " +
                  "missing from this window (widen `since`) — do not treat this as the full history.",
              }),
          note:
            "Amounts are what Meta actually billed the card. The audit log does not name which card paid " +
            "each charge — pair with get_funding_history to see when cards were swapped.",
        };
      },
    },

    {
      name: "get_funding_history",
      description:
        "Timeline of payment-method and billing-state changes: cards added or removed, prepaid top-ups " +
        "(`funding_event_successful`), and every account status transition (Active ↔ Payment Needed ↔ " +
        "Grace Period). This is how many cards an account has actually used over its life — recovered from " +
        "the audit log, since the API exposes only the current funding source.",
      inputSchema: {
        type: "object",
        properties: {
          ad_account_id: ACCOUNT_ID,
          since: { type: "string", description: "YYYY-MM-DD. Default: account creation date." },
          until: { type: "string", description: "YYYY-MM-DD. Default: today." },
        },
        required: ["ad_account_id"],
      },
      handler: async (a) => {
        const id = assertAccountId(a.ad_account_id);
        const acct = await graph.request(id, { fields: BILLING_FIELDS });
        const view = billingView(acct);
        const until = a.until ?? new Date().toISOString().slice(0, 10);
        const since = a.since ?? (acct.created_time ? acct.created_time.slice(0, 10) : "2000-01-01");

        const page = await graph.paginate(`${id}/activities`, {
          since, until,
          fields: "event_type,event_time,actor_name,extra_data",
          limit: 500,
        });

        const KINDS = {
          add_funding_source: "card_added",
          remove_funding_source: "card_removed",
          funding_event_successful: "prepaid_topup",
          funding_event_initiated: "prepaid_topup_initiated",
          ad_account_update_status: "status_change",
        };

        const events = page.data
          .filter((e) => KINDS[e.event_type])
          .map((e) => {
            const x = parseExtra(e.extra_data);
            const kind = KINDS[e.event_type];
            return {
              time: e.event_time,
              kind,
              actor: e.actor_name ?? null,
              ...(kind === "status_change" ? { from: x.old_value, to: x.new_value } : {}),
              ...(kind.startsWith("prepaid") ? { amount: money(x.amount), currency: x.currency } : {}),
              ...(kind.startsWith("card")
                ? { method: x.payment_method?.__html ?? "Payment method (type not disclosed)" }
                : {}),
            };
          })
          .sort((p, q) => p.time.localeCompare(q.time));

        const removed = events.filter((e) => e.kind === "card_removed").length;
        const added = events.filter((e) => e.kind === "card_added").length;

        return {
          ad_account_id: id,
          window: { since, until },
          current_payment_method: view.payment_method,
          cards_removed: removed,
          cards_added: added,
          // Meta logs removals reliably but not always the original attachment, so the
          // floor is what was removed plus whatever is on file now.
          minimum_distinct_cards_used: removed + (view.payment_method ? 1 : 0),
          events,
          limitation:
            "The audit log records that a card was removed, not its brand or last 4 — Meta redacts those " +
            "to '“Credit/debit card”'. Only the CURRENT card's last 4 is available. Match removal " +
            "timestamps against card statements to identify which card was which.",
        };
      },
    },

    {
      name: "get_payment_methods",
      description:
        "Funding source currently charged for an ad account (card brand + last 4, or credit line). " +
        "States plainly that historical/replaced cards are not retrievable via the API.",
      inputSchema: {
        type: "object",
        properties: { ad_account_id: ACCOUNT_ID },
        required: ["ad_account_id"],
      },
      handler: async (a) => {
        const id = assertAccountId(a.ad_account_id);
        const acct = await graph.request(id, {
          fields: "id,name,currency,is_prepay_account,funding_source_details,balance,account_status",
        });
        const fs = acct.funding_source_details ?? null;
        return {
          ad_account_id: id,
          current_method: fs
            ? { id: fs.id, display: fs.display_string, type_code: fs.type }
            : null,
          prepaid: acct.is_prepay_account ?? null,
          outstanding_balance: money(acct.balance),
          status: ACCOUNT_STATUS[acct.account_status] ?? `UNKNOWN (${acct.account_status})`,
          limitation:
            "Meta exposes only the CURRENT funding source here. For cards used previously, call " +
            "get_funding_history — the audit log records every removal (brand/last-4 redacted). Which " +
            "card paid a specific charge is still not disclosed by any endpoint.",
        };
      },
    },

    {
      name: "list_unsettled_accounts",
      description:
        "Sweeps every ad account the token can see and returns those that owe Meta money or are not ACTIVE " +
        "(unsettled, disabled, in grace period, pending closure). Surfaces a stalled account before someone " +
        "notices campaigns stopped delivering.",
      inputSchema: {
        type: "object",
        properties: {
          include_all: {
            type: "boolean",
            description: "true returns every account, healthy ones included. Default false.",
          },
        },
      },
      handler: async (a) => {
        const page = await graph.paginate("me/adaccounts", { fields: BILLING_FIELDS });
        const all = page.data.map(billingView);
        const flagged = all.filter((x) => x.owes_money || !x.is_active);
        return {
          accounts_visible: all.length,
          flagged_count: flagged.length,
          total_outstanding_by_currency: flagged.reduce((acc, x) => {
            if (!x.outstanding_balance) return acc;
            acc[x.currency] = Number(((acc[x.currency] ?? 0) + x.outstanding_balance).toFixed(2));
            return acc;
          }, {}),
          accounts: a.include_all ? all : flagged,
          scope_caveat:
            "Only accounts this token can access are checked. Without business_management, " +
            "Business-Manager-owned accounts are invisible and this sweep is NOT exhaustive — " +
            "run check_scopes to confirm.",
        };
      },
    },

    {
      name: "check_scopes",
      description:
        "Reports which permissions the configured token actually holds, and which capabilities are therefore " +
        "unavailable. Use this whenever a listing comes back empty: Meta returns an empty array rather than " +
        "an error when a scope is missing, so 'no data' and 'no permission' look identical without it.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const [me, perms] = await Promise.all([
          graph.request("me", { fields: "id,name" }),
          graph.request("me/permissions", {}).catch(() => ({ data: [] })),
        ]);

        const granted = new Set(
          (perms.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission),
        );
        // System-user tokens return an empty permissions edge; absence is not proof of denial.
        const introspectable = (perms.data ?? []).length > 0;

        const capabilities = SCOPE_MAP.map((c) => ({
          capability: c.capability,
          required_scopes: c.scopes,
          missing: c.scopes.filter((s) => !granted.has(s)),
          available: introspectable ? c.scopes.every((s) => granted.has(s)) : "unknown",
        }));

        let accounts = null;
        try {
          const page = await graph.paginate("me/adaccounts", { fields: "id,name,business_country_code" });
          accounts = { visible: page.data.length, list: page.data };
        } catch (err) {
          accounts = { visible: 0, error: err.message };
        }

        return {
          token_identity: me,
          permissions_introspectable: introspectable,
          granted_scopes: [...granted],
          capabilities,
          ad_accounts: accounts,
          note: introspectable
            ? "Scopes read from /me/permissions."
            : "This token exposes no /me/permissions edge (typical for System User tokens). Scope " +
              "coverage cannot be verified here — judge by whether the calls you need actually return data.",
        };
      },
    },
  ];
}
