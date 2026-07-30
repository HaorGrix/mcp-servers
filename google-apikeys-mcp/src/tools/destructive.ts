import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiKeysClient } from '../client.js';
import type { Config } from '../config.js';
import { isProtected } from '../config.js';
import type { AuditLog } from '../audit.js';
import { ok, dryRun, requireConfirm, RefusedError } from '../guards.js';
import type { ApiKey } from './read.js';

const API = 'https://apikeys.googleapis.com/v2';

/**
 * Destructive tools — registered only when APIKEYS_ALLOW_DESTRUCTIVE is on,
 * which itself requires APIKEYS_ALLOW_WRITES. Denylist first, then exact-id
 * confirm, then the call. Every path writes an audit line.
 */
export function registerDestructiveTools(
  server: McpServer,
  client: ApiKeysClient,
  config: Config,
  audit: AuditLog,
): void {
  const base = `${API}/projects/${config.projectId}/locations/${config.location}`;

  server.tool(
    'apikeys_delete',
    'Delete an API key. Anything authenticating with it stops working immediately. Google ' +
      'soft-deletes for 30 days, so apikeys_undelete can recover it within that window — but ' +
      'treat it as irreversible when planning. confirm must equal the key id or its last 6 ' +
      'characters, so a key cannot be deleted without having read it first.',
    {
      keyId: z.string().describe('Key id, as returned by apikeys_list.'),
      confirm: z.string().describe('The exact keyId, or its last 6 characters.'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ keyId, confirm, dry_run }) => {
      const url = `${base}/keys/${keyId}`;

      // Denylist before flags, before confirm, before dry_run — a protected id
      // is not even rehearsable as deletable.
      if (isProtected(config, keyId)) {
        const err = new RefusedError(
          `"${keyId}" is on APIKEYS_PROTECTED_KEYS and cannot be deleted through this server ` +
            'under any flag combination.',
        );
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'apikeys_delete',
          args: { keyId },
          resourceId: keyId,
          outcome: 'refused',
          detail: err.message,
        });
        throw err;
      }

      if (dry_run) {
        return dryRun(
          () => client.request<ApiKey>('GET', url).then((r) => r.data),
          (k) =>
            `Delete key ${keyId} ("${k.displayName ?? 'unnamed'}", created ${k.createTime ?? 'unknown'}). ` +
            'Recoverable via apikeys_undelete for 30 days.',
        );
      }

      try {
        requireConfirm(keyId, confirm);
      } catch (err) {
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'apikeys_delete',
          args: { keyId, confirm },
          resourceId: keyId,
          outcome: 'refused',
          detail: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      // Fail closed: the intent must be durably journalled before anything is
      // destroyed. An unlogged delete is not recoverable; a refused one is.
      await audit.recordCritical({
        ts: new Date().toISOString(),
        tool: 'apikeys_delete',
        args: { keyId },
        resourceId: keyId,
        outcome: 'pending',
      });
      const { status } = await client.request<unknown>('DELETE', url);
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'apikeys_delete',
        args: { keyId },
        resourceId: keyId,
        outcome: 'ok',
        status,
      });
      return ok(`Key ${keyId} deleted. Recoverable with apikeys_undelete for 30 days.`);
    },
  );

  server.tool(
    'apikeys_undelete',
    'Restore a key deleted within the last 30 days. The rollback for apikeys_delete.',
    { keyId: z.string().describe('Key id of the soft-deleted key.') },
    async ({ keyId }) => {
      const { status } = await client.request<unknown>('POST', `${base}/keys/${keyId}:undelete`, {});
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'apikeys_undelete',
        args: { keyId },
        resourceId: keyId,
        outcome: 'ok',
        status,
      });
      return ok(`Key ${keyId} restored.`);
    },
  );
}
