import type { Config } from './config.js';
import { redact } from './config.js';

/**
 * Provider error surfaced to the caller: status plus the provider's own message
 * only. Never a raw body, never request headers — an error body is exactly
 * where a connection string echo would hide.
 */
export class OpenRouterError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryable: boolean,
  ) {
    super(`OpenRouter ${status}: ${redact(message)}`);
    this.name = 'OpenRouterError';
  }
}

/** Ran out of retries against a throttling provider. UNKNOWN state, not empty. */
export class ThrottledError extends OpenRouterError {
  constructor(attempts: number) {
    super(429, `rate limited after ${attempts} attempts — result is UNKNOWN, not empty`, false);
    this.name = 'ThrottledError';
  }
}

export class OpenRouterClient {
  constructor(private readonly config: Config) {}

  /** Cheap authenticated call, so bad credentials fail at boot not mid-task. */
  async whoami(): Promise<string> {
    const { data } = await this.request<{ projects?: { id: string }[] }>('GET', '/projects?limit=1');
    return `${data.projects?.length ?? 0} project(s) visible`;
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ data: T; status: number }> {
    const url = `${this.config.baseUrl}${path}`;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        });
      } catch (err: unknown) {
        clearTimeout(timer);
        if (attempt > this.config.maxRetries) {
          const detail = err instanceof Error ? err.message : String(err);
          throw new OpenRouterError(0, `network failure: ${detail}`, false);
        }
        await backoff(attempt);
        continue;
      }
      clearTimeout(timer);

      if (res.ok) {
        const data = res.status === 204 ? ({} as T) : ((await res.json()) as T);
        return { data, status: res.status };
      }

      const message = await providerMessage(res);
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt <= this.config.maxRetries) {
        await backoff(attempt);
        continue;
      }
      if (res.status === 429) throw new ThrottledError(attempt);
      throw new OpenRouterError(res.status, message, retryable);
    }
  }

  /**
   * Neon paginates operations with a cursor. Capped at NEON_PAGE_LIMIT and
   * returns `truncated` so a caller can tell a full list from a capped one.
   */
  async listPaged<T>(
    path: string,
    itemsKey: string,
    limit?: number,
  ): Promise<{ items: T[]; truncated: boolean }> {
    const cap = limit ?? this.config.pageLimit;
    const items: T[] = [];
    let cursor: string | undefined;
    for (;;) {
      const sep = path.includes('?') ? '&' : '?';
      const paged = cursor ? `${path}${sep}cursor=${encodeURIComponent(cursor)}` : path;
      const { data } = await this.request<Record<string, unknown>>('GET', paged);
      const page = (data[itemsKey] as T[] | undefined) ?? [];
      items.push(...page);
      const pagination = data['pagination'] as { cursor?: string } | undefined;
      cursor = pagination?.cursor;
      if (items.length >= cap) return { items: items.slice(0, cap), truncated: true };
      if (!cursor || page.length === 0) return { items, truncated: false };
    }
  }
}

async function backoff(attempt: number): Promise<void> {
  const base = Math.min(1_000 * 2 ** (attempt - 1), 8_000);
  await new Promise((resolve) => setTimeout(resolve, base + Math.random() * 250));
}

async function providerMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
