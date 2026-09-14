/** MCP response helpers. Every tool returns through here so errors are uniform. */
import { GraphError } from "./client.js";

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function ok(payload: unknown): ToolResult {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text", text }] };
}

export function fail(err: unknown): ToolResult {
  if (err instanceof GraphError) {
    const m = err.meta;
    const parts = [err.message];
    if (m.code !== undefined && m.code >= 0) parts.push(`code=${m.code}${m.subcode ? `/${m.subcode}` : ""}`);
    if (m.type) parts.push(`type=${m.type}`);
    if (m.path) parts.push(`path=${m.path}`);
    if (m.traceId) parts.push(`trace=${m.traceId}`);
    if (m.userMessage) parts.push(`hint=${m.userMessage}`);
    return { content: [{ type: "text", text: parts.join(" | ") }], isError: true };
  }
  const detail = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: detail }], isError: true };
}

/** Wrap a handler so thrown errors become isError results instead of crashing the transport. */
export function guarded<A>(fn: (args: A) => Promise<unknown>): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (err: unknown) {
      return fail(err);
    }
  };
}
