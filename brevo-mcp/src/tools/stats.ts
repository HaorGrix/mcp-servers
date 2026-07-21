import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BrevoClient } from '../client.js';
import type { BrevoCampaign, BrevoCampaignList, BrevoCampaignStats } from '../types.js';
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
        const s = resolveStats(c);
        // appleMppOpens exists only on globalStats, which Brevo zeroes for
        // list-based campaigns. When the breakdown supplied the numbers there
        // is no MPP figure to subtract, so report null rather than a real-
        // looking open rate that silently equals the inflated one.
        const globalSent = c.statistics?.globalStats?.sent ?? 0;
        const mpp = globalSent > 0 ? (c.statistics?.globalStats?.appleMppOpens ?? 0) : null;
        const bounces = s.hardBounces + s.softBounces;
        const pct = (n: number, d: number) => (d > 0 ? Number(((n / d) * 100).toFixed(2)) : 0);
        const humanOpens = mpp === null ? null : Math.max(0, s.uniqueViews - mpp);
        return {
          id: c.id,
          name: c.name,
          sender: c.sender?.email ?? 'unknown',
          sent: s.sent,
          delivered: s.delivered,
          bounceRate: pct(bounces, s.sent),
          openRate: pct(s.uniqueViews, s.delivered),
          appleMppOpens: mpp,
          realOpenRate: humanOpens === null ? null : pct(humanOpens, s.delivered),
          clickRate: pct(s.uniqueClicks, s.delivered),
          complaints: s.complaints,
          unsubscribes: s.unsubscriptions,
          warnings: buildWarnings(pct(bounces, s.sent), s.complaints, s.delivered, c.sender?.email),
        };
      });

      const totals = rows.reduce(
        (acc, r) => ({
          sent: acc.sent + r.sent,
          delivered: acc.delivered + r.delivered,
          appleMppOpens: acc.appleMppOpens + (r.appleMppOpens ?? 0),
          unsubscribes: acc.unsubscribes + r.unsubscribes,
        }),
        { sent: 0, delivered: 0, appleMppOpens: 0, unsubscribes: 0 },
      );

      return ok({
        campaignCount: rows.length,
        totals,
        note:
          'realOpenRate is null when Brevo returned per-list stats only, because appleMppOpens lives on ' +
          'globalStats which is zeroed for those campaigns. Use the CSV export for MPP. For reply-driven ' +
          'campaigns all of this is secondary: Brevo cannot see replies, so count them by hand.',
        campaigns: rows,
      });
    },
  );
}

/**
 * Brevo zeroes globalStats on list-based campaigns and fills campaignStats
 * per recipient list instead, so summing the breakdown is the only way to get
 * real numbers. Falls back to globalStats when no breakdown is present.
 */
function resolveStats(c: BrevoCampaign): BrevoCampaignStats {
  const empty: BrevoCampaignStats = {
    uniqueClicks: 0,
    clickers: 0,
    complaints: 0,
    delivered: 0,
    sent: 0,
    softBounces: 0,
    hardBounces: 0,
    uniqueViews: 0,
    unsubscriptions: 0,
    viewed: 0,
  };
  const global = c.statistics?.globalStats;
  const perList = c.statistics?.campaignStats ?? [];

  if (global && global.sent > 0) return global;
  if (perList.length === 0) return global ?? empty;

  return perList.reduce<BrevoCampaignStats>(
    (acc, s) => ({
      uniqueClicks: acc.uniqueClicks + s.uniqueClicks,
      clickers: acc.clickers + s.clickers,
      complaints: acc.complaints + s.complaints,
      delivered: acc.delivered + s.delivered,
      sent: acc.sent + s.sent,
      softBounces: acc.softBounces + s.softBounces,
      hardBounces: acc.hardBounces + s.hardBounces,
      uniqueViews: acc.uniqueViews + s.uniqueViews,
      unsubscriptions: acc.unsubscriptions + s.unsubscriptions,
      viewed: acc.viewed + s.viewed,
    }),
    empty,
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
