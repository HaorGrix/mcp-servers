#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config.js";
import { GraphClient } from "./client.js";
import { modules } from "./modules/index.js";

let config: Config;
try {
  config = loadConfig();
} catch (err: unknown) {
  console.error(`[meta-mcp] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const client = new GraphClient(config);
const server = new McpServer({ name: "meta-mcp", version: "1.0.0" });
for (const m of modules) m.register({ server, client, config });

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  console.error(`[meta-mcp] running on stdio — Graph ${config.version}, ${modules.length} modules, writes ${config.allowWrites ? "enabled" : "disabled"}`);
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
main().catch((err: unknown) => {
  console.error(`[meta-mcp] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
