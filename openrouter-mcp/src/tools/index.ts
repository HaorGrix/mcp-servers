import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OpenRouterClient } from '../client.js';
import type { Config } from '../config.js';
import { isProtected } from '../config.js';
import type { AuditLog } from '../audit.js';
import { ok, dryRun, requireConfirm, RefusedError } from '../guards.js';
import { writeSecretFile } from '../secrets.js';

export interface KeyRow {
  hash: string;
  name: string;
  label?: string;
  limit?: number | null;
  usage?: number;
  disabled?: boolean;
  created_at?: string;
}

/** Surfaces the uncapped case rather than reporting it silently. */
export function summariseKey(k: KeyRow) {
  const uncapped = k.limit === null || k.limit === undefined;
  return {
    hash: k.hash,
    name: k.name ?? k.label,
    limit: k.limit ?? null,
    usage: k.usage ?? 0,
    remaining: uncapped ? null : Math.max(0, (k.limit ?? 0) - (k.usage ?? 0)),
    disabled: k.disabled ?? false,
    created: k.created_at,
    uncapped,
    ...(uncapped
      ? {
          warning:
            'UNCAPPED: this key can spend the entire account balance. Set a limit unless it is ' +
            'deliberately the account-wide key.',
        }
      : {}),
  };
}

// --- read -------------------------------------------------------------------

export function registerReadTools(server: McpServer, client: OpenRouterClient, config: Config): void {
  server.tool(
    'openrouter_list_keys',
    'List provisioned API keys: hash, name, credit limit, usage and whether each is uncapped. ' +
      'Never returns key values — OpenRouter does not expose them after creation. The hash is ' +
      `the id used everywhere else. Default cap ${config.pageLimit}.`,
    { limit: z.number().int().min(1).max(500).optional() },
    async ({ limit }) => {
      const { data } = await client.request<{ data?: KeyRow[] }>('GET', '/keys');
      const rows = (data.data ?? []).slice(0, limit ?? config.pageLimit);
      const keys = rows.map(summariseKey);
      return ok({
        count: keys.length,
        truncated: (data.data?.length ?? 0) > keys.length,
        uncappedCount: keys.filter((k) => k.uncapped).length,
        keys,
      });
    },
  );

  server.tool(
    'openrouter_get_key',
    'Get one provisioned key by hash.',
    { keyHash: z.string() },
    async ({ keyHash }) => {
      const { data } = await client.request<{ data: KeyRow }>('GET', `/keys/${keyHash}`);
      return ok(summariseKey(data.data));
    },
  );

  server.tool(
    'openrouter_get_credits',
    'Account credit balance and total usage. Read-only; this server exposes no billing mutation.',
    {},
    async () => {
      const { data } = await client.request<unknown>('GET', '/credits');
      return ok(data);
    },
  );

  server.tool(
    'openrouter_list_models',
    'List available models with pricing and context length.',
    {},
    async () => {
      const { data } = await client.request<{ data?: unknown[] }>('GET', '/models');
      const models = data.data ?? [];
      return ok({ count: models.length, models: models.slice(0, config.pageLimit) });
    },
  );

  server.tool(
    'openrouter_get_generation',
    'Cost and token counts for a single completed generation, by id. Use this to attribute ' +
      'spend to a specific call rather than guessing from the account total.',
    { generationId: z.string() },
    async ({ generationId }) => {
      const { data } = await client.request<unknown>('GET', `/generation?id=${encodeURIComponent(generationId)}`);
      return ok(data);
    },
  );
}

// --- write ------------------------------------------------------------------

export function registerWriteTools(
  server: McpServer,
  client: OpenRouterClient,
  config: Config,
  audit: AuditLog,
): void {
  server.tool(
    'openrouter_create_key',
    'Create a provisioned API key. The value is returned by OpenRouter exactly once and can ' +
      'never be read again, so it is written to a 0600 file and this tool returns the path plus ' +
      'a fingerprint — never the value. A credit limit is strongly recommended: an uncapped key ' +
      'can spend the whole account balance.',
    {
      name: z.string().max(100).describe('e.g. "reiva-2026".'),
      limit: z
        .number()
        .min(1)
        .optional()
        .describe('Credit ceiling in USD. Omit only for a deliberately uncapped key.'),
      out_path: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ name, limit, out_path, dry_run }) => {
      const effectiveLimit = limit ?? config.defaultKeyLimit;
      const warnings =
        effectiveLimit === undefined
          ? [
              'No credit limit set and no OPENROUTER_DEFAULT_KEY_LIMIT configured. This key can ' +
                'spend the entire account balance.',
            ]
          : [];

      if (dry_run) {
        return ok({
          dryRun: true,
          wouldDo: `Create key "${name}"${effectiveLimit ? ` capped at ${effectiveLimit} credits` : ' with NO limit'}.`,
          warnings,
        });
      }

      const { data, status } = await client.request<{ key: string; data?: KeyRow }>('POST', '/keys', {
        name,
        ...(effectiveLimit === undefined ? {} : { limit: effectiveLimit }),
      });

      const hash = data.data?.hash ?? 'unknown';
      const target = out_path ?? `${config.secretOutDir}/${hash}.key`;
      const handle = await writeSecretFile(target, data.key, `OpenRouter key ${hash}`);

      await audit.record({
        ts: new Date().toISOString(),
        tool: 'openrouter_create_key',
        args: { name, limit: effectiveLimit, out_path: handle.path, fingerprint: handle.fingerprint },
        resourceId: hash,
        outcome: 'ok',
        status,
      });

      return ok({
        hash,
        name,
        limit: effectiveLimit ?? null,
        path: handle.path,
        fingerprint: handle.fingerprint,
        note: handle.note,
        warnings,
      });
    },
  );

  server.tool(
    'openrouter_update_key',
    'Change a key credit limit, or disable it. Disabling is the reversible alternative to ' +
      'deleting and is the safer first step when a key may be compromised.',
    {
      keyHash: z.string(),
      limit: z.number().min(0).optional(),
      disabled: z.boolean().optional(),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ keyHash, limit, disabled, dry_run }) => {
      if (limit === undefined && disabled === undefined) {
        return ok({ refused: true, reason: 'Nothing to change: pass limit, disabled, or both.' });
      }
      if (dry_run) {
        return dryRun(
          () => client.request<{ data: KeyRow }>('GET', `/keys/${keyHash}`).then((r) => r.data.data),
          (k) =>
            `Update key "${k.name}" (${k.hash}): ` +
            [
              limit !== undefined ? `limit ${k.limit ?? 'none'} -> ${limit}` : null,
              disabled !== undefined ? `disabled ${k.disabled ?? false} -> ${disabled}` : null,
            ]
              .filter(Boolean)
              .join(', '),
        );
      }
      const { status } = await client.request<unknown>('PATCH', `/keys/${keyHash}`, {
        ...(limit === undefined ? {} : { limit }),
        ...(disabled === undefined ? {} : { disabled }),
      });
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'openrouter_update_key',
        args: { keyHash, limit, disabled },
        resourceId: keyHash,
        outcome: 'ok',
        status,
      });
      return ok(`Key ${keyHash} updated.`);
    },
  );
}

// --- destructive ------------------------------------------------------------

export function registerDestructiveTools(
  server: McpServer,
  client: OpenRouterClient,
  config: Config,
  audit: AuditLog,
): void {
  server.tool(
    'openrouter_delete_key',
    'Delete a provisioned key by hash. IRREVERSIBLE — anything using it stops working ' +
      'immediately. Prefer openrouter_update_key(disabled=true) first, which is reversible. ' +
      'Hashes on OPENROUTER_PROTECTED_KEYS are refused outright. confirm must equal the exact ' +
      'hash or its last 6 characters.',
    {
      keyHash: z.string(),
      confirm: z.string().describe('The exact keyHash, or its last 6 characters.'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ keyHash, confirm, dry_run }) => {
      if (isProtected(config, keyHash)) {
        const err = new RefusedError(
          `"${keyHash}" is on OPENROUTER_PROTECTED_KEYS and cannot be deleted through this ` +
            'server under any flag combination.',
        );
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'openrouter_delete_key',
          args: { keyHash },
          resourceId: keyHash,
          outcome: 'refused',
          detail: err.message,
        });
        throw err;
      }

      if (dry_run) {
        return dryRun(
          () => client.request<{ data: KeyRow }>('GET', `/keys/${keyHash}`).then((r) => r.data.data),
          (k) =>
            `Delete key "${k.name}" (${k.hash}), usage ${k.usage ?? 0} of ${k.limit ?? 'unlimited'}. ` +
            'Consider disabling instead — that is reversible.',
        );
      }

      try {
        requireConfirm(keyHash, confirm);
      } catch (err) {
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'openrouter_delete_key',
          args: { keyHash, confirm },
          resourceId: keyHash,
          outcome: 'refused',
          detail: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      // Fail closed: intent durably journalled before anything is destroyed.
      await audit.recordCritical({
        ts: new Date().toISOString(),
        tool: 'openrouter_delete_key',
        args: { keyHash },
        resourceId: keyHash,
        outcome: 'pending',
      });
      const { status } = await client.request<unknown>('DELETE', `/keys/${keyHash}`);
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'openrouter_delete_key',
        args: { keyHash },
        resourceId: keyHash,
        outcome: 'ok',
        status,
      });
      return ok(`Key ${keyHash} deleted.`);
    },
  );
}
