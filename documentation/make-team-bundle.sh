#!/usr/bin/env bash
# Builds a complete, credentialed MCP handoff bundle for the team.
#
#   bash documentation/make-team-bundle.sh
#
# Produces an encrypted archive on your Desktop containing the full source, every
# .env, both service-account keys, and a ready-to-use config with real values.
# The plaintext staging directory is shredded before exit.
#
# The passphrase is printed once. Send it to the team over a DIFFERENT channel
# than the archive itself.

set -euo pipefail

MCP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$(mktemp -d)"
OUT="$HOME/Desktop/haorgrix-mcp-handoff.tar.gz.enc"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

echo "==> Staging source from $MCP_ROOT"
rsync -a \
  --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
  --exclude '.DS_Store' --exclude 'archive' \
  --exclude 'audit_results.json' --exclude 'deep_audit_results.json' \
  "$MCP_ROOT/" "$STAGE/servers/"

echo "==> Confirming credentials came across"
missing=0
for f in brevo-mcp/.env cpanel-mcp/.env google-analytics-mcp/.env \
         google-search-console-mcp/.env mcp-meta-ads_new/.env \
         meta-business-mcp/.env wordpress-mcp/.env \
         google-analytics-mcp/credentials.json \
         google-search-console-mcp/credentials.json; do
  if [ -s "$STAGE/servers/$f" ]; then
    echo "    ok      $f"
  else
    echo "    MISSING $f"
    missing=$((missing + 1))
  fi
done
[ "$missing" -gt 0 ] && echo "    ($missing missing — zoho-mail-mcp has no .env yet; expected)"

echo "==> Generating config with real values"
python3 - "$STAGE" "$MCP_ROOT" <<'PY'
import json, os, re, sys

stage, root = sys.argv[1], sys.argv[2]
tpl = json.load(open(os.path.join(root, "documentation/config/mcp.template.json")))

def env(server):
    """Parse a server's .env into a dict, ignoring comments and blank lines."""
    path = os.path.join(root, server, ".env")
    out = {}
    if not os.path.exists(path):
        return out
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out

# Which .env feeds which config entry. Per-site servers share one .env, so the
# site-specific entries fall back to the desktop config below.
SOURCE = {
    "brevo": "brevo-mcp",
    "cpanel-fernhillbd": "cpanel-mcp",
    "cpanel-fernhilluk": "cpanel-mcp",
    "google-analytics": "google-analytics-mcp",
    "google-search-console": "google-search-console-mcp",
    "meta-ads": "mcp-meta-ads_new",
    "meta-business": "meta-business-mcp",
    "wordpress-fernhillbd": "wordpress-mcp",
    "wordpress-fernhilluk": "wordpress-mcp",
    "zoho-mail": "zoho-mail-mcp",
}

# The live desktop config holds the per-site cPanel/WordPress creds that the
# single shared .env cannot represent. Paths in it are stale; only env is used.
desktop = {}
dp = os.path.expanduser(
    "~/Library/Application Support/Claude/claude_desktop_config.json")
if os.path.exists(dp):
    try:
        desktop = json.load(open(dp)).get("mcpServers", {})
    except (OSError, json.JSONDecodeError) as e:
        print(f"    warn: could not read desktop config ({e})")

filled = blank = 0
for name, entry in tpl["mcpServers"].items():
    src = env(SOURCE.get(name, ""))
    live = desktop.get(name, {}).get("env", {})
    for key, val in entry["env"].items():
        if val:                      # non-secret default already set
            continue
        got = live.get(key) or src.get(key) or ""
        entry["env"][key] = got
        if got:
            filled += 1
        else:
            blank += 1
            print(f"    blank   {name}.{key}")

# Absolute paths get rewritten by install.sh on the receiving machine.
out = os.path.join(stage, "claude_desktop_config.json")
json.dump(tpl, open(out, "w"), indent=2)
print(f"    filled {filled} values, {blank} left blank")
PY

echo "==> Writing install.sh for the receiving machine"
cat > "$STAGE/install.sh" <<'INSTALL'
#!/usr/bin/env bash
# Run this after unpacking. Builds every server and installs the config.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_ROOT="$HERE/servers"

echo "==> Building (this compiles dist/ — the config will not work without it)"
for d in brevo-mcp cpanel-mcp google-analytics-mcp google-search-console-mcp \
         meta-business-mcp wordpress-mcp zoho-mail-mcp; do
  (cd "$MCP_ROOT/$d" && npm ci --silent && npm run build) \
    || { echo "    FAILED: $d"; continue; }
  echo "    built   $d"
done
(cd "$MCP_ROOT/mcp-meta-ads_new" && npm ci --silent) && echo "    ok      mcp-meta-ads_new"

echo "==> Pointing config at $MCP_ROOT"
python3 - "$HERE" "$MCP_ROOT" <<'PY'
import json, os, sys
here, root = sys.argv[1], sys.argv[2]
cfg = json.load(open(os.path.join(here, "claude_desktop_config.json")))
for entry in cfg["mcpServers"].values():
    entry["args"] = [a.replace("__MCP_ROOT__", root) for a in entry["args"]]
    for k, v in entry["env"].items():
        if isinstance(v, str):
            entry["env"][k] = v.replace("__MCP_ROOT__", root)
json.dump(cfg, open(os.path.join(here, "claude_desktop_config.json"), "w"), indent=2)
print("    paths resolved")
PY

DEST="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
[ "$(uname)" != "Darwin" ] && DEST="$APPDATA/Claude/claude_desktop_config.json"

if [ -f "$DEST" ]; then
  cp "$DEST" "$DEST.bak"
  echo "==> Existing config backed up to $DEST.bak — MERGE, do not overwrite:"
  echo "    $HERE/claude_desktop_config.json"
else
  mkdir -p "$(dirname "$DEST")"
  cp "$HERE/claude_desktop_config.json" "$DEST"
  echo "==> Installed to $DEST"
fi

echo "==> Restart Claude Desktop, then verify with: claude mcp list"
INSTALL
chmod +x "$STAGE/install.sh"

cp "$MCP_ROOT/documentation/TEAM-SETUP.md" "$STAGE/README.md"

echo "==> Encrypting"
PASS="$(openssl rand -base64 24)"
tar -czf - -C "$STAGE" . \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "pass:$PASS" -out "$OUT"

chmod 600 "$OUT"

cat <<EOF

────────────────────────────────────────────────────────────
Archive     $OUT
Passphrase  $PASS

Send the archive and the passphrase over SEPARATE channels.

Team decrypts with:
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in haorgrix-mcp-handoff.tar.gz.enc | tar -xzf -
  bash install.sh
────────────────────────────────────────────────────────────
EOF
