#!/usr/bin/env bash
# Posts the full MCP credential set to a private Slack channel.
#
#   bash documentation/post-creds-to-slack.sh [CHANNEL_ID]
#
# Defaults to #tools (C0BJ3442J8N). Posts as Sibir per the agent identity rule.
#
# Uploads two files rather than pasting into the message body: a filled
# claude_desktop_config.json and a creds.txt with every raw value. Files can be
# deleted from Slack later; message text is far stickier in exports and search.

set -euo pipefail

CHANNEL="${1:-C0BJ3442J8N}"
MCP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# ── Slack token ──────────────────────────────────────────────────────────────
# Authoritative source is AGENT-COWORK-ONBOARDING-CONFIDENTIAL.md (~line 21);
# ~/.config/haorgrix/slack.env gets wiped periodically, so fall back to the doc.
TOKEN="${SLACK_BOT_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$HOME/.config/haorgrix/slack.env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.config/haorgrix/slack.env"
  TOKEN="${SLACK_BOT_TOKEN:-}"
fi
if [ -z "$TOKEN" ]; then
  echo "No Slack token. Export SLACK_BOT_TOKEN, or regenerate" >&2
  echo "~/.config/haorgrix/slack.env from AGENT-COWORK-ONBOARDING-CONFIDENTIAL.md" >&2
  exit 1
fi

# ── Build the filled config + a flat credential dump ─────────────────────────
echo "==> Collecting credentials"
python3 - "$MCP_ROOT" "$STAGE" <<'PY'
import json, os, sys

root, stage = sys.argv[1], sys.argv[2]
tpl = json.load(open(os.path.join(root, "documentation/config/mcp.template.json")))

def env(server):
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

SOURCE = {
    "brevo": "brevo-mcp",
    "cpanel-fernhillbd": "cpanel-mcp", "cpanel-fernhilluk": "cpanel-mcp",
    "google-analytics": "google-analytics-mcp",
    "google-search-console": "google-search-console-mcp",
    "meta-ads": "mcp-meta-ads_new", "meta-business": "meta-business-mcp",
    "wordpress-fernhillbd": "wordpress-mcp", "wordpress-fernhilluk": "wordpress-mcp",
    "zoho-mail": "zoho-mail-mcp",
}

desktop = {}
dp = os.path.expanduser("~/Library/Application Support/Claude/claude_desktop_config.json")
if os.path.exists(dp):
    try:
        desktop = json.load(open(dp)).get("mcpServers", {})
    except (OSError, json.JSONDecodeError) as e:
        print(f"    warn: desktop config unreadable ({e})")

lines, blanks = [], []
for name, entry in tpl["mcpServers"].items():
    src = env(SOURCE.get(name, ""))
    live = desktop.get(name, {}).get("env", {})
    lines.append(f"[{name}]")
    for key, val in entry["env"].items():
        got = val or live.get(key) or src.get(key) or ""
        entry["env"][key] = got
        lines.append(f"{key}={got}")
        if not got:
            blanks.append(f"{name}.{key}")
    lines.append("")

json.dump(tpl, open(os.path.join(stage, "claude_desktop_config.json"), "w"), indent=2)

# Service-account keys are files, not env values — inline them so nothing is lost.
for svc in ("google-analytics-mcp", "google-search-console-mcp"):
    p = os.path.join(root, svc, "credentials.json")
    if os.path.exists(p):
        lines.append(f"[{svc}/credentials.json]")
        lines.append(open(p).read().strip())
        lines.append("")

open(os.path.join(stage, "creds.txt"), "w").write("\n".join(lines))
print(f"    {len(blanks)} blank: {', '.join(blanks) if blanks else 'none'}")
PY

# ── Upload ───────────────────────────────────────────────────────────────────
upload() {
  local file="$1" title="$2" comment="$3"
  local name size url fid
  name="$(basename "$file")"
  size="$(wc -c < "$file" | tr -d ' ')"

  local up
  up="$(curl -sS -G "https://slack.com/api/files.getUploadURLExternal" \
        -H "Authorization: Bearer $TOKEN" \
        --data-urlencode "filename=$name" --data-urlencode "length=$size")"
  [ "$(printf '%s' "$up" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("ok"))')" = "True" ] || {
    echo "    getUploadURL failed: $up" >&2; return 1; }

  url="$(printf '%s' "$up" | python3 -c 'import json,sys; print(json.load(sys.stdin)["upload_url"])')"
  fid="$(printf '%s' "$up" | python3 -c 'import json,sys; print(json.load(sys.stdin)["file_id"])')"

  curl -sS -X POST "$url" -F "file=@$file" > /dev/null

  local res
  res="$(curl -sS -X POST "https://slack.com/api/files.completeUploadExternal" \
        -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
        -d "$(python3 -c 'import json,sys; print(json.dumps({
              "files":[{"id":sys.argv[1],"title":sys.argv[2]}],
              "channel_id":sys.argv[3],"initial_comment":sys.argv[4]}))' \
              "$fid" "$title" "$CHANNEL" "$comment")")"
  [ "$(printf '%s' "$res" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("ok"))')" = "True" ] \
    && echo "    uploaded $name" \
    || { echo "    upload failed: $res" >&2; return 1; }
}

echo "==> Posting to $CHANNEL"
curl -sS -X POST "https://slack.com/api/chat.postMessage" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({
        "channel": sys.argv[1],
        "username": "Sibir",
        "icon_emoji": ":large_blue_circle:",
        "text": ("*MCP handoff — 8 servers, live credentials*\n\n"
                 "Two files below: the Claude Desktop config with real values, "
                 "and a flat dump of every credential incl. both Google "
                 "service-account keys.\n\n"
                 "Setup: clone the MCP repo, `npm ci && npm run build` in each "
                 "server dir (dist/ is not committed and nothing works without "
                 "it), then fix the absolute paths in the config to match your "
                 "machine and restart Claude Desktop.\n\n"
                 "Not included, because they do not exist yet: zoho-mail needs "
                 "a fresh Zoho app password with IMAP enabled, and the "
                 "WooCommerce WC_* keys were never generated.")}))' "$CHANNEL")" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("    " + ("posted" if d.get("ok") else "FAILED: " + str(d)))'

upload "$STAGE/claude_desktop_config.json" "claude_desktop_config.json" "Drop-in config — fix the paths first."
upload "$STAGE/creds.txt" "creds.txt" "All raw values + both service-account keys."

echo "==> Done."
