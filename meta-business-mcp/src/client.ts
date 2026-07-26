/** Thin Graph API client with retry on transient failures and secret redaction. */

export interface Config {
  token: string;
  version: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env["META_ACCESS_TOKEN"]?.trim();
  if (!token) {
    throw new Error("META_ACCESS_TOKEN is required. Copy .env.example to .env and fill it in.");
  }
  return { token, version: (env["META_API_VERSION"] ?? "v21.0").trim() };
}

export class GraphError extends Error {
  constructor(readonly status: number, readonly code: number | string, message: string) {
    super(`Graph API ${status} (${code}): ${message}`);
    this.name = "GraphError";
  }
}

export class MetaClient {
  private readonly base: string;
  constructor(private readonly config: Config) {
    this.base = `https://graph.facebook.com/${config.version}`;
  }

  private pageTokens: Record<string, string> = {};

  /** Resolve a page's own access token, needed for its posts/feed. Cached. */
  async pageToken(pageId: string): Promise<string> {
    if (this.pageTokens[pageId]) return this.pageTokens[pageId];
    const res = await this.get<{ data: Array<{ id: string; access_token: string }> }>(
      "me/accounts", { fields: "id,access_token", limit: 200 },
    );
    for (const p of res.data ?? []) this.pageTokens[p.id] = p.access_token;
    const tok = this.pageTokens[pageId];
    if (!tok) throw new GraphError(0, "no_page_token", `No page token for ${pageId}; token may not manage this page.`);
    return tok;
  }

  /** GET a node/edge. `params` are query fields; the token is added automatically.
   * Pass a value under the reserved `_token` key to send a different access token. */
  async get<T>(path: string, params: Record<string, string | number> = {}, tries = 3): Promise<T> {
    const override = params["_token"];
    const token = typeof override === "string" && override ? override : this.config.token;
    const qs = new URLSearchParams({ access_token: token });
    for (const [k, v] of Object.entries(params)) {
      if (k === "_token") continue;
      qs.set(k, String(v));
    }
    const url = `${this.base}/${path.replace(/^\//, "")}?${qs}`;

    let last = "";
    for (let attempt = 0; attempt < tries; attempt += 1) {
      let res: Response;
      try {
        res = await fetch(url);
      } catch (err: unknown) {
        last = err instanceof Error ? err.message : String(err);
        await sleep(500 * (attempt + 1));
        continue;
      }
      const text = await res.text();
      if (res.ok) {
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new GraphError(res.status, "bad_json", text.slice(0, 200));
        }
      }
      let code: number | string = "unknown";
      let message = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { error?: { code?: number; message?: string } };
        code = parsed.error?.code ?? code;
        message = parsed.error?.message ?? message;
      } catch {
        // keep raw text
      }
      // 1 and 2 are transient Graph errors; 4/17/613 are rate limits.
      const transient = [1, 2, 4, 17, 341, 613].includes(Number(code)) || res.status >= 500;
      if (!transient || attempt === tries - 1) {
        throw new GraphError(res.status, code, redact(message, this.config.token));
      }
      last = message;
      await sleep(1000 * (attempt + 1));
    }
    throw new GraphError(0, "exhausted", redact(last, this.config.token));
  }

  /** Walk all pages of a paginated edge, up to a cap. */
  async getAll<T>(path: string, params: Record<string, string | number> = {}, maxPages = 20): Promise<T[]> {
    const items: T[] = [];
    let after: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const p = { ...params, limit: params["limit"] ?? 100, ...(after ? { after } : {}) };
      const res = await this.get<{ data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, p);
      if (res.data?.length) items.push(...res.data);
      const next = res.paging?.next;
      after = res.paging?.cursors?.after;
      if (!next || !after) break;
    }
    return items;
  }
}

function redact(input: string, token: string): string {
  return token ? input.split(token).join("***TOKEN***") : input;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
