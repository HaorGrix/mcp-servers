import { z } from "zod";
import { NamecheapClient, NamecheapError } from "../client.js";
import { assertNoSilentLoss, requireConfirmation } from "../guard.js";
import {
  formatRecords,
  getHosts,
  type HostRecord,
  matches,
  normalizeHostName,
  RECORD_TYPES,
  setHosts,
} from "../dns.js";

const recordTypeEnum = z.enum(RECORD_TYPES);

export const listSchema = z.object({
  domain: z.string().describe("Domain whose zone should be listed."),
  type: recordTypeEnum.optional().describe("Only show records of this type."),
});

export async function listRecords(
  client: NamecheapClient,
  args: z.infer<typeof listSchema>,
): Promise<string> {
  const set = await getHosts(client, args.domain);
  const records = args.type
    ? set.records.filter((r) => r.type.toUpperCase() === args.type?.toUpperCase())
    : set.records;

  const header =
    `${args.domain} — ${records.length} record(s)` +
    (set.usingOurDns ? "" : "\nWARNING: this domain is delegated away from Namecheap; these records are NOT live.") +
    (set.emailType && set.emailType !== "NONE" ? `\nEmail routing mode: ${set.emailType}` : "");

  return `${header}\n\n${formatRecords(records)}`;
}

export const addSchema = z.object({
  domain: z.string().describe("Domain to add the record to."),
  name: z.string().default("@").describe('Host, e.g. "@" for the apex, "www", or "mail".'),
  type: recordTypeEnum.describe("Record type."),
  value: z.string().describe("Record value — IP, target hostname, or TXT content."),
  ttl: z.number().int().min(60).max(60000).default(1799).describe("TTL in seconds (60-60000)."),
  mxPref: z.number().int().min(0).max(65535).default(10).describe("MX priority. Ignored for other types."),
  replaceExisting: z
    .boolean()
    .default(false)
    .describe("Replace any existing records with the same name and type instead of adding alongside."),
});

export async function addRecord(
  client: NamecheapClient,
  args: z.infer<typeof addSchema>,
): Promise<string> {
  client.assertWritable("namecheap_add_dns_record");

  const set = await getHosts(client, args.domain);
  const name = normalizeHostName(args.name, args.domain);

  const kept = args.replaceExisting
    ? set.records.filter((r) => !matches(r, name, args.type))
    : [...set.records];

  const record: HostRecord = {
    name,
    type: args.type,
    address: args.value,
    mxPref: String(args.mxPref),
    ttl: String(args.ttl),
  };

  const duplicate = kept.some(
    (r) => matches(r, name, args.type) && r.address.trim() === args.value.trim(),
  );
  if (duplicate) {
    return `${args.domain} already has ${args.type} ${name} -> ${args.value}. No change made.`;
  }

  const next = [...kept, record];
  await setHosts(client, args.domain, next, set.emailType);

  const removed = set.records.length - kept.length;
  return (
    `Added ${args.type} ${name} -> ${args.value} (ttl ${args.ttl}) to ${args.domain}.` +
    (removed > 0 ? ` Replaced ${removed} existing ${args.type} record(s) with the same host.` : "") +
    `\nZone now has ${next.length} record(s).`
  );
}

export const updateSchema = z.object({
  domain: z.string().describe("Domain to update."),
  name: z.string().default("@").describe("Host of the record to update."),
  type: recordTypeEnum.describe("Type of the record to update."),
  value: z.string().describe("New value."),
  ttl: z.number().int().min(60).max(60000).optional().describe("New TTL, if changing."),
  matchValue: z
    .string()
    .optional()
    .describe("Only update the record whose current value is this. Required when several records share the host and type."),
});

export async function updateRecord(
  client: NamecheapClient,
  args: z.infer<typeof updateSchema>,
): Promise<string> {
  client.assertWritable("namecheap_update_dns_record");

  const set = await getHosts(client, args.domain);
  const name = normalizeHostName(args.name, args.domain);

  const candidates = set.records.filter(
    (r) => matches(r, name, args.type) && (args.matchValue ? r.address.trim() === args.matchValue.trim() : true),
  );

  if (candidates.length === 0) {
    throw new NamecheapError("INPUT", `No ${args.type} record for "${name}" on ${args.domain} matched.`);
  }
  if (candidates.length > 1) {
    throw new NamecheapError(
      "INPUT",
      `${candidates.length} ${args.type} records for "${name}" match. Pass matchValue to pick one:\n` +
        candidates.map((c) => `  ${c.address}`).join("\n"),
    );
  }

  const target = candidates[0];
  if (!target) throw new NamecheapError("INPUT", "No matching record.");

  const previous = target.address;
  const next = set.records.map((r) =>
    r === target
      ? { ...r, address: args.value, ttl: args.ttl === undefined ? r.ttl : String(args.ttl) }
      : r,
  );

  await setHosts(client, args.domain, next, set.emailType);
  return `Updated ${args.type} ${name} on ${args.domain}:\n  was: ${previous}\n  now: ${args.value}`;
}

export const deleteSchema = z.object({
  domain: z.string().describe("Domain to delete from."),
  name: z.string().default("@").describe("Host of the record to delete."),
  type: recordTypeEnum.describe("Type of the record to delete."),
  matchValue: z.string().optional().describe("Only delete the record with this exact value."),
  confirm: z.string().optional().describe("Echo the domain name exactly to confirm."),
});

export async function deleteRecord(
  client: NamecheapClient,
  args: z.infer<typeof deleteSchema>,
): Promise<string> {
  client.assertWritable("namecheap_delete_dns_record");
  requireConfirmation(
    "namecheap_delete_dns_record",
    args.domain,
    args.confirm,
    "Deleting a DNS record takes effect as soon as caches expire and can break mail, " +
      "domain verification, or the site itself.",
  );

  const set = await getHosts(client, args.domain);
  const name = normalizeHostName(args.name, args.domain);

  const doomed = set.records.filter(
    (r) => matches(r, name, args.type) && (args.matchValue ? r.address.trim() === args.matchValue.trim() : true),
  );

  if (doomed.length === 0) {
    return `No ${args.type} record for "${name}" on ${args.domain} matched. Nothing deleted.`;
  }

  const next = set.records.filter((r) => !doomed.includes(r));
  assertNoSilentLoss(set.records.length, next.length, true);

  await setHosts(client, args.domain, next, set.emailType);

  return (
    `Deleted ${doomed.length} record(s) from ${args.domain}:\n` +
    doomed.map((d) => `  ${d.type} ${d.name} -> ${d.address}`).join("\n") +
    `\nZone now has ${next.length} record(s).`
  );
}

export const replaceAllSchema = z.object({
  domain: z.string().describe("Domain whose zone should be replaced wholesale."),
  records: z
    .array(
      z.object({
        name: z.string().default("@"),
        type: recordTypeEnum,
        value: z.string(),
        ttl: z.number().int().min(60).max(60000).default(1799),
        mxPref: z.number().int().min(0).max(65535).default(10),
      }),
    )
    .min(1)
    .describe("The complete desired zone. Anything not listed here is deleted."),
  confirm: z.string().optional().describe("Echo the domain name exactly to confirm."),
});

export async function replaceAllRecords(
  client: NamecheapClient,
  args: z.infer<typeof replaceAllSchema>,
): Promise<string> {
  client.assertWritable("namecheap_replace_all_dns_records");
  requireConfirmation(
    "namecheap_replace_all_dns_records",
    args.domain,
    args.confirm,
    "This overwrites the entire zone. Every record you did not include will be deleted.",
  );

  const set = await getHosts(client, args.domain);
  const next: HostRecord[] = args.records.map((r) => ({
    name: normalizeHostName(r.name, args.domain),
    type: r.type,
    address: r.value,
    mxPref: String(r.mxPref),
    ttl: String(r.ttl),
  }));

  await setHosts(client, args.domain, next, set.emailType);

  return (
    `Replaced the zone for ${args.domain}.\n` +
    `Before: ${set.records.length} record(s)\nAfter:  ${next.length} record(s)\n\n` +
    `Previous zone (for recovery):\n${formatRecords(set.records)}`
  );
}
