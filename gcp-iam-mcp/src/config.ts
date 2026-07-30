/** Centralised, validated configuration. Fails loudly at boot, never at call time. */

export interface Config {
  projectId: string;
  credentialsPath?: string;
  /** Layer 1, tier 1: write tools are omitted from tools/list unless this is on. */
  allowWrites: boolean;
  /** Layer 1, tier 2: destructive tools are omitted unless this is on as well. */
  allowDestructive: boolean;
  /**
   * Where credential material is written, 0600, when a tool produces some.
   *
   * There is deliberately no flag that makes a tool RETURN a secret value: a tool
   * result lands in the conversation transcript and stays there. The value goes
   * to a file, the response carries the path and a fingerprint.
   */
  secretOutDir: string;
  /**
   * Resource ids that destructive tools refuse outright, whatever the flags say.
   * Flags protect against the wrong mode; this protects against the right mode
   * and the wrong id.
   */
  protectedServiceAccounts: string[];
  auditLogPath: string;
  timeoutMs: number;
  maxRetries: number;
  pageLimit: number;
}

/**
 * Service accounts that must never be deleted through this server.
 * `search-console-mcp@` is the credential BOTH google-analytics-mcp and
 * google-search-console-mcp authenticate on — deleting it dark-outs both.
 */
const DEFAULT_PROTECTED = ['search-console-mcp@haorgrix-mcp.iam.gserviceaccount.com'];

/** Anything that looks like a credential, masked before it can reach a log line. */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bya29\.[0-9A-Za-z._-]+/g,
  /\bBearer\s+[0-9A-Za-z._-]{20,}/gi,
];

/** Never let a secret reach a log line, an audit entry, or an error message. */
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

function listFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: string[]): string[] {
  const raw = env[name];
  if (raw === undefined) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const projectId = env['GCP_PROJECT_ID']?.trim();
  if (!projectId) {
    throw new Error('GCP_PROJECT_ID is required. Copy .env.example to .env and fill it in.');
  }
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) {
    throw new Error(`GCP_PROJECT_ID is not a valid project id, got "${projectId}"`);
  }

  const allowWrites = boolFromEnv(env, 'GCP_ALLOW_WRITES', false);
  const allowDestructive = boolFromEnv(env, 'GCP_ALLOW_DESTRUCTIVE', false);
  if (allowDestructive && !allowWrites) {
    throw new Error(
      'GCP_ALLOW_DESTRUCTIVE=true requires GCP_ALLOW_WRITES=true. Destructive tools are a ' +
        'strict superset of writes; enabling deletes while writes are off is a misconfiguration.',
    );
  }

  const credentialsPath = env['GOOGLE_APPLICATION_CREDENTIALS']?.trim();

  return {
    projectId,
    ...(credentialsPath ? { credentialsPath } : {}),
    allowWrites,
    allowDestructive,
    secretOutDir: (env['GCP_SECRET_OUT_DIR']?.trim() || './secrets').replace(/\/$/, ''),
    protectedServiceAccounts: listFromEnv(env, 'GCP_PROTECTED_SERVICE_ACCOUNTS', DEFAULT_PROTECTED),
    auditLogPath: env['GCP_AUDIT_LOG']?.trim() || 'audit.jsonl',
    timeoutMs: intFromEnv(env, 'GCP_TIMEOUT_MS', 30_000, 1_000, 120_000),
    maxRetries: intFromEnv(env, 'GCP_MAX_RETRIES', 3, 0, 10),
    pageLimit: intFromEnv(env, 'GCP_PAGE_LIMIT', 100, 1, 500),
  };
}

/** True when the id is on the denylist. Compared case-insensitively. */
export function isProtected(config: Config, resourceId: string): boolean {
  return config.protectedServiceAccounts.includes(resourceId.trim().toLowerCase());
}
