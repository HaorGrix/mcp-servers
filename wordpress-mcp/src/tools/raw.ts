import { z } from 'zod';
import { WordPressClient } from '../client.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const META_NS = '/agent-cache/v1';

/**
 * Full-control escape hatches: reach any WordPress REST route and any post meta
 * key, for cases not covered by the typed domain tools.
 */
export function registerRawTools(server: McpServer, client: WordPressClient): void {
  server.tool(
    'wp_rest_request',
    'Full-control escape hatch: call ANY WordPress REST route under /wp-json with any method. Use for ' +
      'endpoints not covered by the typed tools (custom post types, plugin routes, settings, options, ' +
      'third-party namespaces). Path is relative to /wp-json, e.g. "/wp/v2/settings" or "/elementor/v1/...".',
    {
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
      path: z.string().describe('Route relative to /wp-json, e.g. "/wp/v2/posts/42" or "/myplugin/v1/x"'),
      params: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('Query-string params'),
      body: z.record(z.unknown()).optional().describe('JSON body for write methods'),
    },
    async ({ method, path, params, body }) => {
      const result = await client.raw<unknown>(method, path, params ?? {}, body);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'wp_get_post_meta',
    'Read any post meta key (including hidden/protected keys like _elementor_data) via the Agent Cache ' +
      'Control mu-plugin. Core REST does not expose arbitrary meta; this does. Requires cp_deploy_cache_helper.',
    {
      post_id: z.number().int(),
      key: z.string().describe('Meta key, e.g. "_elementor_data"'),
    },
    async ({ post_id, key }) => {
      const result = await client.getRoot<unknown>(`${META_NS}/post-meta`, { post_id, key });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'wp_update_post_meta',
    'Write any post meta key via the Agent Cache Control mu-plugin. For _elementor_data the value is ' +
      'stored with the correct slashing automatically. Prefer wp_bust_elementor_image_urls for targeted ' +
      'Elementor URL edits; use this for full meta control. Requires cp_deploy_cache_helper.',
    {
      post_id: z.number().int(),
      key: z.string(),
      value: z.string().describe('Meta value. For JSON meta, pass the JSON string.'),
    },
    async ({ post_id, key, value }) => {
      const result = await client.postRoot<unknown>(`${META_NS}/post-meta`, { post_id, key, value });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
