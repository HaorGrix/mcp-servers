import { z } from 'zod';
import { WordPressClient } from '../client.js';
import type { WPPost } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerPostTools(server: McpServer, client: WordPressClient): void {
  // ── List Posts ────────────────────────────────────────────────────────────
  server.tool(
    'wp_list_posts',
    'List WordPress posts with optional filters',
    {
      status: z
        .enum(['publish', 'draft', 'pending', 'private', 'trash', 'any'])
        .optional()
        .default('publish')
        .describe('Post status filter'),
      per_page: z.number().int().min(1).max(100).optional().default(10).describe('Results per page'),
      page: z.number().int().min(1).optional().default(1).describe('Page number'),
      search: z.string().optional().describe('Full-text search term'),
      author: z.number().int().optional().describe('Filter by author ID'),
      categories: z.array(z.number().int()).optional().describe('Filter by category IDs'),
      tags: z.array(z.number().int()).optional().describe('Filter by tag IDs'),
      orderby: z.enum(['date', 'modified', 'title', 'id', 'relevance']).optional().default('date'),
      order: z.enum(['asc', 'desc']).optional().default('desc'),
    },
    async (args) => {
      const params: Record<string, string | number | boolean> = {
        status: args.status,
        per_page: args.per_page,
        page: args.page,
        orderby: args.orderby,
        order: args.order,
      };
      if (args.search) params['search'] = args.search;
      if (args.author) params['author'] = args.author;
      if (args.categories?.length) params['categories'] = args.categories.join(',');
      if (args.tags?.length) params['tags'] = args.tags.join(',');

      const posts = await client.get<WPPost[]>('/posts', params);
      return {
        content: [{ type: 'text', text: JSON.stringify(posts, null, 2) }],
      };
    },
  );

  // ── Get Post ──────────────────────────────────────────────────────────────
  server.tool(
    'wp_get_post',
    'Get a single WordPress post by ID',
    { id: z.number().int().describe('Post ID') },
    async ({ id }) => {
      const post = await client.get<WPPost>(`/posts/${id}`);
      return { content: [{ type: 'text', text: JSON.stringify(post, null, 2) }] };
    },
  );

  // ── Create Post ───────────────────────────────────────────────────────────
  server.tool(
    'wp_create_post',
    'Create a new WordPress post',
    {
      title: z.string().describe('Post title'),
      content: z.string().optional().default('').describe('Post content (HTML allowed)'),
      excerpt: z.string().optional().describe('Post excerpt'),
      status: z
        .enum(['publish', 'draft', 'pending', 'private'])
        .optional()
        .default('draft')
        .describe('Post status'),
      categories: z.array(z.number().int()).optional().describe('Category IDs'),
      tags: z.array(z.number().int()).optional().describe('Tag IDs'),
      featured_media: z.number().int().optional().describe('Featured image media ID'),
      author: z.number().int().optional().describe('Author user ID'),
      slug: z.string().optional().describe('URL slug'),
    },
    async (args) => {
      const body: Record<string, unknown> = {
        title: args.title,
        content: args.content,
        status: args.status,
      };
      if (args.excerpt) body['excerpt'] = args.excerpt;
      if (args.categories) body['categories'] = args.categories;
      if (args.tags) body['tags'] = args.tags;
      if (args.featured_media) body['featured_media'] = args.featured_media;
      if (args.author) body['author'] = args.author;
      if (args.slug) body['slug'] = args.slug;

      const post = await client.post<WPPost>('/posts', body);
      return { content: [{ type: 'text', text: JSON.stringify(post, null, 2) }] };
    },
  );

  // ── Update Post ───────────────────────────────────────────────────────────
  server.tool(
    'wp_update_post',
    'Update an existing WordPress post',
    {
      id: z.number().int().describe('Post ID to update'),
      title: z.string().optional().describe('New title'),
      content: z.string().optional().describe('New content'),
      excerpt: z.string().optional().describe('New excerpt'),
      status: z.enum(['publish', 'draft', 'pending', 'private', 'trash']).optional(),
      categories: z.array(z.number().int()).optional(),
      tags: z.array(z.number().int()).optional(),
      featured_media: z.number().int().optional(),
      slug: z.string().optional(),
    },
    async ({ id, ...rest }) => {
      const body = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      const post = await client.patch<WPPost>(`/posts/${id}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(post, null, 2) }] };
    },
  );

  // ── Delete Post ───────────────────────────────────────────────────────────
  server.tool(
    'wp_delete_post',
    'Delete a WordPress post (move to trash, or force-delete permanently)',
    {
      id: z.number().int().describe('Post ID'),
      force: z.boolean().optional().default(false).describe('If true, permanently delete (bypass trash)'),
    },
    async ({ id, force }) => {
      const result = await client.delete<WPPost>(`/posts/${id}`, { force });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
