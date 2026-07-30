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
  /**
   * 'pending' is written before a destructive provider call, so a crash between
   * intent and outcome still leaves evidence that the call was attempted.
   */
  outcome: 'ok' | 'refused' | 'dry-run' | 'error' | 'pending';
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
/** Raised when a destructive call could not be journalled, so it must not proceed. */
export class AuditWriteError extends Error {
  constructor(cause: string) {
    super(
      `Refusing to proceed: the audit journal could not be written (${cause}). A destructive ` +
        'call is not allowed to run unlogged — a refused delete is recoverable, an unlogged ' +
        'delete is not.',
    );
    this.name = 'AuditWriteError';
  }
}

export class AuditLog {
  constructor(private readonly path: string) {}

  /** Serialises and appends. Throws on failure; the callers decide what that means. */
  private async append(entry: AuditEntry): Promise<void> {
    const safe = {
      ...entry,
      args: redactArgs(entry.args),
      ...(entry.detail ? { detail: redact(entry.detail) } : {}),
    };
    await appendFile(this.path, `${JSON.stringify(safe)}\n`, 'utf8');
  }

  /**
   * Tolerant. For reads and non-destructive writes: a failed journal write must
   * not take down a running server, but it must be visible, so it goes to
   * stderr rather than being swallowed silently.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.append(entry);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[resend-mcp] audit write failed: ${redact(detail)}`);
    }
  }

  /**
   * Fails closed. For destructive calls ONLY, and called BEFORE the provider
   * request so that nothing is destroyed until the intent is durably on disk.
   *
   * Tolerating a failed write here would lose the trail in precisely the
   * situation where it matters most.
   */
  async recordCritical(entry: AuditEntry): Promise<void> {
    try {
      await this.append(entry);
    } catch (err: unknown) {
      throw new AuditWriteError(err instanceof Error ? err.message : String(err));
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
