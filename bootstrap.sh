#!/usr/bin/env bash
# HaorGrix MCP — one-command setup. Identical result on every machine.
#
#   bash bootstrap.sh /path/to/creds.txt
#
# Installs deps, builds all 8 servers, writes .env files and service-account
# keys from creds.txt, generates a config with paths correct for THIS machine,
# registers with Claude Desktop and Claude Code, then verifies every server.
#
# Safe to re-run. Existing config is merged into, never overwritten.

set -euo pipefail

MCP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREDS="${1:-}"

TS_SERVERS=(brevo-mcp cpanel-mcp google-analytics-mcp google-search-console-mcp
            meta-business-mcp wordpress-mcp zoho-mail-mcp)
JS_SERVERS=(mcp-meta-ads_new)

if [ -n "$CREDS" ] && [ ! -f "$CREDS" ]; then
  echo "no such file: $CREDS" >&2
  exit 1
fi

# No creds.txt is fine when the .env files are already on disk — that's the
# case on the machine the credentials came from. Only require it when there is
# nothing to fall back on.
if [ -z "$CREDS" ] && ! ls "$MCP_ROOT"/*/.env >/dev/null 2>&1; then
  echo "usage: bash bootstrap.sh /path/to/creds.txt" >&2
  echo "  creds.txt is the credential dump shared by the team lead." >&2
  echo "  It can be omitted only if the .env files already exist here." >&2
  exit 1
fi

command -v node >/dev/null || { echo "node not found — install Node 20+" >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "node $NODE_MAJOR too old — need 20+" >&2; exit 1; }

# ── 1. Credentials ───────────────────────────────────────────────────────────
if [ -z "$CREDS" ]; then
echo "==> Using existing .env files (no creds.txt given)"
else
echo "==> Writing credentials"
python3 - "$MCP_ROOT" "$CREDS" <<'PY'
import json, os, sys

root, creds_path = sys.argv[1], sys.argv[2]

# creds.txt is [section] blocks; env sections map to a server's .env, and the
# two credentials.json sections are raw JSON written straight to disk.
SECTION_ENV = {
    "brevo": "brevo-mcp",
    "cpanel-fernhillbd": "cpanel-mcp",
    "google-analytics": "google-analytics-mcp",
    "google-search-console": "google-search-console-mcp",
    "meta-ads": "mcp-meta-ads_new",
    "meta-business": "meta-business-mcp",
    "wordpress-fernhillbd": "wordpress-mcp",
    "zoho-mail": "zoho-mail-mcp",
}

sections, cur = {}, None
for line in open(creds_path):
    s = line.rstrip("\n")
    if s.startswith("[") and s.rstrip().endswith("]"):
        cur = s.strip()[1:-1]
        sections[cur] = []
    elif cur:
        sections[cur].append(s)

wrote = []

for name, body in sections.items():
    if name.endswith("credentials.json"):
        dest = os.path.join(root, name)
        text = "\n".join(body).strip()
        try:
            json.loads(text)
        except json.JSONDecodeError as e:
            print(f"    SKIP {name}: not valid JSON ({e})")
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w") as f:
            f.write(text + "\n")
        os.chmod(dest, 0o600)
        wrote.append(name)
        continue

    server = SECTION_ENV.get(name)
    if not server:
        continue
    pairs = [l for l in body if "=" in l and not l.strip().startswith("#")]
    # A blank value means the credential does not exist yet — don't write it.
    pairs = [l for l in pairs if l.split("=", 1)[1].strip()]
    if not pairs:
        print(f"    skip  {server}/.env (no values in creds.txt)")
        continue
    dest = os.path.join(root, server, ".env")
    if not os.path.isdir(os.path.dirname(dest)):
        print(f"    SKIP {server}: directory missing")
        continue
    with open(dest, "w") as f:
        f.write("\n".join(pairs) + "\n")
    os.chmod(dest, 0o600)
    wrote.append(f"{server}/.env")

for w in wrote:
    print(f"    wrote {w}")
PY
fi

# ── 2. Build ─────────────────────────────────────────────────────────────────
echo "==> Installing and building"
failed=()
for d in "${TS_SERVERS[@]}"; do
  if [ ! -d "$MCP_ROOT/$d" ]; then
    echo "    MISSING $d — repo is incomplete, pull latest main"; failed+=("$d"); continue
  fi
  if (cd "$MCP_ROOT/$d" && npm ci --silent >/dev/null 2>&1 && npm run build >/dev/null 2>&1); then
    echo "    built   $d"
  else
    echo "    FAILED  $d"; failed+=("$d")
  fi
done
for d in "${JS_SERVERS[@]}"; do
  if (cd "$MCP_ROOT/$d" && npm ci --silent >/dev/null 2>&1); then
    echo "    ok      $d"
  else
    echo "    FAILED  $d"; failed+=("$d")
  fi
done

# ── 3. Config for THIS machine ───────────────────────────────────────────────
echo "==> Generating config"
GENERATED="$MCP_ROOT/.mcp.generated.json"
python3 - "$MCP_ROOT" "$GENERATED" <<'PY'
import json, os, sys

root, out = sys.argv[1], sys.argv[2]
tpl = json.load(open(os.path.join(root, "documentation/config/mcp.template.json")))

def env(server):
    path = os.path.join(root, server, ".env")
    d = {}
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                d[k.strip()] = v.strip().strip('"').strip("'")
    return d

SOURCE = {
    "brevo": "brevo-mcp",
    "cpanel-fernhillbd": "cpanel-mcp", "cpanel-fernhilluk": "cpanel-mcp",
    "google-analytics": "google-analytics-mcp",
    "google-search-console": "google-search-console-mcp",
    "meta-ads": "mcp-meta-ads_new", "meta-business": "meta-business-mcp",
    "wordpress-fernhillbd": "wordpress-mcp", "wordpress-fernhilluk": "wordpress-mcp",
    "zoho-mail": "zoho-mail-mcp",
}

drop = []
for name, entry in list(tpl["mcpServers"].items()):
    entry["args"] = [a.replace("__MCP_ROOT__", root) for a in entry["args"]]
    src = env(SOURCE.get(name, ""))
    for k, v in entry["env"].items():
        entry["env"][k] = (v or src.get(k, "")).replace("__MCP_ROOT__", root)
    # A server with no credentials at all would fail on launch and show as a
    # red error in the client. Leave it out rather than ship a broken entry.
    required = [k for k in entry["env"] if k not in
                ("META_ALLOW_WRITES", "ZOHO_READ_ONLY", "BREVO_AUDIT_LOG",
                 "BREVO_ENFORCE_SENDER", "ZOHO_IMAP_HOST", "ZOHO_IMAP_PORT",
                 "WC_CONSUMER_KEY", "WC_CONSUMER_SECRET")]
    if not any(entry["env"].get(k) for k in required):
        drop.append(name)
        del tpl["mcpServers"][name]
        continue
    if not os.path.exists(entry["args"][0]):
        drop.append(name + " (not built)")
        del tpl["mcpServers"][name]

json.dump(tpl, open(out, "w"), indent=2)
os.chmod(out, 0o600)
print(f"    {len(tpl['mcpServers'])} servers configured")
if drop:
    print(f"    omitted: {', '.join(drop)}")
PY

# ── 4. Register ──────────────────────────────────────────────────────────────
echo "==> Registering with Claude Desktop"
if [ "$(uname)" = "Darwin" ]; then
  DEST="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
else
  DEST="${APPDATA:-$HOME}/Claude/claude_desktop_config.json"
fi
mkdir -p "$(dirname "$DEST")"
[ -f "$DEST" ] && cp "$DEST" "$DEST.bak.$$" && echo "    backed up existing config"
python3 - "$GENERATED" "$DEST" <<'PY'
import json, os, sys
gen, dest = sys.argv[1], sys.argv[2]
new = json.load(open(gen))["mcpServers"]
cur = {}
if os.path.exists(dest):
    try:
        cur = json.load(open(dest))
    except (OSError, json.JSONDecodeError):
        print("    existing config unreadable — backup kept, writing fresh")
cur.setdefault("mcpServers", {}).update(new)   # merge: other servers survive
json.dump(cur, open(dest, "w"), indent=2)
print(f"    merged {len(new)} servers into {dest}")
PY

echo "==> Registering with Claude Code"
if command -v claude >/dev/null 2>&1; then
  python3 -c '
import json,sys
print("\n".join(json.load(open(sys.argv[1]))["mcpServers"].keys()))' "$GENERATED" |
  while read -r name; do
    claude mcp remove "$name" >/dev/null 2>&1 || true
    args="$(python3 -c '
import json,sys
e=json.load(open(sys.argv[1]))["mcpServers"][sys.argv[2]]
print(" ".join(f"-e {k}={v}" for k,v in e["env"].items() if v), "--", e["command"], *e["args"])' "$GENERATED" "$name")"
    # shellcheck disable=SC2086
    if claude mcp add "$name" $args >/dev/null 2>&1; then
      echo "    added   $name"
    else
      echo "    FAILED  $name"
    fi
  done
else
  echo "    claude CLI not on PATH — Desktop registration still applied"
fi

# ── 5. Verify ────────────────────────────────────────────────────────────────
echo "==> Verifying"
python3 -c '
import json,sys
print("\n".join(json.load(open(sys.argv[1]))["mcpServers"].keys()))' "$GENERATED" |
while read -r name; do
  entry="$(python3 -c '
import json,sys
e=json.load(open(sys.argv[1]))["mcpServers"][sys.argv[2]]
print(e["args"][0])' "$GENERATED" "$name")"
  if [ -f "$entry" ]; then echo "    ok      $name"; else echo "    BROKEN  $name -> $entry"; fi
done

echo
if [ ${#failed[@]} -gt 0 ]; then
  echo "!! ${#failed[@]} server(s) failed to build: ${failed[*]}"
  echo "   Re-run their build alone to see the error:"
  echo "   cd $MCP_ROOT/${failed[0]} && npm run build"
fi
echo "Done. Restart Claude Desktop. Verify with: claude mcp list"
