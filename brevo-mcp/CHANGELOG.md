# Changelog

## [2026-07-21] — Production hardening

### Added
- `config.ts`, validated boot-time configuration. Rejects a missing or
  wrong-prefix API key, a non-email sender lock, and out-of-range numerics.
  Fails at boot rather than mid-campaign.
- `ratelimit.ts`, token bucket plus exponential backoff with full jitter.
- `audit.ts`, append-only JSONL record of every mutating call.
- Retry on 429/408/5xx honouring `Retry-After`, never on 4xx.
- Per-request timeout via `AbortController`.
- `BREVO_DRY_RUN`, refuses every write while still auditing the intent, so a
  full campaign can be rehearsed before going live.
- API key redaction on every error path and log line.
- `client.getAll`, pagination with a runaway cap.
- `brevo_preflight`, pass/fail readiness checklist.
- 34 tests across `src/tests/`, network stubbed, plus `npm run check`.
- `TESTING.md`, covering server, templates and campaign testing.

### Fixed
- `loadConfig` read `process.env` directly inside its numeric and boolean
  helpers, ignoring the injected env argument. Found by the new tests.

## [2026-07-21] — Initial build

Built for the Podium Tutoring campaign rebuild.

### Added
- Brevo API v3 client with typed errors, network failure handling, and empty
  body handling for 204 responses.
- Account tools: account, senders, domain authentication status.
- Contact tools: lists, folders, single contact lookup, list membership,
  async CSV import with status polling, permanent blacklist.
- Campaign tools: list, get, create (draft only), update, send test,
  send now, schedule.
- Statistics tools: per-recipient event query, cross-campaign deliverability
  report with computed bounce, open and click rates.

### Safety
- Campaigns can only be created as drafts. No create-and-send path exists.
- `brevo_send_campaign_now` requires `confirm: "SEND"`, scheduling requires
  `confirm: "SCHEDULE"`.
- Optional `BREVO_ENFORCE_SENDER` blocks any create or send using a different
  From address, checked before the request leaves the machine.
- `brevo_campaign_report` warns on free-mailbox senders, bounce rates over 3%
  and complaint rates over 0.1%.

### Verified
- `npx tsc` clean from a removed dist, exit 0.
- stdio handshake returns all 20 tools.
