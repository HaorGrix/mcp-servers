# Setup — namecheap-mcp

## Requirements
- Node.js 20+
- A Namecheap account with API access enabled

## Enabling the Namecheap API

1. Go to **Profile → Tools → Namecheap API Access** (https://ap.www.namecheap.com/settings/tools/apiaccess/).
2. Toggle API access on. Namecheap requires the account to meet at least one of: 20+ domains, $50+ balance, or $50+ spent in the last two years. Without that, API access cannot be enabled and this server has nothing to talk to.
3. Copy the **API key**.
4. **Whitelist your public IP** on the same page. This is the single most common cause of every call failing — Namecheap rejects any request from a non-whitelisted address regardless of credentials.

Find the IP to whitelist with:

```bash
curl -s https://api.ipify.org
```

If your address is dynamic, it must be re-whitelisted whenever it changes.

## Configuration

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `NAMECHEAP_API_USER` | Yes | Namecheap account username. |
| `NAMECHEAP_API_KEY` | Yes | API key from the page above. |
| `NAMECHEAP_USERNAME` | No | Defaults to `NAMECHEAP_API_USER`. Differs only for reseller sub-accounts. |
| `NAMECHEAP_CLIENT_IP` | Yes | The whitelisted public IP. |
| `NAMECHEAP_ENV` | No | `sandbox` targets api.sandbox.namecheap.com. Anything else is production. |
| `NAMECHEAP_ALLOW_WRITES` | No | Must be exactly `true` to permit any write. Defaults to read-only. |

The sandbox uses **separate credentials** from production — register at https://www.sandbox.namecheap.com/ to get them.

## Build and run

```bash
npm install
npm run build
npm start          # stdio MCP server
npm run typecheck
npm run dev        # tsx, no build step
```

## Registering with an MCP client

```json
{
  "mcpServers": {
    "namecheap": {
      "command": "node",
      "args": ["/Users/musfiqurtuhin/Documents/HaorGrix/Tooling/MCP/namecheap-mcp/dist/index.js"],
      "env": {
        "NAMECHEAP_API_USER": "...",
        "NAMECHEAP_API_KEY": "...",
        "NAMECHEAP_CLIENT_IP": "...",
        "NAMECHEAP_ALLOW_WRITES": "false"
      }
    }
  }
}
```

Run a second entry with `NAMECHEAP_ALLOW_WRITES=true` only when you actually intend to change DNS.

## Operational notes

- **Delegation matters.** If a domain's nameservers point elsewhere (Vercel, Cloudflare), the records this server reads and writes at Namecheap are *not live*. `namecheap_list_dns_records` warns when this is the case.
- **Propagation is not instant.** After any change, confirm with `namecheap_verify_dns` rather than trusting the write's success message.
- **stdout is the MCP transport.** All logging goes to stderr; never add `console.log` to this server.
