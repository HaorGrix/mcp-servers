#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config.js";
import { ZohoClient } from "./client.js";
import { ZohoSender } from "./sender.js";
import { ZohoAdmin } from "./admin.js";
import { registerTools } from "./tools.js";
import { registerWriteTools, registerAdminTools } from "./tools-write.js";

let config: Config;
try {
  config = loadConfig();
} catch (err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[zoho-mail-mcp] Configuration error: ${detail}`);
  process.exit(1);
}

const client = new ZohoClient(config);
const sender = new ZohoSender(config);
const server = new McpServer({ name: "zoho-mail-mcp", version: "2.0.0" });

registerTools(server, client);
registerWriteTools(server, client, sender, config);

let adminEnabled = false;
if (config.admin) {
  registerAdminTools(server, new ZohoAdmin(config.admin));
  adminEnabled = true;
}

const transport = new StdioServerTransport();

async function main(): Promise<void> {
  await server.connect(transport);
  const mode = config.readOnly ? "read-only mailbox" : "READ-WRITE mailbox";
  const guard = config.enforceSender ? `sender locked to ${config.enforceSender}` : "no sender lock";
  const dry = config.dryRun ? ", DRY RUN (no sends)" : "";
  const admin = adminEnabled ? ", admin API ENABLED" : ", admin API off (no refresh token)";
  console.error(`[zoho-mail-mcp] ${mode}, ${guard}${dry}${admin}, ${config.user}`);
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

main().catch((err: unknown) => {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[zoho-mail-mcp] Fatal: ${detail}`);
  process.exit(1);
});
