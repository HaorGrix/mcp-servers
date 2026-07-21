import "dotenv/config.js";

const PLACEHOLDER = "PLACEHOLDER_INSERT_YOUR_META_ACCESS_TOKEN_HERE";

/** @typedef {{ accessToken: string, apiVersion: string, baseUrl: string, timeoutMs: number, maxRetries: number, pageLimit: number, maxPages: number, allowWrites: boolean }} Config */

/**
 * Reads and validates configuration from the environment.
 * Throws on missing or placeholder credentials so the server fails loudly at boot
 * rather than emitting confusing OAuth errors on the first tool call.
 * @returns {Config}
 */
export function loadConfig() {
  const accessToken = process.env.META_ACCESS_TOKEN?.trim();

  if (!accessToken || accessToken === PLACEHOLDER) {
    throw new Error(
      "META_ACCESS_TOKEN is not set. Put a valid Meta access token in .env " +
        "(Business Settings -> System Users -> Generate token, with ads_read).",
    );
  }

  const apiVersion = process.env.META_API_VERSION?.trim() || "v23.0";
  if (!/^v\d+\.\d+$/.test(apiVersion)) {
    throw new Error(`META_API_VERSION must look like "v23.0", got "${apiVersion}".`);
  }

  return {
    accessToken,
    apiVersion,
    baseUrl: `https://graph.facebook.com/${apiVersion}`,
    timeoutMs: positiveInt(process.env.META_TIMEOUT_MS, 60_000),
    maxRetries: positiveInt(process.env.META_MAX_RETRIES, 4),
    pageLimit: positiveInt(process.env.META_PAGE_LIMIT, 200),
    maxPages: positiveInt(process.env.META_MAX_PAGES, 200),
    // Write tools (campaign/adset creation) are opt-in. Read-only by default so an
    // accidental tool call can never spend money or mutate a client account.
    allowWrites: process.env.META_ALLOW_WRITES === "true",
  };
}

/**
 * @param {string | undefined} raw
 * @param {number} fallback
 * @returns {number}
 */
function positiveInt(raw, fallback) {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Expected a positive integer, got "${raw}".`);
  }
  return n;
}
