/** Centralised, validated configuration. Fails loudly at boot, never at call time. */

export interface Config {
  apiKey: string;
  baseUrl: string;
  allowWrites: boolean;
  allowDestructive: boolean;
  /** Connection URIs carry the role password, so they go to a 0600 file. */
  secretOutDir: string;
  /** Project ids destructive tools refuse outright, whatever the flags say. */
  protectedProjects: string[];
  auditLogPath: string;
  timeoutMs: number;
  maxRetries: number;
  pageLimit: number;
}

const SECRET_PATTERNS: RegExp[] = [
  // A Neon connection URI carries the role password in the userinfo section.
  /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/gi,
  /\bnapi_[0-9A-Za-z]{20,}\b/g,
  /\bBearer\s+[0-9A-Za-z._-]{20,}/gi,
];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce(
    (acc, re) => acc.replace(re, (m) => (m.includes('://') ? 'postgresql://[REDACTED]@' : '[REDACTED]')),
    text,
  );
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
  const apiKey = env['NEON_API_KEY']?.trim();
  if (!apiKey) {
    throw new Error('NEON_API_KEY is required. Copy .env.example to .env and fill it in.');
  }

  const allowWrites = boolFromEnv(env, 'NEON_ALLOW_WRITES', false);
  const allowDestructive = boolFromEnv(env, 'NEON_ALLOW_DESTRUCTIVE', false);
  if (allowDestructive && !allowWrites) {
    throw new Error(
      'NEON_ALLOW_DESTRUCTIVE=true requires NEON_ALLOW_WRITES=true. Destructive tools are a ' +
        'strict superset of writes; enabling deletes while writes are off is a misconfiguration.',
    );
  }

  return {
    apiKey,
    baseUrl: (env['NEON_BASE_URL'] ?? 'https://console.neon.tech/api/v2').replace(/\/$/, ''),
    allowWrites,
    allowDestructive,
    secretOutDir: (env['NEON_SECRET_OUT_DIR']?.trim() || './secrets').replace(/\/$/, ''),
    protectedProjects: (env['NEON_PROTECTED_PROJECTS'] ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    auditLogPath: env['NEON_AUDIT_LOG']?.trim() || 'audit.jsonl',
    timeoutMs: intFromEnv(env, 'NEON_TIMEOUT_MS', 30_000, 1_000, 120_000),
    maxRetries: intFromEnv(env, 'NEON_MAX_RETRIES', 3, 0, 10),
    pageLimit: intFromEnv(env, 'NEON_PAGE_LIMIT', 100, 1, 500),
  };
}

export function isProtected(config: Config, projectId: string): boolean {
  return config.protectedProjects.includes(projectId.trim().toLowerCase());
}
