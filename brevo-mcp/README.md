# brevo-mcp

MCP server for the Brevo API v3. Covers account and sender checks, contact
lists and imports, campaign creation and sending, and per-recipient event
statistics.

Built for the Podium Tutoring email programme, but nothing in it is Podium
specific apart from the default sender lock in `.env.example`.

## Setup

```bash
npm install
cp .env.example .env    # then paste the API key
npm run build
```

Get the API key from Brevo, SMTP & API, API keys, Create a new API key.

### Environment

| Var | Required | Purpose |
|---|---|---|
| `BREVO_API_KEY` | yes | `xkeysib-...` key |
| `BREVO_ENFORCE_SENDER` | no | Locks every send to one From address |
| `BREVO_BASE_URL` | no | Defaults to `https://api.brevo.com/v3` |

### Register with Claude Code

```bash
claude mcp add brevo -- node /Users/musfiqurtuhin/Documents/HaorGrix/Tooling/MCP/brevo-mcp/dist/index.js
```

## Safety design

Sending email is irreversible and outward facing, so the write paths are
deliberately awkward.

**Campaigns are always created as drafts.** `brevo_create_campaign` has no
send option. Firing one is a separate, explicit call.

**Sending requires a literal confirm token.** `brevo_send_campaign_now` will
not accept anything except `confirm: "SEND"`, and scheduling needs
`confirm: "SCHEDULE"`. A malformed or hopeful call fails closed.

**The sender can be locked.** Set `BREVO_ENFORCE_SENDER=abir@podiumtutoring.com`
and any attempt to create or send from another address throws before the
request leaves the machine. This exists because 26 of 27 Podium campaigns went
out from `podiumtutor@gmail.com`, which Brevo cannot DKIM-sign for gmail.com,
which is what put the mail in spam. The tool layer now refuses to repeat it.

**`brevo_campaign_report` flags the same mistake retroactively.** Any campaign
sent from a gmail, yahoo, hotmail or outlook address is reported with an
explicit warning, alongside bounce rates over 3% and complaint rates over 0.1%.

## Tools

### Account
- `brevo_get_account`, plan and remaining credits
- `brevo_list_senders`, verified sender identities
- `brevo_check_domain_auth`, DKIM, DMARC and Brevo-code status for a domain

### Contacts
- `brevo_list_lists`, `brevo_create_list`, `brevo_list_folders`
- `brevo_get_contact`, `brevo_list_contacts_in_list`
- `brevo_import_contacts`, bulk CSV import, returns a processId
- `brevo_get_import_status`
- `brevo_blacklist_contact`, permanent opt-out

### Campaigns
- `brevo_list_campaigns`, `brevo_get_campaign`
- `brevo_create_campaign`, always a draft
- `brevo_update_campaign`
- `brevo_send_test_email`, safe, goes only to named addresses
- `brevo_send_campaign_now`, irreversible, needs `confirm: "SEND"`
- `brevo_schedule_campaign`, needs `confirm: "SCHEDULE"`

### Statistics
- `brevo_get_email_events`, per-recipient bounces, complaints, opens, clicks
- `brevo_campaign_report`, cross-campaign deliverability with warnings

## Known limits

**Brevo cannot see replies.** For a reply-driven campaign, open and click rate
are noise. There is no API that reports "someone replied", because replies go
to the Reply-To mailbox and never touch Brevo. Count them by hand.

Apple Mail Privacy Protection prefetches images, so unique opens overstate
real readership, often by half. `brevo_campaign_report` notes this but cannot
subtract it, since Brevo does not expose an MPP flag on the campaign endpoint.
