#!/usr/bin/env bash
# Launcher: decrypts tokens with SOPS into the process environment, never to disk (Law 1).
#
#   ./scripts/launch.sh        -> read-only  (default, safe)
#   ./scripts/launch.sh --rw   -> read-write (destructive tools become callable)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

# SOPS_AGE_KEY_FILE takes ONE path, not a colon-separated list. Multiple identities must be
# concatenated into a single keyring file, which is what haorgrix-infra.txt is. Passing a
# colon list silently loads nothing and every decrypt fails.
KEYRING="$HOME/.config/sops/age/haorgrix-infra.txt"

command -v sops >/dev/null || { echo "sops not installed: brew install sops age" >&2; exit 1; }
[ -f "$KEYRING" ] || {
  echo "missing age keyring: $KEYRING" >&2
  echo "rebuild it: cat ~/.config/sops/age/haorgrix-infra-{prod,dev}.txt > $KEYRING && chmod 600 $KEYRING" >&2
  exit 1
}
export SOPS_AGE_KEY_FILE="$KEYRING"

load() { # load <sops-file> <var-name>
  local f="$1" var="$2" val
  [ -f "$f" ] || return 1
  val="$(sops -d --input-type dotenv --output-type dotenv "$f" 2>/dev/null \
        | grep -E "^${var}=" | head -1 | cut -d= -f2- | tr -d '"'"'"'\r')"
  [ -n "$val" ] || return 1
  printf '%s' "$val"
}

if RO="$(load secrets/hcloud.ro.sops.env HCLOUD_TOKEN_RO)"; then
  export HCLOUD_TOKEN_RO="$RO"
  HAVE_RO=1
else
  HAVE_RO=0
fi

if [ "${1:-}" = "--rw" ]; then
  if RW="$(load secrets/hcloud.rw.sops.env HCLOUD_TOKEN_RW)"; then
    export HCLOUD_TOKEN_RW="$RW"
    # A read-write token can obviously also read. If no dedicated read-only token exists,
    # reuse it so the read tools work at all -- but say so, because it means this session
    # has write capability even for plain inventory calls.
    if [ "$HAVE_RO" -eq 0 ]; then
      export HCLOUD_TOKEN_RO="$RW"
      echo "hetzner-mcp: WRITE ACCESS ENABLED" >&2
      echo "WARNING: no read-only token configured, so the read-write token is serving reads too." >&2
      echo "         Every call in this session is backed by a fleet-deleting credential." >&2
      echo "         Create a Read-only token in the Hetzner console and encrypt it to" >&2
      echo "         secrets/hcloud.ro.sops.env to restore the safe default." >&2
    else
      echo "hetzner-mcp: WRITE ACCESS ENABLED" >&2
    fi
  else
    echo "ERROR: --rw requested but secrets/hcloud.rw.sops.env could not be decrypted." >&2
    echo "The prod age key is required for that file." >&2
  fi
elif [ "$HAVE_RO" -eq 0 ]; then
  echo "ERROR: no read-only token available and --rw not passed. No tool will work." >&2
  echo "Either encrypt a Read-only token to secrets/hcloud.ro.sops.env, or pass --rw." >&2
fi

unset RO RW HAVE_RO
exec node dist/index.js
