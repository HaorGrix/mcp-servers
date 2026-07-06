import { z } from 'zod';
import { CpanelClient } from '../client.js';
import type { CPCronJob } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerCronTools(server: McpServer, client: CpanelClient): void {
  server.tool(
    'cp_list_crons',
    'List all cron jobs on this cPanel account',
    {},
    async () => {
      const data = await client.call<{ COMMAND: string; DAY: string; HOUR: string; MINUTE: string; MONTH: string; WEEKDAY: string; linekey?: string }[]>(
        'Cron',
        'list_cron_jobs',
      );
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    'cp_add_cron',
    'Add a cron job',
    {
      command: z.string().describe('Command to run e.g. "/usr/bin/php /home/user/public_html/cron.php"'),
      minute: z.string().default('0').describe('Minute field (0-59, */5, etc.)'),
      hour: z.string().default('0').describe('Hour field (0-23, */6, etc.)'),
      day: z.string().default('*').describe('Day of month (1-31 or *)'),
      month: z.string().default('*').describe('Month (1-12 or *)'),
      weekday: z.string().default('*').describe('Day of week (0-7, 0=Sunday, or *)'),
    },
    async (args) => {
      await client.post('Cron', 'add_cron_job', {
        command: args.command,
        minute: args.minute,
        hour: args.hour,
        day: args.day,
        month: args.month,
        weekday: args.weekday,
      });
      return {
        content: [{
          type: 'text',
          text: `Cron added: ${args.minute} ${args.hour} ${args.day} ${args.month} ${args.weekday} ${args.command}`,
        }],
      };
    },
  );

  server.tool(
    'cp_remove_cron',
    'Remove a cron job by its exact command (use cp_list_crons to get the exact command string)',
    {
      command: z.string().describe('Exact command of the cron to remove'),
      minute: z.string().describe('Minute field of the cron to remove'),
      hour: z.string().describe('Hour field of the cron to remove'),
      day: z.string().describe('Day field of the cron to remove'),
      month: z.string().describe('Month field of the cron to remove'),
      weekday: z.string().describe('Weekday field of the cron to remove'),
    },
    async (args) => {
      await client.post('Cron', 'remove_cron_job', {
        command: args.command,
        minute: args.minute,
        hour: args.hour,
        day: args.day,
        month: args.month,
        weekday: args.weekday,
      });
      return { content: [{ type: 'text', text: `Cron removed: ${args.command}` }] };
    },
  );

  server.tool(
    'cp_edit_cron',
    'Edit an existing cron job (identified by old values, replaced with new values)',
    {
      old_command: z.string().describe('Existing command to find'),
      old_minute: z.string(),
      old_hour: z.string(),
      old_day: z.string(),
      old_month: z.string(),
      old_weekday: z.string(),
      new_command: z.string().describe('New command'),
      new_minute: z.string(),
      new_hour: z.string(),
      new_day: z.string(),
      new_month: z.string(),
      new_weekday: z.string(),
    },
    async (args) => {
      await client.post('Cron', 'edit_cron_job', {
        command: args.old_command,
        minute: args.old_minute,
        hour: args.old_hour,
        day: args.old_day,
        month: args.old_month,
        weekday: args.old_weekday,
        newcommand: args.new_command,
        newminute: args.new_minute,
        newhour: args.new_hour,
        newday: args.new_day,
        newmonth: args.new_month,
        newweekday: args.new_weekday,
      });
      return { content: [{ type: 'text', text: `Cron updated: ${args.new_command}` }] };
    },
  );
}
