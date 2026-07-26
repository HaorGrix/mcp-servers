/** Validated config, resolved once at boot so failures are loud and immediate. */

export interface Config {
  user: string;
  password: string;
  host: string;
  port: number;
  readOnly: boolean;
  smtpHost: string;
  smtpPort: number;
  /** When set, every send must originate from this address. */
  enforceSender?: string;
  /** Admin API is only wired up when a refresh token is present. */
  admin?: AdminConfig;
  dryRun: boolean;
}

export interface AdminConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Zoho accounts domain, .com / .eu / .in per data center. */
  accountsHost: string;
  /** Zoho Mail API host, mail.zoho.com etc. */
  apiHost: string;
  /** zoid, the org id. Some admin endpoints need it. */
  orgId?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const user = env["ZOHO_USER"]?.trim();
  const password = env["ZOHO_APP_PASSWORD"]?.trim();
  if (!user) throw new Error("ZOHO_USER is required (the mailbox to operate).");
  if (!password) {
    throw new Error(
      "ZOHO_APP_PASSWORD is required. Create an app password in Zoho Mail, Settings, Security.",
    );
  }
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(user)) {
    throw new Error(`ZOHO_USER must be an email address, got "${user}"`);
  }

  const port = intEnv(env, "ZOHO_IMAP_PORT", 993);
  const smtpPort = intEnv(env, "ZOHO_SMTP_PORT", 465);
  const readOnly = boolEnv(env, "ZOHO_READ_ONLY", true);
  const dryRun = boolEnv(env, "ZOHO_DRY_RUN", false);

  const enforceSender = env["ZOHO_ENFORCE_SENDER"]?.trim().toLowerCase();
  if (enforceSender && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(enforceSender)) {
    throw new Error(`ZOHO_ENFORCE_SENDER must be an email address, got "${enforceSender}"`);
  }

  // Admin layer is optional. Present only when all three OAuth values are set,
  // so the mailbox operator works with just the app password.
  const clientId = env["ZOHO_ADMIN_CLIENT_ID"]?.trim();
  const clientSecret = env["ZOHO_ADMIN_CLIENT_SECRET"]?.trim();
  const refreshToken = env["ZOHO_ADMIN_REFRESH_TOKEN"]?.trim();
  const someAdmin = clientId || clientSecret || refreshToken;
  const allAdmin = clientId && clientSecret && refreshToken;
  if (someAdmin && !allAdmin) {
    throw new Error(
      "Admin API needs all three of ZOHO_ADMIN_CLIENT_ID, ZOHO_ADMIN_CLIENT_SECRET, " +
        "ZOHO_ADMIN_REFRESH_TOKEN. Set all or none.",
    );
  }

  const admin: AdminConfig | undefined = allAdmin
    ? {
        clientId: clientId!,
        clientSecret: clientSecret!,
        refreshToken: refreshToken!,
        accountsHost: (env["ZOHO_ACCOUNTS_HOST"] ?? "accounts.zoho.com").trim(),
        apiHost: (env["ZOHO_API_HOST"] ?? "mail.zoho.com").trim(),
        ...(env["ZOHO_ORG_ID"] ? { orgId: env["ZOHO_ORG_ID"].trim() } : {}),
      }
    : undefined;

  return {
    user,
    password,
    host: (env["ZOHO_IMAP_HOST"] ?? "imap.zoho.com").trim(),
    port,
    readOnly,
    smtpHost: (env["ZOHO_SMTP_HOST"] ?? "smtp.zoho.com").trim(),
    smtpPort,
    ...(enforceSender ? { enforceSender } : {}),
    ...(admin ? { admin } : {}),
    dryRun,
  };
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`${name} must be a valid port, got "${raw}"`);
  }
  return n;
}

function boolEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be a boolean, got "${raw}"`);
}

/** Never let a secret reach a log line or an error message. */
export function redact(input: string, ...secrets: string[]): string {
  let out = input;
  for (const s of secrets) {
    if (s) out = out.split(s).join("***REDACTED***");
  }
  return out;
}
