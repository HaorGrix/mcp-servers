#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, MetaClient, type Config } from "./client.js";
import { registerTools } from "./tools/index.js";

let config: Config;
try {
  config = loadConfig();
} catch (err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[meta-business-mcp] Configuration error: ${detail}`);
  process.exit(1);
}

const client = new MetaClient(config);
const server = new McpServer({ name: "meta-business-mcp", version: "1.0.0" });
registerTools(server, client);

const transport = new StdioServerTransport();

async function main(): Promise<void> {
  await server.connect(transport);
  console.error(`[meta-business-mcp] Running against Graph ${config.version}`);
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

main().catch((err: unknown) => {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[meta-business-mcp] Fatal: ${detail}`);
  process.exit(1);
});
