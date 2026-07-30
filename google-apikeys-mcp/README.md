# google-apikeys-mcp

Google Cloud API Keys over MCP: list, create with required restrictions, retarget, delete and
undelete. **7 tools** at full privilege, **3** in the default read-only mode.

Same project and same scoped service account as [`gcp-iam-mcp`](../gcp-iam-mcp) — one credential
surface across both.

## Why this exists

The Gemini key stolen in the 2026-06-24 breach was **unrestricted**: it could call every API
enabled on the project. That is part of why it was worth stealing. So this server makes the safe
thing the default and the unsafe thing explicit:

- **`api_targets` is a required argument on `apikeys_create`.** An unrestricted key must be asked
  for by passing `unrestricted: true`, which the description discourages.
- **`apikeys_list` flags every unrestricted key it finds**, with a count, rather than reporting
  them silently alongside restricted ones.
- **`apikeys_create` warns when a key targets `generativelanguage.googleapis.com` and that API is
  not enabled**, and notes that a Cloud API key is not an AI Studio key. That exact confusion cost
  a live round trip during the June rotation: a Cloud key 403s on the AI Studio endpoint reiva calls.

## Safety model

Identical to `gcp-iam-mcp` — the house dual-layer standard.

**Layer 1 — absence.** Tools are not registered when their flag is off, so they are missing from
`tools/list` rather than refused at call time.

| Flag | Default | Registers |
|---|---|---|
| — | — | `apikeys_list`, `apikeys_get`, `apikeys_lookup` |
| `APIKEYS_ALLOW_WRITES` | `false` | `apikeys_create`, `apikeys_update_restrictions` |
| `APIKEYS_ALLOW_DESTRUCTIVE` | `false` | `apikeys_delete`, `apikeys_undelete`. Requires writes; the server refuses to boot otherwise |

**Layer 2 — per-call guards.** `confirm` must equal the exact key id or its last 6 characters ·
`APIKEYS_PROTECTED_KEYS` is checked before flags and before confirm · `dry_run` hits the read path
to prove the key exists and reports the exact mutation · every write and destructive call appends
to a local gitignored JSONL audit journal.

**Key strings never enter a response.** `apikeys_create` writes the value to a `0600` file and
returns the path plus a 12-char fingerprint. There is no flag to change this — a tool result lands
in the conversation transcript and stays there. `apikeys_lookup` goes the other way: pass a key
string to learn *which key id* it is, and the string you passed is redacted before it reaches the
audit journal or any log line.

`get_key_string` is deliberately **not implemented**. If a human needs the actual value, the
console is the right place to read it from.

## Setup

```bash
npm install && npm run build
cp .env.example .env    # then fill in GCP_PROJECT_ID
npm start
```

Node 20+. `dist/` is not committed. Least privilege for the service account this runs as:
`roles/serviceusage.apiKeysAdmin` on the project.

## Verify

```bash
npm run check    # typecheck + tests
```

Three tests are non-negotiable and must never be weakened: write tools absent from the tool list
when the flag is off, a destructive call refused when the confirm id does not match, and no secret
value in any response envelope or log line.
