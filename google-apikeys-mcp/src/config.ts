/** Centralised, validated configuration. Fails loudly at boot, never at call time. */

export interface Config {
  projectId: string;
  location: string;
  credentialsPath?: string;
  /** Layer 1, tier 1: create/update tools are omitted from tools/list when off. */
  allowWrites: boolean;
  /** Layer 1, tier 2: delete tools need this as well. */
  allowDestructive: boolean;
  /**
   * Key strings are written here, 0600. There is deliberately no flag that
   * returns a key string in a response — a tool result lands in the transcript.
   */
  secretOutDir: string;
  /** Key ids destructive tools refuse outright, whatever the flags say. */
  protectedKeys: string[];
  auditLogPath: string;
  timeoutMs: number;
  maxRetries: number;
  pageLimit: number;
}

/** APIs a Gemini key must target, used to warn on the mismatch that cost us a round trip. */
export const GEMINI_API = 'generativelanguage.googleapis.com';

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bya29\.[0-9A-Za-z._-]+/g,
  /\bBearer\s+[0-9A-Za-z._-]{20,}/gi,
];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, '[REDACTED]'), text);
}

function boolFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`${name} must be a boolean, got "${raw}"`);
}

function intFromEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer, got "${raw}"`);
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}, got ${parsed}`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const projectId = env['GCP_PROJECT_ID']?.trim();
  if (!projectId) {
    throw new Error('GCP_PROJECT_ID is required. Copy .env.example to .env and fill it in.');
  }
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) {
    throw new Error(`GCP_PROJECT_ID is not a valid project id, got "${projectId}"`);
  }

  const allowWrites = boolFromEnv(env, 'APIKEYS_ALLOW_WRITES', false);
  const allowDestructive = boolFromEnv(env, 'APIKEYS_ALLOW_DESTRUCTIVE', false);
  if (allowDestructive && !allowWrites) {
    throw new Error(
      'APIKEYS_ALLOW_DESTRUCTIVE=true requires APIKEYS_ALLOW_WRITES=true. Destructive tools are ' +
        'a strict superset of writes; enabling deletes while writes are off is a misconfiguration.',
    );
  }

  const credentialsPath = env['GOOGLE_APPLICATION_CREDENTIALS']?.trim();
  const protectedKeys = (env['APIKEYS_PROTECTED_KEYS'] ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    projectId,
    // The API Keys API only serves "global" today; kept configurable, validated.
    location: env['APIKEYS_LOCATION']?.trim() || 'global',
    ...(credentialsPath ? { credentialsPath } : {}),
    allowWrites,
    allowDestructive,
    secretOutDir: (env['APIKEYS_SECRET_OUT_DIR']?.trim() || './secrets').replace(/\/$/, ''),
    protectedKeys,
    auditLogPath: env['APIKEYS_AUDIT_LOG']?.trim() || 'audit.jsonl',
    timeoutMs: intFromEnv(env, 'APIKEYS_TIMEOUT_MS', 30_000, 1_000, 120_000),
    maxRetries: intFromEnv(env, 'APIKEYS_MAX_RETRIES', 3, 0, 10),
    pageLimit: intFromEnv(env, 'APIKEYS_PAGE_LIMIT', 100, 1, 500),
  };
}

export function isProtected(config: Config, keyId: string): boolean {
  return config.protectedKeys.includes(keyId.trim().toLowerCase());
}
