#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "./src/config.js";
import { GraphClient, GraphError } from "./src/graph.js";
import { readTools, writeTools } from "./src/tools.js";
import { analyticsTools } from "./src/analytics.js";
import { governTools } from "./src/govern.js";
import { optimizeTools } from "./src/optimize.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`[meta-ads] config error: ${err.message}`);
  process.exit(1);
}

const graph = new GraphClient(config);

// Write tools are only registered when explicitly enabled, so a read-only deployment
// cannot mutate a client account even if a caller invents the tool name.
const tools = [
  ...readTools(graph),
  ...analyticsTools(graph),
  ...governTools(graph),
  ...(config.allowWrites ? [...writeTools(graph), ...optimizeTools(graph)] : []),
];
const byName = new Map(tools.map((t) => [t.name, t]));

const server = new Server(
  { name: "meta-ads-local", version: "2.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const tool = byName.get(name);

  if (!tool) {
    const hint = config.allowWrites ? "" : " (write tools are disabled; set META_ALLOW_WRITES=true to enable them)";
    return errorResult(`Unknown tool "${name}". Available: ${[...byName.keys()].join(", ")}${hint}`);
  }

  try {
    const result = await tool.handler(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    if (err instanceof GraphError) {
      return errorResult(
        `${name} failed: ${err.message}` +
          (err.code !== undefined ? ` [code ${err.code}${err.subcode ? `/${err.subcode}` : ""}]` : "") +
          (err.traceId ? ` [trace ${err.traceId}]` : ""),
      );
    }
    return errorResult(`${name} failed: ${err?.message ?? String(err)}`);
  }
});

/** @param {string} message */
function errorResult(message) {
  return { isError: true, content: [{ type: "text", text: message }] };
}

process.on("unhandledRejection", (reason) => {
  console.error(`[meta-ads] unhandled rejection: ${reason?.message ?? reason}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `[meta-ads] running on stdio — Graph ${config.apiVersion}, ` +
    `${tools.length} tools, writes ${config.allowWrites ? "ENABLED" : "disabled"}`,
);
