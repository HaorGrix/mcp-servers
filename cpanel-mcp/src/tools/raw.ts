import { z } from 'zod';
import { CpanelClient } from '../client.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Full-control escape hatch: call any cPanel UAPI module/function directly, for
 * operations not covered by the typed domain tools.
 */
export function registerRawTools(server: McpServer, client: CpanelClient): void {
  server.tool(
    'cp_uapi_call',
    'Full-control escape hatch: call ANY cPanel UAPI endpoint directly (module + function). Use for ' +
      'operations not covered by the typed tools. Example: module="Mysql" function="list_databases", or ' +
      'module="Fileman" function="get_file_information". Use GET for reads, POST for state changes.',
    {
      method: z.enum(['GET', 'POST']).default('GET'),
      module: z.string().describe('UAPI module, e.g. "Fileman", "Mysql", "Email", "LangPHP"'),
      function: z.string().describe('UAPI function within the module, e.g. "list_files"'),
      params: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Parameters for the call'),
    },
    async ({ method, module, function: fn, params }) => {
      const args = params ?? {};
      const data =
        method === 'POST'
          ? await client.post<unknown>(module, fn, args)
          : await client.call<unknown>(module, fn, args);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );
}
