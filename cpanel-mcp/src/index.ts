#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CpanelClient } from './client.js';
import { registerFileTools } from './tools/files.js';
import { registerDatabaseTools } from './tools/databases.js';
import { registerEmailTools } from './tools/email.js';
import { registerDomainTools } from './tools/domains.js';
import { registerDnsTools } from './tools/dns.js';
import { registerBackupTools } from './tools/backup.js';
import { registerCronTools } from './tools/cron.js';
import { registerSslTools, registerStatsTools } from './tools/ssl.js';
import { registerCacheTools } from './tools/cache.js';
import { registerRawTools } from './tools/raw.js';

// ── Config validation ────────────────────────────────────────────────────────
const REQUIRED = ['CPANEL_HOST', 'CPANEL_USERNAME', 'CPANEL_PASSWORD'] as const;
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[cpanel-mcp] Missing required env vars: ${missing.join(', ')}`);
  console.error('Copy .env.example → .env and fill in the values.');
  process.exit(1);
}

const CPANEL_HOST = process.env['CPANEL_HOST']!;
const CPANEL_USERNAME = process.env['CPANEL_USERNAME']!;
const CPANEL_PASSWORD = process.env['CPANEL_PASSWORD']!;
const CPANEL_BASE_URL = process.env['CPANEL_BASE_URL'];

// ── Client ───────────────────────────────────────────────────────────────────
const client = new CpanelClient({
  host: CPANEL_HOST,
  username: CPANEL_USERNAME,
  password: CPANEL_PASSWORD,
  baseUrlOverride: CPANEL_BASE_URL,
});

// ── MCP Server ───────────────────────────────────────────────────────────────
const server = new McpServer({
  name: 'cpanel-mcp',
  version: '1.0.0',
});

// ── Register all tool groups ──────────────────────────────────────────────────
registerFileTools(server, client);
registerDatabaseTools(server, client);
registerEmailTools(server, client);
registerDomainTools(server, client);
registerDnsTools(server, client);
registerBackupTools(server, client);
registerCronTools(server, client);
registerSslTools(server, client);
registerStatsTools(server, client);
registerCacheTools(server, client);
registerRawTools(server, client);

// ── Start transport ───────────────────────────────────────────────────────────
const transport = new StdioServerTransport();

async function main(): Promise<void> {
  await server.connect(transport);
  const baseUrl = CPANEL_BASE_URL ?? `https://cpanel.${CPANEL_HOST}`;
  console.error(`[cpanel-mcp] Running against ${baseUrl} (user: ${CPANEL_USERNAME})`);
}

process.on('SIGINT', () => { process.exit(0); });
process.on('SIGTERM', () => { process.exit(0); });

main().catch((err: unknown) => {
  console.error('[cpanel-mcp] Fatal error:', err);
  process.exit(1);
});
