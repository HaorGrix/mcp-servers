import { z } from 'zod';
import { WordPressClient } from '../client.js';
import type { WPPage } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerPageTools(server: McpServer, client: WordPressClient): void {
  server.tool(
    'wp_list_pages',
    'List WordPress pages',
    {
      status: z
        .enum(['publish', 'draft', 'pending', 'private', 'trash', 'any'])
        .optional()
        .default('publish'),
      per_page: z.number().int().min(1).max(100).optional().default(10),
      page: z.number().int().min(1).optional().default(1),
      parent: z.number().int().optional().describe('Filter by parent page ID (0 = top-level)'),
      search: z.string().optional(),
      orderby: z.enum(['date', 'modified', 'title', 'id', 'menu_order']).optional().default('menu_order'),
      order: z.enum(['asc', 'desc']).optional().default('asc'),
    },
    async (args) => {
      const params: Record<string, string | number | boolean> = {
        status: args.status,
        per_page: args.per_page,
        page: args.page,
        orderby: args.orderby,
        order: args.order,
      };
      if (args.parent !== undefined) params['parent'] = args.parent;
      if (args.search) params['search'] = args.search;

      const pages = await client.get<WPPage[]>('/pages', params);
      return { content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }] };
    },
  );

  server.tool(
    'wp_get_page',
    'Get a single WordPress page by ID',
    { id: z.number().int().describe('Page ID') },
    async ({ id }) => {
      const page = await client.get<WPPage>(`/pages/${id}`);
      return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
    },
  );

  server.tool(
    'wp_create_page',
    'Create a new WordPress page',
    {
      title: z.string(),
      content: z.string().optional().default(''),
      excerpt: z.string().optional(),
      status: z.enum(['publish', 'draft', 'pending', 'private']).optional().default('draft'),
      parent: z.number().int().optional().describe('Parent page ID'),
      menu_order: z.number().int().optional().default(0).describe('Order in menu'),
      slug: z.string().optional(),
      featured_media: z.number().int().optional(),
    },
    async (args) => {
      const body: Record<string, unknown> = {
        title: args.title,
        content: args.content,
        status: args.status,
        menu_order: args.menu_order,
      };
      if (args.excerpt) body['excerpt'] = args.excerpt;
      if (args.parent !== undefined) body['parent'] = args.parent;
      if (args.slug) body['slug'] = args.slug;
      if (args.featured_media) body['featured_media'] = args.featured_media;

      const page = await client.post<WPPage>('/pages', body);
      return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
    },
  );

  server.tool(
    'wp_update_page',
    'Update an existing WordPress page',
    {
      id: z.number().int(),
      title: z.string().optional(),
      content: z.string().optional(),
      excerpt: z.string().optional(),
      status: z.enum(['publish', 'draft', 'pending', 'private', 'trash']).optional(),
      parent: z.number().int().optional(),
      menu_order: z.number().int().optional(),
      slug: z.string().optional(),
      featured_media: z.number().int().optional(),
    },
    async ({ id, ...rest }) => {
      const body = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      const page = await client.patch<WPPage>(`/pages/${id}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
    },
  );

  server.tool(
    'wp_delete_page',
    'Delete a WordPress page',
    {
      id: z.number().int(),
      force: z.boolean().optional().default(false).describe('Permanently delete (bypass trash)'),
    },
    async ({ id, force }) => {
      const result = await client.delete<WPPage>(`/pages/${id}`, { force });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
