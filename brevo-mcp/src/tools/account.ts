import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BrevoClient } from '../client.js';
import type { BrevoAccount, BrevoSender } from '../types.js';
import { ok } from './helpers.js';

export function registerAccountTools(server: McpServer, client: BrevoClient): void {
  server.tool(
    'brevo_get_account',
    'Get the Brevo account: company, plan, and remaining email credits',
    {},
    async () => ok(await client.get<BrevoAccount>('/account')),
  );

  server.tool(
    'brevo_list_senders',
    'List verified sender identities. Use this to confirm a domain sender exists before sending.',
    {},
    async () => {
      const data = await client.get<{ senders: BrevoSender[] }>('/senders');
      return ok(data);
    },
  );

  server.tool(
    'brevo_check_domain_auth',
    'Check DKIM, DMARC and Brevo-code authentication status for a sending domain',
    {
      domain: z.string().describe('Domain to check e.g. "podiumtutoring.com"'),
    },
    async ({ domain }) => {
      const data = await client.get<unknown>(`/senders/domains/${encodeURIComponent(domain)}`);
      return ok(data);
    },
  );
}
