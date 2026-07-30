/** Centralised, validated configuration. Fails loudly at boot, never at call time. */

export interface Config {
  apiKey: string;
  baseUrl: string;
  allowWrites: boolean;
  allowDestructive: boolean;
  secretOutDir: string;
  /** Key hashes destructive tools refuse outright, whatever the flags say. */
  protectedKeys: string[];
  /**
   * Default credit ceiling applied to a new key when the caller does not set
   * one. A key with no limit can spend the whole account balance.
   */
  defaultKeyLimit?: number;
  auditLogPath: string;
  timeoutMs: number;
  maxRetries: number;
  pageLimit: number;
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-or-v1-[0-9a-f]{16,}\b/gi,
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
  const apiKey = env['OPENROUTER_PROVISIONING_KEY']?.trim();
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_PROVISIONING_KEY is required. This is the PROVISIONING key from ' +
        'openrouter.ai/settings/provisioning-keys, not an inference key — an inference key ' +
        'cannot manage other keys. Copy .env.example to .env and fill it in.',
    );
  }

  const allowWrites = boolFromEnv(env, 'OPENROUTER_ALLOW_WRITES', false);
  const allowDestructive = boolFromEnv(env, 'OPENROUTER_ALLOW_DESTRUCTIVE', false);
  if (allowDestructive && !allowWrites) {
    throw new Error(
      'OPENROUTER_ALLOW_DESTRUCTIVE=true requires OPENROUTER_ALLOW_WRITES=true. Destructive ' +
        'tools are a strict superset of writes; enabling deletes while writes are off is a ' +
        'misconfiguration.',
    );
  }

  const rawLimit = env['OPENROUTER_DEFAULT_KEY_LIMIT'];
  const defaultKeyLimit =
    rawLimit === undefined || rawLimit === '' ? undefined : intFromEnv(env, 'OPENROUTER_DEFAULT_KEY_LIMIT', 0, 1, 100_000);

  return {
    apiKey,
    baseUrl: (env['OPENROUTER_BASE_URL'] ?? 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    allowWrites,
    allowDestructive,
    secretOutDir: (env['OPENROUTER_SECRET_OUT_DIR']?.trim() || './secrets').replace(/\/$/, ''),
    protectedKeys: (env['OPENROUTER_PROTECTED_KEYS'] ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    ...(defaultKeyLimit === undefined ? {} : { defaultKeyLimit }),
    auditLogPath: env['OPENROUTER_AUDIT_LOG']?.trim() || 'audit.jsonl',
    timeoutMs: intFromEnv(env, 'OPENROUTER_TIMEOUT_MS', 30_000, 1_000, 120_000),
    maxRetries: intFromEnv(env, 'OPENROUTER_MAX_RETRIES', 3, 0, 10),
    pageLimit: intFromEnv(env, 'OPENROUTER_PAGE_LIMIT', 100, 1, 500),
  };
}

export function isProtected(config: Config, keyHash: string): boolean {
  return config.protectedKeys.includes(keyHash.trim().toLowerCase());
}
