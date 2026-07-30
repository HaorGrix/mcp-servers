# neon-mcp

Neon Postgres management over MCP: projects, branches, databases, roles, compute endpoints,
operations and consumption. **14 tools** at full privilege, **9** in the default read-only mode.

## The one thing to know before using it

**`neon_reset_role_password` is classed destructive, not write.** Neon replaces a role password
*atomically* — the old password dies the instant the call returns, and every app using it starts
failing until it is redeployed. There is no create-before-delete option; the outage is unavoidable
and only its *length* is controllable.

So: stage the `.env` edit and the restart command **before** calling it. The tool's own description
says the same thing, and the response leads with how urgent the follow-up is.

This was learned the hard way during the 2026-06-24 breach rotation, where reiva's Neon credential
was the one key that could not be rotated without downtime.

## Safety model

The house dual-layer standard, identical to `gcp-iam-mcp`.

**Layer 1 — absence.** Tools are not registered when their flag is off, so they are missing from
`tools/list` rather than refused at call time.

| Flag | Default | Registers |
|---|---|---|
| — | — | 9 read tools |
| `NEON_ALLOW_WRITES` | `false` | create project / branch / role, start & suspend endpoints |
| `NEON_ALLOW_DESTRUCTIVE` | `false` | `reset_role_password`, `delete_project`, `delete_branch`. Requires writes; the server refuses to boot otherwise |

**Layer 2 — per-call guards.** `confirm` must equal the exact resource id or its last 6 characters ·
`NEON_PROTECTED_PROJECTS` is checked before flags and before confirm · `dry_run` hits the read path
to prove the resource exists · every write and destructive call appends to a local gitignored JSONL
audit journal.

**Credentials never enter a response.** A Neon connection URI carries the role password in its
userinfo section, so `neon_get_connection_uri` is **not** a read tool despite reading nothing — it
writes the URI to a `0600` file and returns the path plus a fingerprint. `reset_role_password` does
the same with the new password. A tool result lands in the conversation transcript and stays there.

Redaction covers the URI shape specifically (`postgresql://user:pass@host` → `postgresql://[REDACTED]@`),
and the audit journal drops known-secret field names outright — because a bare password has no
recognisable shape and survives every regex.

## Setup

```bash
npm install && npm run build
cp .env.example .env    # then fill in NEON_API_KEY
npm start
```

Node 20+. `dist/` is not committed.

**Populate `NEON_PROTECTED_PROJECTS` before enabling destructive mode.** Nothing else stops
`neon_delete_project` taking out the project a live app runs on.

## Verify

```bash
npm run check    # typecheck + tests
```

Three tests are non-negotiable: write tools absent from the tool list when the flag is off, a
destructive call refused when the confirm id does not match, and no secret value in any response
envelope or log line.
