# namecheap-mcp

MCP server for the Namecheap API: domains, advanced DNS, nameserver delegation, and email authentication (SPF, DKIM, DMARC) — with live resolver verification.

**Read-only by default.** Writes require `NAMECHEAP_ALLOW_WRITES=true`. Anything that deletes records or changes delegation additionally requires echoing the domain name back as `confirm`.

## Why the safety rails

Namecheap's `setHosts` command is a **full replace**, not a patch. It overwrites every DNS record on the domain with exactly what you send — anything omitted is silently deleted, including mail routing and verification records.

Every write in this server therefore reads the current zone first and rewrites it in full. You never hand it a partial zone.

## Setup

```bash
npm install && npm run build
cp .env.example .env   # fill in credentials
```

The API key comes from [Namecheap API access](https://ap.www.namecheap.com/settings/tools/apiaccess/). **The calling IP must be whitelisted there** or every request is rejected. See [`documentation/Setup.md`](documentation/Setup.md).

## Tools

| Tool | Access |
| --- | --- |
| `namecheap_list_domains` | read |
| `namecheap_get_domain` | read |
| `namecheap_check_availability` | read |
| `namecheap_get_nameservers` | read |
| `namecheap_list_dns_records` | read |
| `namecheap_audit_email_auth` | read |
| `namecheap_verify_dns` | read (no credentials needed) |
| `namecheap_verify_email_auth` | read (no credentials needed) |
| `namecheap_add_dns_record` | write |
| `namecheap_update_dns_record` | write |
| `namecheap_set_spf` | write |
| `namecheap_set_dkim` | write |
| `namecheap_set_dmarc` | write |
| `namecheap_delete_dns_record` | **destructive** |
| `namecheap_replace_all_dns_records` | **destructive** |
| `namecheap_set_nameservers` | **destructive** |
| `namecheap_use_namecheap_dns` | **destructive** |

Full parameter reference: [`documentation/API.md`](documentation/API.md).

## Verification is separate from configuration

The Namecheap API reports what is *configured*. `namecheap_verify_dns` and `namecheap_verify_email_auth` query public resolvers (Google, Cloudflare, Quad9) to report what the world *actually resolves* — the only real test that a change has propagated. Both work without credentials and against any domain, not just yours.
