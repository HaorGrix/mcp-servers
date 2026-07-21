import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BrevoClient } from '../client.js';
import type { BrevoAccount, BrevoSender } from '../types.js';
import { ok } from './helpers.js';

export function registerHealthTools(server: McpServer, client: BrevoClient): void {
  server.tool(
    'brevo_preflight',
    'Run before any campaign. Verifies the API key works, the enforced sender exists and is active, ' +
      'and reports remaining credits. Returns a pass/fail checklist rather than raw API output.',
    {},
    async () => {
      const checks: Array<{ check: string; status: 'pass' | 'fail' | 'warn'; detail: string }> = [];

      let account: BrevoAccount | undefined;
      try {
        account = await client.get<BrevoAccount>('/account');
        checks.push({
          check: 'api_key',
          status: 'pass',
          detail: `Authenticated as ${account.email} (${account.companyName || 'no company set'})`,
        });
      } catch (err: unknown) {
        checks.push({
          check: 'api_key',
          status: 'fail',
          detail: err instanceof Error ? err.message : String(err),
        });
        return ok({ ready: false, checks });
      }

      const credits = account.plan?.find((p) => p.creditsType === 'sendLimit' || p.credits !== undefined);
      checks.push({
        check: 'credits',
        status: credits?.credits === 0 ? 'fail' : 'pass',
        detail: credits ? `${credits.credits ?? 'unlimited'} on plan "${credits.type}"` : 'no plan data returned',
      });

      if (client.enforceSender) {
        try {
          const { senders } = await client.get<{ senders: BrevoSender[] }>('/senders');
          const match = senders.find((s) => s.email.toLowerCase() === client.enforceSender);
          if (!match) {
            checks.push({
              check: 'enforced_sender',
              status: 'fail',
              detail: `${client.enforceSender} is not a verified sender. Verify it in Brevo before sending.`,
            });
          } else {
            checks.push({
              check: 'enforced_sender',
              status: match.active ? 'pass' : 'fail',
              detail: `${match.email} (id ${match.id}) is ${match.active ? 'active' : 'INACTIVE'}`,
            });
          }
        } catch (err: unknown) {
          checks.push({
            check: 'enforced_sender',
            status: 'fail',
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        checks.push({
          check: 'enforced_sender',
          status: 'warn',
          detail: 'No sender lock set. Any verified sender can be used, including a free mailbox domain.',
        });
      }

      checks.push({
        check: 'dry_run',
        status: client.dryRun ? 'warn' : 'pass',
        detail: client.dryRun ? 'DRY RUN is on, every write will be refused' : 'writes enabled',
      });

      return ok({ ready: checks.every((c) => c.status !== 'fail'), checks });
    },
  );
}
