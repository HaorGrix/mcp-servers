# Changelog

## [2026-07-30] — Live-tested against the real project; three bugs fixed
- `SOPS_AGE_KEY_FILE` takes ONE path, not a colon-separated list. The launcher was passing
  `prod:dev` and silently loading no identity, so every decrypt failed. Fixed to use a single
  concatenated keyring at `~/.config/sops/age/haorgrix-infra.txt`.
- Pagination is nested under `meta.pagination`, not at the envelope top level. `listAll` was
  reading the wrong path and would have silently truncated every list at the first 50 items.
- `server_type` and `datacenter` are `null` in the `/servers` list response (populated only on
  `GET /servers/{id}`). Rendering crashed on `datacenter.name`; both are now nullable and handled.
- A missing token was being reported as `network_error` because the credential was resolved inside
  the fetch try-block. It now surfaces as `MissingTokenError`.
- Launcher warns loudly when a read-write token is serving reads because no read-only token exists.

## [2026-07-30] — Initial release
- `hetzner-mcp` v1.0.0: 21 tools over the Hetzner Cloud API v1.
- Two-token model: `HCLOUD_TOKEN_RO` default, `HCLOUD_TOKEN_RW` opt-in via `launch.sh --rw`.
  Hetzner has no granular scopes, so separation is enforced here instead.
- Destructive operations gated behind an exact-resource-name `confirm`; Hetzner
  delete-protection is respected and deliberately not removable through this server.
- Secrets via SOPS+age with separate prod and dev key groups (Laws 1 and 2). Fresh
  HaorGrix infrastructure keys, distinct from the client key; prod key escrowed to a
  break-glass key and the restore path tested.
- `.gitignore` written before the first commit; gitleaks pre-commit hook and
  `scripts/verify.sh` running the trivy/gitleaks gates locally while Actions is billing-blocked.
- `hcloud_compliance_report` audits the project against the standard's Hetzner-answerable laws.
