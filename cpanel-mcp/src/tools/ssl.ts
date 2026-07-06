import { z } from 'zod';
import { CpanelClient } from '../client.js';
import type { CPSSLCert, CPStat, CPAccountInfo } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerSslTools(server: McpServer, client: CpanelClient): void {
  server.tool(
    'cp_list_ssl_certs',
    'List all SSL certificates installed on this cPanel account',
    {},
    async () => {
      const data = await client.call<CPSSLCert[]>('SSL', 'list_certs');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_ssl_status',
    'Check the SSL certificate status for a domain',
    {
      domain: z.string().describe('Domain to check e.g. "fernhillbd.com"'),
    },
    async ({ domain }) => {
      const data = await client.call<Record<string, unknown>>('SSL', 'installed_host', { domain });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_list_ssl_capable_domains',
    'List all domains that are capable of having SSL certificates installed',
    {},
    async () => {
      const data = await client.call<{ domain: string; can_ssl: number }[]>(
        'SSL',
        'list_ssl_capable_domains',
      );
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );
}

export function registerStatsTools(server: McpServer, client: CpanelClient): void {
  server.tool(
    'cp_get_disk_usage',
    'Get disk usage statistics for this cPanel account',
    {},
    async () => {
      const data = await client.call<CPStat[]>('StatsBar', 'get_stats', {
        display: 'diskusage|filesusage|inodeusage',
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_get_bandwidth',
    'Get bandwidth usage statistics for this cPanel account',
    {},
    async () => {
      const data = await client.call<CPStat[]>('StatsBar', 'get_stats', {
        display: 'bandwidthusage',
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_get_account_info',
    'Get general account information (user, domain, plan, IP, email)',
    {},
    async () => {
      const data = await client.call<CPAccountInfo>('Variables', 'get_user_information');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_get_php_version',
    'Get the PHP version used by this cPanel account',
    {},
    async () => {
      const data = await client.call<{ version: string; versions: string[] }>(
        'LangPHP',
        'php_get_installed_versions',
      );
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_set_php_version',
    'Set the PHP version for a domain on this cPanel account',
    {
      version: z.string().describe('PHP version e.g. "ea-php82" or "8.2"'),
    },
    async ({ version }) => {
      await client.post('LangPHP', 'php_set_vhost_versions', { version });
      return { content: [{ type: 'text', text: `PHP version set to: ${version}` }] };
    },
  );
}
