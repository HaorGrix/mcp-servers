import { z } from 'zod';
import { CpanelClient } from '../client.js';
import { CACHE_HELPER_PHP, CACHE_HELPER_FILENAME, CACHE_HELPER_VERSION } from '../assets/cacheHelperPlugin.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Default WordPress docroot relative to the cPanel home directory.
const DEFAULT_DOCROOT = '/public_html';

export function registerCacheTools(server: McpServer, client: CpanelClient): void {
  server.tool(
    'cp_deploy_cache_helper',
    'Install/update the "Agent Cache Control" WordPress must-use plugin. This is the keystone for ' +
      'reliable cache invalidation: it exposes a REST API (agent-cache/v1) that the wordpress-mcp ' +
      'tools call to purge LiteSpeed/Nginx/Rocket/W3TC/Super Cache and regenerate Elementor CSS. ' +
      'Run this once per site before using wp_purge_cache / wp_bust_elementor_image_urls.',
    {
      docroot: z
        .string()
        .optional()
        .default(DEFAULT_DOCROOT)
        .describe('WordPress document root relative to cPanel home, e.g. "/public_html"'),
    },
    async ({ docroot }) => {
      const base = docroot.replace(/\/$/, '');
      const muDir = `${base}/wp-content/mu-plugins`;

      // mu-plugins is auto-loaded but may not exist on a fresh install.
      await client.createDir(muDir);

      await client.post('Fileman', 'save_file_content', {
        dir: muDir,
        file: CACHE_HELPER_FILENAME,
        content: CACHE_HELPER_PHP,
      });

      return {
        content: [
          {
            type: 'text',
            text:
              `Deployed ${CACHE_HELPER_FILENAME} v${CACHE_HELPER_VERSION} to ${muDir}.\n` +
              `Verify with: GET {WORDPRESS_URL}/wp-json/agent-cache/v1/ping (auth required).\n` +
              `Now usable from wordpress-mcp: wp_purge_cache, wp_regenerate_elementor_css, ` +
              `wp_bust_elementor_image_urls.`,
          },
        ],
      };
    },
  );

  server.tool(
    'cp_purge_litespeed',
    'Filesystem fallback to clear LiteSpeed/static page caches by deleting cache directories on disk. ' +
      'Prefer wp_purge_cache (graceful, plugin-aware) when the cache helper is installed; use this only ' +
      'when the WordPress REST API is unreachable or the cache is wedged.',
    {
      docroot: z.string().optional().default(DEFAULT_DOCROOT).describe('WordPress document root relative to cPanel home'),
    },
    async ({ docroot }) => {
      const base = docroot.replace(/\/$/, '');
      // Common on-disk cache locations for LiteSpeed and generic full-page caches.
      const candidates = [
        `${base}/wp-content/litespeed`,
        `${base}/wp-content/cache`,
      ];

      const results: string[] = [];
      for (const path of candidates) {
        try {
          await client.post('Fileman', 'unlink', { path, skip_trash: 1 });
          results.push(`cleared: ${path}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Missing dir is fine — that cache layer simply isn't present.
          results.push(/not.*exist|no such/i.test(msg) ? `absent: ${path}` : `failed: ${path} (${msg})`);
        }
      }

      return { content: [{ type: 'text', text: results.join('\n') }] };
    },
  );
}
