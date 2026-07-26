# MCP Setup — Agent Guide

Read this end to end before running anything. Eight MCP servers, 188 tools.
When you're done, all eight are registered and callable from your Claude client.

Two inputs are needed: this repo, and a `creds.txt` from the team lead. Neither
works alone — the repo has no credentials in it, and `creds.txt` is only values.

---

## 1. Clone

```bash
git clone https://github.com/HaorGrix/mcp-servers.git
cd mcp-servers
```

The repo is **private**. If the clone 404s you don't have access yet — ask the
team lead to add your GitHub account, don't work around it.

Already cloned? Pull first. Two servers (`meta-business-mcp`, `zoho-mail-mcp`)
were only committed on 2026-07-27; an older clone is missing them entirely.

```bash
git pull origin main
ls -d */ | wc -l     # expect 8 server dirs + documentation
```

## 2. Get `creds.txt`

Posted by Sibir in `#agents-tools-haorgrix` (`C0BJ3442J8N`), attached to the
"MCP handoff" message. Download it. Do not commit it, do not paste its contents
into any channel, and delete it once setup is done — everything it holds ends up
in `.env` files that are already gitignored.

It contains every API key plus both Google service-account keys inline.

## 3. Bootstrap

One command. Point it at wherever you saved `creds.txt`:

```bash
bash bootstrap.sh ~/Downloads/creds.txt
```

This does the whole job:

1. Writes every `.env` and both `credentials.json` from `creds.txt`, `chmod 600`
2. `npm ci && npm run build` in all 8 servers
3. Generates a config with absolute paths **for your machine**
4. Merges it into Claude Desktop and registers with Claude Code
5. Verifies each entrypoint exists

It's idempotent — safe to re-run. Your existing config is backed up and merged
into, never overwritten, so unrelated MCP servers you already have survive.

Requires **Node 20+**. The script exits early if you're below that.

## 4. Verify

```bash
claude mcp list
```

All eight should read `connected`. Restart Claude Desktop before checking there.

## 5. When something fails

The bootstrap tells you which server broke and at which step. Match it:

| Symptom | Cause | Fix |
|---|---|---|
| `MISSING <server>` | clone predates 2026-07-27 | `git pull origin main` |
| `FAILED <server>` at build | dep or TS error | `cd <server> && npm run build` to see it |
| `BROKEN <name> -> path` | build silently failed | rebuild that one server |
| omitted from config | no credentials in `creds.txt` | expected for `zoho-mail`, see below |
| `failed` in `claude mcp list` | valid key, missing API grant | see Google note below |

`dist/` is **not** committed. A config pointing at `dist/index.js` fails until
you build — this is the single most common reason "nothing works after cloning."

To see a server's real startup error, run its entrypoint directly. It prints to
stderr, which the client swallows:

```bash
node brevo-mcp/dist/index.js
```

**Google servers:** the service-account key is necessary but not sufficient. The
account must also be granted Viewer on the GA4 property and added as a user in
Search Console. A valid key with no grant authenticates fine and then fails every
call. If GA/GSC connect but return permission errors, this is why.

**Known gaps, expected:** `zoho-mail` has no credentials yet (needs a Zoho app
password with IMAP enabled) and the WooCommerce `WC_*` keys were never generated.
Both are omitted from the config rather than shipped broken.

---

## Before you call anything

These servers hold production access. Read this section — it is not boilerplate.

**`cpanel-mcp` — 51 tools, root-equivalent on fernhillbd.com.** File delete, DB
drop, DNS edits, backup restore. No write gate. `cp_uapi_call` is an unbounded
escape hatch that accepts POST/DELETE against any endpoint.

**`wordpress-mcp` — 49 tools, admin on the live WooCommerce store**, including
customer and order data. `wp_rest_request` is the same kind of escape hatch.

**`mcp-meta-ads_new` — ships `META_ALLOW_WRITES=true`.** That registers
`create_campaign`, `create_adset`, `create_ad`, and `update_status`.
`update_status` can flip a campaign to ACTIVE and **start real ad spend.** If you
are not explicitly tasked with running ads, set it to `false` in
`mcp-meta-ads_new/.env` and rebuild.

Working rules:

- Read-only tools freely. Any write, delete, or spend — CLAIM in
  `#agents-tools-haorgrix` first and wait for an ack.
- Never call `cp_uapi_call` or `wp_rest_request` with a non-GET method unless
  that exact call was asked for.
- These point at **live production**. There is no staging behind them.

## Repo hygiene

`.gitignore` already covers `.env`, `*.pem`, `*.key`, `credentials.json`, and
`*service-account*.json`. Before any commit:

```bash
git status --short           # no .env, no credentials.json
git diff --cached | grep -iE "api[_-]?key|password|token|BEGIN PRIVATE KEY"
```

If a secret ever lands in a commit, say so in the channel immediately. Rotation
is cheap; a secret sitting in history that nobody knows about is not.

## Questions

Post in `#agents-tools-haorgrix` (`C0BJ3442J8N`). Peek before acting, CLAIM
before editing, NOTE what you did, DONE when it's merged.
