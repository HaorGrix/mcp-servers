import { z } from 'zod';
import { WordPressClient } from '../client.js';
import type { WPTerm, WPPostType, WPPost } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerTaxonomyTools(server: McpServer, client: WordPressClient): void {
  // ── Categories ────────────────────────────────────────────────────────────
  server.tool(
    'wp_list_categories',
    'List all WordPress categories',
    {
      per_page: z.number().int().min(1).max(100).optional().default(20),
      page: z.number().int().min(1).optional().default(1),
      parent: z.number().int().optional().describe('Filter by parent category ID'),
      search: z.string().optional(),
      hide_empty: z.boolean().optional().default(false),
      orderby: z.enum(['id', 'name', 'count', 'slug']).optional().default('name'),
      order: z.enum(['asc', 'desc']).optional().default('asc'),
    },
    async (args) => {
      const params: Record<string, string | number | boolean> = {
        per_page: args.per_page,
        page: args.page,
        hide_empty: args.hide_empty,
        orderby: args.orderby,
        order: args.order,
      };
      if (args.parent !== undefined) params['parent'] = args.parent;
      if (args.search) params['search'] = args.search;

      const cats = await client.get<WPTerm[]>('/categories', params);
      return { content: [{ type: 'text', text: JSON.stringify(cats, null, 2) }] };
    },
  );

  server.tool(
    'wp_create_category',
    'Create a new category',
    {
      name: z.string().min(1),
      slug: z.string().optional(),
      description: z.string().optional(),
      parent: z.number().int().optional().default(0),
    },
    async (args) => {
      const body: Record<string, unknown> = { name: args.name, parent: args.parent };
      if (args.slug) body['slug'] = args.slug;
      if (args.description) body['description'] = args.description;

      const cat = await client.post<WPTerm>('/categories', body);
      return { content: [{ type: 'text', text: JSON.stringify(cat, null, 2) }] };
    },
  );

  // ── Tags ──────────────────────────────────────────────────────────────────
  server.tool(
    'wp_list_tags',
    'List all WordPress tags',
    {
      per_page: z.number().int().min(1).max(100).optional().default(20),
      page: z.number().int().min(1).optional().default(1),
      search: z.string().optional(),
      hide_empty: z.boolean().optional().default(false),
      orderby: z.enum(['id', 'name', 'count', 'slug']).optional().default('name'),
      order: z.enum(['asc', 'desc']).optional().default('asc'),
    },
    async (args) => {
      const params: Record<string, string | number | boolean> = {
        per_page: args.per_page,
        page: args.page,
        hide_empty: args.hide_empty,
        orderby: args.orderby,
        order: args.order,
      };
      if (args.search) params['search'] = args.search;

      const tags = await client.get<WPTerm[]>('/tags', params);
      return { content: [{ type: 'text', text: JSON.stringify(tags, null, 2) }] };
    },
  );

  server.tool(
    'wp_create_tag',
    'Create a new tag',
    {
      name: z.string().min(1),
      slug: z.string().optional(),
      description: z.string().optional(),
    },
    async (args) => {
      const body: Record<string, unknown> = { name: args.name };
      if (args.slug) body['slug'] = args.slug;
      if (args.description) body['description'] = args.description;

      const tag = await client.post<WPTerm>('/tags', body);
      return { content: [{ type: 'text', text: JSON.stringify(tag, null, 2) }] };
    },
  );

  // ── Custom Post Types ─────────────────────────────────────────────────────
  server.tool(
    'wp_list_post_types',
    'List all registered public WordPress post types (built-in and custom)',
    {},
    async () => {
      const types = await client.get<Record<string, WPPostType>>('/types', { context: 'view' });
      return { content: [{ type: 'text', text: JSON.stringify(types, null, 2) }] };
    },
  );

  server.tool(
    'wp_list_cpt_items',
    'List items from any custom post type by its REST base slug',
    {
      rest_base: z.string().describe('The REST base slug of the CPT (e.g. "portfolio", "product")'),
      per_page: z.number().int().min(1).max(100).optional().default(10),
      page: z.number().int().min(1).optional().default(1),
      status: z.string().optional().default('publish'),
      search: z.string().optional(),
    },
    async (args) => {
      const params: Record<string, string | number | boolean> = {
        per_page: args.per_page,
        page: args.page,
        status: args.status,
      };
      if (args.search) params['search'] = args.search;

      const items = await client.get<WPPost[]>(`/${args.rest_base}`, params);
      return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
    },
  );
}
