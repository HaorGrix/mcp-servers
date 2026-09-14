/** Lead Ads / Instant Forms: forms, submitted leads, form creation, test leads. */
import { z } from "zod";
import type { Register } from "../context.js";
import { guarded } from "../respond.js";
import { assertWrites, resolveId } from "../guard.js";

interface Lead { id: string; created_time: string; ad_id?: string; adset_id?: string; campaign_id?: string; form_id?: string; is_organic?: boolean; platform?: string; field_data: Array<{ name: string; values: string[] }> }

const flatten = (l: Lead) => ({ id: l.id, created_time: l.created_time, ad_id: l.ad_id, campaign_id: l.campaign_id, form_id: l.form_id, is_organic: l.is_organic, platform: l.platform, ...Object.fromEntries(l.field_data.map((f) => [f.name, f.values.join(", ")])) });

export const registerLeads: Register = ({ server, client, config }) => {
  const withPage = async (id?: string) => {
    const p = resolveId(id, config.defaults.pageId, "pageId", "META_PAGE_ID");
    return { p, opts: { token: await client.pageToken(p) } };
  };

  server.tool("meta_lead_forms", "Instant Forms on the Page with status, lead count, and questions.", { pageId: z.string().optional() }, guarded(async ({ pageId }) => {
    await client.requireScopes("leads_retrieval");
    const { p, opts } = await withPage(pageId);
    return client.getAll(`${p}/leadgen_forms`, { fields: "id,name,status,leads_count,created_time,locale,questions,privacy_policy_url,follow_up_action_url,context_card,thank_you_page" }, opts);
  }));

  server.tool("meta_lead_form_leads", "Leads submitted to a form, flattened to one row per lead. Filter by time. Includes organic (non-ad) leads.", { formId: z.string(), pageId: z.string().optional(), since: z.string().optional(), until: z.string().optional(), limit: z.number().optional() }, guarded(async ({ formId, pageId, since, until, limit }) => {
    await client.requireScopes("leads_retrieval");
    const { opts } = await withPage(pageId);
    const filtering = since || until ? JSON.stringify([
      ...(since ? [{ field: "time_created", operator: "GREATER_THAN", value: Math.floor(new Date(since).getTime() / 1000) }] : []),
      ...(until ? [{ field: "time_created", operator: "LESS_THAN", value: Math.floor(new Date(until).getTime() / 1000) }] : []),
    ]) : undefined;
    const leads = await client.getAll<Lead>(`${formId}/leads`, { fields: "id,created_time,ad_id,adset_id,campaign_id,form_id,is_organic,platform,field_data", filtering, limit: limit ?? 100 }, opts, Math.ceil((limit ?? 100) / 100));
    return leads.map(flatten);
  }));

  server.tool("meta_lead_get", "One lead by id (from a webhook leadgen event).", { leadId: z.string(), pageId: z.string().optional() }, guarded(async ({ leadId, pageId }) => {
    const { opts } = await withPage(pageId);
    return flatten(await client.get<Lead>(leadId, { fields: "id,created_time,ad_id,adset_id,campaign_id,form_id,is_organic,platform,field_data" }, opts));
  }));

  server.tool("meta_page_all_leads", "All leads across every form on the Page since a date (for CRM sync).", { pageId: z.string().optional(), since: z.string().optional() }, guarded(async ({ pageId, since }) => {
    await client.requireScopes("leads_retrieval");
    const { p, opts } = await withPage(pageId);
    const forms = await client.getAll<{ id: string; name: string }>(`${p}/leadgen_forms`, { fields: "id,name" }, opts);
    const filtering = since ? JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: Math.floor(new Date(since).getTime() / 1000) }]) : undefined;
    const out = await Promise.all(forms.map(async (f) => ({ form: f, leads: (await client.getAll<Lead>(`${f.id}/leads`, { fields: "id,created_time,ad_id,campaign_id,is_organic,platform,field_data", filtering }, opts)).map(flatten) })));
    return out;
  }));

  server.tool(
    "meta_lead_form_create",
    "Create an Instant Form. questions: [{type:'EMAIL'},{type:'FULL_NAME'},{type:'PHONE'},{type:'CUSTOM',key:'budget',label:'Budget?',options:[{key:'a',value:'<1k'}]}]. Forms cannot be edited after creation, only archived.",
    { pageId: z.string().optional(), name: z.string(), questions: z.array(z.record(z.unknown())).min(1), privacyPolicyUrl: z.string(), followUpActionUrl: z.string().optional(), locale: z.string().optional(), contextCard: z.object({ title: z.string(), style: z.enum(["PARAGRAPH_STYLE", "LIST_STYLE"]).optional(), content: z.array(z.string()) }).optional(), thankYouPage: z.object({ title: z.string(), body: z.string(), button_text: z.string().optional(), button_type: z.enum(["VIEW_WEBSITE", "CALL_BUSINESS"]).optional(), website_url: z.string().optional() }).optional() },
    guarded(async ({ pageId, name, questions, privacyPolicyUrl, followUpActionUrl, locale, contextCard, thankYouPage }) => {
      assertWrites(config, "Create lead form");
      const { p, opts } = await withPage(pageId);
      return client.post(`${p}/leadgen_forms`, { name, questions, privacy_policy: { url: privacyPolicyUrl }, follow_up_action_url: followUpActionUrl, locale: locale ?? "en_US", context_card: contextCard, thank_you_page: thankYouPage }, opts);
    }),
  );

  server.tool("meta_lead_form_archive", "Archive (status=ARCHIVED) or reactivate (ACTIVE) a form.", { formId: z.string(), pageId: z.string().optional(), status: z.enum(["ARCHIVED", "ACTIVE"]) }, guarded(async ({ formId, pageId, status }) => {
    assertWrites(config, "Archive form");
    const { opts } = await withPage(pageId);
    return client.post(formId, { status }, opts);
  }));

  server.tool("meta_lead_test_leads", "Test leads created via the Lead Ads Testing Tool for a form (for CRM integration checks).", { formId: z.string(), pageId: z.string().optional() }, guarded(async ({ formId, pageId }) => {
    const { opts } = await withPage(pageId);
    return client.getAll<Lead>(`${formId}/test_leads`, { fields: "id,created_time,field_data" }, opts).then((r) => r.map(flatten));
  }));
};
