#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, redact } from './config.js';
import { OpenRouterClient } from './client.js';
import { AuditLog } from './audit.js';
import {
  registerReadTools,
  registerWriteTools,
  registerDestructiveTools,
} from './tools/index.js';

/**
 * Builds the server with exactly the tools the config permits.
 *
 * Layer 1 of the safety model lives here: when a flag is off the corresponding
 * tools are never registered, so they are absent from tools/list rather than
 * refused at call time. An agent cannot reach them by guessing a name.
 *
 * Exported so the tests can assert tool absence without spawning a process.
 */
export function buildServer(
  config = loadConfig(),
  client = new OpenRouterClient(config),
  audit = new AuditLog(config.auditLogPath),
): { server: McpServer; toolNames: string[] } {
  const server = new McpServer(
    { name: 'openrouter-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  const toolNames: string[] = [];
  const track = <T extends { tool: McpServer['tool'] }>(target: T): T =>
    new Proxy(target, {
      get(obj, prop, recv) {
        if (prop !== 'tool') return Reflect.get(obj, prop, recv);
        return (name: string, ...rest: unknown[]) => {
          toolNames.push(name);
          return (obj.tool as (...a: unknown[]) => unknown)(name, ...rest);
        };
      },
    });

  const tracked = track(server) as McpServer;

  registerReadTools(tracked, client, config);
  if (config.allowWrites) registerWriteTools(tracked, client, config, audit);
  if (config.allowDestructive) registerDestructiveTools(tracked, client, config, audit);

  return { server, toolNames };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new OpenRouterClient(config);
  const { server, toolNames } = buildServer(config, client);

  // Fail at boot with a clear reason rather than on the first tool call.
  let identity = '(unresolved)';
  try {
    identity = await client.whoami();
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[openrouter-mcp] FATAL: credentials did not resolve: ${redact(detail)}`);
    process.exit(1);
  }

  await server.connect(new StdioServerTransport());

  const mode = config.allowDestructive
    ? 'READ + WRITE + DESTRUCTIVE'
    : config.allowWrites
      ? 'READ + WRITE'
      : 'READ-ONLY';
  console.error(
    `[openrouter-mcp] ${mode}, secrets -> file only (${config.secretOutDir}), ${toolNames.length} tools, ` +
      `${identity}, ` +
      `${config.protectedKeys.length} protected key(s), audit -> ${config.auditLogPath}`,
  );
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// Only run when executed directly, so importing for tests does not start a server.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '')) {
  main().catch((err: unknown) => {
    console.error(`[openrouter-mcp] FATAL: ${redact(err instanceof Error ? err.message : String(err))}`);
    process.exit(1);
  });
}
