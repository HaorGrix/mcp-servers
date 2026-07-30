import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GcpClient } from '../client.js';
import type { Config } from '../config.js';
import { ok } from '../guards.js';

const IAM = 'https://iam.googleapis.com/v1';
const CRM = 'https://cloudresourcemanager.googleapis.com/v1';
const SU = 'https://serviceusage.googleapis.com/v1';
const BILLING = 'https://cloudbilling.googleapis.com/v1';

interface ServiceAccount {
  name: string;
  email: string;
  displayName?: string;
  disabled?: boolean;
  uniqueId?: string;
}

interface ServiceAccountKey {
  name: string;
  validAfterTime?: string;
  validBeforeTime?: string;
  keyType?: string;
  keyOrigin?: string;
}

/**
 * Read tools. Always registered — they cannot mutate anything and none of them
 * returns a credential. Anything that RETURNS a secret lives in the secret-read
 * tier instead, however read-only it looks.
 */
export function registerReadTools(server: McpServer, client: GcpClient, config: Config): void {
  server.tool(
    'gcp_list_service_accounts',
    `List service accounts in project ${config.projectId}. Returns email, display name, ` +
      `unique id and disabled state. Paginated; returns at most GCP_PAGE_LIMIT ` +
      `(currently ${config.pageLimit}) with a truncated flag when capped.`,
    {
      limit: z.number().int().min(1).max(500).optional().describe('Override the page cap.'),
    },
    async ({ limit }) => {
      const { items, truncated } = await client.listAll<ServiceAccount>(
        `${IAM}/projects/${config.projectId}/serviceAccounts`,
        'accounts',
        limit,
      );
      return ok({ count: items.length, truncated, accounts: items });
    },
  );

  server.tool(
    'gcp_get_service_account',
    'Get one service account by email.',
    { email: z.string().describe('Full service account email.') },
    async ({ email }) => {
      const { data } = await client.request<ServiceAccount>(
        'GET',
        `${IAM}/projects/${config.projectId}/serviceAccounts/${encodeURIComponent(email)}`,
      );
      return ok(data);
    },
  );

  server.tool(
    'gcp_list_sa_keys',
    'List the keys on a service account: key id, type, and validAfterTime (the creation ' +
      'date). Never returns key material — that cannot be re-read from Google once issued. ' +
      'This is the tool that answers "which of these keys predates the breach, and is the ' +
      'stolen one still live?" without opening the console.',
    {
      email: z.string().describe('Full service account email.'),
      keyTypes: z
        .enum(['USER_MANAGED', 'SYSTEM_MANAGED', 'ALL'])
        .optional()
        .default('USER_MANAGED')
        .describe('USER_MANAGED is what rotation cares about; Google rotates the rest itself.'),
    },
    async ({ email, keyTypes }) => {
      const filter = keyTypes === 'ALL' ? '' : `?keyTypes=${keyTypes}`;
      const { data } = await client.request<{ keys?: ServiceAccountKey[] }>(
        'GET',
        `${IAM}/projects/${config.projectId}/serviceAccounts/${encodeURIComponent(email)}/keys${filter}`,
      );
      const keys = (data.keys ?? []).map((k) => ({
        keyId: k.name.split('/').pop(),
        created: k.validAfterTime,
        expires: k.validBeforeTime,
        keyType: k.keyType,
        origin: k.keyOrigin,
      }));
      return ok({ email, count: keys.length, keys });
    },
  );

  server.tool(
    'gcp_get_iam_policy',
    `Get the IAM policy for project ${config.projectId} — every role binding and its members.`,
    {},
    async () => {
      const { data } = await client.request<unknown>(
        'POST',
        `${CRM}/projects/${config.projectId}:getIamPolicy`,
        {},
      );
      return ok(data);
    },
  );

  server.tool(
    'gcp_test_permissions',
    'Check which of the given permissions the current credential actually holds on the ' +
      'project. Use this before assuming a failure is a bug — a 403 is usually a real answer.',
    {
      permissions: z
        .array(z.string())
        .min(1)
        .max(100)
        .describe('e.g. ["iam.serviceAccountKeys.create","iam.serviceAccountKeys.delete"]'),
    },
    async ({ permissions }) => {
      const { data } = await client.request<{ permissions?: string[] }>(
        'POST',
        `${CRM}/projects/${config.projectId}:testIamPermissions`,
        { permissions },
      );
      const held = data.permissions ?? [];
      return ok({
        held,
        missing: permissions.filter((p) => !held.includes(p)),
      });
    },
  );

  server.tool(
    'gcp_list_enabled_services',
    `List APIs enabled on project ${config.projectId}. Paginated.`,
    { limit: z.number().int().min(1).max(500).optional() },
    async ({ limit }) => {
      const { items, truncated } = await client.listAll<{ config?: { name?: string } }>(
        `${SU}/projects/${config.projectId}/services?filter=state:ENABLED`,
        'services',
        limit,
      );
      return ok({
        count: items.length,
        truncated,
        services: items.map((s) => s.config?.name).filter(Boolean),
      });
    },
  );

  server.tool(
    'gcp_get_billing_info',
    'Get the billing account linked to the project. READ ONLY by design — this server ' +
      'never exposes a billing mutation, whatever the write flags say.',
    {},
    async () => {
      const { data } = await client.request<unknown>(
        'GET',
        `${BILLING}/projects/${config.projectId}/billingInfo`,
      );
      return ok(data);
    },
  );
}
