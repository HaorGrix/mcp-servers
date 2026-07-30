import { asArray, NamecheapClient, NamecheapError, splitDomain } from "./client.js";

export type HostRecord = {
  name: string;
  type: string;
  address: string;
  mxPref: string;
  ttl: string;
};

export type HostSet = {
  records: HostRecord[];
  /** Namecheap's email routing mode. It must be echoed back on write or forwarding breaks. */
  emailType: string;
  usingOurDns: boolean;
};

/** Record types Namecheap's advanced DNS accepts. */
export const RECORD_TYPES = [
  "A",
  "AAAA",
  "ALIAS",
  "CAA",
  "CNAME",
  "MX",
  "MXE",
  "NS",
  "TXT",
  "URL",
  "URL301",
  "FRAME",
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

function str(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

/** Reads the full current zone. Every write path starts here — never blind-write. */
export async function getHosts(client: NamecheapClient, domain: string): Promise<HostSet> {
  const { sld, tld } = splitDomain(domain);
  const response = await client.call("namecheap.domains.dns.getHosts", { SLD: sld, TLD: tld });

  const result = response["DomainDNSGetHostsResult"] as Record<string, unknown> | undefined;
  if (!result) {
    throw new NamecheapError("PARSE", `No DNS result returned for ${domain}.`);
  }

  const hosts = asArray(result["host"] as Record<string, unknown> | Record<string, unknown>[] | undefined);

  return {
    records: hosts.map((h) => ({
      name: str(h["Name"], "@"),
      type: str(h["Type"]),
      address: str(h["Address"]),
      mxPref: str(h["MXPref"], "10"),
      ttl: str(h["TTL"], "1799"),
    })),
    emailType: str(result["EmailType"], "NONE"),
    usingOurDns: str(result["IsUsingOurDNS"]).toLowerCase() === "true",
  };
}

/**
 * Writes the zone. Namecheap has no partial update: this sends the complete
 * desired state and anything omitted is deleted. Callers must always derive
 * `records` from a fresh getHosts.
 */
export async function setHosts(
  client: NamecheapClient,
  domain: string,
  records: HostRecord[],
  emailType: string,
): Promise<void> {
  const { sld, tld } = splitDomain(domain);

  if (records.length === 0) {
    throw new NamecheapError(
      "INPUT",
      `Refusing to write an empty record set to ${domain} — that would delete the entire zone.`,
    );
  }

  const params: Record<string, string> = { SLD: sld, TLD: tld };
  if (emailType && emailType !== "NONE") params["EmailType"] = emailType;

  records.forEach((record, index) => {
    const n = index + 1;
    params[`HostName${n}`] = record.name;
    params[`RecordType${n}`] = record.type;
    params[`Address${n}`] = record.address;
    params[`TTL${n}`] = record.ttl;
    if (record.type === "MX") params[`MXPref${n}`] = record.mxPref;
  });

  const response = await client.call("namecheap.domains.dns.setHosts", params);
  const result = response["DomainDNSSetHostsResult"] as Record<string, unknown> | undefined;
  if (result && str(result["IsSuccess"]).toLowerCase() === "false") {
    throw new NamecheapError("API", `Namecheap rejected the DNS update for ${domain}.`);
  }
}

/** Namecheap stores the apex as "@"; accept the bare domain or an empty string too. */
export function normalizeHostName(name: string | undefined, domain: string): string {
  const raw = (name ?? "@").trim();
  if (raw === "" || raw === "@" || raw.toLowerCase() === domain.toLowerCase()) return "@";
  const suffix = `.${domain.toLowerCase()}`;
  const lower = raw.toLowerCase();
  return lower.endsWith(suffix) ? raw.slice(0, raw.length - suffix.length) : raw;
}

export function matches(record: HostRecord, name: string, type: string): boolean {
  return record.name.toLowerCase() === name.toLowerCase() && record.type.toUpperCase() === type.toUpperCase();
}

export function formatRecords(records: HostRecord[]): string {
  if (records.length === 0) return "(no records)";
  const width = Math.max(...records.map((r) => r.name.length), 4);
  return records
    .map((r) => {
      const mx = r.type === "MX" ? ` pref=${r.mxPref}` : "";
      return `${r.name.padEnd(width)}  ${r.type.padEnd(6)} ttl=${r.ttl}${mx}  ${r.address}`;
    })
    .join("\n");
}
