import { z } from 'zod';
import { WordPressClient } from '../client.js';
import type { WPComment } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerCommentTools(server: McpServer, client: WordPressClient): void {
  server.tool(
    'wp_list_comments',
    'List WordPress comments',
    {
      per_page: z.number().int().min(1).max(100).optional().default(10),
      page: z.number().int().min(1).optional().default(1),
      post: z.number().int().optional().describe('Filter by post ID'),
      status: z.enum(['approved', 'hold', 'spam', 'trash', 'all']).optional().default('all'),
      orderby: z.enum(['date', 'id', 'post', 'parent']).optional().default('date'),
      order: z.enum(['asc', 'desc']).optional().default('desc'),
      search: z.string().optional(),
      author_email: z.string().email().optional(),
    },
    async (args) => {
      const params: Record<string, string | number | boolean> = {
        per_page: args.per_page,
        page: args.page,
        status: args.status,
        orderby: args.orderby,
        order: args.order,
      };
      if (args.post) params['post'] = args.post;
      if (args.search) params['search'] = args.search;
      if (args.author_email) params['author_email'] = args.author_email;

      const comments = await client.get<WPComment[]>('/comments', params);
      return { content: [{ type: 'text', text: JSON.stringify(comments, null, 2) }] };
    },
  );

  server.tool(
    'wp_get_comment',
    'Get a single comment by ID',
    { id: z.number().int() },
    async ({ id }) => {
      const comment = await client.get<WPComment>(`/comments/${id}`);
      return { content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }] };
    },
  );

  server.tool(
    'wp_create_comment',
    'Create a new comment on a post',
    {
      post: z.number().int().describe('Post ID to comment on'),
      content: z.string().describe('Comment content (HTML allowed)'),
      parent: z.number().int().optional().default(0).describe('Parent comment ID (0 for top-level)'),
      author_name: z.string().optional(),
      author_email: z.string().email().optional(),
      author_url: z.string().url().optional(),
      status: z.enum(['approved', 'hold', 'spam']).optional().default('approved'),
    },
    async (args) => {
      const body: Record<string, unknown> = {
        post: args.post,
        content: args.content,
        parent: args.parent,
        status: args.status,
      };
      if (args.author_name) body['author_name'] = args.author_name;
      if (args.author_email) body['author_email'] = args.author_email;
      if (args.author_url) body['author_url'] = args.author_url;

      const comment = await client.post<WPComment>('/comments', body);
      return { content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }] };
    },
  );

  server.tool(
    'wp_update_comment',
    'Update a comment (content, status, moderation)',
    {
      id: z.number().int(),
      content: z.string().optional(),
      status: z.enum(['approved', 'hold', 'spam', 'trash']).optional(),
      author_name: z.string().optional(),
      author_email: z.string().email().optional(),
    },
    async ({ id, ...rest }) => {
      const body = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      const comment = await client.patch<WPComment>(`/comments/${id}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }] };
    },
  );

  server.tool(
    'wp_delete_comment',
    'Delete a comment',
    {
      id: z.number().int(),
      force: z.boolean().optional().default(false).describe('Permanently delete (bypass trash)'),
    },
    async ({ id, force }) => {
      const result = await client.delete<WPComment>(`/comments/${id}`, { force });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
