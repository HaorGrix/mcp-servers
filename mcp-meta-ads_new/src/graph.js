/**
 * Meta Graph API client: retries, cursor pagination, and error normalisation.
 * Knows nothing about MCP — it is a plain data layer.
 */

/** Graph error codes that are worth retrying rather than surfacing. */
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);
const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);

export class GraphError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: number, subcode?: number, type?: string, status?: number, path?: string, traceId?: string }} meta
   */
  constructor(message, meta = {}) {
    super(message);
    this.name = "GraphError";
    Object.assign(this, meta);
  }
}

export class GraphClient {
  /** @param {import("./config.js").Config} config */
  constructor(config) {
    this.config = config;
  }

  /**
   * Single Graph request with bounded exponential backoff.
   * @param {string} path e.g. "act_123/campaigns"
   * @param {Record<string, string | number>} params
   * @param {{ method?: "GET" | "POST", body?: object }} opts
   * @returns {Promise<any>}
   */
  async request(path, params = {}, opts = {}) {
    const method = opts.method ?? "GET";
    const url = new URL(`${this.config.baseUrl}/${String(path).replace(/^\//, "")}`);

    if (method === "GET") {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
      }
    }

    let lastError;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        // 0.5s, 1s, 2s, 4s — plus jitter so parallel callers don't sync up.
        const backoff = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
        await sleep(backoff);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const res = await fetch(url, {
          method,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.config.accessToken}`,
            ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
          },
          ...(method === "POST" ? { body: JSON.stringify(opts.body ?? {}) } : {}),
        });

        const text = await res.text();
        let payload;
        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          throw new GraphError(`Graph returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`, {
            status: res.status,
            path,
          });
        }

        if (payload?.error) {
          const e = payload.error;
          const err = new GraphError(e.message ?? "Unknown Graph error", {
            code: e.code,
            subcode: e.error_subcode,
            type: e.type,
            status: res.status,
            path,
            traceId: e.fbtrace_id,
          });
          if (RETRYABLE_CODES.has(e.code) || RETRYABLE_HTTP.has(res.status)) {
            lastError = err;
            continue;
          }
          throw err;
        }

        if (!res.ok) {
          const err = new GraphError(`HTTP ${res.status} from Graph`, { status: res.status, path });
          if (RETRYABLE_HTTP.has(res.status)) {
            lastError = err;
            continue;
          }
          throw err;
        }

        return payload;
      } catch (err) {
        if (err instanceof GraphError && !RETRYABLE_CODES.has(err.code) && !RETRYABLE_HTTP.has(err.status)) {
          throw err;
        }
        // Network failure or abort — retry until the budget is gone.
        lastError = err instanceof Error ? err : new Error(String(err));
      } finally {
        clearTimeout(timer);
      }
    }

    throw new GraphError(
      `Graph request failed after ${this.config.maxRetries + 1} attempts: ${lastError?.message ?? "unknown"}`,
      { path, code: lastError?.code, subcode: lastError?.subcode, traceId: lastError?.traceId },
    );
  }

  /**
   * Follows `paging.next` until exhausted, so callers never silently see page 1 only.
   * @param {string} path
   * @param {Record<string, string | number>} params
   * @returns {Promise<{ data: any[], pages: number, truncated: boolean }>}
   */
  async paginate(path, params = {}) {
    const collected = [];
    let page = await this.request(path, { limit: this.config.pageLimit, ...params });
    let pages = 1;

    collected.push(...(page.data ?? []));

    while (page?.paging?.next) {
      if (pages >= this.config.maxPages) {
        return { data: collected, pages, truncated: true };
      }
      page = await this.requestAbsolute(page.paging.next);
      pages++;
      collected.push(...(page.data ?? []));
    }

    return { data: collected, pages, truncated: false };
  }

  /**
   * Fetches a fully-formed Graph URL (used for `paging.next`, which already carries
   * the cursor and every original query param).
   * @param {string} absoluteUrl
   */
  async requestAbsolute(absoluteUrl) {
    const u = new URL(absoluteUrl);
    const params = Object.fromEntries(u.searchParams.entries());
    delete params.access_token;
    return this.request(u.pathname.replace(/^\/v\d+\.\d+\//, ""), params);
  }
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
