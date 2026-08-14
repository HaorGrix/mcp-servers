# hetzner-mcp — Setup

MCP server for the Hetzner Cloud API. Read-only by default. Writes need a second token.
Built to SECURITY-STANDARD v1.0; this repo is the reference for the Part 3 "New project" checklist.

## 1. Prerequisites

```bash
brew install sops age gitleaks trivy   # all free
node --version                          # >= 20
```

Age keys (already generated for HaorGrix infrastructure, `chmod 600`, FileVault on):

| Key | Path | Purpose |
|---|---|---|
| infra-prod | `~/.config/sops/age/haorgrix-infra-prod.txt` | decrypts the read-write token |
| infra-dev | `~/.config/sops/age/haorgrix-infra-dev.txt` | decrypts the read-only token |
| break-glass | `Infrastructure/_SECRETS_confidential/escrow/breakglass.txt` | offline recovery only |

Public keys are in `.sops.yaml`. These are deliberately separate from the client key at
`~/.config/sops/age/keys.txt` — a client key must never decrypt fleet credentials (Law 2).

## 2. Create the two Hetzner tokens

Hetzner Console → your project → **Security → API tokens → Generate API token**.

Create **two**, because Hetzner has no granular scopes and a read-write token can delete
every server in the project:

| Name | Permission |
|---|---|
| `haorgrix-mcp-readonly` | **Read** |
| `haorgrix-mcp-readwrite` | **Read & Write** |

Copy each value immediately; Hetzner shows it once.

## 3. Encrypt them (never write plaintext to disk)

```bash
cd Tooling/MCP/hetzner-mcp
export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/haorgrix-infra.txt"   # ONE path only, see note below

sops secrets/hcloud.ro.sops.env     # add: HCLOUD_TOKEN_RO=<read-only token>
sops secrets/hcloud.rw.sops.env     # add: HCLOUD_TOKEN_RW=<read-write token>
```

`sops` opens an editor and saves the file already encrypted. Confirm with
`grep -c ENC secrets/*.sops.env` — a plaintext token in there is a Law 1 failure.

> **Gotcha that cost us a debug cycle:** `SOPS_AGE_KEY_FILE` accepts a *single* path. A
> colon-separated list loads no identity at all and every decrypt fails with
> "failed to get the data key". Concatenate identities into one keyring instead:
> `cat ~/.config/sops/age/haorgrix-infra-{prod,dev}.txt > ~/.config/sops/age/haorgrix-infra.txt && chmod 600 $_`

## 4. Build and register

```bash
npm install && npm run build
npm run verify        # Law 9 gates locally
```

Register with Claude Code (read-only, the safe default):

```bash
claude mcp add hetzner -- bash /Users/musfiqurtuhin/Documents/HaorGrix/Tooling/MCP/hetzner-mcp/scripts/launch.sh
```

For a session that needs writes, register a second entry passing `--rw`, or relaunch with it.
Keeping them separate means write capability is an explicit choice, not the default.

## 5. Verify

```bash
./scripts/launch.sh          # stderr should say: write access: disabled
./scripts/launch.sh --rw     # stderr should say: WRITE ACCESS ENABLED
```

Then from Claude: `hcloud_list_servers`, and `hcloud_compliance_report` for the audit view.

## Operational rules

- **Read-only is the default.** Launch with `--rw` only for a specific change, then drop back.
- **Destructive tools require an exact-name confirm.** You must echo the resource's real name,
  which cannot be satisfied without having looked it up first.
- **Hetzner delete-protection is respected and not removable from here.** Toggle it in the console.
- **The token bypasses account MFA.** Treat it as crown-jewel material (Law 8). Rotate it on any
  laptop compromise and on offboarding, per Part 6 — removing an age key is not enough.
- **Rate limit** is 3600 requests/hour per project; a 429 is reported as such.
