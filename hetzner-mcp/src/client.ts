import type { HcloudError, HcloudMeta } from "./types.js";

const API_BASE = "https://api.hetzner.cloud/v1";

/**
 * Which credential a call needs.
 *  - "read"  : the read-only token. Cannot mutate anything, so it is the default.
 *  - "write" : the read-write token. Absent token means the call refuses rather than
 *              silently falling back to read, which would produce a confusing 403.
 */
export type Scope = "read" | "write";

export class HetznerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "HetznerError";
  }
}

export class MissingTokenError extends Error {
  constructor(scope: Scope) {
    super(
      scope === "write"
        ? "HCLOUD_TOKEN_RW is not set. This server refuses write operations unless the read-write token is explicitly loaded. Decrypt secrets/hcloud.rw.sops.env and relaunch."
        : "HCLOUD_TOKEN_RO is not set. Decrypt secrets/hcloud.ro.sops.env and relaunch.",
    );
    this.name = "MissingTokenError";
  }
}

type ListEnvelope<T> = HcloudMeta & Readonly<Record<string, unknown>> & { readonly items?: T[] };

export class HetznerClient {
  private readonly readToken: string | undefined;
  private readonly writeToken: string | undefined;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.readToken = env.HCLOUD_TOKEN_RO?.trim() || undefined;
    this.writeToken = env.HCLOUD_TOKEN_RW?.trim() || undefined;
  }

  /** True when a read-write token is loaded. Tools use this to describe their own availability. */
  get canWrite(): boolean {
    return this.writeToken !== undefined;
  }

  private token(scope: Scope): string {
    const t = scope === "write" ? this.writeToken : this.readToken;
    if (t === undefined) throw new MissingTokenError(scope);
    return t;
  }

  async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: { scope: Scope; body?: unknown; query?: Record<string, string | number | undefined> } = {
      scope: "read",
    },
  ): Promise<T> {
    const url = new URL(`${API_BASE}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    // Resolve the credential BEFORE the fetch try-block, so a missing token surfaces as
    // MissingTokenError rather than being mislabelled a network failure.
    const bearer = this.token(opts.scope);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new HetznerError(`Network failure calling ${method} ${path}: ${reason}`, 0, "network_error");
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      throw new HetznerError(
        `Hetzner returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`,
        res.status,
        "bad_response",
      );
    }

    if (!res.ok) {
      const err = (parsed as { error?: HcloudError }).error;
      const code = err?.code ?? "unknown";
      const detail = err?.message ?? text.slice(0, 300);
      const hint =
        res.status === 401
          ? " (token invalid or revoked)"
          : res.status === 403
            ? " (token lacks write permission — is HCLOUD_TOKEN_RW actually a read-write token?)"
            : res.status === 429
              ? " (rate limited; Hetzner allows 3600 requests/hour)"
              : "";
      throw new HetznerError(`${method} ${path} failed: ${detail}${hint}`, res.status, code);
    }

    return parsed as T;
  }

  /** Follow pagination to completion. Hetzner caps per_page at 50. */
  async listAll<T>(path: string, key: string, query: Record<string, string | number | undefined> = {}): Promise<T[]> {
    const out: T[] = [];
    let page = 1;
    for (;;) {
      const env = await this.request<ListEnvelope<T>>("GET", path, {
        scope: "read",
        query: { ...query, page, per_page: 50 },
      });
      const batch = env[key];
      if (Array.isArray(batch)) out.push(...(batch as T[]));
      // Pagination is nested under `meta`. Reading it from the top level silently
      // truncates every list at the first page of 50.
      const next = env.meta?.pagination?.next_page;
      if (next === null || next === undefined) break;
      page = next;
      if (page > 200) break; // hard stop; no silent infinite loop
    }
    return out;
  }
}
