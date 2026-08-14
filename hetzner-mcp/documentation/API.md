# hetzner-mcp — Tools

21 tools. Auth column: RO = read-only token, RW = read-write token required,
RW+C = read-write plus an exact-name `confirm` string.

## Inventory and audit (RO)

| Tool | Args | Returns |
|---|---|---|
| `hcloud_list_servers` | — | every server: IPs, type, DC, attached firewalls, protection, backup window |
| `hcloud_get_server` | `id` | full server JSON |
| `hcloud_server_metrics` | `id`, `type` (cpu\|disk\|network), `hours` 1-168 | avg/max per series — use to spot a miner |
| `hcloud_server_actions` | `id`, `limit` | recent API actions: the console-change audit trail |
| `hcloud_list_firewalls` | — | firewalls, rules, and which servers they are actually attached to |
| `hcloud_get_firewall` | `id` | full firewall JSON. Read before replacing rules |
| `hcloud_list_snapshots` | — | snapshots with status, size, source server |
| `hcloud_list_ssh_keys` | — | project SSH keys; an unexpected entry is a compromise signal |
| `hcloud_compliance_report` | — | project audited against the standard's Hetzner-answerable laws |

## Writes (RW)

| Tool | Args | Notes |
|---|---|---|
| `hcloud_create_snapshot` | `id`, `description` | the rollback point to create before any change |
| `hcloud_power_on_server` | `id` | — |
| `hcloud_reboot_server` | `id` | graceful ACPI. Downtime for every site on the host |
| `hcloud_create_firewall` | `name`, `rules[]`, `apply_to_server_ids[]?` | provider-edge, survives root compromise of the box |
| `hcloud_apply_firewall` | `id`, `server_ids[]` | attach an existing firewall |

## Destructive (RW+C)

Each requires `confirm` set to the resource's own exact name. Delete-protected resources refuse outright.

| Tool | Args | Destroys |
|---|---|---|
| `hcloud_set_firewall_rules` | `id`, `rules[]`, `confirm` | replaces the ENTIRE rule set; omitting 22 locks out SSH |
| `hcloud_power_off_server` | `id`, `confirm` | hard power cut; can corrupt data |
| `hcloud_delete_firewall` | `id`, `confirm` | servers lose that protection immediately |
| `hcloud_delete_snapshot` | `id`, `confirm` | a rollback point |
| `hcloud_delete_ssh_key` | `id`, `confirm` | project key only; `authorized_keys` on hosts is untouched |
| `hcloud_delete_server` | `id`, `confirm` | the server. Irreversible without a snapshot |
| `hcloud_rebuild_server` | `id`, `image`, `confirm` | all disk contents. This is Part 5 "rebuild, never clean" |

## Firewall rule shape

```json
{ "direction": "in", "protocol": "tcp", "port": "22",
  "source_ips": ["0.0.0.0/0", "::/0"], "description": "ssh" }
```

`direction: "in"` uses `source_ips`, `out` uses `destination_ips`. Omit `port` for icmp/esp/gre.
Hetzner firewalls are default-deny inbound, so an empty rule set blocks everything.

## Errors

`MissingTokenError` (token not loaded), `ConfirmationRequiredError` (destructive call refused),
`ProtectedResourceError` (Hetzner delete-protection on), `HetznerError` with the HTTP status —
401 invalid token, 403 read token used for a write, 429 rate limited.
No token value ever appears in an error message.
