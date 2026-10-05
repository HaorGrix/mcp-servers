/** Minimal typed HTTP helper shared by all providers. Every call is wrapped so a
 * network failure, non-2xx status, or unparseable body becomes a structured result
 * instead of a thrown, unlogged error. Secrets are never included in the returned text. */

export interface HttpResult {
  ok: boolean;
  status: number;
  /** Parsed JSON when the body is JSON, else the raw text. */
  body: unknown;
  /** Present only when the request could not complete at all. */
  error?: string;
}

export interface HttpOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** JSON body — serialized and sent with Content-Type: application/json. */
  json?: unknown;
  /** Form body — serialized as application/x-www-form-urlencoded. Repeats keys ending in "[]". */
  form?: Record<string, string | string[]>;
  timeoutMs?: number;
}

function encodeForm(form: Record<string, string | string[]>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) {
    if (Array.isArray(v)) for (const item of v) p.append(k, item);
    else p.append(k, v);
  }
  return p.toString();
}

export async function http(url: string, opts: HttpOptions = {}): Promise<HttpResult> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  let bodyInit: string | undefined;

  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyInit = JSON.stringify(opts.json);
  } else if (opts.form !== undefined) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    bodyInit = encodeForm(opts.form);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);
  try {
    const res = await fetch(url, {
      method,
      headers,
      ...(bodyInit !== undefined ? { body: bodyInit } : {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* leave as raw text — some errors return HTML */
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, body: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Wrap a provider result into the MCP text-content shape the tools return. */
export function asToolResult(label: string, result: HttpResult): {
  content: { type: "text"; text: string }[];
  isError?: boolean;
} {
  const payload = {
    provider: label,
    ok: result.ok,
    status: result.status,
    ...(result.error ? { transport_error: result.error } : {}),
    data: result.body,
  };
  const text = JSON.stringify(payload, null, 2);
  return result.ok ? { content: [{ type: "text", text }] } : { content: [{ type: "text", text }], isError: true };
}
