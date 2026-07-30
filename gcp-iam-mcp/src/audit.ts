import { appendFile } from 'node:fs/promises';
import { redact } from './config.js';

export interface AuditEntry {
  /** ISO timestamp. */
  ts: string;
  /** MCP tool name, e.g. "gcp_delete_sa_key". */
  tool: string;
  /** Tool arguments, secrets already redacted by `record`. */
  args: Record<string, unknown>;
  /** The resource acted on, so a 3am question has a single field to grep. */
  resourceId?: string;
  outcome: 'ok' | 'refused' | 'dry-run' | 'error';
  /** Provider HTTP status when there was one. */
  status?: number;
  /** Why, for refusals and errors. Redacted. */
  detail?: string;
}

/**
 * Append-only record of every write and destructive call.
 *
 * The point is recoverability of intent, not compliance theatre: when something
 * is missing at 3am, this is the only thing that answers "did the MCP do it?".
 * Local file only — never a network sink, because shipping an audit trail of
 * credential operations off-box would recreate the exfiltration path we are
 * defending against.
 */
export class AuditLog {
  constructor(private readonly path: string) {}

  async record(entry: AuditEntry): Promise<void> {
    const safe = {
      ...entry,
      args: redactArgs(entry.args),
      ...(entry.detail ? { detail: redact(entry.detail) } : {}),
    };
    try {
      await appendFile(this.path, `${JSON.stringify(safe)}\n`, 'utf8');
    } catch (err: unknown) {
      // A failed audit write must never take down a running server, but it must
      // be visible, so it goes to stderr rather than being swallowed.
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[gcp-iam-mcp] audit write failed: ${redact(detail)}`);
    }
  }
}

/**
 * Field names whose values are dropped outright rather than pattern-matched.
 *
 * Pattern matching alone is not enough: a bare password has no recognisable
 * shape, so `{ password: "hunter2" }` survives every regex. This list is the
 * backstop, and it is deliberately broad — a false positive costs one redacted
 * field in a log, a false negative costs a live credential.
 */
const SECRET_KEYS = new Set([
  'privateKeyData',
  'private_key',
  'privateKey',
  'keyString',
  'key_string',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'password',
  'passwd',
  'secret',
  'clientSecret',
  'client_secret',
  'apiKey',
  'api_key',
  'uri',
  'connectionUri',
  'connection_uri',
  'connectionString',
  'connection_string',
  'dsn',
  'credentials',
  'authorization',
]);

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SECRET_KEYS.has(key.toLowerCase()) || SECRET_KEYS.has(key)) {
      out[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      out[key] = redact(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
