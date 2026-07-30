# openrouter-mcp

OpenRouter management over MCP: key provisioning, credit balance, per-generation cost attribution
and model listing. **8 tools** at full privilege, **5** in the default read-only mode.

## What this one guards against

**Spend, not just deletion.** An OpenRouter key with no credit limit can spend the entire account
balance, so:

- `openrouter_create_key` takes a `limit` and applies `OPENROUTER_DEFAULT_KEY_LIMIT` when none is
  given. Creating an uncapped key returns a warning saying exactly that.
- `openrouter_list_keys` reports an `uncappedCount` and flags each uncapped key individually,
  rather than listing them silently alongside capped ones.
- `openrouter_get_generation` attributes cost to a single call, so spend can be traced rather than
  guessed at from the account total.

**Disable before delete.** `openrouter_update_key(disabled: true)` is reversible and is the right
first move when a key may be compromised. `openrouter_delete_key` says so in its own description.

**The right key type at boot.** The server requires a *provisioning* key and refuses to start with
an inference key, with a message naming the difference — that mix-up produces a confusing 401 much
later otherwise.

## Safety model

The house dual-layer standard.

| Flag | Default | Registers |
|---|---|---|
| — | — | 5 read tools |
| `OPENROUTER_ALLOW_WRITES` | `false` | `create_key`, `update_key` |
| `OPENROUTER_ALLOW_DESTRUCTIVE` | `false` | `delete_key`. Requires writes |

Layer 2: `confirm` must equal the exact key hash or its last 6 characters · `OPENROUTER_PROTECTED_KEYS`
refused before flags and before confirm · `dry_run` proves the key exists and reports current usage
against its limit · every write and destructive call appends to a local gitignored JSONL audit journal.

**Key values never enter a response.** `openrouter_create_key` writes the value to a `0600` file and
returns the path plus a 12-char fingerprint. OpenRouter issues a value exactly once.

## Setup

```bash
npm install && npm run build
cp .env.example .env    # then fill in OPENROUTER_PROVISIONING_KEY
npm start
```

Node 20+. `dist/` is not committed.

## Verify

```bash
npm run check    # typecheck + tests
```

11 tests, including the three non-negotiables and two covering uncapped-key detection.
