import { z } from "zod";
import { NamecheapClient, NamecheapError } from "../client.js";
import { getHosts, type HostRecord, matches, setHosts } from "../dns.js";

/** Strips the quoting Namecheap and dig both apply to TXT values. */
function unquote(value: string): string {
  return value.replace(/^"|"$/g, "").replace(/"\s+"/g, "");
}

function upsert(
  records: HostRecord[],
  name: string,
  type: string,
  address: string,
  ttl: string,
  predicate?: (existing: HostRecord) => boolean,
): { next: HostRecord[]; replaced: string[] } {
  const replaced: string[] = [];
  const kept = records.filter((r) => {
    if (!matches(r, name, type)) return true;
    if (predicate && !predicate(r)) return true;
    replaced.push(r.address);
    return false;
  });
  return { next: [...kept, { name, type, address, mxPref: "10", ttl }], replaced };
}

// ---------- SPF ----------

export const spfSchema = z.object({
  domain: z.string().describe("Domain to set SPF for."),
  value: z
    .string()
    .optional()
    .describe('Complete SPF record. If omitted, one is built from the other fields.'),
  include: z
    .array(z.string())
    .default([])
    .describe('Sending services to authorise, e.g. ["spf.protection.outlook.com", "_spf.google.com"].'),
  ip4: z.array(z.string()).default([]).describe("IPv4 addresses or CIDR ranges permitted to send."),
  ip6: z.array(z.string()).default([]).describe("IPv6 addresses or CIDR ranges permitted to send."),
  policy: z
    .enum(["-all", "~all", "?all"])
    .default("~all")
    .describe("-all rejects unlisted senders, ~all soft-fails (safer to start with), ?all is neutral."),
  ttl: z.number().int().min(60).max(60000).default(1799),
});

export async function setSpf(client: NamecheapClient, args: z.infer<typeof spfSchema>): Promise<string> {
  client.assertWritable("namecheap_set_spf");

  let value = args.value?.trim();
  if (!value) {
    const parts = [
      "v=spf1",
      ...args.ip4.map((ip) => `ip4:${ip}`),
      ...args.ip6.map((ip) => `ip6:${ip}`),
      ...args.include.map((inc) => `include:${inc}`),
      args.policy,
    ];
    value = parts.join(" ");
  }

  if (!value.startsWith("v=spf1")) {
    throw new NamecheapError("INPUT", `An SPF record must start with "v=spf1". Got: ${value}`);
  }
  if (value.length > 255) {
    throw new NamecheapError(
      "INPUT",
      `SPF record is ${value.length} characters; a single TXT string cannot exceed 255. Reduce the number of includes.`,
    );
  }

  const lookups = (value.match(/\b(include|a|mx|ptr|exists|redirect):?/g) ?? []).length;
  const warning =
    lookups > 10
      ? `\n\nWARNING: this record implies about ${lookups} DNS lookups. SPF fails permanently above 10.`
      : "";

  const set = await getHosts(client, args.domain);
  const { next, replaced } = upsert(set.records, "@", "TXT", value, String(args.ttl), (r) =>
    unquote(r.address).toLowerCase().startsWith("v=spf1"),
  );

  await setHosts(client, args.domain, next, set.emailType);

  return (
    `SPF set on ${args.domain}:\n  ${value}` +
    (replaced.length > 0 ? `\n\nReplaced previous SPF record(s):\n${replaced.map((r) => `  ${r}`).join("\n")}` : "") +
    warning
  );
}

// ---------- DKIM ----------

export const dkimSchema = z.object({
  domain: z.string().describe("Domain to set DKIM for."),
  selector: z.string().describe('DKIM selector supplied by your mail provider, e.g. "google" or "resend".'),
  value: z
    .string()
    .describe('The full TXT value, e.g. "v=DKIM1; k=rsa; p=MIGfMA0..." — copy it exactly from the provider.'),
  ttl: z.number().int().min(60).max(60000).default(1799),
});

export async function setDkim(client: NamecheapClient, args: z.infer<typeof dkimSchema>): Promise<string> {
  client.assertWritable("namecheap_set_dkim");

  const selector = args.selector.trim().replace(/\._domainkey.*$/i, "");
  const host = `${selector}._domainkey`;
  const value = unquote(args.value.trim());

  if (!/p=/.test(value)) {
    throw new NamecheapError("INPUT", `A DKIM record must contain a public key ("p="). Got: ${value.slice(0, 80)}`);
  }

  const set = await getHosts(client, args.domain);
  const { next, replaced } = upsert(set.records, host, "TXT", value, String(args.ttl));

  await setHosts(client, args.domain, next, set.emailType);

  const note =
    value.length > 255
      ? `\n\nNote: this key is ${value.length} characters. Namecheap splits long TXT values automatically, ` +
        `but verify with namecheap_verify_email_auth that it resolves as a single joined string.`
      : "";

  return (
    `DKIM set on ${args.domain}:\n  ${host}  TXT  ${value.slice(0, 60)}…` +
    (replaced.length > 0 ? `\n\nReplaced the previous key for this selector.` : "") +
    note
  );
}

// ---------- DMARC ----------

export const dmarcSchema = z.object({
  domain: z.string().describe("Domain to set DMARC for."),
  policy: z
    .enum(["none", "quarantine", "reject"])
    .default("none")
    .describe("Start at none to collect reports, then tighten to quarantine and finally reject."),
  subdomainPolicy: z.enum(["none", "quarantine", "reject"]).optional().describe("Policy for subdomains (sp=)."),
  reportEmail: z.string().optional().describe("Address for aggregate reports (rua=)."),
  forensicEmail: z.string().optional().describe("Address for failure reports (ruf=)."),
  percentage: z.number().int().min(1).max(100).default(100).describe("Percentage of mail the policy applies to."),
  ttl: z.number().int().min(60).max(60000).default(1799),
});

export async function setDmarc(client: NamecheapClient, args: z.infer<typeof dmarcSchema>): Promise<string> {
  client.assertWritable("namecheap_set_dmarc");

  const parts = [`v=DMARC1`, `p=${args.policy}`];
  if (args.subdomainPolicy) parts.push(`sp=${args.subdomainPolicy}`);
  if (args.reportEmail) parts.push(`rua=mailto:${args.reportEmail.replace(/^mailto:/, "")}`);
  if (args.forensicEmail) parts.push(`ruf=mailto:${args.forensicEmail.replace(/^mailto:/, "")}`);
  if (args.percentage !== 100) parts.push(`pct=${args.percentage}`);
  const value = parts.join("; ");

  const set = await getHosts(client, args.domain);
  const { next, replaced } = upsert(set.records, "_dmarc", "TXT", value, String(args.ttl));

  await setHosts(client, args.domain, next, set.emailType);

  const advice =
    args.policy === "reject" && replaced.length === 0
      ? `\n\nWARNING: starting straight at p=reject will bounce any legitimate mail that is not yet ` +
        `covered by SPF or DKIM. p=none first, with rua reporting, is the safe order.`
      : "";

  return `DMARC set on ${args.domain}:\n  _dmarc  TXT  ${value}${advice}`;
}

// ---------- inspection ----------

export const auditSchema = z.object({
  domain: z.string().describe("Domain to audit."),
  dkimSelectors: z
    .array(z.string())
    .default([])
    .describe("Selectors to look for, since DKIM selectors cannot be enumerated from DNS."),
});

export async function auditEmailAuth(
  client: NamecheapClient,
  args: z.infer<typeof auditSchema>,
): Promise<string> {
  const set = await getHosts(client, args.domain);
  const txt = set.records.filter((r) => r.type.toUpperCase() === "TXT");

  const spf = txt.filter((r) => r.name === "@" && unquote(r.address).toLowerCase().startsWith("v=spf1"));
  const dmarc = txt.filter((r) => r.name.toLowerCase() === "_dmarc");
  const dkim = txt.filter((r) => r.name.toLowerCase().includes("._domainkey"));
  const mx = set.records.filter((r) => r.type.toUpperCase() === "MX");

  const findings: string[] = [];

  if (spf.length === 0) findings.push("SPF: MISSING — senders cannot be authorised and mail is likely to be spam-foldered.");
  else if (spf.length > 1) findings.push(`SPF: INVALID — ${spf.length} SPF records found. More than one is a permanent error; merge them.`);
  else {
    const value = unquote(spf[0]?.address ?? "");
    const lookups = (value.match(/\b(include|a|mx|ptr|exists|redirect):/g) ?? []).length;
    findings.push(`SPF: ok — ${value}`);
    if (lookups > 10) findings.push(`  WARNING: ~${lookups} DNS lookups; the limit is 10.`);
    if (/\+all/.test(value)) findings.push("  WARNING: +all authorises the entire internet to send as you.");
  }

  if (dmarc.length === 0) findings.push("DMARC: MISSING — no policy tells receivers what to do with failures, and you get no reports.");
  else {
    const value = unquote(dmarc[0]?.address ?? "");
    findings.push(`DMARC: ok — ${value}`);
    if (/p=none/.test(value) && !/rua=/.test(value)) {
      findings.push("  NOTE: p=none with no rua= address does nothing useful. Add a reporting address.");
    }
  }

  if (dkim.length === 0) {
    findings.push(
      "DKIM: none found in the zone" +
        (args.dkimSelectors.length > 0 ? ` for the selectors you named.` : ". Provide dkimSelectors to check specific ones."),
    );
  } else {
    findings.push(`DKIM: ${dkim.length} key(s) — ${dkim.map((d) => d.name).join(", ")}`);
  }

  findings.push(mx.length === 0 ? "MX: none — this domain cannot receive mail." : `MX: ${mx.length} record(s)`);

  return (
    `Email authentication audit for ${args.domain}\n` +
    (set.usingOurDns ? "" : "WARNING: domain is delegated away from Namecheap; the live zone may differ.\n") +
    `\n${findings.join("\n")}`
  );
}
