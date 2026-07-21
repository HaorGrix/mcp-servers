import { appendFile } from 'node:fs/promises';
import { redact } from './config.js';

export interface AuditEntry {
  ts: string;
  method: string;
  path: string;
  status: number | 'dry-run' | 'error';
  durationMs: number;
  attempts: number;
  detail?: string;
}

/**
 * Append-only record of every mutating call. Email sends are irreversible and
 * outward facing, so there has to be a trail of what went out and when, kept
 * outside whatever the model happens to remember about the session.
 */
export class AuditLog {
  constructor(private readonly path: string) {}

  async record(entry: AuditEntry): Promise<void> {
    const line = JSON.stringify({ ...entry, detail: entry.detail ? redact(entry.detail) : undefined });
    try {
      await appendFile(this.path, `${line}\n`, 'utf8');
    } catch (err: unknown) {
      // A failed audit write must never take down a running server, but it
      // must be visible, so it goes to stderr rather than being swallowed.
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[brevo-mcp] audit write failed: ${redact(detail)}`);
    }
  }
}

/** Reads are high volume and uninteresting; only writes are worth recording. */
export function isMutating(method: string): boolean {
  return method !== 'GET';
}
