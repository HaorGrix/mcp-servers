#!/usr/bin/env bash
# Law 9 gates, run locally because GitHub Actions is billing-blocked.
# Same checks a CI job would run; the executor is this laptop.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0

echo "== typecheck (clean build, no incremental masking) =="
rm -rf dist && npx tsc || fail=1

echo "== gitleaks: secret scan over full history =="
if command -v gitleaks >/dev/null; then
  gitleaks detect --source . --no-banner || fail=1
else
  echo "SKIP: gitleaks not installed (brew install gitleaks)"; fail=1
fi

echo "== trivy config: IaC / misconfig =="
if command -v trivy >/dev/null; then
  trivy config . --exit-code 1 --quiet || fail=1
else
  echo "SKIP: trivy not installed (brew install trivy)"; fail=1
fi

echo "== plaintext secret files must not exist =="
if ls secrets/*.env 2>/dev/null | grep -v '\.sops\.env$' | grep -q .; then
  echo "FAIL: plaintext file in secrets/"; fail=1
else
  echo "OK: secrets/ holds only .sops.env"
fi

[ "$fail" -eq 0 ] && echo "ALL GATES PASSED" || echo "GATES FAILED"
exit "$fail"
