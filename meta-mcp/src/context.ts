/** Shared context handed to every module's register function. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GraphClient } from "./client.js";
import type { Config } from "./config.js";

export interface Ctx {
  server: McpServer;
  client: GraphClient;
  config: Config;
}

export type Register = (ctx: Ctx) => void;
