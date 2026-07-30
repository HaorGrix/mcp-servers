import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NeonClient } from '../client.js';
import type { Config } from '../config.js';
import type { AuditLog } from '../audit.js';
import { ok, dryRun } from '../guards.js';
import type { Project, Branch } from './read.js';

export function registerWriteTools(
  server: McpServer,
  client: NeonClient,
  config: Config,
  audit: AuditLog,
): void {
  server.tool(
    'neon_create_project',
    'Create a Neon project.',
    {
      name: z.string().max(64),
      region_id: z.string().optional().describe('e.g. aws-us-east-1. Neon picks a default if omitted.'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ name, region_id, dry_run }) => {
      if (dry_run) {
        const { items } = await client.listPaged<Project>('/projects', 'projects');
        const clash = items.find((p) => p.name === name);
        return ok({
          dryRun: true,
          wouldDo: clash
            ? `Create project "${name}" — NOTE a project with this name already exists (${clash.id}).`
            : `Create project "${name}"${region_id ? ` in ${region_id}` : ''}.`,
        });
      }
      const { data, status } = await client.request<{ project: Project }>('POST', '/projects', {
        project: { name, ...(region_id ? { region_id } : {}) },
      });
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'neon_create_project',
        args: { name, region_id },
        resourceId: data.project.id,
        outcome: 'ok',
        status,
      });
      return ok(data.project);
    },
  );

  server.tool(
    'neon_create_branch',
    'Create a branch in a project.',
    {
      projectId: z.string(),
      name: z.string().max(64),
      parentId: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ projectId, name, parentId, dry_run }) => {
      if (dry_run) {
        return dryRun(
          () =>
            client
              .request<{ project: Project }>('GET', `/projects/${projectId}`)
              .then((r) => r.data.project),
          (p) => `Create branch "${name}" in project ${p.name} (${p.id}).`,
        );
      }
      const { data, status } = await client.request<{ branch: Branch }>(
        'POST',
        `/projects/${projectId}/branches`,
        { branch: { name, ...(parentId ? { parent_id: parentId } : {}) } },
      );
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'neon_create_branch',
        args: { projectId, name, parentId },
        resourceId: data.branch.id,
        outcome: 'ok',
        status,
      });
      return ok(data.branch);
    },
  );

  server.tool(
    'neon_create_role',
    'Create a role on a branch. Neon returns the generated password, so it is written to a ' +
      '0600 file rather than into this response — use neon_get_connection_uri to retrieve it.',
    {
      projectId: z.string(),
      branchId: z.string(),
      roleName: z.string().max(63),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ projectId, branchId, roleName, dry_run }) => {
      if (dry_run) {
        return ok({ dryRun: true, wouldDo: `Create role "${roleName}" on branch ${branchId}.` });
      }
      const { status } = await client.request<unknown>(
        'POST',
        `/projects/${projectId}/branches/${branchId}/roles`,
        { role: { name: roleName } },
      );
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'neon_create_role',
        args: { projectId, branchId, roleName },
        resourceId: roleName,
        outcome: 'ok',
        status,
      });
      return ok({
        roleName,
        branchId,
        note: 'Role created. Retrieve its credentials with neon_get_connection_uri, which writes them to a 0600 file.',
      });
    },
  );

  server.tool(
    'neon_set_endpoint_state',
    'Start or suspend a compute endpoint. Suspending stops it serving connections; it is ' +
      'reversible, unlike deleting.',
    {
      projectId: z.string(),
      endpointId: z.string(),
      action: z.enum(['start', 'suspend']),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ projectId, endpointId, action, dry_run }) => {
      if (dry_run) {
        return ok({ dryRun: true, wouldDo: `${action} endpoint ${endpointId} in ${projectId}.` });
      }
      const { status } = await client.request<unknown>(
        'POST',
        `/projects/${projectId}/endpoints/${endpointId}/${action}`,
        {},
      );
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'neon_set_endpoint_state',
        args: { projectId, endpointId, action },
        resourceId: endpointId,
        outcome: 'ok',
        status,
      });
      return ok(`Endpoint ${endpointId} ${action === 'start' ? 'started' : 'suspended'}.`);
    },
  );
}
