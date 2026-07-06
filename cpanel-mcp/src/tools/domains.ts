import { z } from 'zod';
import { CpanelClient } from '../client.js';
import type { CPDomainInfo, CPSubDomain } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerDomainTools(server: McpServer, client: CpanelClient): void {
  server.tool(
    'cp_list_domains',
    'List all domains (main, addon, sub, parked) on this cPanel account',
    {},
    async () => {
      const data = await client.call<{
        main_domain: string;
        addon_domains: CPDomainInfo[];
        sub_domains: CPDomainInfo[];
        parked_domains: string[];
      }>('DomainInfo', 'list_domains');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_domain_info',
    'Get detailed info for a specific domain',
    {
      domain: z.string().describe('Domain name e.g. fernhillbd.com'),
    },
    async ({ domain }) => {
      const data = await client.call<CPDomainInfo>('DomainInfo', 'single_domain_data', {
        domain,
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_list_subdomains',
    'List all subdomains on this cPanel account',
    {},
    async () => {
      const data = await client.call<CPSubDomain[]>('SubDomain', 'listsubdomains');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_create_subdomain',
    'Create a new subdomain',
    {
      domain: z.string().describe('Subdomain prefix e.g. "blog" (creates blog.fernhillbd.com)'),
      rootdomain: z.string().describe('Root domain e.g. "fernhillbd.com"'),
      dir: z.string().optional().describe('Document root directory (defaults to /public_html/subdomain)'),
    },
    async ({ domain, rootdomain, dir }) => {
      const params: Record<string, string | number | boolean> = { domain, rootdomain };
      if (dir) params['dir'] = dir;
      await client.post('SubDomain', 'addsubdomain', params);
      return { content: [{ type: 'text', text: `Subdomain created: ${domain}.${rootdomain}` }] };
    },
  );

  server.tool(
    'cp_delete_subdomain',
    'Delete a subdomain',
    {
      domain: z.string().describe('Full subdomain e.g. "blog.fernhillbd.com"'),
    },
    async ({ domain }) => {
      await client.post('SubDomain', 'delsubdomain', { domain });
      return { content: [{ type: 'text', text: `Subdomain deleted: ${domain}` }] };
    },
  );
}
