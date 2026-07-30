import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NeonClient } from '../client.js';
import type { Config } from '../config.js';
import type { AuditLog } from '../audit.js';
import { ok } from '../guards.js';
import { writeSecretFile } from '../secrets.js';

export interface Project {
  id: string;
  name: string;
  region_id?: string;
  created_at?: string;
  pg_version?: number;
}

export interface Branch {
  id: string;
  name: string;
  primary?: boolean;
  default?: boolean;
  created_at?: string;
}

export interface Role {
  name: string;
  branch_id?: string;
  created_at?: string;
  protected?: boolean;
}

export function registerReadTools(
  server: McpServer,
  client: NeonClient,
  config: Config,
  audit: AuditLog,
): void {
  server.tool(
    'neon_list_projects',
    `List Neon projects on this account: id, name, region, Postgres version. Paginated, ` +
      `default cap ${config.pageLimit}, sets a truncated flag when capped.`,
    { limit: z.number().int().min(1).max(500).optional() },
    async ({ limit }) => {
      const { items, truncated } = await client.listPaged<Project>('/projects', 'projects', limit);
      return ok({ count: items.length, truncated, projects: items });
    },
  );

  server.tool(
    'neon_get_project',
    'Get one project by id.',
    { projectId: z.string() },
    async ({ projectId }) => {
      const { data } = await client.request<{ project: Project }>('GET', `/projects/${projectId}`);
      return ok(data.project);
    },
  );

  server.tool(
    'neon_list_branches',
    'List branches in a project, including which is primary.',
    { projectId: z.string() },
    async ({ projectId }) => {
      const { data } = await client.request<{ branches: Branch[] }>(
        'GET',
        `/projects/${projectId}/branches`,
      );
      return ok({ count: data.branches?.length ?? 0, branches: data.branches ?? [] });
    },
  );

  server.tool(
    'neon_list_databases',
    'List databases on a branch.',
    { projectId: z.string(), branchId: z.string() },
    async ({ projectId, branchId }) => {
      const { data } = await client.request<{ databases: unknown[] }>(
        'GET',
        `/projects/${projectId}/branches/${branchId}/databases`,
      );
      return ok(data.databases ?? []);
    },
  );

  server.tool(
    'neon_list_roles',
    'List roles on a branch. Role names only — never passwords.',
    { projectId: z.string(), branchId: z.string() },
    async ({ projectId, branchId }) => {
      const { data } = await client.request<{ roles: Role[] }>(
        'GET',
        `/projects/${projectId}/branches/${branchId}/roles`,
      );
      return ok({ count: data.roles?.length ?? 0, roles: data.roles ?? [] });
    },
  );

  server.tool(
    'neon_list_endpoints',
    'List compute endpoints in a project: host, state, autoscaling and suspend settings. ' +
      'The host is what identifies a project when you only have a connection string.',
    { projectId: z.string() },
    async ({ projectId }) => {
      const { data } = await client.request<{ endpoints: unknown[] }>(
        'GET',
        `/projects/${projectId}/endpoints`,
      );
      return ok(data.endpoints ?? []);
    },
  );

  server.tool(
    'neon_list_operations',
    'List recent operations on a project — the audit trail of what Neon itself did, ' +
      `paginated with a cursor, default cap ${config.pageLimit}.`,
    { projectId: z.string(), limit: z.number().int().min(1).max(500).optional() },
    async ({ projectId, limit }) => {
      const { items, truncated } = await client.listPaged<unknown>(
        `/projects/${projectId}/operations`,
        'operations',
        limit,
      );
      return ok({ count: items.length, truncated, operations: items });
    },
  );

  server.tool(
    'neon_get_consumption',
    'Account-level consumption metrics. Read-only; this server exposes no billing mutation ' +
      'at any privilege level.',
    {},
    async () => {
      const { data } = await client.request<unknown>('GET', '/consumption_history/account');
      return ok(data);
    },
  );

  server.tool(
    'neon_get_connection_uri',
    'Get the connection URI for a database and role. The URI CONTAINS THE ROLE PASSWORD, so ' +
      'it is written to a 0600 file and this tool returns the path plus a fingerprint — never ' +
      'the value. A tool result lands in the conversation transcript and stays there. This is ' +
      'why it is not classed as a read tool despite reading nothing.',
    {
      projectId: z.string(),
      branchId: z.string(),
      databaseName: z.string(),
      roleName: z.string(),
      out_path: z.string().optional().describe('Where to write the URI.'),
    },
    async ({ projectId, branchId, databaseName, roleName, out_path }) => {
      const { data, status } = await client.request<{ uri: string }>(
        'GET',
        `/projects/${projectId}/connection_uri?branch_id=${encodeURIComponent(branchId)}` +
          `&database_name=${encodeURIComponent(databaseName)}&role_name=${encodeURIComponent(roleName)}`,
      );
      const target = out_path ?? `${config.secretOutDir}/${projectId}-${roleName}.uri`;
      const handle = await writeSecretFile(target, data.uri, `Connection URI for ${roleName}`);

      await audit.record({
        ts: new Date().toISOString(),
        tool: 'neon_get_connection_uri',
        args: { projectId, branchId, databaseName, roleName, out_path: handle.path, fingerprint: handle.fingerprint },
        resourceId: projectId,
        outcome: 'ok',
        status,
      });

      return ok({
        projectId,
        roleName,
        databaseName,
        path: handle.path,
        fingerprint: handle.fingerprint,
        note: handle.note,
      });
    },
  );
}
