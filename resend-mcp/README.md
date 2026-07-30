# resend-mcp

Resend management over MCP: domains, API keys, transactional email, audiences, contacts and
broadcasts. **13 tools** at full privilege, **7** in the default read-only mode.

## Two rules encoded as code, not documentation

**1. `zennpsi@gmail.com` is never a recipient and never a sender.** Enforced server-side before any
request reaches Resend, and it **cannot be configured away** — `RESEND_BLOCKED_RECIPIENTS` *adds*
to the list rather than replacing it, and setting that address as `RESEND_ENFORCE_SENDER` refuses
at boot. A send tool is exactly what breaches a never-contact rule by accident, so it is a test,
not a note in a doc.

**2. A key is identified by id, never by name.** Resend never exposes a key value — not through the
API, not in the dashboard — so a name is not proof of identity. `resend_delete_api_key` takes an
**id only**, and `resend_list_api_keys` flags every key created before the configured breach date
(`2026-06-24`) as `suspect`, with the reason attached. "Delete every key created before date X"
stays a deliberate two-step: list, read the dates, then delete by id.

That constraint came out of the June rotation, where the stolen Resend key could not be positively
identified and the right call was to not delete anything.

## Safety model

The house dual-layer standard.

| Flag | Default | Registers |
|---|---|---|
| — | — | 7 read tools |
| `RESEND_ALLOW_WRITES` | `false` | create key / domain / audience, **and `resend_send_email`** |
| `RESEND_ALLOW_DESTRUCTIVE` | `false` | delete key / domain / audience. Requires writes |

**Sending is a write, so by default this server cannot send mail at all.**

Layer 2: `confirm` must equal the exact resource id or its last 6 characters ·
`RESEND_PROTECTED_DOMAINS` refused before flags and before confirm · `dry_run` proves the resource
exists and reports the exact mutation, including whether the sender and recipient checks passed ·
every write and destructive call appends to a local gitignored JSONL audit journal.

**Key values never enter a response.** `resend_create_api_key` writes the token to a `0600` file
and returns the path plus a 12-char fingerprint. Resend issues a value exactly once, and a tool
result lands in the conversation transcript and stays there.

## Setup

```bash
npm install && npm run build
cp .env.example .env    # then fill in RESEND_API_KEY
npm start
```

Node 20+. `dist/` is not committed. Set `RESEND_ENFORCE_SENDER` and `RESEND_PROTECTED_DOMAINS`
before enabling writes.

## Verify

```bash
npm run check    # typecheck + tests
```

12 tests, including the three non-negotiables and four covering the blocked-recipient rule.
