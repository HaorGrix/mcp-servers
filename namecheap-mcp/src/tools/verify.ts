import { Resolver } from "node:dns/promises";
import { z } from "zod";

/**
 * Live DNS verification.
 *
 * The Namecheap API reports what is *configured*; it cannot tell you what the
 * world actually resolves. These tools query public resolvers directly so a
 * change can be confirmed as propagated rather than merely submitted.
 */

const PUBLIC_RESOLVERS: Record<string, string[]> = {
  google: ["8.8.8.8", "8.8.4.4"],
  cloudflare: ["1.1.1.1", "1.0.0.1"],
  quad9: ["9.9.9.9"],
};

function resolverFor(name: string): Resolver {
  const resolver = new Resolver();
  const servers = PUBLIC_RESOLVERS[name];
  if (servers) resolver.setServers(servers);
  return resolver;
}

async function attempt<T>(fn: () => Promise<T>): Promise<T | string> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code ?? "";
    if (code === "ENODATA" || code === "ENOTFOUND") return "(none)";
    return `(lookup failed: ${code || (err instanceof Error ? err.message : String(err))})`;
  }
}

function render(label: string, value: unknown): string {
  if (typeof value === "string") return `${label}: ${value}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${label}: (none)`;
    return `${label}:\n${value.map((v) => `  ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n")}`;
  }
  return `${label}: ${JSON.stringify(value)}`;
}

export const verifySchema = z.object({
  domain: z.string().describe("Domain or hostname to resolve."),
  resolver: z.enum(["google", "cloudflare", "quad9", "system"]).default("google").describe("Which public resolver to query."),
});

export async function verifyDns(args: z.infer<typeof verifySchema>): Promise<string> {
  const resolver = resolverFor(args.resolver);
  const domain = args.domain.trim().replace(/\.$/, "");

  const [a, aaaa, cname, mx, ns, txt] = await Promise.all([
    attempt(() => resolver.resolve4(domain)),
    attempt(() => resolver.resolve6(domain)),
    attempt(() => resolver.resolveCname(domain)),
    attempt(() => resolver.resolveMx(domain)),
    attempt(() => resolver.resolveNs(domain)),
    attempt(() => resolver.resolveTxt(domain)),
  ]);

  const txtFlat = Array.isArray(txt) ? txt.map((chunks) => (Array.isArray(chunks) ? chunks.join("") : String(chunks))) : txt;
  const mxFlat = Array.isArray(mx)
    ? mx.map((m) => (typeof m === "object" && m !== null && "exchange" in m ? `${m.priority} ${m.exchange}` : String(m)))
    : mx;

  return [
    `Live DNS for ${domain} (via ${args.resolver})`,
    "",
    render("A", a),
    render("AAAA", aaaa),
    render("CNAME", cname),
    render("MX", mxFlat),
    render("NS", ns),
    render("TXT", txtFlat),
  ].join("\n");
}

export const verifyEmailAuthSchema = z.object({
  domain: z.string().describe("Domain to check."),
  dkimSelectors: z.array(z.string()).default([]).describe("DKIM selectors to probe, e.g. [\"google\", \"resend\"]."),
  resolver: z.enum(["google", "cloudflare", "quad9", "system"]).default("google"),
});

export async function verifyEmailAuth(args: z.infer<typeof verifyEmailAuthSchema>): Promise<string> {
  const resolver = resolverFor(args.resolver);
  const domain = args.domain.trim().replace(/\.$/, "");

  const flatten = (value: string[][] | string): string[] | string =>
    typeof value === "string" ? value : value.map((chunks) => chunks.join(""));

  const apex = flatten((await attempt(() => resolver.resolveTxt(domain))) as string[][] | string);
  const dmarcRaw = flatten((await attempt(() => resolver.resolveTxt(`_dmarc.${domain}`))) as string[][] | string);

  const lines: string[] = [`Live email authentication for ${domain} (via ${args.resolver})`, ""];

  const spf = Array.isArray(apex) ? apex.filter((t) => t.toLowerCase().startsWith("v=spf1")) : [];
  if (!Array.isArray(apex)) lines.push(`SPF:   ${apex}`);
  else if (spf.length === 0) lines.push("SPF:   NOT PUBLISHED");
  else if (spf.length > 1) lines.push(`SPF:   INVALID — ${spf.length} records published (must be exactly one)`);
  else lines.push(`SPF:   ${spf[0]}`);

  const dmarc = Array.isArray(dmarcRaw) ? dmarcRaw.filter((t) => t.toLowerCase().startsWith("v=dmarc1")) : [];
  if (!Array.isArray(dmarcRaw)) lines.push(`DMARC: ${dmarcRaw}`);
  else if (dmarc.length === 0) lines.push("DMARC: NOT PUBLISHED");
  else lines.push(`DMARC: ${dmarc[0]}`);

  if (args.dkimSelectors.length === 0) {
    lines.push("DKIM:  no selectors supplied — DKIM cannot be discovered from DNS, ask your mail provider.");
  } else {
    for (const selector of args.dkimSelectors) {
      const clean = selector.replace(/\._domainkey.*$/i, "");
      const value = flatten(
        (await attempt(() => resolver.resolveTxt(`${clean}._domainkey.${domain}`))) as string[][] | string,
      );
      if (!Array.isArray(value)) lines.push(`DKIM ${clean}: ${value}`);
      else if (value.length === 0) lines.push(`DKIM ${clean}: NOT PUBLISHED`);
      else lines.push(`DKIM ${clean}: published (${value[0]?.slice(0, 50)}…)`);
    }
  }

  return lines.join("\n");
}
