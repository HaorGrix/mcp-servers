import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GcpClient } from '../client.js';
import type { Config } from '../config.js';
import type { AuditLog } from '../audit.js';
import { ok, dryRun } from '../guards.js';
import { writeSecretFile } from '../secrets.js';

const IAM = 'https://iam.googleapis.com/v1';
const SU = 'https://serviceusage.googleapis.com/v1';

interface ServiceAccount {
  email: string;
  displayName?: string;
  disabled?: boolean;
}

/**
 * Write tools — registered ONLY when GCP_ALLOW_WRITES is on, so when the flag is
 * off they are absent from tools/list entirely and cannot be reached by guessing
 * a tool name. Deletes live in destructive.ts behind a second flag.
 */
export function registerWriteTools(
  server: McpServer,
  client: GcpClient,
  config: Config,
  audit: AuditLog,
): void {
  server.tool(
    'gcp_create_service_account',
    'Create a new service account in the project.',
    {
      accountId: z
        .string()
        .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, '6-30 chars, lowercase letters, digits, hyphens')
        .describe('The id portion, before the @.'),
      displayName: z.string().max(100).describe('Human-readable name.'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ accountId, displayName, dry_run }) => {
      if (dry_run) {
        // Probe: prove the id is FREE. For a create, "the resource exists" is
        // the failure case, so the dry run reports the collision instead.
        const { items } = await client.listAll<ServiceAccount>(
          `${IAM}/projects/${config.projectId}/serviceAccounts`,
          'accounts',
        );
        const email = `${accountId}@${config.projectId}.iam.gserviceaccount.com`;
        const clash = items.find((a) => a.email === email);
        return ok({
          dryRun: true,
          wouldDo: clash
            ? `REFUSE: ${email} already exists.`
            : `Create service account ${email} ("${displayName}").`,
        });
      }
      const { data, status } = await client.request<ServiceAccount>(
        'POST',
        `${IAM}/projects/${config.projectId}/serviceAccounts`,
        { accountId, serviceAccount: { displayName } },
      );
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'gcp_create_service_account',
        args: { accountId, displayName },
        resourceId: data.email,
        outcome: 'ok',
        status,
      });
      return ok(data);
    },
  );

  server.tool(
    'gcp_set_service_account_enabled',
    'Enable or disable a service account. Disabling is reversible and is the safe ' +
      'first step before deleting one — prefer it while confirming nothing broke.',
    {
      email: z.string().describe('Full service account email.'),
      enabled: z.boolean().describe('true = enable, false = disable.'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ email, enabled, dry_run }) => {
      const base = `${IAM}/projects/${config.projectId}/serviceAccounts/${encodeURIComponent(email)}`;
      if (dry_run) {
        return dryRun(
          () => client.request<ServiceAccount>('GET', base).then((r) => r.data),
          (sa) =>
            `${enabled ? 'Enable' : 'Disable'} ${sa.email} (currently ${sa.disabled ? 'disabled' : 'enabled'}).`,
        );
      }
      const { status } = await client.request<unknown>(
        'POST',
        `${base}:${enabled ? 'enable' : 'disable'}`,
        {},
      );
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'gcp_set_service_account_enabled',
        args: { email, enabled },
        resourceId: email,
        outcome: 'ok',
        status,
      });
      return ok(`${email} is now ${enabled ? 'enabled' : 'disabled'}.`);
    },
  );

  server.tool(
    'gcp_create_sa_key',
    'Create a new JSON key for a service account. Google returns the private key ONCE and ' +
      'it can never be re-read, so the key material is written to a 0600 file and this tool ' +
      'returns the FILE PATH plus a fingerprint — never the value. A tool result lands in the ' +
      'conversation transcript and stays there, which is how a live credential leaks. ' +
      'Always create and verify the new key BEFORE deleting an old one.',
    {
      email: z.string().describe('Full service account email.'),
      out_path: z
        .string()
        .optional()
        .describe('Where to write the key JSON. Defaults to GCP_SECRET_OUT_DIR/<keyId>.json'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ email, out_path, dry_run }) => {
      const base = `${IAM}/projects/${config.projectId}/serviceAccounts/${encodeURIComponent(email)}`;
      if (dry_run) {
        return dryRun(
          () => client.request<ServiceAccount>('GET', base).then((r) => r.data),
          (sa) => `Create a new USER_MANAGED JSON key on ${sa.email}.`,
        );
      }
      const { data, status } = await client.request<{ name: string; privateKeyData?: string }>(
        'POST',
        `${base}/keys`,
        { privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE', keyAlgorithm: 'KEY_ALG_RSA_2048' },
      );
      const keyId = data.name.split('/').pop() ?? 'unknown';
      // Google base64-encodes the credentials file in privateKeyData.
      const material = data.privateKeyData
        ? Buffer.from(data.privateKeyData, 'base64').toString('utf8')
        : '';
      const target = out_path ?? `${config.secretOutDir}/${keyId}.json`;
      const handle = await writeSecretFile(target, material, `Service-account key ${keyId}`);

      await audit.record({
        ts: new Date().toISOString(),
        tool: 'gcp_create_sa_key',
        // Never the material — only where it went and what it hashes to.
        args: { email, out_path: handle.path, fingerprint: handle.fingerprint },
        resourceId: keyId,
        outcome: 'ok',
        status,
      });

      return ok({
        keyId,
        email,
        path: handle.path,
        fingerprint: handle.fingerprint,
        bytes: handle.bytes,
        note: handle.note,
        nextStep:
          'Verify the new key works BEFORE deleting any old one. Then delete this file — ' +
          'a 0600 file is better than a transcript, but it is still a private key on disk.',
      });
    },
  );

  server.tool(
    'gcp_enable_service',
    'Enable an API on the project, e.g. generativelanguage.googleapis.com. Enabling is ' +
      'additive and low risk; disabling is destructive and lives behind the delete flag.',
    {
      service: z.string().describe('Service name, e.g. "iam.googleapis.com".'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ service, dry_run }) => {
      if (dry_run) {
        return dryRun(
          () =>
            client
              .request<{ state?: string }>('GET', `${SU}/projects/${config.projectId}/services/${service}`)
              .then((r) => r.data),
          (s) => `Enable ${service} (currently ${s.state ?? 'unknown'}).`,
        );
      }
      const { status } = await client.request<unknown>(
        'POST',
        `${SU}/projects/${config.projectId}/services/${service}:enable`,
        {},
      );
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'gcp_enable_service',
        args: { service },
        resourceId: service,
        outcome: 'ok',
        status,
      });
      return ok(`${service} enabled on ${config.projectId}.`);
    },
  );
}
