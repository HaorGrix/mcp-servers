/**
 * Graph API client: GET/POST/DELETE with bounded backoff, rate-limit header
 * tracking, cursor pagination, page-token derivation, scope checks and token
 * redaction. Knows nothing about MCP.
 */
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Config } from "./config.js";

const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);
const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);

export type Params = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  /** JSON body for POST. Nested objects are serialised as JSON strings, which Graph expects. */
  body?: Record<string, unknown>;
  /** Use a different access token (e.g. a Page token). */
  token?: string;
  /** Hit graph.facebook.com/<version> by default; set for graph-video.facebook.com etc. */
  host?: string;
}

export interface Paged<T> {
  data?: T[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string; previous?: string };
}

export interface Usage {
  app: number;
  adAccount: number;
  businessUseCase: number;
  updatedAt: number | null;
}

export class GraphError extends Error {
  constructor(
    message: string,
    readonly meta: { code?: number; subcode?: number; type?: string; status?: number; path?: string; traceId?: string; userMessage?: string } = {},
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export class GraphClient {
  usage: Usage = { app: 0, adAccount: 0, businessUseCase: 0, updatedAt: null };
  private pageTokens = new Map<string, string>();
  private scopes: Set<string> | null = null;

  constructor(readonly config: Config) {}

  // ── Scopes ────────────────────────────────────────────────────────────────

  async grantedScopes(): Promise<Set<string>> {
    if (this.scopes) return this.scopes;
    const res = await this.get<Paged<{ permission: string; status: string }>>("me/permissions");
    this.scopes = new Set((res.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission));
    return this.scopes;
  }

  /** Throw a clear error if any of the listed scopes is missing from the token. */
  async requireScopes(...needed: string[]): Promise<void> {
    const have = await this.grantedScopes();
    const missing = needed.filter((s) => !have.has(s));
    if (missing.length) {
      throw new GraphError(
        `This tool needs the ${missing.join(", ")} permission${missing.length > 1 ? "s" : ""}, which the token does not have. ` +
          `Grant it to the System User in Business Manager (and request advanced access in App Review if required), then mint a new token.`,
        { code: -1, type: "MissingScope" },
      );
    }
  }

  // ── Page tokens ───────────────────────────────────────────────────────────

  /** Page access token for a Page the System User manages. Cached. */
  async pageToken(pageId: string): Promise<string> {
    const cached = this.pageTokens.get(pageId);
    if (cached) return cached;
    const res = await this.get<{ access_token?: string }>(`${pageId}`, { fields: "access_token" });
    if (!res.access_token) {
      throw new GraphError(`No Page token for ${pageId}; the System User must be assigned this Page with full control.`, { code: -1 });
    }
    this.pageTokens.set(pageId, res.access_token);
    return res.access_token;
  }

  // ── Core request ──────────────────────────────────────────────────────────

  private appSecretProof(token: string): string | undefined {
    if (!this.config.appSecret) return undefined;
    return createHmac("sha256", this.config.appSecret).update(token).digest("hex");
  }

  private trackUsage(headers: Headers): void {
    const worst = (raw: string | null, pick: (r: Record<string, number>) => number): number => {
      if (!raw) return 0;
      try {
        const parsed = JSON.parse(raw) as unknown;
        const rows: Record<string, number>[] = Array.isArray(parsed)
          ? (parsed as Record<string, number>[])
          : (Object.values(parsed as Record<string, unknown>).flat() as Record<string, number>[]);
        return rows.reduce((m, r) => Math.max(m, pick(r)), 0);
      } catch {
        return 0;
      }
    };
    const cpu = (r: Record<string, number>) => Math.max(r["call_count"] ?? 0, r["total_cputime"] ?? 0, r["total_time"] ?? 0);
    this.usage = {
      app: worst(headers.get("x-app-usage"), cpu),
      adAccount: worst(headers.get("x-ad-account-usage"), (r) => r["acc_id_util_pct"] ?? 0),
      businessUseCase: worst(headers.get("x-business-use-case-usage"), cpu),
      updatedAt: Date.now(),
    };
  }

  peakUsage(): number {
    return Math.max(this.usage.app, this.usage.adAccount, this.usage.businessUseCase);
  }

  private redact(text: string): string {
    let out = text.split(this.config.token).join("***TOKEN***");
    for (const t of this.pageTokens.values()) out = out.split(t).join("***PAGE_TOKEN***");
    return out.replace(/EAA[A-Za-z0-9]{40,}/g, "***TOKEN***");
  }

  async request<T>(path: string, params: Params = {}, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? "GET";
    const token = opts.token ?? this.config.token;
    const host = opts.host ?? this.config.baseUrl;
    const url = new URL(`${host}/${path.replace(/^\//, "")}`);
    url.searchParams.set("access_token", token);
    const proof = this.appSecretProof(token);
    if (proof) url.searchParams.set("appsecret_proof", proof);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }

    let body: string | undefined;
    if (method === "POST") {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.body ?? {})) {
        if (v === undefined || v === null) continue;
        form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      }
      body = form.toString();
    }

    let last: GraphError | undefined;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      if (attempt > 0) await sleep(500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
      const peak = this.peakUsage();
      if (peak >= 95) await sleep(2000);
      else if (peak >= 80) await sleep(500);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const res = await fetch(url, {
          method,
          signal: controller.signal,
          headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
          body,
        });
        this.trackUsage(res.headers);
        const text = await res.text();
        let payload: unknown;
        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          throw new GraphError(`Graph returned non-JSON (HTTP ${res.status}): ${this.redact(text.slice(0, 300))}`, { status: res.status, path });
        }
        const errBody = (payload as { error?: Record<string, unknown> }).error;
        if (errBody) {
          const err = new GraphError(this.redact(String(errBody["message"] ?? "Unknown Graph error")), {
            code: errBody["code"] as number | undefined,
            subcode: errBody["error_subcode"] as number | undefined,
            type: errBody["type"] as string | undefined,
            status: res.status,
            path,
            traceId: errBody["fbtrace_id"] as string | undefined,
            userMessage: errBody["error_user_msg"] as string | undefined,
          });
          const policyGate = err.meta.code === 2 && Boolean(err.meta.userMessage);
          const retry = !policyGate && (RETRYABLE_CODES.has(err.meta.code ?? -1) || RETRYABLE_HTTP.has(res.status));
          if (!retry || attempt === this.config.maxRetries) throw err;
          last = err;
          continue;
        }
        if (!res.ok) {
          const err = new GraphError(`HTTP ${res.status}: ${this.redact(text.slice(0, 300))}`, { status: res.status, path });
          if (!RETRYABLE_HTTP.has(res.status) || attempt === this.config.maxRetries) throw err;
          last = err;
          continue;
        }
        return payload as T;
      } catch (err: unknown) {
        if (err instanceof GraphError) throw err;
        const detail = err instanceof Error ? err.message : String(err);
        last = new GraphError(`Network error calling ${path}: ${this.redact(detail)}`, { path });
        if (attempt === this.config.maxRetries) throw last;
      } finally {
        clearTimeout(timer);
      }
    }
    throw last ?? new GraphError(`Request to ${path} failed`, { path });
  }

  get<T>(path: string, params: Params = {}, opts: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
    return this.request<T>(path, params, { ...opts, method: "GET" });
  }

  post<T = { id?: string; success?: boolean }>(path: string, body: Record<string, unknown> = {}, opts: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
    return this.request<T>(path, {}, { ...opts, method: "POST", body });
  }

  delete<T = { success?: boolean }>(path: string, params: Params = {}, opts: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
    return this.request<T>(path, params, { ...opts, method: "DELETE" });
  }

  /** Multipart POST with a local file (WhatsApp media, Page photos/videos, Reels chunks). */
  async upload<T>(path: string, filePath: string, fileField: string, fields: Record<string, unknown> = {}, opts: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
    const token = opts.token ?? this.config.token;
    const host = opts.host ?? this.config.baseUrl;
    const url = new URL(`${host}/${path.replace(/^\//, "")}`);
    url.searchParams.set("access_token", token);
    const proof = this.appSecretProof(token);
    if (proof) url.searchParams.set("appsecret_proof", proof);
    const buf = await readFile(filePath);
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    form.set(fileField, new Blob([buf]), basename(filePath));
    const res = await fetch(url, { method: "POST", body: form });
    this.trackUsage(res.headers);
    const text = await res.text();
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : {}; } catch { throw new GraphError(`Upload returned non-JSON (HTTP ${res.status}): ${this.redact(text.slice(0, 300))}`, { status: res.status, path }); }
    const errBody = (payload as { error?: Record<string, unknown> }).error;
    if (errBody) throw new GraphError(this.redact(String(errBody["message"] ?? "Upload failed")), { code: errBody["code"] as number | undefined, subcode: errBody["error_subcode"] as number | undefined, status: res.status, path, traceId: errBody["fbtrace_id"] as string | undefined, userMessage: errBody["error_user_msg"] as string | undefined });
    return payload as T;
  }

  /** Raw binary POST (resumable upload chunks). */
  async uploadBinary<T>(url: string, body: Buffer, headers: Record<string, string>): Promise<T> {
    const res = await fetch(url, { method: "POST", body, headers });
    const text = await res.text();
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : {}; } catch { throw new GraphError(`Binary upload returned non-JSON (HTTP ${res.status}): ${this.redact(text.slice(0, 300))}`, { status: res.status }); }
    const errBody = (payload as { error?: Record<string, unknown> }).error;
    if (errBody) throw new GraphError(this.redact(String(errBody["message"] ?? "Upload failed")), { code: errBody["code"] as number | undefined, status: res.status });
    return payload as T;
  }

  /** Graph batch API: up to 50 requests in one round trip. */
  async batch(requests: Array<{ method: "GET" | "POST" | "DELETE"; relative_url: string; body?: Record<string, unknown>; name?: string; depends_on?: string }>, opts: { token?: string } = {}): Promise<Array<{ code: number; body: unknown }>> {
    const prepared = requests.map((r) => ({ ...r, body: r.body ? new URLSearchParams(Object.entries(r.body).map(([k, v]): [string, string] => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])).toString() : undefined }));
    const res = await this.request<Array<{ code: number; body: string } | null>>("", {}, { method: "POST", body: { batch: prepared, include_headers: false }, token: opts.token });
    return res.map((r) => (r ? { code: r.code, body: safeJson(r.body) } : { code: 0, body: null }));
  }

  /** Walk a paginated edge up to `maxPages` pages. */
  async getAll<T>(path: string, params: Params = {}, opts: Omit<RequestOptions, "method" | "body"> = {}, maxPages = 20): Promise<T[]> {
    const items: T[] = [];
    let after: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const res = await this.get<Paged<T>>(path, { limit: 100, ...params, ...(after ? { after } : {}) }, opts);
      if (res.data?.length) items.push(...res.data);
      after = res.paging?.cursors?.after;
      if (!res.paging?.next || !after) break;
    }
    return items;
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
