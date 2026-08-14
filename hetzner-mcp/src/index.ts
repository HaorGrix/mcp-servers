#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { HetznerClient, HetznerError, MissingTokenError } from "./client.js";
import { ConfirmationRequiredError, ProtectedResourceError } from "./guard.js";
import * as fw from "./tools/firewalls.js";
import * as assets from "./tools/assets.js";
import * as srv from "./tools/servers.js";

const client = new HetznerClient();

const server = new McpServer({ name: "hetzner-mcp", version: "1.0.0" });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/**
 * Single error boundary. Every tool goes through here so a failure returns a usable
 * message instead of crashing the transport, and so no token value can leak into
 * an error string.
 */
function wrap<A>(name: string, fn: (args: A) => Promise<string>): (args: A) => Promise<ToolResult> {
  return async (args: A): Promise<ToolResult> => {
    try {
      return { content: [{ type: "text", text: await fn(args) }] };
    } catch (err) {
      let text: string;
      if (
        err instanceof ConfirmationRequiredError ||
        err instanceof ProtectedResourceError ||
        err instanceof MissingTokenError
      ) {
        text = err.message;
      } else if (err instanceof HetznerError) {
        text = `Hetzner API error (${err.status} ${err.code}): ${err.message}`;
      } else {
        text = `${name} failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      return { content: [{ type: "text", text }], isError: true };
    }
  };
}

const READ_ONLY_NOTE = "Read-only.";
const WRITE_NOTE = "Requires HCLOUD_TOKEN_RW.";
const DESTRUCTIVE_NOTE = "DESTRUCTIVE. Requires HCLOUD_TOKEN_RW and an exact-name confirm.";

// ---------- inventory / audit (read-only) ----------

server.tool(
  "hcloud_list_servers",
  `List every server with IPs, type, attached firewalls, protection and backup state. ${READ_ONLY_NOTE}`,
  srv.listServersSchema.shape,
  wrap("hcloud_list_servers", () => srv.listServers(client)),
);

server.tool(
  "hcloud_get_server",
  `Full JSON for one server. ${READ_ONLY_NOTE}`,
  srv.getServerSchema.shape,
  wrap("hcloud_get_server", (a: z.infer<typeof srv.getServerSchema>) => srv.getServer(client, a)),
);

server.tool(
  "hcloud_server_metrics",
  `CPU, disk or network metrics over a window, summarised. Useful for spotting a miner. ${READ_ONLY_NOTE}`,
  srv.metricsSchema.shape,
  wrap("hcloud_server_metrics", (a: z.infer<typeof srv.metricsSchema>) => srv.serverMetrics(client, a)),
);

server.tool(
  "hcloud_server_actions",
  `Recent API actions against a server. This is the audit trail for console-level changes. ${READ_ONLY_NOTE}`,
  assets.serverActionsSchema.shape,
  wrap("hcloud_server_actions", (a: z.infer<typeof assets.serverActionsSchema>) => assets.serverActions(client, a)),
);

server.tool(
  "hcloud_list_firewalls",
  `List Cloud Firewalls, their rules, and which servers they are actually attached to. ${READ_ONLY_NOTE}`,
  fw.listFirewallsSchema.shape,
  wrap("hcloud_list_firewalls", () => fw.listFirewalls(client)),
);

server.tool(
  "hcloud_get_firewall",
  `Full JSON for one firewall. Read this before replacing rules. ${READ_ONLY_NOTE}`,
  fw.getFirewallSchema.shape,
  wrap("hcloud_get_firewall", (a: z.infer<typeof fw.getFirewallSchema>) => fw.getFirewall(client, a)),
);

server.tool(
  "hcloud_list_snapshots",
  `List snapshots, their status and which server each came from. ${READ_ONLY_NOTE}`,
  assets.listSnapshotsSchema.shape,
  wrap("hcloud_list_snapshots", () => assets.listSnapshots(client)),
);

server.tool(
  "hcloud_list_ssh_keys",
  `List SSH keys registered in the project. An unexpected entry is a compromise signal. ${READ_ONLY_NOTE}`,
  assets.listSshKeysSchema.shape,
  wrap("hcloud_list_ssh_keys", () => assets.listSshKeys(client)),
);

server.tool(
  "hcloud_compliance_report",
  `Audit the project against the parts of SECURITY-STANDARD v1.0 that Hetzner can answer: ` +
    `firewall attachment, backups, delete-protection, snapshot coverage. ${READ_ONLY_NOTE}`,
  z.object({}).shape,
  wrap("hcloud_compliance_report", () => assets.complianceReport(client)),
);

// ---------- safe writes ----------

server.tool(
  "hcloud_create_snapshot",
  `Take a snapshot of a server. This is the rollback point to create BEFORE any change. ${WRITE_NOTE}`,
  srv.snapshotSchema.shape,
  wrap("hcloud_create_snapshot", (a: z.infer<typeof srv.snapshotSchema>) => srv.createSnapshot(client, a)),
);

server.tool(
  "hcloud_power_on_server",
  `Power on a stopped server. ${WRITE_NOTE}`,
  srv.powerSchema.shape,
  wrap("hcloud_power_on_server", (a: z.infer<typeof srv.powerSchema>) => srv.powerOn(client, a)),
);

server.tool(
  "hcloud_reboot_server",
  `Graceful ACPI reboot. Causes downtime for every site on the host. ${WRITE_NOTE}`,
  srv.rebootSchema.shape,
  wrap("hcloud_reboot_server", (a: z.infer<typeof srv.rebootSchema>) => srv.reboot(client, a)),
);

server.tool(
  "hcloud_create_firewall",
  `Create a Cloud Firewall and optionally attach it to servers. Provider-edge, so a root ` +
    `compromise on the box cannot disable it. ${WRITE_NOTE}`,
  fw.createFirewallSchema.shape,
  wrap("hcloud_create_firewall", (a: z.infer<typeof fw.createFirewallSchema>) => fw.createFirewall(client, a)),
);

server.tool(
  "hcloud_apply_firewall",
  `Attach an existing firewall to servers. ${WRITE_NOTE}`,
  fw.applyFirewallSchema.shape,
  wrap("hcloud_apply_firewall", (a: z.infer<typeof fw.applyFirewallSchema>) => fw.applyFirewall(client, a)),
);

// ---------- destructive, gated ----------

server.tool(
  "hcloud_set_firewall_rules",
  `Replace a firewall's ENTIRE rule set. Can lock out SSH if 22 is omitted. ${DESTRUCTIVE_NOTE}`,
  fw.setRulesSchema.shape,
  wrap("hcloud_set_firewall_rules", (a: z.infer<typeof fw.setRulesSchema>) => fw.setFirewallRules(client, a)),
);

server.tool(
  "hcloud_power_off_server",
  `Hard power-off, equivalent to pulling the plug. Can corrupt data. ${DESTRUCTIVE_NOTE}`,
  srv.powerOffSchema.shape,
  wrap("hcloud_power_off_server", (a: z.infer<typeof srv.powerOffSchema>) => srv.powerOff(client, a)),
);

server.tool(
  "hcloud_delete_firewall",
  `Delete a firewall. Servers relying on it lose that protection immediately. ${DESTRUCTIVE_NOTE}`,
  fw.deleteFirewallSchema.shape,
  wrap("hcloud_delete_firewall", (a: z.infer<typeof fw.deleteFirewallSchema>) => fw.deleteFirewall(client, a)),
);

server.tool(
  "hcloud_delete_snapshot",
  `Delete a snapshot, removing a rollback point. ${DESTRUCTIVE_NOTE}`,
  assets.deleteSnapshotSchema.shape,
  wrap("hcloud_delete_snapshot", (a: z.infer<typeof assets.deleteSnapshotSchema>) => assets.deleteSnapshot(client, a)),
);

server.tool(
  "hcloud_delete_ssh_key",
  `Remove an SSH key from the project. ${DESTRUCTIVE_NOTE}`,
  assets.deleteSshKeySchema.shape,
  wrap("hcloud_delete_ssh_key", (a: z.infer<typeof assets.deleteSshKeySchema>) => assets.deleteSshKey(client, a)),
);

server.tool(
  "hcloud_delete_server",
  `DELETE A SERVER. Irreversible without a snapshot. ${DESTRUCTIVE_NOTE}`,
  srv.deleteServerSchema.shape,
  wrap("hcloud_delete_server", (a: z.infer<typeof srv.deleteServerSchema>) => srv.deleteServer(client, a)),
);

server.tool(
  "hcloud_rebuild_server",
  `Rebuild a server from an image, destroying all disk contents. This is the "rebuild, never clean" ` +
    `operation from Part 5. ${DESTRUCTIVE_NOTE}`,
  srv.rebuildServerSchema.shape,
  wrap("hcloud_rebuild_server", (a: z.infer<typeof srv.rebuildServerSchema>) => srv.rebuildServer(client, a)),
);

async function main(): Promise<void> {
  if (process.env.HCLOUD_TOKEN_RO === undefined && process.env.HCLOUD_TOKEN_RW === undefined) {
    process.stderr.write(
      "hetzner-mcp: no tokens loaded. Launch via scripts/launch.sh so SOPS decrypts them.\n",
    );
  }
  process.stderr.write(`hetzner-mcp ready (write access: ${client.canWrite ? "ENABLED" : "disabled"})\n`);
  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  process.stderr.write(`hetzner-mcp fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
