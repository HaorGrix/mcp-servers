import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiKeysClient } from '../client.js';
import type { Config } from '../config.js';
import { ok } from '../guards.js';

const API = 'https://apikeys.googleapis.com/v2';

export interface ApiKey {
  name: string;
  uid?: string;
  displayName?: string;
  createTime?: string;
  updateTime?: string;
  deleteTime?: string;
  restrictions?: {
    apiTargets?: { service: string }[];
    browserKeyRestrictions?: unknown;
    serverKeyRestrictions?: unknown;
  };
}

/** `projects/x/locations/global/keys/<id>` -> `<id>` */
export function keyIdOf(name: string): string {
  return name.split('/').pop() ?? name;
}

/** A key with no apiTargets can call every enabled API on the project. */
export function summarise(k: ApiKey) {
  const targets = k.restrictions?.apiTargets?.map((t) => t.service) ?? [];
  return {
    keyId: keyIdOf(k.name),
    displayName: k.displayName,
    created: k.createTime,
    updated: k.updateTime,
    ...(k.deleteTime ? { deleteTime: k.deleteTime, state: 'DELETED (restorable)' } : {}),
    apiTargets: targets,
    unrestricted: targets.length === 0,
    ...(targets.length === 0
      ? {
          warning:
            'UNRESTRICTED: this key can call every API enabled on the project. The key stolen ' +
            'in the 2026-06-24 breach was unrestricted, which is part of why it was worth stealing.',
        }
      : {}),
  };
}

export function registerReadTools(server: McpServer, client: ApiKeysClient, config: Config): void {
  const base = `${API}/projects/${config.projectId}/locations/${config.location}`;

  server.tool(
    'apikeys_list',
    `List API keys in project ${config.projectId}. Returns key id, display name, creation ` +
      'date and API restrictions — never the key string, which is not readable through this ' +
      `server at all. Paginated, default cap ${config.pageLimit}, sets a truncated flag when capped. ` +
      'Creation date is what tells you whether a key predates an incident.',
    {
      limit: z.number().int().min(1).max(500).optional().describe('Override the page cap.'),
      showDeleted: z.boolean().optional().default(false).describe('Include soft-deleted keys.'),
    },
    async ({ limit, showDeleted }) => {
      const { items, truncated } = await client.listAll<ApiKey>(
        `${base}/keys${showDeleted ? '?showDeleted=true' : ''}`,
        'keys',
        limit,
      );
      const keys = items.map(summarise);
      return ok({
        count: keys.length,
        truncated,
        unrestrictedCount: keys.filter((k) => k.unrestricted).length,
        keys,
      });
    },
  );

  server.tool(
    'apikeys_get',
    'Get one API key by id: display name, creation date and restrictions. Never the key string.',
    { keyId: z.string().describe('Key id, as returned by apikeys_list.') },
    async ({ keyId }) => {
      const { data } = await client.request<ApiKey>('GET', `${base}/keys/${keyId}`);
      return ok(summarise(data));
    },
  );

  server.tool(
    'apikeys_lookup',
    'Find which key id a key STRING belongs to, without revealing any key string. Use this to ' +
      'identify a key you hold a value for — for example matching a leaked value against the ' +
      'console — rather than guessing from names. The string you pass is redacted before it ' +
      'reaches the audit journal or any log line.',
    { keyString: z.string().describe('The API key value to identify.') },
    async ({ keyString }) => {
      const { data } = await client.request<{ name?: string; parent?: string }>(
        'GET',
        `${API}/keys:lookupKey?keyString=${encodeURIComponent(keyString)}`,
      );
      return ok({
        keyId: data.name ? keyIdOf(data.name) : null,
        parent: data.parent,
        note: 'The key string you supplied was not logged or stored.',
      });
    },
  );
}
