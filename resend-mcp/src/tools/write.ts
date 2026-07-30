import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResendClient } from '../client.js';
import type { Config } from '../config.js';
import { blockedIn } from '../config.js';
import type { AuditLog } from '../audit.js';
import { ok, RefusedError } from '../guards.js';
import { writeSecretFile } from '../secrets.js';

export function registerWriteTools(
  server: McpServer,
  client: ResendClient,
  config: Config,
  audit: AuditLog,
): void {
  server.tool(
    'resend_create_api_key',
    'Create a Resend API key. The value is returned by Resend exactly once and can never be ' +
      'read again, so it is written to a 0600 file and this tool returns the path plus a ' +
      'fingerprint — never the value. Create and verify the new key BEFORE deleting an old one.',
    {
      name: z.string().max(100).describe('e.g. "edugrix-2026".'),
      permission: z.enum(['full_access', 'sending_access']).optional().default('sending_access'),
      out_path: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ name, permission, out_path, dry_run }) => {
      if (dry_run) {
        return ok({
          dryRun: true,
          wouldDo: `Create Resend API key "${name}" with ${permission}.`,
        });
      }
      const { data, status } = await client.request<{ id: string; token: string }>(
        'POST',
        '/api-keys',
        { name, permission },
      );
      const target = out_path ?? `${config.secretOutDir}/${data.id}.key`;
      const handle = await writeSecretFile(target, data.token, `Resend API key ${data.id}`);

      await audit.record({
        ts: new Date().toISOString(),
        tool: 'resend_create_api_key',
        args: { name, permission, out_path: handle.path, fingerprint: handle.fingerprint },
        resourceId: data.id,
        outcome: 'ok',
        status,
      });

      return ok({
        id: data.id,
        name,
        permission,
        path: handle.path,
        fingerprint: handle.fingerprint,
        note: handle.note,
      });
    },
  );

  server.tool(
    'resend_send_email',
    'Send a transactional email. IRREVERSIBLE — a sent email cannot be recalled. Recipients ' +
      'on RESEND_BLOCKED_RECIPIENTS are refused before the request is issued, and when ' +
      'RESEND_ENFORCE_SENDER is set the from address must match it exactly.',
    {
      from: z.string().describe('Sender address.'),
      to: z.array(z.string()).min(1).max(50).describe('Recipient addresses.'),
      subject: z.string().max(200),
      text: z.string().describe('Plain text body.'),
      html: z.string().optional(),
      dry_run: z.boolean().optional().default(false),
    },
    async ({ from, to, subject, text, html, dry_run }) => {
      // Enforced server-side, before anything reaches Resend. A send tool is
      // exactly what breaches a never-contact rule by accident.
      const blocked = blockedIn(config, to);
      if (blocked.length > 0) {
        const err = new RefusedError(
          `Refusing to send: ${blocked.join(', ')} on the blocked-recipient list. That address ` +
            'is a permanent company rule, never a recipient and never a sender. Remove the ' +
            'recipient, not the rule.',
        );
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'resend_send_email',
          args: { from, to, subject },
          outcome: 'refused',
          detail: err.message,
        });
        throw err;
      }

      if (config.enforceSender && from.trim().toLowerCase() !== config.enforceSender) {
        const err = new RefusedError(
          `Refusing to send: from "${from}" does not match RESEND_ENFORCE_SENDER ` +
            `"${config.enforceSender}".`,
        );
        await audit.record({
          ts: new Date().toISOString(),
          tool: 'resend_send_email',
          args: { from, to, subject },
          outcome: 'refused',
          detail: err.message,
        });
        throw err;
      }

      if (dry_run) {
        return ok({
          dryRun: true,
          wouldDo: `Send "${subject}" from ${from} to ${to.length} recipient(s): ${to.join(', ')}.`,
          senderCheck: config.enforceSender ? 'passed' : 'no sender lock configured',
          recipientCheck: 'no blocked recipients',
        });
      }

      const { data, status } = await client.request<{ id: string }>('POST', '/emails', {
        from,
        to,
        subject,
        text,
        ...(html ? { html } : {}),
      });

      await audit.record({
        ts: new Date().toISOString(),
        tool: 'resend_send_email',
        args: { from, to, subject },
        resourceId: data.id,
        outcome: 'ok',
        status,
      });
      return ok({ id: data.id, to, subject, note: 'Sent. This cannot be recalled.' });
    },
  );

  server.tool(
    'resend_create_domain',
    'Add a sending domain. Returns the DNS records that must be published before it verifies.',
    { name: z.string(), region: z.string().optional(), dry_run: z.boolean().optional().default(false) },
    async ({ name, region, dry_run }) => {
      if (dry_run) return ok({ dryRun: true, wouldDo: `Add sending domain ${name}.` });
      const { data, status } = await client.request<unknown>('POST', '/domains', {
        name,
        ...(region ? { region } : {}),
      });
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'resend_create_domain',
        args: { name, region },
        resourceId: name,
        outcome: 'ok',
        status,
      });
      return ok(data);
    },
  );

  server.tool(
    'resend_create_audience',
    'Create an audience.',
    { name: z.string().max(100), dry_run: z.boolean().optional().default(false) },
    async ({ name, dry_run }) => {
      if (dry_run) return ok({ dryRun: true, wouldDo: `Create audience "${name}".` });
      const { data, status } = await client.request<{ id: string }>('POST', '/audiences', { name });
      await audit.record({
        ts: new Date().toISOString(),
        tool: 'resend_create_audience',
        args: { name },
        resourceId: data.id,
        outcome: 'ok',
        status,
      });
      return ok(data);
    },
  );
}
