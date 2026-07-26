#!/usr/bin/env bash
# Ships the complete, turnkey MCP handoff to the team channel.
#
#   bash documentation/ship-to-team.sh [CHANNEL_ID]
#
# Preflights first: refuses to post if the repo state would give the team
# instructions that cannot work. Then posts one message with three attachments
# (setup guide, bootstrap script, credentials) and a copy-paste block.

set -euo pipefail

CHANNEL="${1:-C0BJ3442J8N}"
MCP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cd "$MCP_ROOT"

# ── Preflight ────────────────────────────────────────────────────────────────
# The team clones from GitHub. Anything not pushed does not exist for them.
echo "==> Preflight"
fatal=0

for f in bootstrap.sh AGENT-SETUP.md documentation/config/mcp.template.json; do
  if git ls-tree -r origin/main --name-only 2>/dev/null | grep -qx "$f"; then
    echo "    ok      $f is on origin/main"
  else
    echo "    BLOCKED $f is not pushed — team's clone won't have it"
    fatal=1
  fi
done

for d in meta-business-mcp zoho-mail-mcp; do
  if git ls-tree -r origin/main --name-only 2>/dev/null | grep -q "^$d/"; then
    echo "    ok      $d is on origin/main"
  else
    echo "    BLOCKED $d is not pushed — team would be missing it"
    fatal=1
  fi
done

if [ "$fatal" -ne 0 ]; then
  cat >&2 <<'EOF'

Nothing was posted. Push first, then re-run:

  git add meta-business-mcp zoho-mail-mcp bootstrap.sh AGENT-SETUP.md documentation
  git commit -m "feat(mcp): add meta-business and zoho-mail servers, one-command bootstrap"
  git push -u origin main
EOF
  exit 1
fi

# ── Token ────────────────────────────────────────────────────────────────────
TOKEN="${SLACK_BOT_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$HOME/.config/haorgrix/slack.env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.config/haorgrix/slack.env"; TOKEN="${SLACK_BOT_TOKEN:-}"
fi
[ -z "$TOKEN" ] && { echo "No SLACK_BOT_TOKEN — regenerate from the onboarding doc" >&2; exit 1; }

# ── Build creds.txt ──────────────────────────────────────────────────────────
echo "==> Collecting credentials"
python3 - "$MCP_ROOT" "$STAGE" <<'PY'
import json, os, sys
root, stage = sys.argv[1], sys.argv[2]
tpl = json.load(open(os.path.join(root, "documentation/config/mcp.template.json")))

def env(server):
    p = os.path.join(root, server, ".env"); d = {}
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1); d[k.strip()] = v.strip().strip('"').strip("'")
    return d

SOURCE = {"brevo": "brevo-mcp", "cpanel-fernhillbd": "cpanel-mcp",
          "cpanel-fernhilluk": "cpanel-mcp", "google-analytics": "google-analytics-mcp",
          "google-search-console": "google-search-console-mcp",
          "meta-ads": "mcp-meta-ads_new", "meta-business": "meta-business-mcp",
          "wordpress-fernhillbd": "wordpress-mcp", "wordpress-fernhilluk": "wordpress-mcp",
          "zoho-mail": "zoho-mail-mcp"}

desktop = {}
dp = os.path.expanduser("~/Library/Application Support/Claude/claude_desktop_config.json")
if os.path.exists(dp):
    try: desktop = json.load(open(dp)).get("mcpServers", {})
    except (OSError, json.JSONDecodeError): pass

lines, blank = [], []
for name, entry in tpl["mcpServers"].items():
    src, live = env(SOURCE.get(name, "")), desktop.get(name, {}).get("env", {})
    lines.append("[%s]" % name)
    for k, v in entry["env"].items():
        got = v or live.get(k) or src.get(k) or ""
        lines.append("%s=%s" % (k, got))
        if not got: blank.append("%s.%s" % (name, k))
    lines.append("")

for svc in ("google-analytics-mcp", "google-search-console-mcp"):
    p = os.path.join(root, svc, "credentials.json")
    if os.path.exists(p):
        lines += ["[%s/credentials.json]" % svc, open(p).read().strip(), ""]

open(os.path.join(stage, "creds.txt"), "w").write("\n".join(lines))
print("    %d blank (expected): %s" % (len(blank), ", ".join(blank) or "none"))
PY

cp "$MCP_ROOT/AGENT-SETUP.md" "$STAGE/AGENT-SETUP.md"
cp "$MCP_ROOT/bootstrap.sh"   "$STAGE/bootstrap.sh"

# ── Post ─────────────────────────────────────────────────────────────────────
post_json() {
  curl -sS -X POST "https://slack.com/api/$1" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$2"
}

echo "==> Posting to $CHANNEL"
MSG=$(python3 -c '
import json, sys
print(json.dumps({
 "channel": sys.argv[1], "username": "Sibir", "icon_emoji": ":large_blue_circle:",
 "text": "\n".join([
  "*MCP setup — everything you need, three files below*",
  "",
  "8 servers, 188 tools. Download all three attachments, then run:",
  "```",
  "git clone https://github.com/HaorGrix/mcp-servers.git",
  "cd mcp-servers",
  "bash bootstrap.sh ~/Downloads/creds.txt",
  "claude mcp list",
  "```",
  "That is the whole setup. The bootstrap writes every .env and both",
  "service-account keys, builds all 8 servers, generates a config with the",
  "right absolute paths for *your* machine, registers with Claude Desktop and",
  "Claude Code, and verifies each one. Re-runnable, and it merges into your",
  "existing config rather than overwriting it.",
  "",
  "Node 20+ required. Restart Claude Desktop when it finishes.",
  "",
  "*Read AGENT-SETUP.md before calling anything.* Three of these hold live",
  "production access with no write gate: cpanel-mcp is root-equivalent on",
  "fernhillbd.com, wordpress-mcp is admin on the live Woo store including",
  "customer and order data, and meta-ads ships META_ALLOW_WRITES=true which",
  "can activate a campaign and start real spend. Read-only calls are fine;",
  "CLAIM here before any write, delete, or spend.",
  "",
  "Two known gaps, both expected and omitted from the config rather than",
  "shipped broken: zoho-mail has no credentials yet (needs a Zoho app",
  "password with IMAP enabled) and the WooCommerce WC_* keys were never",
  "generated.",
  "",
  "Stuck? AGENT-SETUP.md has a failure table covering every way this breaks.",
  "If it is not in there, post here."])}))' "$CHANNEL")

post_json chat.postMessage "$MSG" | python3 -c '
import json,sys; d=json.load(sys.stdin)
print("    " + ("posted" if d.get("ok") else "FAILED: %s" % d.get("error")))'

upload() {
  local file="$1" title="$2" comment="$3" name size up url fid res
  name="$(basename "$file")"; size="$(wc -c < "$file" | tr -d ' ')"
  up="$(curl -sS -G "https://slack.com/api/files.getUploadURLExternal" \
        -H "Authorization: Bearer $TOKEN" \
        --data-urlencode "filename=$name" --data-urlencode "length=$size")"
  url="$(printf '%s' "$up" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("upload_url",""))')"
  fid="$(printf '%s' "$up" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("file_id",""))')"
  [ -z "$url" ] && { echo "    upload-url failed for $name: $up" >&2; return 1; }
  curl -sS -X POST "$url" -F "file=@$file" > /dev/null
  res="$(post_json files.completeUploadExternal "$(python3 -c '
import json,sys; print(json.dumps({"files":[{"id":sys.argv[1],"title":sys.argv[2]}],
"channel_id":sys.argv[3],"initial_comment":sys.argv[4]}))' \
    "$fid" "$title" "$CHANNEL" "$comment")")"
  printf '%s' "$res" | python3 -c '
import json,sys; d=json.load(sys.stdin)
print("    " + ("uploaded" if d.get("ok") else "FAILED: %s" % d.get("error")))'
}

upload "$STAGE/AGENT-SETUP.md" "AGENT-SETUP.md" "1/3 — read this first. Setup, troubleshooting, and the production-access rules."
upload "$STAGE/bootstrap.sh"   "bootstrap.sh"   "2/3 — also in the repo. Only needed standalone if your clone is stale."
upload "$STAGE/creds.txt"      "creds.txt"      "3/3 — feed this to bootstrap.sh. Delete it locally once setup finishes."

echo "==> Done."
