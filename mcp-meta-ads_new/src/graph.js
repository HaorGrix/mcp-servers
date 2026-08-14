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
    /** Latest Meta rate-limit usage, parsed from response headers (0-100). */
    this.usage = { app: 0, adAccount: 0, businessUseCase: 0, updatedAt: null };
  }

  /**
   * Reads Meta's usage headers and records the worst percentage seen, so callers can
   * throttle before hitting a hard block. Meta returns these as JSON strings.
   * @param {Headers} headers
   */
  trackUsage(headers) {
    const worst = (raw, pick) => {
      if (!raw) return 0;
      try {
        const parsed = JSON.parse(raw);
        const rows = Array.isArray(parsed) ? parsed : Object.values(parsed).flat();
        return rows.reduce((m, r) => Math.max(m, pick(r)), 0);
      } catch {
        return 0;
      }
    };
    const appPct = worst(headers.get("x-app-usage"), (r) => Math.max(r.call_count ?? 0, r.total_cputime ?? 0, r.total_time ?? 0));
    const acctPct = worst(headers.get("x-ad-account-usage"), (r) => r.acc_id_util_pct ?? 0);
    const bucPct = worst(headers.get("x-business-use-case-usage"), (r) => Math.max(r.call_count ?? 0, r.total_cputime ?? 0, r.total_time ?? 0));
    this.usage = { app: appPct, adAccount: acctPct, businessUseCase: bucPct, updatedAt: Date.now() };
  }

  /** Worst current usage percentage across all buckets. */
  peakUsage() {
    return Math.max(this.usage.app, this.usage.adAccount, this.usage.businessUseCase);
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

      // Proactive throttle: if Meta says we are near the ceiling, slow down before
      // it hard-blocks us. Enterprise accounts hit this at agency scale.
      const peak = this.peakUsage();
      if (peak >= 95) await sleep(2000);
      else if (peak >= 80) await sleep(500);

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

        this.trackUsage(res.headers);
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
   * Async insights report: submit the job, poll until complete, then page the result.
   * For heavy historical pulls that time out synchronously. Bounded polling so it can
   * never hang forever.
   * @param {string} path e.g. "act_123/insights"
   * @param {Record<string, string | number>} params
   * @returns {Promise<{ data: any[], pages: number, report_run_id: string }>}
   */
  async asyncReport(path, params = {}) {
    const submit = await this.request(path, {}, { method: "POST", body: params });
    const runId = submit.report_run_id;
    if (!runId) throw new GraphError("Async report did not return a report_run_id.", { path });

    const maxPolls = 30;
    for (let i = 0; i < maxPolls; i++) {
      const status = await this.request(runId, { fields: "async_status,async_percent_completion" });
      if (status.async_status === "Job Completed") {
        const out = await this.paginate(`${runId}/insights`, {});
        return { data: out.data, pages: out.pages, report_run_id: runId };
      }
      if (status.async_status === "Job Failed" || status.async_status === "Job Skipped") {
        throw new GraphError(`Async report ${status.async_status} (run ${runId}).`, { path });
      }
      await sleep(Math.min(2000 + i * 500, 8000));
    }
    throw new GraphError(`Async report did not complete after ${maxPolls} polls (run ${runId}).`, { path });
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
