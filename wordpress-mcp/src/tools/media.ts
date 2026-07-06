import { z } from 'zod';
import { readFile } from 'fs/promises';
import { lookup } from 'node:dns/promises';
import path from 'path';
import { WordPressClient } from '../client.js';
import type { WPMedia } from '../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Naive mime-type map for common extensions
const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
  mp4: 'video/mp4', mp3: 'audio/mpeg', zip: 'application/zip',
};

function inferMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

export function registerMediaTools(server: McpServer, client: WordPressClient): void {
  server.tool(
    'wp_list_media',
    'List WordPress media library items',
    {
      per_page: z.number().int().min(1).max(100).optional().default(10),
      page: z.number().int().min(1).optional().default(1),
      search: z.string().optional(),
      media_type: z.enum(['image', 'video', 'audio', 'application', 'text']).optional(),
      mime_type: z.string().optional().describe('MIME type filter e.g. image/jpeg'),
      orderby: z.enum(['date', 'modified', 'title', 'id']).optional().default('date'),
      order: z.enum(['asc', 'desc']).optional().default('desc'),
    },
    async (args) => {
      const params: Record<string, string | number | boolean> = {
        per_page: args.per_page,
        page: args.page,
        orderby: args.orderby,
        order: args.order,
      };
      if (args.search) params['search'] = args.search;
      if (args.media_type) params['media_type'] = args.media_type;
      if (args.mime_type) params['mime_type'] = args.mime_type;

      const items = await client.get<WPMedia[]>('/media', params);
      return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
    },
  );

  server.tool(
    'wp_get_media',
    'Get a single media item by ID',
    { id: z.number().int() },
    async ({ id }) => {
      const item = await client.get<WPMedia>(`/media/${id}`);
      return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
    },
  );

  server.tool(
    'wp_upload_media',
    'Upload a media file from a local filesystem path',
    {
      file_path: z.string().describe('Absolute path to the local file to upload'),
      title: z.string().optional().describe('Override the filename as the media title'),
      alt_text: z.string().optional().describe('Alt text for the image'),
      caption: z.string().optional().describe('Media caption'),
    },
    async ({ file_path, title, alt_text, caption }) => {
      const filename = path.basename(file_path);
      const mimeType = inferMimeType(filename);
      const data = await readFile(file_path);

      const uploaded = await client.upload<WPMedia>('/media', filename, mimeType, data);

      // Update metadata if provided
      if (title || alt_text || caption) {
        const body: Record<string, unknown> = {};
        if (title) body['title'] = title;
        if (alt_text) body['alt_text'] = alt_text;
        if (caption) body['caption'] = caption;
        const updated = await client.patch<WPMedia>(`/media/${uploaded.id}`, body);
        return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify(uploaded, null, 2) }] };
    },
  );

  server.tool(
    'wp_update_media',
    'Update media item metadata (alt text, caption, title)',
    {
      id: z.number().int(),
      title: z.string().optional(),
      alt_text: z.string().optional(),
      caption: z.string().optional(),
      description: z.string().optional(),
    },
    async ({ id, ...rest }) => {
      const body = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
      );
      const item = await client.patch<WPMedia>(`/media/${id}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
    },
  );

  server.tool(
    'wp_delete_media',
    'Delete a media item',
    {
      id: z.number().int(),
      force: z.boolean().optional().default(true).describe('Must be true to permanently delete media'),
    },
    async ({ id, force }) => {
      const result = await client.delete<WPMedia>(`/media/${id}`, { force });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
