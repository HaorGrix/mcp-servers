import { GoogleAuth } from 'google-auth-library';
import type { Config } from './config.js';
import { redact } from './config.js';

const SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

/**
 * Provider error surfaced to the caller.
 *
 * Carries status + provider message ONLY. Raw bodies and request headers never
 * reach the model: provider error text has leaked internals before, and an error
 * body is exactly where a token echo would hide.
 */
export class ApiKeysError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryable: boolean,
  ) {
    super(`Google API Keys ${status}: ${redact(message)}`);
    this.name = 'ApiKeysError';
  }
}

/** Thrown when we ran out of retries against a throttling provider. */
export class ThrottledError extends ApiKeysError {
  constructor(attempts: number) {
    super(429, `rate limited after ${attempts} attempts — result is UNKNOWN, not empty`, false);
    this.name = 'ThrottledError';
  }
}

interface PageResponse<T> {
  items: T[];
  nextPageToken?: string;
}

export class ApiKeysClient {
  private readonly auth: GoogleAuth;

  constructor(private readonly config: Config) {
    this.auth = new GoogleAuth({
      scopes: SCOPES,
      ...(config.credentialsPath ? { keyFile: config.credentialsPath } : {}),
    });
  }

  /** Verifies credentials resolve at boot rather than on the first tool call. */
  async whoami(): Promise<string> {
    const client = await this.auth.getClient();
    const email = (client as { email?: string }).email;
    return email ?? '(application default credentials)';
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
  ): Promise<{ data: T; status: number }> {
    let attempt = 0;
    // Retry only on throttling and transient server faults. A 403 is a real
    // answer about permissions and must surface immediately, not after 3 waits.
    for (;;) {
      attempt += 1;
      const token = await this.auth.getAccessToken();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        });
      } catch (err: unknown) {
        clearTimeout(timer);
        if (attempt > this.config.maxRetries) {
          const detail = err instanceof Error ? err.message : String(err);
          throw new ApiKeysError(0, `network failure: ${detail}`, false);
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
      // A throttle that exhausted retries must NOT look like an empty result.
      // An agent that reads "empty" concludes the resource is gone and creates
      // a duplicate — so this is raised loudly as unknown state.
      if (res.status === 429) throw new ThrottledError(attempt);
      throw new ApiKeysError(res.status, message, retryable);
    }
  }

  /**
   * Follows pageToken to exhaustion, capped at `GCP_PAGE_LIMIT` items.
   * Returns `truncated` so a caller can tell a full list from a capped one.
   */
  async listAll<T>(
    url: string,
    itemsKey: string,
    pageSize?: number,
  ): Promise<{ items: T[]; truncated: boolean }> {
    const cap = pageSize ?? this.config.pageLimit;
    const items: T[] = [];
    let pageToken: string | undefined;
    do {
      const sep = url.includes('?') ? '&' : '?';
      const paged = pageToken ? `${url}${sep}pageToken=${encodeURIComponent(pageToken)}` : url;
      const { data } = await this.request<Record<string, unknown>>('GET', paged);
      const page = (data[itemsKey] as T[] | undefined) ?? [];
      items.push(...page);
      pageToken = data['nextPageToken'] as string | undefined;
      if (items.length >= cap) return { items: items.slice(0, cap), truncated: true };
    } while (pageToken);
    return { items, truncated: false };
  }
}

/** Exponential backoff with jitter, so parallel servers do not resonate. */
async function backoff(attempt: number): Promise<void> {
  const base = Math.min(1_000 * 2 ** (attempt - 1), 8_000);
  const jitter = Math.random() * 250;
  await new Promise((resolve) => setTimeout(resolve, base + jitter));
}

/** Extracts the provider's own message, discarding the rest of the body. */
async function providerMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

export type { PageResponse };
