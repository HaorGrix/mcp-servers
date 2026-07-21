# ⛔ OLD — DO NOT USE

Superseded copy of the Meta Ads MCP server. Kept for reference only.

**Use [`../mcp-meta-ads_new/`](../mcp-meta-ads_new/) instead.**

## Why this is retired

Verified 2026-07-21: this folder is **byte-for-byte identical** to `mcp-meta-ads_new`
(`index.js`, `.env`, `package.json`, `package-lock.json` all md5-match). There is no
data or feature difference between them — this server holds no local data, it queries
the Meta Graph API live.

The only real difference: this copy has **no `node_modules`**, so it will not run
without `npm install`. `mcp-meta-ads_new` has its dependencies installed.

Nothing was deleted. If you ever need this copy, it still works after `npm install`.

## Known issue carried by both copies

`index.js` targets **Graph API v20.0** (mid-2024), which is at or past Meta's
end-of-life window. Bump the version in `mcp-meta-ads_new` before relying on it.
