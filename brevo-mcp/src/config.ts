/** Centralised, validated configuration. Fails loudly at boot, never at call time. */

export interface Config {
  apiKey: string;
  baseUrl: string;
  enforceSender?: string;
  dryRun: boolean;
  timeoutMs: number;
  maxRetries: number;
  requestsPerSecond: number;
  auditLogPath: string;
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
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer, got "${raw}"`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}, got ${parsed}`);
  }
  return parsed;
}

function boolFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`${name} must be a boolean, got "${raw}"`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiKey = env['BREVO_API_KEY'];
  if (!apiKey) {
    throw new Error('BREVO_API_KEY is required. Copy .env.example to .env and fill it in.');
  }
  if (!apiKey.startsWith('xkeysib-')) {
    throw new Error('BREVO_API_KEY does not look like a Brevo v3 key (expected an "xkeysib-" prefix).');
  }

  const enforceSender = env['BREVO_ENFORCE_SENDER']?.trim().toLowerCase();
  if (enforceSender && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(enforceSender)) {
    throw new Error(`BREVO_ENFORCE_SENDER must be an email address, got "${enforceSender}"`);
  }

  return {
    apiKey,
    baseUrl: (env['BREVO_BASE_URL'] ?? 'https://api.brevo.com/v3').replace(/\/$/, ''),
    ...(enforceSender ? { enforceSender } : {}),
    dryRun: boolFromEnv(env, 'BREVO_DRY_RUN', false),
    timeoutMs: intFromEnv(env, 'BREVO_TIMEOUT_MS', 30_000, 1_000, 120_000),
    maxRetries: intFromEnv(env, 'BREVO_MAX_RETRIES', 3, 0, 10),
    requestsPerSecond: intFromEnv(env, 'BREVO_RPS', 8, 1, 100),
    auditLogPath: env['BREVO_AUDIT_LOG'] ?? 'audit.jsonl',
  };
}

/** Strip anything that looks like a credential before a string reaches a log or an error. */
export function redact(input: string): string {
  return input.replace(/xkeysib-[A-Za-z0-9-]+/g, 'xkeysib-***REDACTED***');
}
