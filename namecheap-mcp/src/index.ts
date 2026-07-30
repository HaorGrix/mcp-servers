#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  MissingCredentialsError,
  NamecheapClient,
  NamecheapError,
  WritesDisabledError,
} from "./client.js";
import { ConfirmationRequiredError, UnsafeOperationError } from "./guard.js";
import * as domains from "./tools/domains.js";
import * as records from "./tools/records.js";
import * as email from "./tools/email.js";
import * as verify from "./tools/verify.js";

const client = new NamecheapClient();

const server = new McpServer({ name: "namecheap-mcp", version: "1.0.0" });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/**
 * Single error boundary. Every tool goes through here so a failure returns a
 * usable message instead of crashing the transport, and so no credential value
 * can leak into an error string.
 */
function wrap<A>(name: string, fn: (args: A) => Promise<string>): (args: A) => Promise<ToolResult> {
  return async (args: A): Promise<ToolResult> => {
    try {
      return { content: [{ type: "text", text: await fn(args) }] };
    } catch (err) {
      let text: string;
      if (
        err instanceof ConfirmationRequiredError ||
        err instanceof UnsafeOperationError ||
        err instanceof WritesDisabledError ||
        err instanceof MissingCredentialsError
      ) {
        text = err.message;
      } else if (err instanceof NamecheapError) {
        text = `Namecheap API error (${err.code}): ${err.message}`;
      } else {
        text = `${name} failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      return { content: [{ type: "text", text }], isError: true };
    }
  };
}

const READ_ONLY = "Read-only.";
const WRITE = "Requires NAMECHEAP_ALLOW_WRITES=true.";
const DESTRUCTIVE = "DESTRUCTIVE. Requires NAMECHEAP_ALLOW_WRITES=true and an exact domain-name confirm.";

// ---------- domains (read-only) ----------

server.tool(
  "namecheap_list_domains",
  `List every domain in the account with expiry, lock and auto-renew state. ${READ_ONLY}`,
  domains.listDomainsSchema.shape,
  wrap("namecheap_list_domains", (a: z.infer<typeof domains.listDomainsSchema>) => domains.listDomains(client, a)),
);

server.tool(
  "namecheap_get_domain",
  `Registration details for one domain: status, dates, DNS provider, nameservers, WhoisGuard. ${READ_ONLY}`,
  domains.domainSchema.shape,
  wrap("namecheap_get_domain", (a: z.infer<typeof domains.domainSchema>) => domains.getDomain(client, a)),
);

server.tool(
  "namecheap_check_availability",
  `Check whether domains are available to register. ${READ_ONLY}`,
  domains.checkSchema.shape,
  wrap("namecheap_check_availability", (a: z.infer<typeof domains.checkSchema>) => domains.checkAvailability(client, a)),
);

server.tool(
  "namecheap_get_nameservers",
  `Show the delegated nameservers and whether Namecheap is hosting the zone. ${READ_ONLY}`,
  domains.domainSchema.shape,
  wrap("namecheap_get_nameservers", (a: z.infer<typeof domains.domainSchema>) => domains.getNameservers(client, a)),
);

// ---------- DNS records (read) ----------

server.tool(
  "namecheap_list_dns_records",
  `List the advanced DNS records Namecheap holds for a domain, optionally filtered by type. ${READ_ONLY}`,
  records.listSchema.shape,
  wrap("namecheap_list_dns_records", (a: z.infer<typeof records.listSchema>) => records.listRecords(client, a)),
);

// ---------- DNS records (write) ----------

server.tool(
  "namecheap_add_dns_record",
  `Add a DNS record, preserving everything already in the zone. Set replaceExisting to swap records with the same host and type. ${WRITE}`,
  records.addSchema.shape,
  wrap("namecheap_add_dns_record", (a: z.infer<typeof records.addSchema>) => records.addRecord(client, a)),
);

server.tool(
  "namecheap_update_dns_record",
  `Change the value or TTL of one existing record. Refuses to guess when several records share a host and type. ${WRITE}`,
  records.updateSchema.shape,
  wrap("namecheap_update_dns_record", (a: z.infer<typeof records.updateSchema>) => records.updateRecord(client, a)),
);

server.tool(
  "namecheap_delete_dns_record",
  `Delete matching DNS records. ${DESTRUCTIVE}`,
  records.deleteSchema.shape,
  wrap("namecheap_delete_dns_record", (a: z.infer<typeof records.deleteSchema>) => records.deleteRecord(client, a)),
);

server.tool(
  "namecheap_replace_all_dns_records",
  `Overwrite the entire zone with an exact record set. Returns the previous zone so it can be restored. ${DESTRUCTIVE}`,
  records.replaceAllSchema.shape,
  wrap("namecheap_replace_all_dns_records", (a: z.infer<typeof records.replaceAllSchema>) =>
    records.replaceAllRecords(client, a),
  ),
);

// ---------- delegation (write) ----------

server.tool(
  "namecheap_set_nameservers",
  `Delegate the domain to custom nameservers, e.g. moving DNS to Vercel or Cloudflare. ${DESTRUCTIVE}`,
  domains.setNameserversSchema.shape,
  wrap("namecheap_set_nameservers", (a: z.infer<typeof domains.setNameserversSchema>) =>
    domains.setNameservers(client, a),
  ),
);

server.tool(
  "namecheap_use_namecheap_dns",
  `Move the domain back to Namecheap BasicDNS. ${DESTRUCTIVE}`,
  domains.useNamecheapDnsSchema.shape,
  wrap("namecheap_use_namecheap_dns", (a: z.infer<typeof domains.useNamecheapDnsSchema>) =>
    domains.useNamecheapDns(client, a),
  ),
);

// ---------- email authentication ----------

server.tool(
  "namecheap_set_spf",
  `Create or replace the SPF record. Builds a valid record from includes and IPs, or takes a complete one. Rejects records over the 255-character TXT limit and warns past the 10-lookup limit. ${WRITE}`,
  email.spfSchema.shape,
  wrap("namecheap_set_spf", (a: z.infer<typeof email.spfSchema>) => email.setSpf(client, a)),
);

server.tool(
  "namecheap_set_dkim",
  `Publish a DKIM public key at <selector>._domainkey. ${WRITE}`,
  email.dkimSchema.shape,
  wrap("namecheap_set_dkim", (a: z.infer<typeof email.dkimSchema>) => email.setDkim(client, a)),
);

server.tool(
  "namecheap_set_dmarc",
  `Create or replace the DMARC policy at _dmarc, with reporting addresses. Warns when jumping straight to p=reject. ${WRITE}`,
  email.dmarcSchema.shape,
  wrap("namecheap_set_dmarc", (a: z.infer<typeof email.dmarcSchema>) => email.setDmarc(client, a)),
);

server.tool(
  "namecheap_audit_email_auth",
  `Audit SPF, DKIM, DMARC and MX as configured at Namecheap, flagging duplicates, lookup-limit breaches and missing policies. ${READ_ONLY}`,
  email.auditSchema.shape,
  wrap("namecheap_audit_email_auth", (a: z.infer<typeof email.auditSchema>) => email.auditEmailAuth(client, a)),
);

// ---------- live verification (no credentials needed) ----------

server.tool(
  "namecheap_verify_dns",
  `Resolve a hostname against a public resolver to confirm what the world actually sees, rather than what is configured. ${READ_ONLY}`,
  verify.verifySchema.shape,
  wrap("namecheap_verify_dns", (a: z.infer<typeof verify.verifySchema>) => verify.verifyDns(a)),
);

server.tool(
  "namecheap_verify_email_auth",
  `Check the live, published SPF, DKIM and DMARC records via a public resolver — the real test of whether a change has propagated. ${READ_ONLY}`,
  verify.verifyEmailAuthSchema.shape,
  wrap("namecheap_verify_email_auth", (a: z.infer<typeof verify.verifyEmailAuthSchema>) => verify.verifyEmailAuth(a)),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only: stdout is the MCP transport and must carry nothing else.
  console.error(
    `namecheap-mcp ready — ${client.sandbox ? "SANDBOX" : "production"}, ` +
      `writes ${client.writesEnabled ? "ENABLED" : "disabled"}`,
  );
}

main().catch((err: unknown) => {
  console.error("namecheap-mcp failed to start:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
