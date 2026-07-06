import { z } from 'zod';
import { CpanelClient } from '../client.js';
import type { CPBackup } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerBackupTools(server: McpServer, client: CpanelClient): void {
  server.tool(
    'cp_create_backup',
    'Generate a full cPanel backup to the home directory',
    {
      email: z.string().email().optional().describe('Email to notify when backup completes (optional)'),
    },
    async ({ email }) => {
      const params: Record<string, string | number | boolean> = {};
      if (email) params['email'] = email;
      await client.post('Backup', 'fullbackup_to_homedir', params);
      return {
        content: [{
          type: 'text',
          text: 'Full backup generation started. The backup file will appear in your home directory when complete.',
        }],
      };
    },
  );

  server.tool(
    'cp_list_backups',
    'List available cPanel backup files in the home directory',
    {},
    async () => {
      const data = await client.call<CPBackup[]>('Backup', 'list_backups');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_restore_db_backup',
    'Restore a MySQL database from a backup file',
    {
      backup_file: z.string().describe('Path to the .sql.gz or .sql backup file in the home directory'),
    },
    async ({ backup_file }) => {
      const data = await client.post<{ restored: boolean; database: string }>(
        'Backup',
        'restore_databases',
        { backup_file },
      );
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );
}
