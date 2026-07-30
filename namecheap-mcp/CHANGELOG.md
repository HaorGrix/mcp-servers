# Changelog

## [2026-07-31] — Initial release

- New `namecheap-mcp` MCP server covering domains, advanced DNS, nameserver delegation, and email authentication.
- 17 tools: 8 read-only, 5 write, 4 destructive.
- Read-only by default. Writes require `NAMECHEAP_ALLOW_WRITES=true`; destructive operations additionally require echoing the domain name as `confirm`.
- Every write reads the current zone and rewrites it in full, because Namecheap's `setHosts` command replaces the entire zone rather than patching it. `EmailType` is preserved on every write so email forwarding is not silently disabled.
- SPF, DKIM and DMARC helpers that build valid records, replace rather than duplicate existing ones, and refuse records that breach the 255-character TXT limit. Warns on SPF lookup-limit breaches and on jumping straight to `p=reject`.
- Live verification tools querying Google, Cloudflare or Quad9 resolvers directly, so propagation can be confirmed rather than assumed. These need no credentials.
- Credentials are redacted from all error output; stdout carries only the MCP transport.
- Verified: typecheck and build clean under the repo's strict tsconfig; MCP handshake and all 17 tools enumerate; live verification parsed real SPF/DKIM/DMARC records correctly; write, credential and confirmation gates each refuse as designed, including a wrong confirmation string.
