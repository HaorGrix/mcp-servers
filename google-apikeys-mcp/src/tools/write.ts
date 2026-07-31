import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiKeysClient } from '../client.js';
import type { Config } from '../config.js';
import { GEMINI_API } from '../config.js';
import type { AuditLog } from '../audit.js';
import { ok, dryRun } from '../guards.js';
import { writeSecretFile } from '../secrets.js';
import { type ApiKey, keyIdOf, summarise } from './read.js';

const API = 'https://apikeys.googleapis.com/v2';
const SU = 'https://serviceusage.googleapis.com/v1';

interface Operation {
  name: string;
  done?: boolean;
  response?: { name?: string; keyString?: string };
  error?: { message?: string };
}

export function registerWriteTools(
  server: McpServer,
  client: ApiKeysClient,
  config: Config,
  audit: AuditLog,
): void {
  const base = `${API}/projects/${config.projectId}/locations/${config.location}`;

  server.tool(
    'apikeys_create',
    'Create an API key. api_targets is REQUIRED: a key restricted to the APIs it actually ' +
      'needs is the whole point. An unrestricted key must be asked for explicitly with ' +
      'unrestricted=true, which is discouraged — the key stolen on 2026-06-24 had no ' +
      'restrictions. The key STRING is written to a 0600 file and this tool returns the path ' +
      'plus a fingerprint, never the value: a tool result lands in the transcript and stays there.',
    {
      displayName: z.string().max(100).describe('Human-readable name, e.g. "reiva-gemini-2026".'),
      api_targets: z
        .array(z.string())
        .describe(
          'Services this key may call, e.g. ["generativelanguage.googleapis.com"]. ' +
            'Pass an empty array ONLY with unrestricted=true.',
        ),
      unrestricted: z
        .boolean()
        .optional()
        .default(false)
        .describe('Discouraged. Required to be true if api_targets is empty.'),
      out_path: z.string().optional().describe('Where to write the key string.'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ displayName, api_targets, unrestricted, out_path, dry_run }) => {
      if (api_targets.length === 0 && !unrestricted) {
        return ok({
          refused: true,
          reason:
            'api_targets is empty. An unrestricted key can call every API enabled on the ' +
            'project. If that is genuinely intended, pass unrestricted=true explicitly.',
        });
      }

      // The Cloud-key vs AI-Studio-key confusion cost a live round trip during the
      // June rotation: a Cloud key 403s on the AI Studio endpoint reiva calls.
      const warnings: string[] = [];
      if (api_targets.includes(GEMINI_API)) {
        try {
          const { data } = await client.request<{ state?: string }>(
            'GET',
            `${SU}/projects/${config.projectId}/services/${GEMINI_API}`,
          );
          if (data.state !== 'ENABLED') {
            warnings.push(
              `${GEMINI_API} is ${data.state ?? 'not enabled'} on ${config.projectId}. This key ` +
                'will 403 until it is enabled. Note also that a Google Cloud API key is not an ' +
                'AI Studio key — if the caller uses the AI Studio endpoint, create the key there.',
            );
          }
        } catch {
          warnings.push(`Could not confirm ${GEMINI_API} is enabled; check before relying on this key.`);
        }
      }

      if (dry_run) {
        return ok({
          dryRun: true,
          wouldDo:
            `Create API key "${displayName}" restricted to ` +
            (api_targets.length ? api_targets.join(', ') : 'NOTHING (unrestricted)'),
          warnings,
        });
      }

      const body: Record<string, unknown> = { displayName };
      if (api_targets.length > 0) {
        body['restrictions'] = { apiTargets: api_targets.map((service) => ({ service })) };
      }

      const { data: started, status } = await client.request<Operation>('POST', `${base}/keys`, body);
      // The v2 API returns a long-running Operation, NOT the finished key. It is
      // not done on the first response, so reading op.response immediately gives
      // undefined — which previously produced keyId "unknown" and an EMPTY key
      // file reported as a success. Found by a live run on 2026-07-31; the
      // giveaway was fingerprint e3b0c44298fc, the SHA-256 of the empty string.
      const op = await awaitOperation(client, started);
      if (op.error) {
        throw new Error(`key creation failed: ${op.error.message ?? 'unknown'}`);
      }
      const keyName = op.response?.name ?? '';
      const keyId = keyName ? keyIdOf(keyName) : '';
      const keyString = op.response?.keyString ?? '';
      if (!keyId || !keyString) {
        throw new Error(
          'Key creation returned no key material, so nothing was written. The key may still ' +
            'exist in the project — run apikeys_list before retrying so a duplicate is not created.',
        );
      }

      const target = out_path ?? `${config.secretOutDir}/${keyId}.key`;
      const handle = await writeSecretFile(target, keyString, `API key ${keyId}`);

      await audit.record({
        ts: new Date().toISOString(),
        tool: 'apikeys_create',
        args: { displayName, api_targets, unrestricted, out_path: handle.path, fingerprint: handle.fingerprint },
        resourceId: keyId,
        outcome: 'ok',
        status,
      });

      return ok({
        keyId,
        displayName,
        apiTargets: api_targets,
        unrestricted: api_targets.length === 0,
        path: handle.path,
        fingerprint: handle.fingerprint,
        note: handle.note,
        warnings,
        nextStep:
          'Deploy and VERIFY this key works before deleting the one it replaces, then delete ' +
          'the file. Create-before-delete, never the other way round.',
      });
    },
  );

  server.tool(
    'apikeys_update_restrictions',
    'Change which APIs an existing key may call. Tightening restrictions on a live key ' +
      'takes effect immediately — anything calling an API you remove starts failing, so ' +
      'confirm the caller set first.',
    {
      keyId: z.string().describe('Key id, as returned by apikeys_list.'),
      api_targets: z.array(z.string()).min(1).describe('The new complete allowed-API list.'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ keyId, api_targets, dry_run }) => {
      const url = `${base}/keys/${keyId}`;
      if (dry_run) {
        return dryRun(
          () => client.request<ApiKey>('GET', url).then((r) => r.data),
          (k) => {
            const before = k.restrictions?.apiTargets?.map((t) => t.service) ?? [];
            return (
              `Restrict key ${keyId} to [${api_targets.join(', ')}]. Currently ` +
              (before.length ? `[${before.join(', ')}]` : 'UNRESTRICTED') +
              '.'
            );
          },
        );
      }
      const { status } = await client.request<Operation>(
        'PATCH',
        `${url}?updateMask=restrictions`,
        { restrictions: { apiTargets: api_targets.map((service) => ({ service })) } },
      );
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'apikeys_update_restrictions',
        args: { keyId, api_targets },
        resourceId: keyId,
        outcome: 'ok',
        status,
      });
      const { data } = await client.request<ApiKey>('GET', url);
      return ok(summarise(data));
    },
  );
}

/**
 * Polls a long-running Operation to completion.
 *
 * The API Keys v2 create endpoint returns immediately with `done: false`; the
 * key material only appears once the operation finishes. Without this the tool
 * silently wrote an empty file and called it a success.
 */
async function awaitOperation(
  client: ApiKeysClient,
  op: Operation,
  timeoutMs = 30_000,
): Promise<Operation> {
  if (op.done) return op;
  const deadline = Date.now() + timeoutMs;
  let current = op;
  let delay = 250;
  while (!current.done) {
    if (Date.now() > deadline) {
      throw new Error(
        `Key creation did not complete within ${timeoutMs}ms. It may still have succeeded — ` +
          'run apikeys_list before retrying so a duplicate is not created.',
      );
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 2_000);
    const { data } = await client.request<Operation>(
      'GET',
      `https://apikeys.googleapis.com/v2/${current.name}`,
    );
    current = data;
  }
  return current;
}
