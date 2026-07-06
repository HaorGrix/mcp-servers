import https from 'node:https';
import type { UAPIResponse } from './types.js';

interface ClientConfig {
  host: string;
  username: string;
  password: string;
  baseUrlOverride?: string;
}

export class CpanelClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly username: string;
  // cPanel shared hosting uses intermediate/self-signed certs on the cpanel.* subdomain.
  private readonly agent = new https.Agent({ rejectUnauthorized: false });

  constructor(config: ClientConfig) {
    const host = config.host.replace(/\/$/, '');
    this.username = config.username;
    this.baseUrl =
      config.baseUrlOverride?.replace(/\/$/, '') ?? `https://cpanel.${host}`;
    this.authHeader =
      'Basic ' +
      Buffer.from(`${config.username}:${config.password}`).toString('base64');
  }

  /**
   * Call a cPanel UAPI endpoint (GET).
   */
  async call<T>(
    module: string,
    fn: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      qs.set(k, String(v));
    }
    const url = `${this.baseUrl}/execute/${module}/${fn}${
      qs.toString() ? `?${qs}` : ''
    }`;
    return this.request<T>(url, 'GET', undefined);
  }

  /**
   * POST to a UAPI endpoint (form-encoded body).
   */
  async post<T>(
    module: string,
    fn: string,
    body: Record<string, string | number | boolean>,
  ): Promise<T> {
    const url = `${this.baseUrl}/execute/${module}/${fn}`;
    const formBody = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      formBody.set(k, String(v));
    }
    return this.request<T>(url, 'POST', formBody.toString());
  }

  /**
   * Call a legacy cPanel API2 endpoint. Some Fileman operations (notably
   * directory creation) exist only in API2, not UAPI.
   */
  async api2<T>(
    module: string,
    fn: string,
    params: Record<string, string | number | boolean> = {},
  ): Promise<T> {
    const qs = new URLSearchParams({
      cpanel_jsonapi_user: this.username,
      cpanel_jsonapi_apiversion: '2',
      cpanel_jsonapi_module: module,
      cpanel_jsonapi_func: fn,
    });
    for (const [k, v] of Object.entries(params)) {
      qs.set(k, String(v));
    }
    const url = `${this.baseUrl}/json-api/cpanel?${qs}`;
    return this.api2Request<T>(url);
  }

  /**
   * Create a directory (idempotent). Uses API2 Fileman::mkdir, which accepts a
   * parent path and a new directory name. Treats "already exists" as success.
   */
  async createDir(fullPath: string): Promise<void> {
    const clean = fullPath.replace(/\/+$/, '');
    const idx = clean.lastIndexOf('/');
    const parent = idx <= 0 ? '/' : clean.slice(0, idx);
    const name = clean.slice(idx + 1);
    if (!name) throw new Error(`Invalid directory path: ${fullPath}`);

    try {
      await this.api2<unknown>('Fileman', 'mkdir', { path: parent, name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/exist/i.test(msg)) throw err;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private request<T>(url: string, method: 'GET' | 'POST', body?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const options: https.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        agent: this.agent,
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
          ...(method === 'POST' && body
            ? {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
              }
            : {}),
        },
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`cPanel HTTP ${res.statusCode} — ${url}`));
            return;
          }
          let parsed: UAPIResponse<T>;
          try {
            parsed = JSON.parse(raw) as UAPIResponse<T>;
          } catch {
            reject(new Error(`cPanel returned non-JSON: ${raw.slice(0, 200)}`));
            return;
          }
          if (parsed.status === 0) {
            reject(new Error(`cPanel UAPI error: ${parsed.errors?.join('; ') ?? 'unknown'}`));
            return;
          }
          resolve(parsed.data);
        });
      });

      req.on('error', reject);
      if (method === 'POST' && body) req.write(body);
      req.end();
    });
  }

  private api2Request<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const options: https.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        agent: this.agent,
        headers: { Authorization: this.authHeader, Accept: 'application/json' },
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`cPanel HTTP ${res.statusCode} — ${url}`));
            return;
          }
          let body: {
            cpanelresult?: {
              error?: string | null;
              data?: Array<{ result?: number; reason?: string }> | unknown;
            };
          };
          try {
            body = JSON.parse(raw) as typeof body;
          } catch {
            reject(new Error(`cPanel returned non-JSON: ${raw.slice(0, 200)}`));
            return;
          }
          const r = body.cpanelresult;
          if (!r) {
            reject(new Error(`cPanel API2 unexpected response: ${raw.slice(0, 200)}`));
            return;
          }
          if (r.error) {
            reject(new Error(`cPanel API2 error: ${r.error}`));
            return;
          }
          const rows = Array.isArray(r.data) ? r.data : [];
          const failed = rows.find((row) => row && row.result === 0);
          if (failed) {
            reject(new Error(`cPanel API2 error: ${failed.reason ?? 'operation failed'}`));
            return;
          }
          resolve(r.data as T);
        });
      });

      req.on('error', reject);
      req.end();
    });
  }
}
