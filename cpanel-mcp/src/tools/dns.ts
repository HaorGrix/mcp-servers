import { z } from 'zod';
import { CpanelClient } from '../client.js';
import type { CPDNSRecord } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerDnsTools(server: McpServer, client: CpanelClient): void {
  server.tool(
    'cp_list_dns_records',
    'List all DNS records for a zone (domain)',
    {
      zone: z.string().describe('Domain zone name e.g. "fernhillbd.com"'),
    },
    async ({ zone }) => {
      const data = await client.call<{ record: CPDNSRecord[] }>('DNS', 'parse_zone', { zone });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_add_dns_record',
    'Add a DNS record to a zone',
    {
      zone: z.string().describe('Domain zone e.g. "fernhillbd.com"'),
      type: z
        .enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'NS', 'PTR', 'CAA'])
        .describe('Record type'),
      name: z.string().describe('Record name e.g. "www" or "@" for root'),
      address: z.string().describe('Record value e.g. IP address, hostname, or text'),
      ttl: z.number().int().optional().default(14400).describe('TTL in seconds'),
      priority: z.number().int().optional().describe('Priority (MX and SRV records only)'),
    },
    async ({ zone, type, name, address, ttl, priority }) => {
      const params: Record<string, string | number | boolean> = {
        zone,
        type,
        name,
        address,
        ttl,
      };
      if (priority !== undefined) params['priority'] = priority;
      await client.post('DNS', 'add_zone_record', params);
      return { content: [{ type: 'text', text: `DNS record added: ${type} ${name} → ${address}` }] };
    },
  );

  server.tool(
    'cp_delete_dns_record',
    'Delete a DNS record by line number (use cp_list_dns_records to find Line numbers)',
    {
      zone: z.string().describe('Domain zone e.g. "fernhillbd.com"'),
      line: z.number().int().describe('Line number of the record to delete (from cp_list_dns_records)'),
    },
    async ({ zone, line }) => {
      await client.post('DNS', 'remove_zone_record', { zone, line });
      return { content: [{ type: 'text', text: `DNS record at line ${line} deleted from ${zone}` }] };
    },
  );

  server.tool(
    'cp_get_zone_info',
    'Get zone information for a domain',
    {
      zone: z.string().describe('Domain zone name'),
    },
    async ({ zone }) => {
      const data = await client.call<Record<string, unknown>>('DNS', 'get_zone_info', { zone });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );
}
