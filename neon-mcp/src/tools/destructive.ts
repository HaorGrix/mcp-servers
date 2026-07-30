import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NeonClient } from '../client.js';
import type { Config } from '../config.js';
import { isProtected } from '../config.js';
import type { AuditLog } from '../audit.js';
import { ok, dryRun, requireConfirm, RefusedError } from '../guards.js';
import { writeSecretFile } from '../secrets.js';
import type { Project } from './read.js';

/**
 * Destructive tools — registered only when NEON_ALLOW_DESTRUCTIVE is on, which
 * itself requires NEON_ALLOW_WRITES. Denylist first, then exact-id confirm.
 */
export function registerDestructiveTools(
  server: McpServer,
  client: NeonClient,
  config: Config,
  audit: AuditLog,
): void {
  /** Shared denylist gate. Refuses and audits before anything else happens. */
  async function guardProject(tool: string, projectId: string): Promise<void> {
    if (!isProtected(config, projectId)) return;
    const err = new RefusedError(
      `"${projectId}" is on NEON_PROTECTED_PROJECTS and cannot be destroyed through this server ` +
        'under any flag combination.',
    );
    await audit.record({
      ts: new Date().toISOString(),
      tool,
      args: { projectId },
      resourceId: projectId,
      outcome: 'refused',
      detail: err.message,
    });
    throw err;
  }

  server.tool(
    'neon_reset_role_password',
    'Reset a role password. DESTRUCTIVE AND ATOMIC: Neon replaces the password in place, so ' +
      'the OLD ONE DIES THE INSTANT THIS RUNS and every app using it starts failing until it ' +
      'is redeployed. There is no create-before-delete option here — the outage is unavoidable, ' +
      'only its length is controllable. Stage the .env edit and the restart command BEFORE ' +
      'calling this. The new password is written to a 0600 file, never into this response.',
    {
      projectId: z.string(),
      branchId: z.string(),
      roleName: z.string(),
      confirm: z.string().describe('The exact roleName, or its last 6 characters.'),
      out_path: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ projectId, branchId, roleName, confirm, out_path, dry_run }) => {
      await guardProject('neon_reset_role_password', projectId);

      if (dry_run) {
        return dryRun(
          () =>
            client
              .request<{ project: Project }>('GET', `/projects/${projectId}`)
              .then((r) => r.data.project),
          (p) =>
            `Reset the password for role "${roleName}" on branch ${branchId} in ${p.name}. ` +
            'The current password stops working immediately — anything using it goes down ' +
            'until redeployed.',
        );
      }

      try {
        requireConfirm(roleName, confirm);
      } catch (err) {
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'neon_reset_role_password',
          args: { projectId, branchId, roleName, confirm },
          resourceId: roleName,
          outcome: 'refused',
          detail: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      const { data, status } = await client.request<{ role?: { password?: string } }>(
        'POST',
        `/projects/${projectId}/branches/${branchId}/roles/${encodeURIComponent(roleName)}/reset_password`,
        {},
      );
      const password = data.role?.password ?? '';
      const target = out_path ?? `${config.secretOutDir}/${projectId}-${roleName}.password`;
      const handle = await writeSecretFile(target, password, `Password for role ${roleName}`);

      await audit.record({
        ts: new Date().toISOString(),
        tool: 'neon_reset_role_password',
        args: { projectId, branchId, roleName, out_path: handle.path, fingerprint: handle.fingerprint },
        resourceId: roleName,
        outcome: 'ok',
        status,
      });

      return ok({
        roleName,
        projectId,
        path: handle.path,
        fingerprint: handle.fingerprint,
        note: handle.note,
        urgent:
          'The old password is ALREADY DEAD. Any app using it is down right now. Deploy the ' +
          'new value and restart immediately, then delete the file.',
      });
    },
  );

  server.tool(
    'neon_delete_project',
    'Delete an ENTIRE Neon project: every branch, database, role and all data. IRREVERSIBLE ' +
      'and not recoverable. Ids on NEON_PROTECTED_PROJECTS are refused outright.',
    {
      projectId: z.string(),
      confirm: z.string().describe('The exact projectId, or its last 6 characters.'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ projectId, confirm, dry_run }) => {
      await guardProject('neon_delete_project', projectId);

      if (dry_run) {
        return dryRun(
          () =>
            client
              .request<{ project: Project }>('GET', `/projects/${projectId}`)
              .then((r) => r.data.project),
          (p) => `DELETE project "${p.name}" (${p.id}) and all of its data. Not recoverable.`,
        );
      }

      try {
        requireConfirm(projectId, confirm);
      } catch (err) {
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'neon_delete_project',
          args: { projectId, confirm },
          resourceId: projectId,
          outcome: 'refused',
          detail: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      const { status } = await client.request<unknown>('DELETE', `/projects/${projectId}`);
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'neon_delete_project',
        args: { projectId },
        resourceId: projectId,
        outcome: 'ok',
        status,
      });
      return ok(`Project ${projectId} deleted.`);
    },
  );

  server.tool(
    'neon_delete_branch',
    'Delete a branch and its data. IRREVERSIBLE. The primary branch cannot be deleted.',
    {
      projectId: z.string(),
      branchId: z.string(),
      confirm: z.string().describe('The exact branchId, or its last 6 characters.'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ projectId, branchId, confirm, dry_run }) => {
      await guardProject('neon_delete_branch', projectId);

      if (dry_run) {
        return ok({ dryRun: true, wouldDo: `Delete branch ${branchId} in project ${projectId}.` });
      }

      try {
        requireConfirm(branchId, confirm);
      } catch (err) {
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'neon_delete_branch',
          args: { projectId, branchId, confirm },
          resourceId: branchId,
          outcome: 'refused',
          detail: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      const { status } = await client.request<unknown>(
        'DELETE',
        `/projects/${projectId}/branches/${branchId}`,
      );
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'neon_delete_branch',
        args: { projectId, branchId },
        resourceId: branchId,
        outcome: 'ok',
        status,
      });
      return ok(`Branch ${branchId} deleted.`);
    },
  );
}
