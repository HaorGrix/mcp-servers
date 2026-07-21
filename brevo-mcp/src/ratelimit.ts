/**
 * Token bucket. Brevo throttles per-endpoint and answers 429 when exceeded;
 * pacing locally is cheaper than burning retries discovering the limit.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;

  constructor(requestsPerSecond: number, now: number = Date.now()) {
    this.capacity = requestsPerSecond;
    this.tokens = requestsPerSecond;
    this.refillPerMs = requestsPerSecond / 1000;
    this.lastRefill = now;
  }

  /** Milliseconds the caller must wait before a token is available. */
  reserve(now: number = Date.now()): number {
    const elapsed = Math.max(0, now - this.lastRefill);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    const deficit = 1 - this.tokens;
    this.tokens = 0;
    return Math.ceil(deficit / this.refillPerMs);
  }

  async acquire(): Promise<void> {
    const waitMs = this.reserve();
    if (waitMs > 0) await sleep(waitMs);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with full jitter. Jitter matters because several tools
 * can retry at once; without it they resynchronise and hammer the same second.
 */
export function backoffDelay(attempt: number, baseMs = 500, capMs = 20_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exponential);
}

/** 429 and 5xx are worth retrying. 4xx client errors are not. */
export function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}
