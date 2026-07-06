import { z } from 'zod';
import { WordPressClient } from '../client.js';
import type { WPUser } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerUserTools(server: McpServer, client: WordPressClient): void {
  server.tool(
    'wp_list_users',
    'List WordPress users',
    {
      per_page: z.number().int().min(1).max(100).optional().default(10),
      page: z.number().int().min(1).optional().default(1),
      roles: z
        .array(z.string())
        .optional()
        .describe('Filter by roles e.g. ["administrator","editor"]'),
      search: z.string().optional(),
      orderby: z.enum(['id', 'name', 'registered_date', 'email']).optional().default('name'),
      order: z.enum(['asc', 'desc']).optional().default('asc'),
      context: z.enum(['view', 'edit']).optional().default('view'),
    },
    async (args) => {
      const params: Record<string, string | number | boolean> = {
        per_page: args.per_page,
        page: args.page,
        orderby: args.orderby,
        order: args.order,
        context: args.context,
      };
      if (args.roles?.length) params['roles'] = args.roles.join(',');
      if (args.search) params['search'] = args.search;

      const users = await client.get<WPUser[]>('/users', params);
      return { content: [{ type: 'text', text: JSON.stringify(users, null, 2) }] };
    },
  );

  server.tool(
    'wp_get_user',
    'Get a single WordPress user by ID (use "me" as ID for current user)',
    { id: z.union([z.number().int(), z.literal('me')]).describe('User ID or "me"') },
    async ({ id }) => {
      const user = await client.get<WPUser>(`/users/${id}`, { context: 'edit' });
      return { content: [{ type: 'text', text: JSON.stringify(user, null, 2) }] };
    },
  );

  server.tool(
    'wp_create_user',
    'Create a new WordPress user',
    {
      username: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
      name: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      roles: z
        .array(z.enum(['administrator', 'editor', 'author', 'contributor', 'subscriber']))
        .optional()
        .default(['subscriber']),
      url: z.string().url().optional(),
      description: z.string().optional(),
    },
    async (args) => {
      const body: Record<string, unknown> = {
        username: args.username,
        email: args.email,
        password: args.password,
        roles: args.roles,
      };
      if (args.name) body['name'] = args.name;
      if (args.first_name) body['first_name'] = args.first_name;
      if (args.last_name) body['last_name'] = args.last_name;
      if (args.url) body['url'] = args.url;
      if (args.description) body['description'] = args.description;

      const user = await client.post<WPUser>('/users', body);
      return { content: [{ type: 'text', text: JSON.stringify(user, null, 2) }] };
    },
  );

  server.tool(
    'wp_update_user',
    'Update an existing WordPress user',
    {
      id: z.number().int().describe('User ID'),
      email: z.string().email().optional(),
      name: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      roles: z.array(z.string()).optional(),
      description: z.string().optional(),
      url: z.string().optional(),
    },
    async ({ id, ...rest }) => {
      const body = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      const user = await client.patch<WPUser>(`/users/${id}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(user, null, 2) }] };
    },
  );

  server.tool(
    'wp_delete_user',
    'Delete a WordPress user (reassign their content to another user)',
    {
      id: z.number().int().describe('User ID to delete'),
      reassign: z
        .number()
        .int()
        .describe('User ID to reassign the deleted user\'s posts to'),
    },
    async ({ id, reassign }) => {
      const result = await client.delete<{ deleted: boolean; previous: WPUser }>(
        `/users/${id}`,
        { force: true, reassign },
      );
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
