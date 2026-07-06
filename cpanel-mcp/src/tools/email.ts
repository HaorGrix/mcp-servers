import { z } from 'zod';
import { CpanelClient } from '../client.js';
import type { CPEmailAccount, CPForwarder, CPAutoresponder } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerEmailTools(server: McpServer, client: CpanelClient): void {
  server.tool(
    'cp_list_email_accounts',
    'List all email accounts in the cPanel account',
    {
      domain: z.string().optional().describe('Filter by domain'),
      skip_main: z.boolean().optional().default(true).describe('Skip the main cPanel email account'),
    },
    async ({ domain, skip_main }) => {
      const params: Record<string, string | number | boolean> = {
        skip_main: skip_main ? 1 : 0,
      };
      if (domain) params['domain'] = domain;
      const data = await client.call<CPEmailAccount[]>('Email', 'list_pops', params);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_create_email',
    'Create a new email account',
    {
      email: z.string().email().describe('Full email address e.g. hello@fernhillbd.com'),
      password: z.string().min(8).describe('Password for the email account'),
      quota: z
        .number()
        .int()
        .optional()
        .default(250)
        .describe('Disk quota in MB (0 = unlimited)'),
    },
    async ({ email, password, quota }) => {
      const [user, domain] = email.split('@') as [string, string];
      await client.post('Email', 'add_pop', { email: user, domain, password, quota });
      return { content: [{ type: 'text', text: `Email account created: ${email}` }] };
    },
  );

  server.tool(
    'cp_delete_email',
    'Delete an email account',
    {
      email: z.string().email().describe('Full email address to delete'),
    },
    async ({ email }) => {
      const [user, domain] = email.split('@') as [string, string];
      await client.post('Email', 'delete_pop', { email: user, domain });
      return { content: [{ type: 'text', text: `Email account deleted: ${email}` }] };
    },
  );

  server.tool(
    'cp_change_email_password',
    'Change the password for an email account',
    {
      email: z.string().email(),
      password: z.string().min(8),
    },
    async ({ email, password }) => {
      const [user, domain] = email.split('@') as [string, string];
      await client.post('Email', 'passwd_pop', { email: user, domain, password });
      return { content: [{ type: 'text', text: `Password updated for: ${email}` }] };
    },
  );

  server.tool(
    'cp_list_forwarders',
    'List all email forwarders',
    {
      domain: z.string().optional().describe('Filter by domain'),
    },
    async ({ domain }) => {
      const params: Record<string, string | number | boolean> = {};
      if (domain) params['domain'] = domain;
      const data = await client.call<CPForwarder[]>('Email', 'list_forwarders', params);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_create_forwarder',
    'Create an email forwarder',
    {
      email: z.string().email().describe('Source email address to forward FROM'),
      forward_to: z.string().email().describe('Destination email address to forward TO'),
    },
    async ({ email, forward_to }) => {
      const [user, domain] = email.split('@') as [string, string];
      await client.post('Email', 'add_forwarder', {
        email: user,
        domain,
        forward_to,
      });
      return { content: [{ type: 'text', text: `Forwarder created: ${email} → ${forward_to}` }] };
    },
  );

  server.tool(
    'cp_delete_forwarder',
    'Delete an email forwarder',
    {
      email: z.string().email().describe('Source email address of the forwarder'),
      forward_to: z.string().email().describe('Destination that was being forwarded to'),
    },
    async ({ email, forward_to }) => {
      const [address, domain] = email.split('@') as [string, string];
      await client.post('Email', 'delete_forwarder', {
        address: `${address}@${domain}`,
        forwarder: forward_to,
      });
      return { content: [{ type: 'text', text: `Forwarder deleted: ${email} → ${forward_to}` }] };
    },
  );

  server.tool(
    'cp_list_autoresponders',
    'List all email autoresponders',
    {
      domain: z.string().optional().describe('Filter by domain'),
    },
    async ({ domain }) => {
      const params: Record<string, string | number | boolean> = {};
      if (domain) params['domain'] = domain;
      const data = await client.call<CPAutoresponder[]>('Email', 'list_auto_responders', params);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );
}
