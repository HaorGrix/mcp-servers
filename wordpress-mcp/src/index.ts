#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WordPressClient } from './client.js';
import { registerPostTools } from './tools/posts.js';
import { registerPageTools } from './tools/pages.js';
import { registerMediaTools } from './tools/media.js';
import { registerUserTools } from './tools/users.js';
import { registerCommentTools } from './tools/comments.js';
import { registerWooCommerceTools } from './tools/woocommerce.js';
import { registerTaxonomyTools } from './tools/taxonomy.js';
import { registerCacheTools } from './tools/cache.js';
import { registerRawTools } from './tools/raw.js';

// ── Config validation ────────────────────────────────────────────────────────
const REQUIRED_ENV = ['WORDPRESS_URL', 'WORDPRESS_USERNAME', 'WORDPRESS_APP_PASSWORD'] as const;
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[wordpress-mcp] Missing required env vars: ${missing.join(', ')}`);
  console.error('Copy .env.example → .env and fill in the values.');
  process.exit(1);
}

const WORDPRESS_URL = process.env['WORDPRESS_URL']!;
const WORDPRESS_USERNAME = process.env['WORDPRESS_USERNAME']!;
const WORDPRESS_APP_PASSWORD = process.env['WORDPRESS_APP_PASSWORD']!;
const WC_CONSUMER_KEY = process.env['WC_CONSUMER_KEY'];
const WC_CONSUMER_SECRET = process.env['WC_CONSUMER_SECRET'];
const CLOUDFLARE_API_TOKEN = process.env['CLOUDFLARE_API_TOKEN'];
const CLOUDFLARE_ZONE_ID = process.env['CLOUDFLARE_ZONE_ID'];

// ── Client ───────────────────────────────────────────────────────────────────
const client = new WordPressClient({
  baseUrl: WORDPRESS_URL,
  username: WORDPRESS_USERNAME,
  appPassword: WORDPRESS_APP_PASSWORD,
  wcConsumerKey: WC_CONSUMER_KEY,
  wcConsumerSecret: WC_CONSUMER_SECRET,
  cfApiToken: CLOUDFLARE_API_TOKEN,
  cfZoneId: CLOUDFLARE_ZONE_ID,
});

// ── MCP Server ───────────────────────────────────────────────────────────────
const server = new McpServer({
  name: 'wordpress-mcp',
  version: '1.0.0',
});

// ── Register all tool groups ──────────────────────────────────────────────────
registerPostTools(server, client);
registerPageTools(server, client);
registerMediaTools(server, client);
registerUserTools(server, client);
registerCommentTools(server, client);
registerTaxonomyTools(server, client);
registerWooCommerceTools(server, client);
registerCacheTools(server, client);
registerRawTools(server, client);

// ── Start transport ───────────────────────────────────────────────────────────
const transport = new StdioServerTransport();

async function main(): Promise<void> {
  await server.connect(transport);
  console.error(
    `[wordpress-mcp] Running against ${WORDPRESS_URL} — ${
      WC_CONSUMER_KEY ? 'WooCommerce enabled' : 'WooCommerce disabled (no WC keys)'
    }`,
  );
}

process.on('SIGINT', () => {
  console.error('[wordpress-mcp] Shutting down.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('[wordpress-mcp] Shutting down.');
  process.exit(0);
});

main().catch((err: unknown) => {
  console.error('[wordpress-mcp] Fatal error:', err);
  process.exit(1);
});
