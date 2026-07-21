#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BrevoClient } from './client.js';
import { loadConfig, type Config } from './config.js';
import { registerAccountTools } from './tools/account.js';
import { registerContactTools } from './tools/contacts.js';
import { registerCampaignTools } from './tools/campaigns.js';
import { registerStatsTools } from './tools/stats.js';
import { registerHealthTools } from './tools/health.js';

// ── Config validation ────────────────────────────────────────────────────────
let config: Config;
try {
  config = loadConfig();
} catch (err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[brevo-mcp] Configuration error: ${detail}`);
  process.exit(1);
}

// ── Client ───────────────────────────────────────────────────────────────────
const client = new BrevoClient(config);

// ── MCP Server ───────────────────────────────────────────────────────────────
const server = new McpServer({
  name: 'brevo-mcp',
  version: '1.0.0',
});

// ── Register all tool groups ─────────────────────────────────────────────────
registerHealthTools(server, client);
registerAccountTools(server, client);
registerContactTools(server, client);
registerCampaignTools(server, client);
registerStatsTools(server, client);

// ── Start transport ──────────────────────────────────────────────────────────
const transport = new StdioServerTransport();

async function main(): Promise<void> {
  await server.connect(transport);
  const guard = config.enforceSender
    ? `sender locked to ${config.enforceSender}`
    : 'no sender lock (set BREVO_ENFORCE_SENDER to enable)';
  const mode = config.dryRun ? 'DRY RUN, all writes refused' : 'live';
  console.error(
    `[brevo-mcp] ${mode}, ${config.baseUrl}, ${guard}, ` +
      `${config.requestsPerSecond} rps, ${config.maxRetries} retries, audit -> ${config.auditLogPath}`,
  );
}

process.on('SIGINT', () => { process.exit(0); });
process.on('SIGTERM', () => { process.exit(0); });

main().catch((err: unknown) => {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[brevo-mcp] Fatal: ${detail}`);
  process.exit(1);
});
