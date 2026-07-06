import { z } from 'zod';
import { CpanelClient } from '../client.js';
import type { CPDatabase, CPDatabaseUser } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerDatabaseTools(server: McpServer, client: CpanelClient): void {
  server.tool(
    'cp_list_databases',
    'List all MySQL databases in the cPanel account',
    {},
    async () => {
      const data = await client.call<CPDatabase[]>('Mysql', 'list_databases');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_create_database',
    'Create a new MySQL database (cPanel username is auto-prefixed)',
    {
      name: z.string().min(1).describe('Database name (without cPanel username prefix)'),
    },
    async ({ name }) => {
      await client.post('Mysql', 'create_database', { name });
      return { content: [{ type: 'text', text: `Database created: ${name}` }] };
    },
  );

  server.tool(
    'cp_delete_database',
    'Delete a MySQL database',
    {
      name: z.string().describe('Full database name (with cPanel username prefix)'),
    },
    async ({ name }) => {
      await client.post('Mysql', 'delete_database', { name });
      return { content: [{ type: 'text', text: `Database deleted: ${name}` }] };
    },
  );

  server.tool(
    'cp_list_db_users',
    'List all MySQL database users',
    {},
    async () => {
      const data = await client.call<CPDatabaseUser[]>('Mysql', 'list_users');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_create_db_user',
    'Create a MySQL database user',
    {
      name: z.string().min(1).describe('Username (without cPanel username prefix)'),
      password: z.string().min(8).describe('Password for the DB user'),
    },
    async ({ name, password }) => {
      await client.post('Mysql', 'create_user', { name, password });
      return { content: [{ type: 'text', text: `DB user created: ${name}` }] };
    },
  );

  server.tool(
    'cp_delete_db_user',
    'Delete a MySQL database user',
    {
      name: z.string().describe('Full DB username (with cPanel username prefix)'),
    },
    async ({ name }) => {
      await client.post('Mysql', 'delete_user', { name });
      return { content: [{ type: 'text', text: `DB user deleted: ${name}` }] };
    },
  );

  server.tool(
    'cp_assign_db_user',
    'Grant a MySQL user privileges on a database',
    {
      user: z.string().describe('Full DB username (with cPanel prefix)'),
      database: z.string().describe('Full database name (with cPanel prefix)'),
      privileges: z
        .string()
        .optional()
        .default('ALL PRIVILEGES')
        .describe('Privileges string e.g. "ALL PRIVILEGES" or "SELECT,INSERT,UPDATE,DELETE"'),
    },
    async ({ user, database, privileges }) => {
      await client.post('Mysql', 'set_privileges_on_database', {
        user,
        database,
        privileges,
      });
      return {
        content: [{ type: 'text', text: `Granted [${privileges}] on ${database} to ${user}` }],
      };
    },
  );

  server.tool(
    'cp_check_db',
    'Check and repair a MySQL database',
    {
      name: z.string().describe('Full database name (with cPanel prefix)'),
    },
    async ({ name }) => {
      const data = await client.post<{ database: string; result: string }>(
        'Mysql',
        'check_database',
        { name },
      );
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );
}
