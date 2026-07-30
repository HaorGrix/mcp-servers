import { z } from "zod";
import { asArray, NamecheapClient, NamecheapError, splitDomain } from "../client.js";
import { requireConfirmation } from "../guard.js";

function str(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

export const listDomainsSchema = z.object({
  search: z.string().optional().describe("Filter by a substring of the domain name."),
  pageSize: z.number().int().min(10).max(100).default(100).describe("Results per page (10-100)."),
});

export async function listDomains(
  client: NamecheapClient,
  args: z.infer<typeof listDomainsSchema>,
): Promise<string> {
  const params: Record<string, string> = { PageSize: String(args.pageSize) };
  if (args.search) params["SearchTerm"] = args.search;

  const response = await client.call("namecheap.domains.getList", params);
  const result = response["DomainGetListResult"] as Record<string, unknown> | undefined;
  const domains = asArray(result?.["Domain"] as Record<string, unknown> | Record<string, unknown>[] | undefined);

  if (domains.length === 0) return "No domains found in this Namecheap account.";

  const lines = domains.map((d) => {
    const expired = str(d["IsExpired"]).toLowerCase() === "true" ? " EXPIRED" : "";
    const locked = str(d["IsLocked"]).toLowerCase() === "true" ? " locked" : "";
    const autoRenew = str(d["AutoRenew"]).toLowerCase() === "true" ? " auto-renew" : "";
    return `${str(d["Name"])}  expires=${str(d["Expires"])}${expired}${locked}${autoRenew}`;
  });

  return `${domains.length} domain(s):\n${lines.join("\n")}`;
}

export const domainSchema = z.object({
  domain: z.string().describe("Fully qualified domain, e.g. example.com"),
});

export async function getDomain(
  client: NamecheapClient,
  args: z.infer<typeof domainSchema>,
): Promise<string> {
  const response = await client.call("namecheap.domains.getInfo", { DomainName: args.domain.trim() });
  const result = response["DomainGetInfoResult"] as Record<string, unknown> | undefined;
  if (!result) throw new NamecheapError("PARSE", `No information returned for ${args.domain}.`);

  const dns = result["DnsDetails"] as Record<string, unknown> | undefined;
  const nameservers = asArray(dns?.["Nameserver"] as string | string[] | undefined).map(String);
  const whois = result["Whoisguard"] as Record<string, unknown> | undefined;

  return [
    `Domain:       ${str(result["DomainName"], args.domain)}`,
    `Status:       ${str(result["Status"])}`,
    `Created:      ${str((result["DomainDetails"] as Record<string, unknown> | undefined)?.["CreatedDate"])}`,
    `Expires:      ${str((result["DomainDetails"] as Record<string, unknown> | undefined)?.["ExpiredDate"])}`,
    `DNS provider: ${str(dns?.["ProviderType"], "unknown")}`,
    `Nameservers:  ${nameservers.length > 0 ? nameservers.join(", ") : "(none reported)"}`,
    `WhoisGuard:   ${str(whois?.["Enabled"], "unknown")}`,
  ].join("\n");
}

export const checkSchema = z.object({
  domains: z.array(z.string()).min(1).max(50).describe("Domains to check for availability."),
});

export async function checkAvailability(
  client: NamecheapClient,
  args: z.infer<typeof checkSchema>,
): Promise<string> {
  const response = await client.call("namecheap.domains.check", {
    DomainList: args.domains.map((d) => d.trim()).join(","),
  });

  const results = asArray(
    response["DomainCheckResult"] as Record<string, unknown> | Record<string, unknown>[] | undefined,
  );

  if (results.length === 0) return "Namecheap returned no availability results.";

  return results
    .map((r) => {
      const available = str(r["Available"]).toLowerCase() === "true";
      const premium = str(r["IsPremiumName"]).toLowerCase() === "true" ? " (premium)" : "";
      return `${str(r["Domain"])}: ${available ? "available" : "taken"}${premium}`;
    })
    .join("\n");
}

export async function getNameservers(
  client: NamecheapClient,
  args: z.infer<typeof domainSchema>,
): Promise<string> {
  const { sld, tld } = splitDomain(args.domain);
  const response = await client.call("namecheap.domains.dns.getList", { SLD: sld, TLD: tld });
  const result = response["DomainDNSGetListResult"] as Record<string, unknown> | undefined;
  const nameservers = asArray(result?.["Nameserver"] as string | string[] | undefined).map(String);
  const usingNamecheap = str(result?.["IsUsingOurDNS"]).toLowerCase() === "true";

  return [
    `Domain:            ${args.domain}`,
    `Using Namecheap DNS: ${usingNamecheap ? "yes (BasicDNS/PremiumDNS)" : "no — delegated elsewhere"}`,
    `Nameservers:`,
    ...nameservers.map((ns) => `  ${ns}`),
    usingNamecheap
      ? ""
      : `\nNote: DNS record tools in this server only affect the zone when Namecheap hosts it. ` +
        `While delegated elsewhere, records must be edited at the provider above.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const setNameserversSchema = z.object({
  domain: z.string().describe("Domain to re-delegate."),
  nameservers: z
    .array(z.string())
    .min(2)
    .max(12)
    .describe("Full nameserver hostnames, e.g. ns1.vercel-dns.com"),
  confirm: z.string().optional().describe("Echo the domain name exactly to confirm."),
});

export async function setNameservers(
  client: NamecheapClient,
  args: z.infer<typeof setNameserversSchema>,
): Promise<string> {
  client.assertWritable("namecheap_set_nameservers");
  requireConfirmation(
    "namecheap_set_nameservers",
    args.domain,
    args.confirm,
    "Changing nameservers moves the entire zone to another provider. Every DNS record hosted at " +
      "Namecheap stops being served immediately, including mail routing.",
  );

  const { sld, tld } = splitDomain(args.domain);
  await client.call("namecheap.domains.dns.setCustom", {
    SLD: sld,
    TLD: tld,
    Nameservers: args.nameservers.map((n) => n.trim()).join(","),
  });

  return (
    `Nameservers for ${args.domain} set to:\n${args.nameservers.map((n) => `  ${n}`).join("\n")}\n\n` +
    `Delegation changes can take up to 48 hours to propagate. Namecheap-hosted DNS records ` +
    `are no longer authoritative for this domain.`
  );
}

export const useNamecheapDnsSchema = z.object({
  domain: z.string().describe("Domain to move back to Namecheap BasicDNS."),
  confirm: z.string().optional().describe("Echo the domain name exactly to confirm."),
});

export async function useNamecheapDns(
  client: NamecheapClient,
  args: z.infer<typeof useNamecheapDnsSchema>,
): Promise<string> {
  client.assertWritable("namecheap_use_namecheap_dns");
  requireConfirmation(
    "namecheap_use_namecheap_dns",
    args.domain,
    args.confirm,
    "This re-delegates the domain to Namecheap BasicDNS. Records served by the current provider " +
      "stop resolving, and the Namecheap zone may be empty or stale.",
  );

  const { sld, tld } = splitDomain(args.domain);
  await client.call("namecheap.domains.dns.setDefault", { SLD: sld, TLD: tld });

  return (
    `${args.domain} now uses Namecheap BasicDNS. ` +
    `Check the record set with namecheap_list_dns_records before relying on it — ` +
    `the Namecheap zone may not contain what the previous provider was serving.`
  );
}
