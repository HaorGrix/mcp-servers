import { z } from "zod";
import type { HetznerClient } from "../client.js";
import { ProtectedResourceError, requireConfirmation } from "../guard.js";
import type { HcloudAction, MetricsResponse, Server } from "../types.js";

export const listServersSchema = z.object({});
export const getServerSchema = z.object({ id: z.number().int().positive() });
export const powerSchema = z.object({ id: z.number().int().positive() });
export const powerOffSchema = z.object({
  id: z.number().int().positive(),
  confirm: z.string().optional().describe("Exact server name. Required: a hard power-off can corrupt data."),
});
export const rebootSchema = z.object({ id: z.number().int().positive() });
export const snapshotSchema = z.object({
  id: z.number().int().positive(),
  description: z.string().min(1).describe("Human label for the snapshot, e.g. 'pre-ufw-reinstall 2026-07-30'"),
});
export const deleteServerSchema = z.object({
  id: z.number().int().positive(),
  confirm: z.string().optional().describe("Exact server name. Required."),
});
export const rebuildServerSchema = z.object({
  id: z.number().int().positive(),
  image: z.string().min(1).describe("Image name or id, e.g. 'ubuntu-24.04'"),
  confirm: z.string().optional().describe("Exact server name. Required."),
});
export const metricsSchema = z.object({
  id: z.number().int().positive(),
  type: z.enum(["cpu", "disk", "network"]),
  hours: z.number().int().min(1).max(168).default(1),
});

async function fetchServer(client: HetznerClient, id: number): Promise<Server> {
  const res = await client.request<{ server: Server }>("GET", `/servers/${id}`, { scope: "read" });
  return res.server;
}

export async function listServers(client: HetznerClient): Promise<string> {
  const servers = await client.listAll<Server>("/servers", "servers");
  if (servers.length === 0) return "No servers in this project.";
  return servers
    .map((s) => {
      const fw = s.public_net.firewalls ?? [];
      const st = s.server_type;
      return [
        `#${s.id}  ${s.name}  [${s.status}]`,
        `  ipv4=${s.public_net.ipv4?.ip ?? "none"}  ipv6=${s.public_net.ipv6?.ip ?? "none"}`,
        `  type=${st === null ? "unknown" : `${st.name} (${st.cores}vCPU ${st.memory}GB RAM ${st.disk}GB disk)`}`,
        `  dc=${s.datacenter?.name ?? "n/a in list response"}  image=${s.image?.name ?? s.image?.os_flavor ?? "unknown"}`,
        `  firewalls_attached=${fw.length === 0 ? "NONE" : fw.map((f) => `${f.id}(${f.status})`).join(",")}`,
        `  locked=${s.locked}  delete_protection=${s.protection.delete}  rebuild_protection=${s.protection.rebuild}`,
        `  backups=${s.backup_window ?? "DISABLED"}  created=${s.created}`,
      ].join("\n");
    })
    .join("\n\n");
}

export async function getServer(client: HetznerClient, args: z.infer<typeof getServerSchema>): Promise<string> {
  const s = await fetchServer(client, args.id);
  return JSON.stringify(s, null, 2);
}

async function runAction(
  client: HetznerClient,
  id: number,
  action: string,
  body?: unknown,
): Promise<HcloudAction> {
  const res = await client.request<{ action: HcloudAction }>("POST", `/servers/${id}/actions/${action}`, {
    scope: "write",
    ...(body === undefined ? {} : { body }),
  });
  return res.action;
}

export async function powerOn(client: HetznerClient, args: z.infer<typeof powerSchema>): Promise<string> {
  const a = await runAction(client, args.id, "poweron");
  return `poweron queued: action #${a.id} status=${a.status}`;
}

export async function reboot(client: HetznerClient, args: z.infer<typeof rebootSchema>): Promise<string> {
  const s = await fetchServer(client, args.id);
  const a = await runAction(client, args.id, "reboot");
  return `Graceful reboot queued for "${s.name}": action #${a.id} status=${a.status}. Verify services after boot.`;
}

export async function powerOff(client: HetznerClient, args: z.infer<typeof powerOffSchema>): Promise<string> {
  const s = await fetchServer(client, args.id);
  requireConfirmation("Hard power-off", s.name, args.confirm);
  const a = await runAction(client, args.id, "poweroff");
  return `HARD power-off issued for "${s.name}": action #${a.id} status=${a.status}`;
}

export async function createSnapshot(client: HetznerClient, args: z.infer<typeof snapshotSchema>): Promise<string> {
  const s = await fetchServer(client, args.id);
  const res = await client.request<{ action: HcloudAction; image: { id: number } }>(
    "POST",
    `/servers/${args.id}/actions/create_image`,
    { scope: "write", body: { description: args.description, type: "snapshot" } },
  );
  return [
    `Snapshot started for "${s.name}".`,
    `  image_id=${res.image.id}`,
    `  action=#${res.action.id} status=${res.action.status} progress=${res.action.progress}%`,
    `Poll hcloud_list_snapshots until status=available before relying on it.`,
  ].join("\n");
}

export async function deleteServer(client: HetznerClient, args: z.infer<typeof deleteServerSchema>): Promise<string> {
  const s = await fetchServer(client, args.id);
  if (s.protection.delete) throw new ProtectedResourceError("Server", s.name);
  requireConfirmation("Server deletion", s.name, args.confirm);
  await client.request<{ action: HcloudAction }>("DELETE", `/servers/${args.id}`, { scope: "write" });
  return `Server "${s.name}" (#${s.id}) deletion issued. This is irreversible without a snapshot.`;
}

export async function rebuildServer(
  client: HetznerClient,
  args: z.infer<typeof rebuildServerSchema>,
): Promise<string> {
  const s = await fetchServer(client, args.id);
  if (s.protection.rebuild) throw new ProtectedResourceError("Server (rebuild)", s.name);
  requireConfirmation("Server rebuild", s.name, args.confirm);
  const a = await runAction(client, args.id, "rebuild", { image: args.image });
  return `Rebuild of "${s.name}" from image "${args.image}" queued: action #${a.id}. All disk contents are destroyed.`;
}

export async function serverMetrics(client: HetznerClient, args: z.infer<typeof metricsSchema>): Promise<string> {
  const end = new Date();
  const start = new Date(end.getTime() - args.hours * 3_600_000);
  const res = await client.request<MetricsResponse>("GET", `/servers/${args.id}/metrics`, {
    scope: "read",
    query: { type: args.type, start: start.toISOString(), end: end.toISOString() },
  });
  const lines: string[] = [`metrics type=${args.type} window=${args.hours}h step=${res.metrics.step}s`];
  for (const [series, data] of Object.entries(res.metrics.time_series)) {
    const nums = data.values.map(([, v]) => Number(v)).filter((n) => Number.isFinite(n));
    if (nums.length === 0) {
      lines.push(`  ${series}: no samples`);
      continue;
    }
    const max = Math.max(...nums);
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    lines.push(`  ${series}: avg=${avg.toFixed(3)} max=${max.toFixed(3)} samples=${nums.length}`);
  }
  return lines.join("\n");
}
