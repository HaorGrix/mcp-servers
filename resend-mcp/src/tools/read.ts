import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResendClient } from '../client.js';
import type { Config } from '../config.js';
import { ok } from '../guards.js';

export interface ApiKeyRow {
  id: string;
  name: string;
  created_at: string;
}

export interface Domain {
  id: string;
  name: string;
  status?: string;
  created_at?: string;
  region?: string;
}

/**
 * Resend never exposes a key VALUE after creation — not in the API, not in the
 * dashboard. So a key can only be identified by name plus creation date, which
 * is why `suspect` is computed here rather than left to the caller's judgement.
 */
export function annotateKeys(keys: ApiKeyRow[], breachDate: string) {
  const cutoff = new Date(breachDate).getTime();
  return keys.map((k) => {
    const created = new Date(k.created_at).getTime();
    const suspect = Number.isFinite(created) && created < cutoff;
    return {
      id: k.id,
      name: k.name,
      created: k.created_at,
      suspect,
      ...(suspect
        ? {
            reason:
              `Created before the ${breachDate} breach, so it must be treated as compromised. ` +
              'Resend cannot show key values, so date is the only evidence available.',
          }
        : {}),
    };
  });
}

export function registerReadTools(server: McpServer, client: ResendClient, config: Config): void {
  server.tool(
    'resend_list_api_keys',
    'List API keys: id, name and creation date. Resend NEVER exposes key values, so a key can ' +
      `only be identified by name plus date. Each key is flagged suspect if it predates the ` +
      `configured breach date (${config.breachDate}). Use the id — never the name — with ` +
      'resend_delete_api_key.',
    {},
    async () => {
      const { data } = await client.request<{ data?: ApiKeyRow[] }>('GET', '/api-keys');
      const keys = annotateKeys(data.data ?? [], config.breachDate);
      return ok({
        count: keys.length,
        suspectCount: keys.filter((k) => k.suspect).length,
        keys,
      });
    },
  );

  server.tool(
    'resend_list_domains',
    'List sending domains and their verification status.',
    {},
    async () => {
      const { data } = await client.request<{ data?: Domain[] }>('GET', '/domains');
      return ok({ count: data.data?.length ?? 0, domains: data.data ?? [] });
    },
  );

  server.tool(
    'resend_get_domain',
    'Get one domain by id, including DNS records and verification state.',
    { domainId: z.string() },
    async ({ domainId }) => {
      const { data } = await client.request<Domain>('GET', `/domains/${domainId}`);
      return ok(data);
    },
  );

  server.tool(
    'resend_get_email',
    'Get a sent email by id: status, recipients, subject and timestamps.',
    { emailId: z.string() },
    async ({ emailId }) => {
      const { data } = await client.request<unknown>('GET', `/emails/${emailId}`);
      return ok(data);
    },
  );

  server.tool(
    'resend_list_audiences',
    'List audiences.',
    {},
    async () => {
      const { data } = await client.request<{ data?: unknown[] }>('GET', '/audiences');
      return ok(data.data ?? []);
    },
  );

  server.tool(
    'resend_list_contacts',
    `List contacts in an audience. Paginated by the provider; default cap ${config.pageLimit}.`,
    { audienceId: z.string(), limit: z.number().int().min(1).max(500).optional() },
    async ({ audienceId, limit }) => {
      const { data } = await client.request<{ data?: unknown[] }>(
        'GET',
        `/audiences/${audienceId}/contacts`,
      );
      const all = data.data ?? [];
      const cap = limit ?? config.pageLimit;
      return ok({
        count: Math.min(all.length, cap),
        truncated: all.length > cap,
        contacts: all.slice(0, cap),
      });
    },
  );

  server.tool(
    'resend_list_broadcasts',
    'List broadcasts and their send status.',
    {},
    async () => {
      const { data } = await client.request<{ data?: unknown[] }>('GET', '/broadcasts');
      return ok(data.data ?? []);
    },
  );
}
