import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BrevoClient } from '../client.js';
import type { BrevoCampaign, BrevoCampaignList } from '../types.js';
import { ok } from './helpers.js';

/**
 * Sending is irreversible and outward-facing, so every send path here is
 * gated. Campaigns are always created as drafts, and firing one requires an
 * explicit confirm token plus a sender check. This exists because 26 of 27
 * Podium campaigns went out from a gmail.com address that could never be
 * DKIM-aligned, which is a mistake no API should make easy to repeat.
 */
export function registerCampaignTools(server: McpServer, client: BrevoClient): void {
  server.tool(
    'brevo_list_campaigns',
    'List email campaigns with status and headline statistics',
    {
      status: z
        .enum(['draft', 'sent', 'archive', 'queued', 'suspended', 'in_process'])
        .optional()
        .describe('Filter by status'),
      limit: z.number().int().min(1).max(100).optional().default(50),
      offset: z.number().int().min(0).optional().default(0),
    },
    async ({ status, limit, offset }) => {
      const query: Record<string, string | number> = { limit, offset };
      if (status) query['status'] = status;
      return ok(await client.get<BrevoCampaignList>('/emailCampaigns', query));
    },
  );

  server.tool(
    'brevo_get_campaign',
    'Get one campaign including full delivery and engagement statistics',
    {
      campaignId: z.number().int().describe('Campaign id'),
    },
    async ({ campaignId }) => ok(await client.get<BrevoCampaign>(`/emailCampaigns/${campaignId}`)),
  );

  server.tool(
    'brevo_create_campaign',
    'Create an email campaign. Always created as a DRAFT; it is never sent by this tool. ' +
      'Use brevo_send_test_email to preview, then brevo_send_campaign_now or brevo_schedule_campaign.',
    {
      name: z.string().describe('Internal campaign name e.g. "podium-shsat-w2"'),
      subject: z.string().describe('Subject line'),
      senderName: z.string().describe('Sender display name e.g. "Abir Banik"'),
      senderEmail: z.string().email().describe('Sender address. Must be a verified Brevo sender.'),
      replyTo: z.string().email().describe('Reply-To. For reply-driven campaigns this is the conversion path, so it must be a monitored mailbox.'),
      htmlContent: z.string().describe('Full HTML body'),
      listIds: z.array(z.number().int()).min(1).describe('Recipient list ids'),
      exclusionListIds: z.array(z.number().int()).optional().describe('Lists to exclude, e.g. a suppression list'),
    },
    async (args) => {
      assertSenderAllowed(client, args.senderEmail);
      const body = {
        name: args.name,
        subject: args.subject,
        sender: { name: args.senderName, email: args.senderEmail },
        replyTo: args.replyTo,
        htmlContent: args.htmlContent,
        recipients: {
          listIds: args.listIds,
          ...(args.exclusionListIds ? { exclusionListIds: args.exclusionListIds } : {}),
        },
        inlineImageActivation: false,
      };
      const created = await client.post<{ id: number }>('/emailCampaigns', body);
      return ok(
        `Draft campaign created, id ${created.id}. Nothing has been sent. ` +
          `Send a test with brevo_send_test_email before going live.`,
      );
    },
  );

  server.tool(
    'brevo_update_campaign',
    'Update a draft campaign. Only supplied fields change.',
    {
      campaignId: z.number().int().describe('Campaign id'),
      name: z.string().optional(),
      subject: z.string().optional(),
      htmlContent: z.string().optional(),
      replyTo: z.string().email().optional(),
      listIds: z.array(z.number().int()).optional(),
    },
    async ({ campaignId, listIds, ...rest }) => {
      const body: Record<string, unknown> = { ...rest };
      if (listIds) body['recipients'] = { listIds };
      await client.put<void>(`/emailCampaigns/${campaignId}`, body);
      return ok(`Campaign ${campaignId} updated.`);
    },
  );

  server.tool(
    'brevo_send_test_email',
    'Send a test copy of a draft campaign to specific addresses. Safe: goes only to the addresses given.',
    {
      campaignId: z.number().int().describe('Campaign id'),
      emails: z.array(z.string().email()).min(1).max(10).describe('Test recipients'),
    },
    async ({ campaignId, emails }) => {
      await client.post<void>(`/emailCampaigns/${campaignId}/sendTest`, { emailTo: emails });
      return ok(`Test sent to ${emails.join(', ')}.`);
    },
  );

  server.tool(
    'brevo_send_campaign_now',
    'IRREVERSIBLE. Sends a campaign to its entire recipient list immediately. ' +
      'Requires confirm="SEND". Verify the sender, the list size and a test email first.',
    {
      campaignId: z.number().int().describe('Campaign id'),
      confirm: z
        .literal('SEND')
        .describe('Must be exactly "SEND". Guards against an accidental blast.'),
    },
    async ({ campaignId }) => {
      const campaign = await client.get<BrevoCampaign>(`/emailCampaigns/${campaignId}`);
      assertSenderAllowed(client, campaign.sender.email);
      await client.post<void>(`/emailCampaigns/${campaignId}/sendNow`, {});
      return ok(`Campaign ${campaignId} ("${campaign.name}") is sending from ${campaign.sender.email}.`);
    },
  );

  server.tool(
    'brevo_schedule_campaign',
    'Schedule a campaign for a future time. Requires confirm="SCHEDULE".',
    {
      campaignId: z.number().int().describe('Campaign id'),
      scheduledAt: z
        .string()
        .describe('ISO 8601 datetime with offset, e.g. "2026-08-04T14:00:00-04:00"'),
      confirm: z.literal('SCHEDULE').describe('Must be exactly "SCHEDULE".'),
    },
    async ({ campaignId, scheduledAt }) => {
      const campaign = await client.get<BrevoCampaign>(`/emailCampaigns/${campaignId}`);
      assertSenderAllowed(client, campaign.sender.email);
      await client.put<void>(`/emailCampaigns/${campaignId}`, { scheduledAt });
      return ok(`Campaign ${campaignId} scheduled for ${scheduledAt}.`);
    },
  );
}

/**
 * Refuse any send whose sender does not match BREVO_ENFORCE_SENDER, when set.
 * A misaligned From domain is the single most damaging deliverability mistake,
 * so it is blocked at the tool layer rather than left to judgement.
 */
function assertSenderAllowed(client: BrevoClient, senderEmail: string): void {
  const enforced = client.enforceSender;
  if (!enforced) return;
  if (senderEmail.toLowerCase() === enforced) return;
  throw new Error(
    `Refusing to use sender "${senderEmail}". BREVO_ENFORCE_SENDER is set to "${enforced}". ` +
      `Sending from a mismatched address breaks DKIM alignment and lands mail in spam.`,
  );
}
