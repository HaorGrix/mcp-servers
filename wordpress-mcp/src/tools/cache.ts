import { z } from 'zod';
import { WordPressClient } from '../client.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const NS = '/agent-cache/v1';

interface PurgeResult {
  ok: boolean;
  mode: string;
  targets: string[];
  mechanisms: string[];
}

export function registerCacheTools(server: McpServer, client: WordPressClient): void {
  server.tool(
    'wp_purge_cache',
    'Purge WordPress page/object caches (LiteSpeed, Nginx Helper, WP Rocket, W3TC, WP Super Cache, ' +
      'Autoptimize, SiteGround) via the Agent Cache Control mu-plugin. Call this after replacing media ' +
      'or editing content so the same URL serves fresh bytes. Requires cp_deploy_cache_helper to have ' +
      'been run once. Omit urls to purge everything.',
    {
      urls: z
        .array(z.string().url())
        .optional()
        .describe('Specific URLs to purge. Omit to purge the whole site cache.'),
    },
    async ({ urls }) => {
      const body = urls?.length ? { urls } : { all: true };
      const result = await client.postRoot<PurgeResult>(`${NS}/purge`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'wp_regenerate_elementor_css',
    'Regenerate Elementor generated CSS so layout/style changes appear on the front end. Pass a post_id ' +
      'to target one page, or omit to clear all Elementor CSS. Requires the Agent Cache Control mu-plugin.',
    {
      post_id: z.number().int().optional().describe('Target a single post/page; omit to clear all'),
    },
    async ({ post_id }) => {
      const body = post_id ? { post_id } : {};
      const result = await client.postRoot<unknown>(`${NS}/elementor/regenerate-css`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'wp_bust_elementor_image_urls',
    'Safely rewrite image URLs inside a page\'s _elementor_data without corrupting the stored JSON ' +
      '(done server-side via json_decode/encode, never SQL string-replace). Use "version" to append a ' +
      '?ver= cache-bust to every image URL, and/or "replacements" to swap exact URL substrings. ' +
      'Regenerates that post\'s Elementor CSS automatically. Requires the Agent Cache Control mu-plugin.',
    {
      post_id: z.number().int().describe('Post/page ID whose Elementor data to edit'),
      version: z
        .string()
        .optional()
        .describe('Cache-bust token appended as ?ver=<value> to image URLs, e.g. a timestamp'),
      replacements: z
        .array(z.object({ from: z.string(), to: z.string() }))
        .optional()
        .describe('Exact substring swaps applied to URLs, e.g. old → new image path'),
    },
    async ({ post_id, version, replacements }) => {
      if (!version && !replacements?.length) {
        throw new Error('Provide "version" and/or "replacements" — nothing to change otherwise.');
      }
      const body: Record<string, unknown> = { post_id };
      if (version) body['version'] = version;
      if (replacements?.length) body['replacements'] = replacements;
      const result = await client.postRoot<unknown>(`${NS}/elementor/bust-image-urls`, body);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'wp_purge_cloudflare',
    'Purge the Cloudflare edge cache (sits above the origin, so origin plugins cannot evict it). ' +
      'Pass files to purge specific URLs, or set everything=true for a full zone purge. Requires ' +
      'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID in .env.',
    {
      files: z.array(z.string().url()).optional().describe('Specific URLs to evict from the edge'),
      everything: z.boolean().optional().default(false).describe('Purge the entire zone'),
    },
    async ({ files, everything }) => {
      const result = await client.cloudflarePurge({ files, everything });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'wp_cache_status',
    'Report which cache layers are active on the site and whether the Agent Cache Control mu-plugin is ' +
      'installed and reachable. Use this to diagnose before/after a deploy.',
    {},
    async () => {
      const ping = await client.getRoot<unknown>(`${NS}/ping`);
      const status = {
        cache_helper: ping,
        cloudflare_configured: client.cloudflareConfigured(),
      };
      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    },
  );
}
