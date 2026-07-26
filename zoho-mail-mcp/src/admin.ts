import type { AdminConfig } from "./config.js";
import { redact } from "./config.js";

/**
 * Zoho Mail organization admin API. Only constructed when a refresh token is
 * present. Access tokens are short-lived and minted on demand from the durable
 * refresh token, so nothing here needs a browser after the one-time setup.
 *
 * Zoho uses the header prefix "Zoho-oauthtoken", not "Bearer".
 */
export class ZohoAdmin {
  private accessToken?: string;
  private tokenExpiry = 0;

  constructor(private readonly config: AdminConfig) {}

  private async token(): Promise<string> {
    // 60s safety margin so a token never expires mid-request.
    if (this.accessToken && Date.now() < this.tokenExpiry - 60_000) {
      return this.accessToken;
    }
    const url =
      `https://${this.config.accountsHost}/oauth/v2/token` +
      `?refresh_token=${encodeURIComponent(this.config.refreshToken)}` +
      `&client_id=${encodeURIComponent(this.config.clientId)}` +
      `&client_secret=${encodeURIComponent(this.config.clientSecret)}` +
      `&grant_type=refresh_token`;

    const res = await fetch(url, { method: "POST" });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(redact(`Zoho token refresh failed (${res.status}): ${text}`, this.config.refreshToken, this.config.clientSecret));
    }
    let parsed: { access_token?: string; expires_in?: number; error?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Zoho token response was not JSON");
    }
    if (parsed.error || !parsed.access_token) {
      throw new Error(`Zoho token refresh error: ${parsed.error ?? "no access_token"}`);
    }
    this.accessToken = parsed.access_token;
    this.tokenExpiry = Date.now() + (parsed.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.token();
    const res = await fetch(`https://${this.config.apiHost}${path}`, {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(redact(`Zoho admin API ${res.status} on ${method} ${path}: ${text}`, token, this.config.refreshToken));
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  orgPath(suffix: string): string {
    const zoid = this.config.orgId;
    return zoid ? `/api/organization/${zoid}${suffix}` : `/api/organization${suffix}`;
  }
}
