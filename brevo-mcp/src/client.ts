import type { BrevoError } from './types.js';
import type { Config } from './config.js';
import { redact } from './config.js';
import { AuditLog, isMutating } from './audit.js';
import { RateLimiter, backoffDelay, isRetryable, sleep } from './ratelimit.js';

/** Thrown for any non-2xx response so tool handlers surface a real message. */
export class BrevoApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly attempts = 1,
  ) {
    super(`Brevo API ${status} (${code}) after ${attempts} attempt(s): ${redact(message)}`);
    this.name = 'BrevoApiError';
  }
}

/** Thrown when a write is attempted while BREVO_DRY_RUN is on. */
export class DryRunError extends Error {
  constructor(method: string, path: string) {
    super(`DRY RUN: refused ${method} ${path}. Unset BREVO_DRY_RUN to allow writes.`);
    this.name = 'DryRunError';
  }
}

export class BrevoClient {
  readonly enforceSender?: string;
  readonly dryRun: boolean;
  private readonly config: Config;
  private readonly limiter: RateLimiter;
  private readonly audit: AuditLog;

  constructor(config: Config) {
    this.config = config;
    if (config.enforceSender) this.enforceSender = config.enforceSender;
    this.dryRun = config.dryRun;
    this.limiter = new RateLimiter(config.requestsPerSecond);
    this.audit = new AuditLog(config.auditLogPath);
  }

  async get<T>(path: string, query: Record<string, string | number | boolean> = {}): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) qs.set(k, String(v));
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.request<T>('GET', `${path}${suffix}`);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  /**
   * Walk a paginated collection to completion. Brevo caps most endpoints at
   * 50 or 500 per page, and every list in this codebase is bigger than that.
   */
  async getAll<T>(
    path: string,
    key: string,
    pageSize = 500,
    query: Record<string, string | number | boolean> = {},
    maxPages = 200,
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 0; page < maxPages; page += 1) {
      const res = await this.get<Record<string, unknown>>(path, {
        ...query,
        limit: pageSize,
        offset: page * pageSize,
      });
      const batch = res[key];
      if (!Array.isArray(batch) || batch.length === 0) return items;
      items.push(...(batch as T[]));
      if (batch.length < pageSize) return items;
    }
    throw new Error(
      `Pagination exceeded ${maxPages} pages on ${path}. Narrow the query rather than raising the cap.`,
    );
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const started = Date.now();

    if (this.dryRun && isMutating(method)) {
      await this.audit.record({
        ts: new Date().toISOString(),
        method,
        path,
        status: 'dry-run',
        durationMs: 0,
        attempts: 0,
      });
      throw new DryRunError(method, path);
    }

    let attempts = 0;
    let lastError: BrevoApiError | undefined;

    while (attempts <= this.config.maxRetries) {
      attempts += 1;
      await this.limiter.acquire();

      try {
        const { status, text, retryAfterMs } = await this.fetchOnce(method, path, body);

        if (status >= 200 && status < 300) {
          if (isMutating(method)) {
            await this.audit.record({
              ts: new Date().toISOString(),
              method,
              path,
              status,
              durationMs: Date.now() - started,
              attempts,
            });
          }
          if (!text) return undefined as T;
          try {
            return JSON.parse(text) as T;
          } catch {
            throw new BrevoApiError(status, 'bad_json', `Unparseable body: ${text.slice(0, 200)}`, attempts);
          }
        }

        lastError = toApiError(status, text, attempts);

        if (!isRetryable(status) || attempts > this.config.maxRetries) break;

        // Honour Retry-After when Brevo sends one; it knows better than our curve.
        await sleep(retryAfterMs ?? backoffDelay(attempts));
      } catch (err: unknown) {
        if (err instanceof BrevoApiError) {
          lastError = err;
          break;
        }
        const detail = err instanceof Error ? err.message : String(err);
        lastError = new BrevoApiError(0, 'network_error', `Could not reach Brevo: ${detail}`, attempts);
        if (attempts > this.config.maxRetries) break;
        await sleep(backoffDelay(attempts));
      }
    }

    const error = lastError ?? new BrevoApiError(0, 'unknown', 'Request failed', attempts);
    if (isMutating(method)) {
      await this.audit.record({
        ts: new Date().toISOString(),
        method,
        path,
        status: 'error',
        durationMs: Date.now() - started,
        attempts,
        detail: error.message,
      });
    }
    throw error;
  }

  private async fetchOnce(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; text: string; retryAfterMs?: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          'api-key': this.config.apiKey,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      const retryAfter = res.headers.get('retry-after');
      const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;
      return {
        status: res.status,
        text,
        ...(Number.isFinite(retryAfterMs) ? { retryAfterMs: retryAfterMs as number } : {}),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function toApiError(status: number, text: string, attempts: number): BrevoApiError {
  let code = 'unknown';
  let message = text || 'no response body';
  try {
    const parsed = JSON.parse(text) as Partial<BrevoError>;
    code = parsed.code ?? code;
    message = parsed.message ?? message;
  } catch {
    // Non-JSON error body; keep the raw text.
  }
  return new BrevoApiError(status, code, message, attempts);
}
