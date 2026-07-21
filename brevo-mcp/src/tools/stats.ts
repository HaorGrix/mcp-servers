import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BrevoClient } from '../client.js';
import type { BrevoCampaign, BrevoCampaignList } from '../types.js';
import { ok } from './helpers.js';

export function registerStatsTools(server: McpServer, client: BrevoClient): void {
  server.tool(
    'brevo_get_email_events',
    'Query per-recipient email events: bounces, spam complaints, opens, clicks, unsubscribes. ' +
      'This is the only way to see which specific addresses are failing.',
    {
      event: z
        .enum([
          'bounces',
          'hardBounces',
          'softBounces',
          'delivered',
          'spam',
          'requests',
          'opened',
          'clicks',
          'invalid',
          'deferred',
          'blocked',
          'unsubscribed',
        ])
        .optional()
        .describe('Event type filter'),
      email: z.string().email().optional().describe('Filter to one recipient'),
      startDate: z.string().optional().describe('YYYY-MM-DD'),
      endDate: z.string().optional().describe('YYYY-MM-DD'),
      limit: z.number().int().min(1).max(1000).optional().default(100),
      offset: z.number().int().min(0).optional().default(0),
    },
    async ({ event, email, startDate, endDate, limit, offset }) => {
      const query: Record<string, string | number> = { limit, offset };
      if (event) query['event'] = event;
      if (email) query['email'] = email;
      if (startDate) query['startDate'] = startDate;
      if (endDate) query['endDate'] = endDate;
      return ok(await client.get<unknown>('/smtp/statistics/events', query));
    },
  );

  server.tool(
    'brevo_campaign_report',
    'Deliverability report across recent campaigns. Computes real open rate by removing Apple MPP ' +
      'prefetch opens, and flags any campaign whose bounce rate crosses the safe threshold.',
    {
      limit: z.number().int().min(1).max(100).optional().default(30),
    },
    async ({ limit }) => {
      const data = await client.get<BrevoCampaignList>('/emailCampaigns', {
        status: 'sent',
        limit,
        offset: 0,
      });
      const campaigns = data.campaigns ?? [];
      if (campaigns.length === 0) return ok('No sent campaigns found.');

      const rows = campaigns.map((c: BrevoCampaign) => {
        const s = c.statistics?.globalStats;
        const sent = s?.sent ?? 0;
        const delivered = s?.delivered ?? 0;
        const bounces = (s?.hardBounces ?? 0) + (s?.softBounces ?? 0);
        const pct = (n: number, d: number) => (d > 0 ? Number(((n / d) * 100).toFixed(2)) : 0);
        return {
          id: c.id,
          name: c.name,
          sender: c.sender?.email ?? 'unknown',
          sent,
          delivered,
          bounceRate: pct(bounces, sent),
          openRate: pct(s?.uniqueViews ?? 0, delivered),
          clickRate: pct(s?.uniqueClicks ?? 0, delivered),
          complaints: s?.complaints ?? 0,
          unsubscribes: s?.unsubscriptions ?? 0,
          warnings: buildWarnings(pct(bounces, sent), s?.complaints ?? 0, delivered, c.sender?.email),
        };
      });

      const totals = rows.reduce(
        (acc, r) => ({ sent: acc.sent + r.sent, delivered: acc.delivered + r.delivered }),
        { sent: 0, delivered: 0 },
      );

      return ok({
        campaignCount: rows.length,
        totals,
        note:
          'Open rate is inflated by Apple MPP prefetch. For reply-driven campaigns, count replies by hand; ' +
          'Brevo cannot measure them.',
        campaigns: rows,
      });
    },
  );
}

function buildWarnings(
  bounceRate: number,
  complaints: number,
  delivered: number,
  sender?: string,
): string[] {
  const warnings: string[] = [];
  if (bounceRate > 3) warnings.push(`bounce rate ${bounceRate}% is above the 3% safe threshold`);
  if (delivered > 0 && (complaints / delivered) * 100 > 0.1) {
    warnings.push('complaint rate is above 0.1%');
  }
  if (sender && /@(gmail|yahoo|hotmail|outlook)\.com$/i.test(sender)) {
    warnings.push(
      `sender ${sender} is a free mailbox domain and cannot be DKIM-aligned through Brevo, so mail will be filtered`,
    );
  }
  return warnings;
}
