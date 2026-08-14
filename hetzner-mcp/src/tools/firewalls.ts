import { z } from "zod";
import type { HetznerClient } from "../client.js";
import { requireConfirmation } from "../guard.js";
import type { Firewall, FirewallRule, HcloudAction } from "../types.js";

const ruleSchema = z.object({
  direction: z.enum(["in", "out"]),
  protocol: z.enum(["tcp", "udp", "icmp", "esp", "gre"]),
  port: z.string().optional().describe("Single port or range, e.g. '22' or '3000-3005'. Omit for icmp/esp/gre."),
  source_ips: z.array(z.string()).optional().describe("CIDRs. Required for direction=in. Use 0.0.0.0/0 and ::/0 for any."),
  destination_ips: z.array(z.string()).optional().describe("CIDRs. Required for direction=out."),
  description: z.string().optional(),
});

export const listFirewallsSchema = z.object({});
export const getFirewallSchema = z.object({ id: z.number().int().positive() });
export const createFirewallSchema = z.object({
  name: z.string().min(1),
  rules: z.array(ruleSchema).describe("Full rule set. Hetzman firewalls are default-deny inbound."),
  apply_to_server_ids: z.array(z.number().int().positive()).optional(),
});
export const setRulesSchema = z.object({
  id: z.number().int().positive(),
  rules: z.array(ruleSchema).describe("REPLACES all existing rules. Read the firewall first."),
  confirm: z.string().optional().describe("Exact firewall name. Required: this replaces the whole rule set."),
});
export const applyFirewallSchema = z.object({
  id: z.number().int().positive(),
  server_ids: z.array(z.number().int().positive()).min(1),
});
export const deleteFirewallSchema = z.object({
  id: z.number().int().positive(),
  confirm: z.string().optional().describe("Exact firewall name. Required."),
});

function renderRule(r: FirewallRule): string {
  const ips = r.direction === "in" ? r.source_ips : r.destination_ips;
  const port = r.port === null || r.port === undefined ? "" : `:${r.port}`;
  const desc = r.description === null || r.description === undefined ? "" : `  # ${r.description}`;
  return `    ${r.direction.toUpperCase()} ${r.protocol}${port} from/to ${(ips ?? []).join(",") || "(none)"}${desc}`;
}

async function fetchFirewall(client: HetznerClient, id: number): Promise<Firewall> {
  const res = await client.request<{ firewall: Firewall }>("GET", `/firewalls/${id}`, { scope: "read" });
  return res.firewall;
}

export async function listFirewalls(client: HetznerClient): Promise<string> {
  const fws = await client.listAll<Firewall>("/firewalls", "firewalls");
  if (fws.length === 0) {
    return [
      "No Hetzner Cloud Firewall exists in this project.",
      "",
      "That is a finding, not just a fact: with no provider-edge firewall, the only inbound",
      "control is whatever iptables/ufw state the box itself holds. A root compromise on the",
      "box can disable that. A Cloud Firewall sits outside the VM and cannot be turned off",
      "from inside it (Law 3 / Law 6).",
    ].join("\n");
  }
  return fws
    .map((f) => {
      const servers = f.applied_to.filter((a) => a.server !== null && a.server !== undefined).map((a) => a.server?.id);
      return [
        `#${f.id}  ${f.name}   created=${f.created}`,
        `  applied_to_servers=${servers.length === 0 ? "NONE (inert!)" : servers.join(",")}`,
        `  rules (${f.rules.length}):`,
        ...(f.rules.length === 0 ? ["    (none — an empty firewall blocks all inbound)"] : f.rules.map(renderRule)),
      ].join("\n");
    })
    .join("\n\n");
}

export async function getFirewall(client: HetznerClient, args: z.infer<typeof getFirewallSchema>): Promise<string> {
  return JSON.stringify(await fetchFirewall(client, args.id), null, 2);
}

export async function createFirewall(
  client: HetznerClient,
  args: z.infer<typeof createFirewallSchema>,
): Promise<string> {
  const body: Record<string, unknown> = { name: args.name, rules: args.rules };
  if (args.apply_to_server_ids !== undefined && args.apply_to_server_ids.length > 0) {
    body.apply_to = args.apply_to_server_ids.map((id) => ({ type: "server", server: { id } }));
  }
  const res = await client.request<{ firewall: Firewall }>("POST", "/firewalls", { scope: "write", body });
  return `Firewall "${res.firewall.name}" created as #${res.firewall.id} with ${res.firewall.rules.length} rules.`;
}

export async function setFirewallRules(client: HetznerClient, args: z.infer<typeof setRulesSchema>): Promise<string> {
  const fw = await fetchFirewall(client, args.id);
  requireConfirmation("Replacing the entire rule set", fw.name, args.confirm);
  const res = await client.request<{ actions: readonly HcloudAction[] }>(
    "POST",
    `/firewalls/${args.id}/actions/set_rules`,
    { scope: "write", body: { rules: args.rules } },
  );
  return [
    `Rules replaced on "${fw.name}" (#${fw.id}): ${fw.rules.length} -> ${args.rules.length}.`,
    `actions=${res.actions.map((a) => `#${a.id}:${a.status}`).join(",")}`,
    `Verify from OUTSIDE the box before trusting this (Law 10).`,
  ].join("\n");
}

export async function applyFirewall(client: HetznerClient, args: z.infer<typeof applyFirewallSchema>): Promise<string> {
  const fw = await fetchFirewall(client, args.id);
  const res = await client.request<{ actions: readonly HcloudAction[] }>(
    "POST",
    `/firewalls/${args.id}/actions/apply_to_resources`,
    { scope: "write", body: { apply_to: args.server_ids.map((id) => ({ type: "server", server: { id } })) } },
  );
  return `Firewall "${fw.name}" applied to servers ${args.server_ids.join(",")}. actions=${res.actions
    .map((a) => `#${a.id}:${a.status}`)
    .join(",")}`;
}

export async function deleteFirewall(client: HetznerClient, args: z.infer<typeof deleteFirewallSchema>): Promise<string> {
  const fw = await fetchFirewall(client, args.id);
  requireConfirmation("Firewall deletion", fw.name, args.confirm);
  await client.request<void>("DELETE", `/firewalls/${args.id}`, { scope: "write" });
  return `Firewall "${fw.name}" (#${fw.id}) deleted. Any server relying on it is now exposed to whatever the host firewall allows.`;
}
