/** Centralised, validated configuration. Fails loudly at boot, never at call time. */

export interface Config {
  apiKey: string;
  baseUrl: string;
  allowWrites: boolean;
  allowDestructive: boolean;
  secretOutDir: string;
  /** Domain names destructive tools refuse outright. */
  protectedDomains: string[];
  /**
   * Addresses that can never receive mail from this server, enforced before
   * anything reaches Resend. A send tool is exactly what breaches a
   * never-contact rule by accident.
   */
  blockedRecipients: string[];
  /** When set, every send refuses unless the from address matches. */
  enforceSender?: string;
  /** The breach date. Keys created before this are suspect by definition. */
  breachDate: string;
  auditLogPath: string;
  timeoutMs: number;
  maxRetries: number;
  pageLimit: number;
}

/**
 * Permanent company rule: this address is never a recipient and never a sender.
 * Shipped in the default denylist so it holds even with an empty .env.
 */
const DEFAULT_BLOCKED = ['zennpsi@gmail.com'];

const SECRET_PATTERNS: RegExp[] = [
  /\bre_[0-9A-Za-z_-]{16,}\b/g,
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

function emailList(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined) return fallback;
  const list = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // The permanent rule is not opt-out: an override that omits it still keeps it.
  for (const must of DEFAULT_BLOCKED) if (!list.includes(must)) list.push(must);
  return list;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env['RESEND_API_KEY']?.trim();
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is required. Copy .env.example to .env and fill it in.');
  }
  if (!apiKey.startsWith('re_')) {
    throw new Error('RESEND_API_KEY does not look like a Resend key (expected an "re_" prefix).');
  }

  const allowWrites = boolFromEnv(env, 'RESEND_ALLOW_WRITES', false);
  const allowDestructive = boolFromEnv(env, 'RESEND_ALLOW_DESTRUCTIVE', false);
  if (allowDestructive && !allowWrites) {
    throw new Error(
      'RESEND_ALLOW_DESTRUCTIVE=true requires RESEND_ALLOW_WRITES=true. Destructive tools are a ' +
        'strict superset of writes; enabling deletes while writes are off is a misconfiguration.',
    );
  }

  const enforceSender = env['RESEND_ENFORCE_SENDER']?.trim().toLowerCase();
  if (enforceSender && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(enforceSender)) {
    throw new Error(`RESEND_ENFORCE_SENDER must be an email address, got "${enforceSender}"`);
  }
  if (enforceSender && DEFAULT_BLOCKED.includes(enforceSender)) {
    throw new Error(
      `RESEND_ENFORCE_SENDER cannot be ${enforceSender} — that address is never a sender.`,
    );
  }

  return {
    apiKey,
    baseUrl: (env['RESEND_BASE_URL'] ?? 'https://api.resend.com').replace(/\/$/, ''),
    allowWrites,
    allowDestructive,
    secretOutDir: (env['RESEND_SECRET_OUT_DIR']?.trim() || './secrets').replace(/\/$/, ''),
    protectedDomains: (env['RESEND_PROTECTED_DOMAINS'] ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    blockedRecipients: emailList(env['RESEND_BLOCKED_RECIPIENTS'], DEFAULT_BLOCKED),
    ...(enforceSender ? { enforceSender } : {}),
    breachDate: env['RESEND_BREACH_DATE']?.trim() || '2026-06-24',
    auditLogPath: env['RESEND_AUDIT_LOG']?.trim() || 'audit.jsonl',
    timeoutMs: intFromEnv(env, 'RESEND_TIMEOUT_MS', 30_000, 1_000, 120_000),
    maxRetries: intFromEnv(env, 'RESEND_MAX_RETRIES', 3, 0, 10),
    pageLimit: intFromEnv(env, 'RESEND_PAGE_LIMIT', 100, 1, 500),
  };
}

export function isProtectedDomain(config: Config, domain: string): boolean {
  return config.protectedDomains.includes(domain.trim().toLowerCase());
}

/** Returns the blocked addresses found in a recipient list, empty when clean. */
export function blockedIn(config: Config, recipients: string[]): string[] {
  const blocked = new Set(config.blockedRecipients);
  return recipients.map((r) => r.trim().toLowerCase()).filter((r) => blocked.has(r));
}
