# hetzner-mcp

MCP server for the Hetzner Cloud API. Read-only by default; writes require a second
token and destructive calls require an exact-name confirmation.

Built to `SECURITY-STANDARD.md` v1.0 and intended as the reference implementation of its
Part 3 "New project" checklist.

- Setup: [documentation/Setup.md](documentation/Setup.md)
- Tool reference: [documentation/API.md](documentation/API.md)

```bash
npm install && npm run build
npm run verify                # Law 9 gates, locally
./scripts/launch.sh           # read-only
./scripts/launch.sh --rw      # write access enabled
```

## Why two tokens

Hetzner API tokens are project-scoped and either Read or Read & Write. There is nothing in
between, so a single read-write token can delete every server in the project and it bypasses
account MFA entirely. This server splits the credential and gates the dangerous calls, because
the API will not do it for us.
