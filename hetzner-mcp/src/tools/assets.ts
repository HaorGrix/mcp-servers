import { z } from "zod";
import type { HetznerClient } from "../client.js";
import { ProtectedResourceError, requireConfirmation } from "../guard.js";
import type { HcloudAction, Image, Server, SshKey } from "../types.js";

export const listSnapshotsSchema = z.object({});
export const deleteSnapshotSchema = z.object({
  id: z.number().int().positive(),
  confirm: z.string().optional().describe("Exact snapshot description. Required."),
});
export const listSshKeysSchema = z.object({});
export const deleteSshKeySchema = z.object({
  id: z.number().int().positive(),
  confirm: z.string().optional().describe("Exact SSH key name. Required."),
});
export const serverActionsSchema = z.object({
  id: z.number().int().positive(),
  limit: z.number().int().min(1).max(50).default(20),
});

export async function listSnapshots(client: HetznerClient): Promise<string> {
  const images = await client.listAll<Image>("/images", "images", { type: "snapshot" });
  if (images.length === 0) {
    return "No snapshots exist in this project. There is no rollback point for any server (Part 2.6).";
  }
  return images
    .map((i) => {
      const gb = i.image_size === null ? "building" : `${i.image_size.toFixed(2)}GB`;
      return [
        `#${i.id}  ${i.description}`,
        `  status=${i.status}  size=${gb}  disk=${i.disk_size}GB  created=${i.created}`,
        `  from_server=${i.created_from?.name ?? "unknown"}  delete_protection=${i.protection.delete}`,
      ].join("\n");
    })
    .join("\n\n");
}

export async function deleteSnapshot(client: HetznerClient, args: z.infer<typeof deleteSnapshotSchema>): Promise<string> {
  const res = await client.request<{ image: Image }>("GET", `/images/${args.id}`, { scope: "read" });
  const img = res.image;
  if (img.protection.delete) throw new ProtectedResourceError("Snapshot", img.description);
  requireConfirmation("Snapshot deletion", img.description, args.confirm);
  await client.request<void>("DELETE", `/images/${args.id}`, { scope: "write" });
  return `Snapshot "${img.description}" (#${img.id}) deleted. That rollback point is gone.`;
}

export async function listSshKeys(client: HetznerClient): Promise<string> {
  const keys = await client.listAll<SshKey>("/ssh_keys", "ssh_keys");
  if (keys.length === 0) return "No SSH keys registered in this Hetzner project.";
  return [
    "Law 10 wants an alert on any NEW key here — an unexpected entry is a console compromise signal.",
    "",
    ...keys.map((k) => `#${k.id}  ${k.name}\n  fingerprint=${k.fingerprint}\n  created=${k.created}`),
  ].join("\n");
}

export async function deleteSshKey(client: HetznerClient, args: z.infer<typeof deleteSshKeySchema>): Promise<string> {
  const res = await client.request<{ ssh_key: SshKey }>("GET", `/ssh_keys/${args.id}`, { scope: "read" });
  const key = res.ssh_key;
  requireConfirmation("SSH key deletion", key.name, args.confirm);
  await client.request<void>("DELETE", `/ssh_keys/${args.id}`, { scope: "write" });
  return `SSH key "${key.name}" (#${key.id}) removed from the project. Existing servers keep the key in authorized_keys — remove it there too, via the playbook.`;
}

export async function serverActions(client: HetznerClient, args: z.infer<typeof serverActionsSchema>): Promise<string> {
  const res = await client.request<{ actions: readonly HcloudAction[] }>("GET", `/servers/${args.id}/actions`, {
    scope: "read",
    query: { sort: "started:desc", per_page: args.limit },
  });
  if (res.actions.length === 0) return "No recorded actions for this server.";
  return res.actions
    .map(
      (a) =>
        `#${a.id}  ${a.command}  ${a.status}  started=${a.started}  finished=${a.finished ?? "-"}` +
        (a.error === null ? "" : `\n  ERROR ${a.error.code}: ${a.error.message}`),
    )
    .join("\n");
}

/** Cross-checks the project against the laws that Hetzner itself can answer. */
export async function complianceReport(client: HetznerClient): Promise<string> {
  const [servers, firewallCount, snapshots] = await Promise.all([
    client.listAll<Server>("/servers", "servers"),
    client.listAll<{ id: number }>("/firewalls", "firewalls").then((f) => f.length),
    client.listAll<Image>("/images", "images", { type: "snapshot" }),
  ]);

  const lines: string[] = ["HETZNER-SIDE COMPLIANCE vs SECURITY-STANDARD v1.0", ""];
  lines.push(`Cloud Firewalls defined: ${firewallCount}${firewallCount === 0 ? "  <-- FAIL (Law 3/6)" : ""}`);
  lines.push(`Snapshots in project: ${snapshots.length}${snapshots.length === 0 ? "  <-- FAIL (Part 2.6)" : ""}`);
  lines.push("");

  for (const s of servers) {
    const fw = s.public_net.firewalls ?? [];
    const snapsForServer = snapshots.filter((i) => i.created_from?.id === s.id);
    const findings: string[] = [];
    if (fw.length === 0) findings.push("no Cloud Firewall attached (Law 3)");
    if (s.backup_window === null) findings.push("provider backups disabled (Part 2.6)");
    if (!s.protection.delete) findings.push("no delete-protection");
    if (snapsForServer.length === 0) findings.push("no snapshot exists (no rollback point)");
    lines.push(
      `#${s.id} ${s.name} (${s.public_net.ipv4?.ip ?? "no ipv4"})` +
        (findings.length === 0 ? "  OK" : `\n    ${findings.map((f) => `FAIL: ${f}`).join("\n    ")}`),
    );
  }

  lines.push("");
  lines.push("Not answerable from the Hetzner API — check on the box or in the account:");
  lines.push("  Law 7 patch cadence, Law 8 account MFA, Law 9 CI gates, Law 10 cross-scan.");
  return lines.join("\n");
}
