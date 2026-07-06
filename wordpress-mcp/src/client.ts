import { WPError } from './types.js';

interface ClientConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
  wcConsumerKey?: string;
  wcConsumerSecret?: string;
  cfApiToken?: string;
  cfZoneId?: string;
}

export class WordPressClient {
  private readonly wpBase: string;
  private readonly wpRoot: string;
  private readonly wcBase: string;
  private readonly wpAuthHeader: string;
  private readonly wcConsumerKey: string;
  private readonly wcConsumerSecret: string;
  private readonly cfApiToken: string;
  private readonly cfZoneId: string;

  constructor(config: ClientConfig) {
    const url = config.baseUrl.replace(/\/$/, '');
    this.wpRoot = `${url}/wp-json`;
    this.wpBase = `${url}/wp-json/wp/v2`;
    this.wcBase = `${url}/wp-json/wc/v3`;
    this.wpAuthHeader =
      'Basic ' +
      Buffer.from(`${config.username}:${config.appPassword}`).toString('base64');
    this.wcConsumerKey = config.wcConsumerKey ?? '';
    this.wcConsumerSecret = config.wcConsumerSecret ?? '';
    this.cfApiToken = config.cfApiToken ?? '';
    this.cfZoneId = config.cfZoneId ?? '';
  }

  // ─── WordPress REST API ───────────────────────────────────────────────────

  async get<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      qs.set(k, String(v));
    }
    const url = `${this.wpBase}${path}${qs.toString() ? `?${qs}` : ''}`;
    return this.request<T>(url, { method: 'GET' }, 'wp');
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.wpBase}${path}`;
    return this.request<T>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    }, 'wp');
  }

  async patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.wpBase}${path}`;
    return this.request<T>(url, {
      method: 'POST', // WP REST uses POST for updates when method override not available
      headers: { 'X-HTTP-Method-Override': 'PATCH' },
      body: JSON.stringify(body),
    }, 'wp');
  }

  async delete<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      qs.set(k, String(v));
    }
    const url = `${this.wpBase}${path}${qs.toString() ? `?${qs}` : ''}`;
    return this.request<T>(url, { method: 'DELETE' }, 'wp');
  }

  // Upload raw binary (for media)
  async upload<T>(path: string, filename: string, mimeType: string, data: Buffer): Promise<T> {
    const url = `${this.wpBase}${path}`;
    return this.request<T>(url, {
      method: 'POST',
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': mimeType,
      },
      body: data,
    }, 'wp', false);
  }

  // ─── Custom REST namespaces (e.g. agent-cache/v1) ─────────────────────────

  async getRoot<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      qs.set(k, String(v));
    }
    const url = `${this.wpRoot}${path}${qs.toString() ? `?${qs}` : ''}`;
    return this.request<T>(url, { method: 'GET' }, 'wp');
  }

  async postRoot<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.wpRoot}${path}`;
    return this.request<T>(url, { method: 'POST', body: JSON.stringify(body) }, 'wp');
  }

  /**
   * Raw escape hatch: call any WordPress REST route under /wp-json with any
   * method and body. Powers the full-control wp_rest_request tool.
   */
  async raw<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    params: Record<string, string | number | boolean> = {},
    body?: Record<string, unknown>,
  ): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      qs.set(k, String(v));
    }
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const url = `${this.wpRoot}${normalized}${qs.toString() ? `?${qs}` : ''}`;
    const init: RequestInit = { method };
    if (body !== undefined) init.body = JSON.stringify(body);
    return this.request<T>(url, init, 'wp');
  }

  // ─── Cloudflare edge cache ────────────────────────────────────────────────

  /**
   * Purge Cloudflare's edge cache. Cloudflare sits above the origin, so origin
   * plugins cannot evict it — this hits the Cloudflare API directly.
   */
  async cloudflarePurge(opts: { files?: string[]; everything?: boolean }): Promise<unknown> {
    if (!this.cfApiToken || !this.cfZoneId) {
      throw new Error(
        'Cloudflare not configured. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID in .env.',
      );
    }
    const payload =
      opts.everything || !opts.files?.length
        ? { purge_everything: true }
        : { files: opts.files };

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${this.cfZoneId}/purge_cache`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    const json = (await res.json()) as { success: boolean; errors?: unknown[] };
    if (!res.ok || !json.success) {
      throw new Error(`Cloudflare purge failed: ${JSON.stringify(json.errors ?? json)}`);
    }
    return json;
  }

  cloudflareConfigured(): boolean {
    return Boolean(this.cfApiToken && this.cfZoneId);
  }

  // ─── WooCommerce REST API ─────────────────────────────────────────────────

  async wcGet<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
    this.assertWcCredentials();
    const qs = new URLSearchParams({
      consumer_key: this.wcConsumerKey,
      consumer_secret: this.wcConsumerSecret,
    });
    for (const [k, v] of Object.entries(params)) {
      qs.set(k, String(v));
    }
    const url = `${this.wcBase}${path}?${qs}`;
    return this.request<T>(url, { method: 'GET' }, 'wc');
  }

  async wcPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    this.assertWcCredentials();
    const qs = new URLSearchParams({
      consumer_key: this.wcConsumerKey,
      consumer_secret: this.wcConsumerSecret,
    });
    const url = `${this.wcBase}${path}?${qs}`;
    return this.request<T>(url, {
      method: 'POST',
      body: JSON.stringify(body),
    }, 'wc');
  }

  async wcPut<T>(path: string, body: Record<string, unknown>): Promise<T> {
    this.assertWcCredentials();
    const qs = new URLSearchParams({
      consumer_key: this.wcConsumerKey,
      consumer_secret: this.wcConsumerSecret,
    });
    const url = `${this.wcBase}${path}?${qs}`;
    return this.request<T>(url, {
      method: 'PUT',
      body: JSON.stringify(body),
    }, 'wc');
  }

  async wcDelete<T>(path: string, force = false): Promise<T> {
    this.assertWcCredentials();
    const qs = new URLSearchParams({
      consumer_key: this.wcConsumerKey,
      consumer_secret: this.wcConsumerSecret,
      ...(force ? { force: 'true' } : {}),
    });
    const url = `${this.wcBase}${path}?${qs}`;
    return this.request<T>(url, { method: 'DELETE' }, 'wc');
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async request<T>(
    url: string,
    init: RequestInit,
    auth: 'wp' | 'wc',
    addContentType = true,
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> ?? {}),
    };

    if (auth === 'wp') {
      headers['Authorization'] = this.wpAuthHeader;
    }

    if (addContentType && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, { ...init, headers });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status} ${res.statusText}`;
      try {
        const err = (await res.json()) as WPError;
        errMsg = `[${err.code}] ${err.message}`;
      } catch {
        // ignore JSON parse error
      }
      throw new Error(errMsg);
    }

    return res.json() as Promise<T>;
  }

  private assertWcCredentials(): void {
    if (!this.wcConsumerKey || !this.wcConsumerSecret) {
      throw new Error(
        'WooCommerce API keys not configured. Set WC_CONSUMER_KEY and WC_CONSUMER_SECRET in .env.',
      );
    }
  }
}
