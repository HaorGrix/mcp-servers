import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GcpClient } from '../client.js';
import type { Config } from '../config.js';
import type { AuditLog } from '../audit.js';
import { ok, dryRun, requireConfirm, requireNotProtected, RefusedError } from '../guards.js';

const IAM = 'https://iam.googleapis.com/v1';
const SU = 'https://serviceusage.googleapis.com/v1';

interface ServiceAccount {
  email: string;
  displayName?: string;
  disabled?: boolean;
}

interface KeyInfo {
  name: string;
  validAfterTime?: string;
}

/**
 * Destructive tools — registered ONLY when GCP_ALLOW_DESTRUCTIVE is on (which
 * itself requires GCP_ALLOW_WRITES). Every one of these:
 *   1. refuses ids on the protected denylist, before anything else
 *   2. requires `confirm` to equal the exact resource id or its last 6 chars
 *   3. supports a dry_run that proves the resource exists first
 *   4. writes an audit line whether it succeeded, refused, or failed
 */
export function registerDestructiveTools(
  server: McpServer,
  client: GcpClient,
  config: Config,
  audit: AuditLog,
): void {
  server.tool(
    'gcp_delete_sa_key',
    'Delete ONE service-account key by key id. IRREVERSIBLE. Anything authenticating on ' +
      'that key stops working immediately, so verify the replacement works first. ' +
      'confirm must equal the key id or its last 6 characters.',
    {
      email: z.string().describe('Full service account email.'),
      keyId: z.string().describe('The key id, as returned by gcp_list_sa_keys.'),
      confirm: z.string().describe('The exact keyId, or its last 6 characters.'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ email, keyId, confirm, dry_run }) => {
      const url = `${IAM}/projects/${config.projectId}/serviceAccounts/${encodeURIComponent(email)}/keys/${keyId}`;
      if (dry_run) {
        return dryRun(
          () => client.request<KeyInfo>('GET', url).then((r) => r.data),
          (k) => `Delete key ${keyId} on ${email} (created ${k.validAfterTime ?? 'unknown'}).`,
        );
      }
      try {
        requireConfirm(keyId, confirm);
      } catch (err) {
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'gcp_delete_sa_key',
          args: { email, keyId, confirm },
          resourceId: keyId,
          outcome: 'refused',
          detail: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      const { status } = await client.request<unknown>('DELETE', url);
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'gcp_delete_sa_key',
        args: { email, keyId },
        resourceId: keyId,
        outcome: 'ok',
        status,
      });
      return ok(`Key ${keyId} deleted from ${email}.`);
    },
  );

  server.tool(
    'gcp_delete_service_account',
    'Delete an ENTIRE service account and every key on it. IRREVERSIBLE and far wider ' +
      'than deleting one key. Prefer gcp_set_service_account_enabled(false) first and ' +
      'confirm nothing broke. Ids on GCP_PROTECTED_SERVICE_ACCOUNTS are refused outright.',
    {
      email: z.string().describe('Full service account email.'),
      confirm: z.string().describe('The exact email, or its last 6 characters.'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ email, confirm, dry_run }) => {
      const url = `${IAM}/projects/${config.projectId}/serviceAccounts/${encodeURIComponent(email)}`;
      // Denylist is checked before the flags, before confirm, before dry_run —
      // a protected id must not even be rehearsed as deletable.
      try {
        requireNotProtected(config, email);
      } catch (err) {
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'gcp_delete_service_account',
          args: { email },
          resourceId: email,
          outcome: 'refused',
          detail: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      if (dry_run) {
        return dryRun(
          () => client.request<ServiceAccount>('GET', url).then((r) => r.data),
          (sa) => `Delete service account ${sa.email} and ALL of its keys.`,
        );
      }
      try {
        requireConfirm(email, confirm);
      } catch (err) {
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'gcp_delete_service_account',
          args: { email, confirm },
          resourceId: email,
          outcome: 'refused',
          detail: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      const { status } = await client.request<unknown>('DELETE', url);
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'gcp_delete_service_account',
        args: { email },
        resourceId: email,
        outcome: 'ok',
        status,
      });
      return ok(`Service account ${email} deleted.`);
    },
  );

  server.tool(
    'gcp_disable_service',
    'Disable an API on the project. Destructive: every app calling that API starts ' +
      'failing immediately. confirm must equal the service name or its last 6 characters.',
    {
      service: z.string().describe('Service name, e.g. "generativelanguage.googleapis.com".'),
      confirm: z.string().describe('The exact service name, or its last 6 characters.'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ service, confirm, dry_run }) => {
      const url = `${SU}/projects/${config.projectId}/services/${service}`;
      if (dry_run) {
        return dryRun(
          () => client.request<{ state?: string }>('GET', url).then((r) => r.data),
          (s) => `Disable ${service} (currently ${s.state ?? 'unknown'}).`,
        );
      }
      try {
        requireConfirm(service, confirm);
      } catch (err) {
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'gcp_disable_service',
          args: { service, confirm },
          resourceId: service,
          outcome: 'refused',
          detail: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      const { status } = await client.request<unknown>('POST', `${url}:disable`, {
        disableDependentServices: false,
      });
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'gcp_disable_service',
        args: { service },
        resourceId: service,
        outcome: 'ok',
        status,
      });
      return ok(`${service} disabled on ${config.projectId}.`);
    },
  );
}

export { RefusedError };
