# API — namecheap-mcp

All tools return plain text. Errors are returned as `isError: true` with a human-readable explanation; credentials are never echoed back in an error.

Access levels:
- **read** — always available
- **write** — requires `NAMECHEAP_ALLOW_WRITES=true`
- **destructive** — requires `NAMECHEAP_ALLOW_WRITES=true` *and* `confirm` set to the exact domain name

---

## Domains

### `namecheap_list_domains` — read
| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `search` | string | — | Substring filter on the domain name. |
| `pageSize` | int 10–100 | 100 | Results per page. |

### `namecheap_get_domain` — read
| Param | Type | Notes |
| --- | --- | --- |
| `domain` | string | Fully qualified, e.g. `example.com`. |

Returns status, creation and expiry dates, DNS provider, nameservers, WhoisGuard state.

### `namecheap_check_availability` — read
| Param | Type | Notes |
| --- | --- | --- |
| `domains` | string[] (1–50) | Domains to check. |

### `namecheap_get_nameservers` — read
| Param | Type | Notes |
| --- | --- | --- |
| `domain` | string | — |

Reports whether Namecheap hosts the zone. If not, DNS record tools do not affect live resolution.

---

## DNS records

### `namecheap_list_dns_records` — read
| Param | Type | Notes |
| --- | --- | --- |
| `domain` | string | — |
| `type` | enum | Optional filter. |

Record types: `A`, `AAAA`, `ALIAS`, `CAA`, `CNAME`, `MX`, `MXE`, `NS`, `TXT`, `URL`, `URL301`, `FRAME`.

### `namecheap_add_dns_record` — write
| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `domain` | string | — | — |
| `name` | string | `@` | `@` is the apex. A fully qualified host is trimmed to its label automatically. |
| `type` | enum | — | — |
| `value` | string | — | IP, target hostname, or TXT content. |
| `ttl` | int 60–60000 | 1799 | — |
| `mxPref` | int 0–65535 | 10 | MX only. |
| `replaceExisting` | bool | false | Replace records sharing the host and type instead of adding alongside. |

Adding an exact duplicate is a no-op rather than an error.

### `namecheap_update_dns_record` — write
| Param | Type | Notes |
| --- | --- | --- |
| `domain` | string | — |
| `name` | string | Default `@`. |
| `type` | enum | — |
| `value` | string | New value. |
| `ttl` | int | Optional. |
| `matchValue` | string | Required when several records share the host and type — the tool refuses to guess. |

### `namecheap_delete_dns_record` — destructive
| Param | Type | Notes |
| --- | --- | --- |
| `domain` | string | — |
| `name` | string | Default `@`. |
| `type` | enum | — |
| `matchValue` | string | Optional; restricts deletion to an exact value. |
| `confirm` | string | Must equal the domain name. |

### `namecheap_replace_all_dns_records` — destructive
| Param | Type | Notes |
| --- | --- | --- |
| `domain` | string | — |
| `records` | object[] | The complete desired zone: `{name, type, value, ttl, mxPref}`. |
| `confirm` | string | Must equal the domain name. |

Returns the **previous zone** in full so it can be restored if the change was wrong.

---

## Delegation

### `namecheap_set_nameservers` — destructive
| Param | Type | Notes |
| --- | --- | --- |
| `domain` | string | — |
| `nameservers` | string[] (2–12) | e.g. `ns1.vercel-dns.com`. |
| `confirm` | string | Must equal the domain name. |

### `namecheap_use_namecheap_dns` — destructive
Moves the domain back to Namecheap BasicDNS. Same `confirm` requirement.

---

## Email authentication

### `namecheap_set_spf` — write
| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `domain` | string | — | — |
| `value` | string | — | Complete SPF record. If omitted, built from the fields below. |
| `include` | string[] | `[]` | e.g. `_spf.google.com`. |
| `ip4` / `ip6` | string[] | `[]` | Addresses or CIDR ranges. |
| `policy` | `-all` \| `~all` \| `?all` | `~all` | `~all` soft-fails; safer to start with. |
| `ttl` | int | 1799 | — |

Rejects records over the 255-character TXT limit and warns past SPF's 10-lookup limit. Replaces any existing SPF record rather than adding a second one — two SPF records is a permanent failure.

### `namecheap_set_dkim` — write
| Param | Type | Notes |
| --- | --- | --- |
| `domain` | string | — |
| `selector` | string | From your mail provider, e.g. `google`. A `._domainkey` suffix is stripped if included. |
| `value` | string | Full TXT value; must contain `p=`. |
| `ttl` | int | Default 1799. |

Published at `<selector>._domainkey`.

### `namecheap_set_dmarc` — write
| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `domain` | string | — | — |
| `policy` | `none` \| `quarantine` \| `reject` | `none` | — |
| `subdomainPolicy` | same enum | — | `sp=` |
| `reportEmail` | string | — | `rua=` aggregate reports. |
| `forensicEmail` | string | — | `ruf=` failure reports. |
| `percentage` | int 1–100 | 100 | `pct=` |
| `ttl` | int | 1799 | — |

Warns when setting `p=reject` with no prior DMARC record, since that bounces legitimate mail not yet covered by SPF or DKIM.

### `namecheap_audit_email_auth` — read
| Param | Type | Notes |
| --- | --- | --- |
| `domain` | string | — |
| `dkimSelectors` | string[] | DKIM selectors cannot be enumerated from DNS. |

Flags: missing SPF, duplicate SPF, `+all`, lookup-limit breaches, missing DMARC, `p=none` with no reporting address, and absent MX.

---

## Live verification

These query public resolvers directly and need **no Namecheap credentials**. They work against any domain.

### `namecheap_verify_dns` — read
| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `domain` | string | — | — |
| `resolver` | `google` \| `cloudflare` \| `quad9` \| `system` | `google` | — |

Returns live A, AAAA, CNAME, MX, NS and TXT records.

### `namecheap_verify_email_auth` — read
| Param | Type | Default |
| --- | --- | --- |
| `domain` | string | — |
| `dkimSelectors` | string[] | `[]` |
| `resolver` | enum | `google` |

Reports the SPF, DMARC and DKIM records actually published, and detects the duplicate-SPF failure mode that only shows up in live DNS.
