# gcp-iam-mcp

Google Cloud IAM management over MCP: service accounts, service-account keys, IAM policy,
service usage, and billing (read-only). **14 tools** at full privilege, **7** in the default
read-only mode.

Deliberately **not** "full GCP" — unbounded GCP is a footgun. Scoped to the surfaces HaorGrix
actually uses, and grows on demand.

## Why this exists

During the June-breach credential rotation, answering *"which of these service-account keys
predates the breach, and is the stolen one still live?"* required a console session, and the
service account could not list its own keys (403 — correct least privilege, unhelpful timing).
`gcp_list_sa_keys` is that question as one call.

## Safety model

Two independent layers. Neither is sufficient alone.

**Layer 1 — absence.** Tools are *not registered* when their flag is off, so they are absent from
`tools/list` rather than refused at call time. An agent cannot reach them by guessing a name.

| Flag | Default | Registers |
|---|---|---|
| — | — | 7 read tools, always |
| `GCP_ALLOW_WRITES` | `false` | create / enable / disable (4 more) |
| `GCP_ALLOW_DESTRUCTIVE` | `false` | the delete tools (3 more). Requires `GCP_ALLOW_WRITES`; the server refuses to boot otherwise |

There is deliberately **no flag that makes a tool return a secret value** — see below.

**Layer 2 — per-call guards.** Even with every flag on:

- **`confirm` must equal the exact resource id** (or its last 6 characters). A fixed literal like
  `"DELETE"` is passed reflexively by an agent that has not looked at anything; requiring the id
  means you cannot confirm without having read the specific resource first.
- **The protected denylist is checked first**, before flags, before `confirm`. Flags protect
  against the wrong *mode*; the denylist protects against the right mode and the wrong *id*.
  Ships protecting `search-console-mcp@haorgrix-mcp.iam.gserviceaccount.com`, the credential both
  `google-analytics-mcp` and `google-search-console-mcp` authenticate on.
- **`dry_run` hits the provider's read path** to prove the resource exists and reports the exact
  intended mutation. A dry run that echoes arguments back is theatre and worse than none.
- **Every write and destructive call appends to an audit journal** (`audit.jsonl`): timestamp,
  tool, redacted args, resource id, outcome, provider status. Local file, gitignored, never a
  network sink — shipping a trail of credential operations off-box would recreate the
  exfiltration path this is defending against.

**Secrets never enter a response.** `gcp_create_sa_key` writes the key JSON to a `0600` file and
returns the **path plus a 12-char fingerprint** — enough to match the file against the console,
not enough to authenticate. A tool result is not ephemeral: it lands in the conversation
transcript and stays there. This is not hypothetical — a Hetzner read-write token was pasted into
a chat window on 2026-07-29 and had to be rotated for exactly this reason.

Delete the file once the credential is where it belongs. A `0600` file beats a transcript, but it
is still a private key on disk.

## Setup

```bash
npm install && npm run build
cp .env.example .env    # then fill in GCP_PROJECT_ID
npm start
```

Requires Node 20+. `dist/` is not committed. Credentials come from
`GOOGLE_APPLICATION_CREDENTIALS` or Application Default Credentials — never from tool arguments,
never from the client config. Relative credential paths resolve against the process working
directory, so register through a launcher that `chdir`s into this folder.

Least privilege for the service account this runs as: `roles/iam.serviceAccountKeyAdmin` plus
`roles/iam.serviceAccountAdmin` for the account tools, `roles/serviceusage.serviceUsageAdmin` for
enable/disable, and **billing viewer only** — this server exposes no billing mutation whatever the
flags say.

## Verify

```bash
npm run check    # typecheck + tests
```

Three tests are non-negotiable and must never be weakened: write tools absent from the tool list
when the flag is off, a destructive call refused when the confirm id does not match, and no secret
value in any response envelope or log line.
