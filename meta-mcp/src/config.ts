/** Environment-driven configuration. Fails fast on a missing token. */

export interface Config {
  token: string;
  version: string;
  baseUrl: string;
  allowWrites: boolean;
  appSecret: string | undefined;
  defaults: {
    businessId: string | undefined;
    pageId: string | undefined;
    igUserId: string | undefined;
    wabaId: string | undefined;
    appId: string | undefined;
    adAccountId: string | undefined;
  };
  maxRetries: number;
  timeoutMs: number;
}

function opt(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key]?.trim();
  return v ? v : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = opt(env, "META_ACCESS_TOKEN");
  if (!token) throw new Error("META_ACCESS_TOKEN is required. Copy .env.example to .env and fill it in.");
  const version = opt(env, "META_API_VERSION") ?? "v23.0";
  const adAccount = opt(env, "META_AD_ACCOUNT_ID");
  return {
    token,
    version,
    baseUrl: `https://graph.facebook.com/${version}`,
    allowWrites: (opt(env, "META_ALLOW_WRITES") ?? "true").toLowerCase() !== "false",
    appSecret: opt(env, "META_APP_SECRET"),
    defaults: {
      businessId: opt(env, "META_BUSINESS_ID"),
      pageId: opt(env, "META_PAGE_ID"),
      igUserId: opt(env, "META_IG_USER_ID"),
      wabaId: opt(env, "META_WABA_ID"),
      appId: opt(env, "META_APP_ID"),
      adAccountId: adAccount ? (adAccount.startsWith("act_") ? adAccount : `act_${adAccount}`) : undefined,
    },
    maxRetries: 3,
    timeoutMs: 30_000,
  };
}
