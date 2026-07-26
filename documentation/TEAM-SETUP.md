# MCP Team Setup

Eight MCP servers. This doc gets them registered and running on a fresh machine.

Nothing here contains a secret. Credentials arrive separately (see **Step 3**).

## 0. Prerequisites

- Node.js 20+
- The repo checked out somewhere. Call that path `$MCP_ROOT`.

```bash
export MCP_ROOT=/absolute/path/to/Tooling/MCP
```

## 1. Install and build

Seven of the eight are TypeScript and must be compiled before registration —
the configs invoke `dist/index.js`, which does not exist until you build.

```bash
cd "$MCP_ROOT"
for d in brevo-mcp cpanel-mcp google-analytics-mcp google-search-console-mcp \
         meta-business-mcp wordpress-mcp zoho-mail-mcp; do
  (cd "$d" && npm ci && npm run build) || echo "FAILED: $d"
done

# mcp-meta-ads_new is plain JS — no build step
(cd mcp-meta-ads_new && npm ci)
```

Verify every entrypoint exists before moving on:

```bash
cd "$MCP_ROOT"
for d in brevo-mcp cpanel-mcp google-analytics-mcp google-search-console-mcp \
         meta-business-mcp wordpress-mcp zoho-mail-mcp; do
  [ -f "$d/dist/index.js" ] && echo "ok   $d" || echo "MISSING $d/dist/index.js"
done
[ -f mcp-meta-ads_new/index.js ] && echo "ok   mcp-meta-ads_new"
```

## 2. Server inventory

| Server | Entrypoint | Credentials needed |
|---|---|---|
| `brevo-mcp` | `dist/index.js` | `BREVO_API_KEY` |
| `cpanel-mcp` | `dist/index.js` | `CPANEL_HOST`, `CPANEL_USERNAME`, `CPANEL_PASSWORD` |
| `google-analytics-mcp` | `dist/index.js` | `credentials.json` (service account) + `GA4_PROPERTY_ID` |
| `google-search-console-mcp` | `dist/index.js` | `credentials.json` (service account) + `GSC_SITE_URL` |
| `mcp-meta-ads_new` | `index.js` | `META_ACCESS_TOKEN` |
| `meta-business-mcp` | `dist/index.js` | `META_ACCESS_TOKEN` |
| `wordpress-mcp` | `dist/index.js` | `WORDPRESS_URL`, `WORDPRESS_USERNAME`, `WORDPRESS_APP_PASSWORD` (+ optional `WC_*`) |
| `zoho-mail-mcp` | `dist/index.js` | `ZOHO_USER`, `ZOHO_APP_PASSWORD`, `ZOHO_IMAP_HOST` |

`cpanel-mcp` and `wordpress-mcp` are per-site: register one entry per site, each
with its own env block. `mcp-meta-ads_new` and `meta-business-mcp` overlap —
register whichever the task calls for, not necessarily both.

## 3. Credentials

Every `.env` and both `credentials.json` files are gitignored and are **not** in
this repo or in any zip of it. Each server ships a `.env.example` /
`credentials.example.json` showing the exact keys.

Get the real values from Musfiqur over a secrets channel — a password manager
share, `age`/`sops`, or 1Password. Do not send them over email, Slack DM, or
inside an archive.

```bash
cd "$MCP_ROOT"
for d in */; do
  [ -f "$d/.env.example" ] && [ ! -f "$d/.env" ] && cp "$d/.env.example" "$d/.env"
done
# then fill each .env in by hand
```

For the two Google servers, drop the service-account JSON at
`$MCP_ROOT/google-analytics-mcp/credentials.json` and
`$MCP_ROOT/google-search-console-mcp/credentials.json`. The service account must
be granted Viewer on the GA4 property and added as a user in Search Console —
having the key file is not sufficient on its own.

## 4. Register

Config lives outside the repo, which is why cloning alone never made these
appear. Use `config/mcp.template.json` in this folder: replace every
`__MCP_ROOT__` with your absolute path, fill the `env` values, and write the
result to the right location.

```bash
cd "$MCP_ROOT"
sed "s|__MCP_ROOT__|$MCP_ROOT|g" documentation/config/mcp.template.json > /tmp/mcp.json
# fill in the env values in /tmp/mcp.json, then install it
```

**Claude Desktop** — merge into
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows). If the file already has
an `mcpServers` object, merge keys into it rather than overwriting the file.
Restart Claude Desktop fully.

**Claude Code** — prefer the CLI over hand-editing `~/.claude.json`:

```bash
claude mcp add brevo -- node "$MCP_ROOT/brevo-mcp/dist/index.js"
claude mcp list     # shows connected / failed per server
```

Add `--scope project` to register for a single repo instead of globally.

## 5. Verify

```bash
claude mcp list
```

A server that shows `failed` is usually one of: `dist/` not built (Step 1), a
missing or malformed `.env` (Step 3), an absolute path still containing
`__MCP_ROOT__` (Step 4), or a credential that is valid but lacks the API-side
grant (Step 3, Google note).

To see the actual error, run the entrypoint directly — it prints startup
failures to stderr:

```bash
node "$MCP_ROOT/brevo-mcp/dist/index.js"
```

## Known issues

- The sending machine's `claude_desktop_config.json` still points at a legacy
  `HaorGrix/MCP/...` path from before the move to `HaorGrix/Tooling/MCP/...`.
  Do not copy that file verbatim; generate a fresh one from the template.
- `zoho-mail-mcp` has no `.env` on the sending machine, only `.env.example`.
  Its credentials must be issued fresh (Zoho Mail → Settings → Security → App
  Passwords), and IMAP access enabled on the mailbox.
