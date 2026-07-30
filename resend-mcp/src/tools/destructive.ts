import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResendClient } from '../client.js';
import type { Config } from '../config.js';
import { isProtectedDomain } from '../config.js';
import type { AuditLog } from '../audit.js';
import { ok, dryRun, requireConfirm, RefusedError } from '../guards.js';
import { annotateKeys, type ApiKeyRow, type Domain } from './read.js';

export function registerDestructiveTools(
  server: McpServer,
  client: ResendClient,
  config: Config,
  audit: AuditLog,
): void {
  server.tool(
    'resend_delete_api_key',
    'Delete an API key by ID. IRREVERSIBLE, and anything authenticating with it stops working ' +
      'immediately. Takes an ID only — never a name — because Resend cannot show key values, ' +
      'so a name is not proof of identity. confirm must equal the exact id or its last 6 chars.',
    {
      keyId: z.string().describe('Key ID from resend_list_api_keys. Not the name.'),
      confirm: z.string().describe('The exact keyId, or its last 6 characters.'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ keyId, confirm, dry_run }) => {
      if (dry_run) {
        return dryRun(
          async () => {
            const { data } = await client.request<{ data?: ApiKeyRow[] }>('GET', '/api-keys');
            const row = (data.data ?? []).find((k) => k.id === keyId);
            if (!row) throw new RefusedError(`No API key with id ${keyId}.`);
            return annotateKeys([row], config.breachDate)[0]!;
          },
          (k) =>
            `Delete API key "${k.name}" (${k.id}, created ${k.created})` +
            (k.suspect ? ' — flagged suspect, predates the breach date.' : '.'),
        );
      }

      try {
        requireConfirm(keyId, confirm);
      } catch (err) {
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'resend_delete_api_key',
          args: { keyId, confirm },
          resourceId: keyId,
          outcome: 'refused',
          detail: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      // Fail closed: intent durably journalled before anything is destroyed.
      await audit.recordCritical({
        ts: new Date().toISOString(),
        tool: 'resend_delete_api_key',
        args: { keyId },
        resourceId: keyId,
        outcome: 'pending',
      });
      const { status } = await client.request<unknown>('DELETE', `/api-keys/${keyId}`);
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'resend_delete_api_key',
        args: { keyId },
        resourceId: keyId,
        outcome: 'ok',
        status,
      });
      return ok(`API key ${keyId} deleted.`);
    },
  );

  server.tool(
    'resend_delete_domain',
    'Delete a sending domain. IRREVERSIBLE, and every app sending from it starts failing. ' +
      'Domains on RESEND_PROTECTED_DOMAINS are refused outright.',
    {
      domainId: z.string(),
      domainName: z.string().describe('The domain name, checked against the denylist.'),
      confirm: z.string().describe('The exact domainId, or its last 6 characters.'),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ domainId, domainName, confirm, dry_run }) => {
      if (isProtectedDomain(config, domainName)) {
        const err = new RefusedError(
          `"${domainName}" is on RESEND_PROTECTED_DOMAINS and cannot be deleted through this ` +
            'server under any flag combination.',
        );
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'resend_delete_domain',
          args: { domainId, domainName },
          resourceId: domainId,
          outcome: 'refused',
          detail: err.message,
        });
        throw err;
      }

      if (dry_run) {
        return dryRun(
          () => client.request<Domain>('GET', `/domains/${domainId}`).then((r) => r.data),
          (d) => `Delete sending domain ${d.name} (${d.id}, status ${d.status ?? 'unknown'}).`,
        );
      }

      try {
        requireConfirm(domainId, confirm);
      } catch (err) {
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'resend_delete_domain',
          args: { domainId, domainName, confirm },
          resourceId: domainId,
          outcome: 'refused',
          detail: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      // Fail closed: intent durably journalled before anything is destroyed.
      await audit.recordCritical({
        ts: new Date().toISOString(),
        tool: 'resend_delete_domain',
        args: { domainId, domainName },
        resourceId: domainId,
        outcome: 'pending',
      });
      const { status } = await client.request<unknown>('DELETE', `/domains/${domainId}`);
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'resend_delete_domain',
        args: { domainId, domainName },
        resourceId: domainId,
        outcome: 'ok',
        status,
      });
      return ok(`Domain ${domainName} (${domainId}) deleted.`);
    },
  );

  server.tool(
    'resend_delete_audience',
    'Delete an audience and its contacts. IRREVERSIBLE.',
    {
      audienceId: z.string(),
      confirm: z.string().describe('The exact audienceId, or its last 6 characters.'),
    },
    async ({ audienceId, confirm }) => {
      try {
        requireConfirm(audienceId, confirm);
      } catch (err) {
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'resend_delete_audience',
          args: { audienceId, confirm },
          resourceId: audienceId,
          outcome: 'refused',
          detail: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      // Fail closed: intent durably journalled before anything is destroyed.
      await audit.recordCritical({
        ts: new Date().toISOString(),
        tool: 'resend_delete_audience',
        args: { audienceId },
        resourceId: audienceId,
        outcome: 'pending',
      });
      const { status } = await client.request<unknown>('DELETE', `/audiences/${audienceId}`);
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'resend_delete_audience',
        args: { audienceId },
        resourceId: audienceId,
        outcome: 'ok',
        status,
      });
      return ok(`Audience ${audienceId} deleted.`);
    },
  );
}
