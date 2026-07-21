# Testing guide

Two things need testing here, and they fail in completely different ways.
The MCP server fails loudly in a terminal. A campaign fails silently, a month
later, when nobody replies. Test both.

---

## Part 1, the MCP server

### 1.1 Automated suite

```bash
cd /Users/musfiqurtuhin/Documents/HaorGrix/Tooling/MCP/brevo-mcp
npm run check          # typecheck plus 34 tests
```

Expect `pass 34`, `fail 0`. `npm run check` is the gate; nothing ships red.

Individual runs:

```bash
npm run typecheck      # tsc --noEmit
npm test               # node:test via tsx
```

The suite hits no network. `client.test.ts` replaces `globalThis.fetch` with a
scripted queue, so retry and backoff behaviour is tested deterministically
rather than by waiting on Brevo.

What it covers:

| Area | Cases |
|---|---|
| Config | key validation, prefix check, sender normalising, numeric bounds, boolean spellings |
| Redaction | api key stripped from arbitrary text |
| Rate limiter | burst to capacity, throttle when empty, refill over time, no unbounded credit |
| Backoff | stays under the exponential ceiling, capped at 20s |
| Retry policy | retries 429/408/5xx, never retries 4xx |
| Client | parsed success, empty 204, retry-then-succeed, exhaustion, error surfacing, key never leaked |
| Dry run | writes refused, reads allowed, refusal still audited |
| Audit | writes logged, reads not logged |
| Pagination | walks pages, stops on short page, stops on empty page |

### 1.2 Clean build

Incremental builds hide errors, so always start from nothing.

```bash
rm -rf dist
npx tsc
echo "exit=$?"     # must be 0
```

### 1.3 Boot and handshake, no API key needed

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | BREVO_API_KEY=xkeysib-dummy node dist/index.js 2>/dev/null \
  | python3 -c "import sys,json; [print(' -',t['name']) for l in sys.stdin if (d:=json.loads(l)).get('id')==2 for t in d['result']['tools']]"
```

Expect 21 tool names. This proves registration without touching Brevo.

### 1.4 Config guards

Each of these must refuse to start:

```bash
node dist/index.js                                    # no key
BREVO_API_KEY=wrong-prefix node dist/index.js         # bad prefix
BREVO_API_KEY=xkeysib-x BREVO_RPS=0 node dist/index.js        # out of range
BREVO_API_KEY=xkeysib-x BREVO_DRY_RUN=maybe node dist/index.js # bad boolean
BREVO_API_KEY=xkeysib-x BREVO_ENFORCE_SENDER=abir node dist/index.js # not an email
```

Each prints `[brevo-mcp] Configuration error: ...` and exits 1. A server that
starts with bad config and fails at send time is worse than one that refuses
to boot.

### 1.5 Live checks, once a real key is in .env

Run in this order. Stop at the first failure.

```bash
# 1. Preflight. Do this before every campaign, not just the first.
#    Verifies key, credits, and that the enforced sender exists and is active.
brevo_preflight

# 2. Confirm the domain sender is really verified
brevo_list_senders

# 3. Confirm DKIM and DMARC
brevo_check_domain_auth  domain=podiumtutoring.com

# 4. Pull the truth about the 27 failed campaigns
brevo_campaign_report  limit=30
```

Step 4 should flag every campaign sent from `podiumtutor@gmail.com` with a
free-mailbox warning, plus any bounce rate over 3%. If it does not, the report
logic is wrong and worth fixing before trusting anything else it says.

### 1.6 Dry run rehearsal

Before the first real send, run the whole sequence with writes disabled:

```bash
BREVO_DRY_RUN=1 node dist/index.js
```

Every write throws `DryRunError` and is still written to `audit.jsonl` with
`"status":"dry-run"`. Read that file afterwards. It is the exact list of what
would have happened. If anything in it surprises you, do not go live.

```bash
cat audit.jsonl | python3 -m json.tool --json-lines
```

---

## Part 2, the email templates

```bash
cd "/Users/musfiqurtuhin/Documents/HaorGrix/Clients/Podium/Email Marketing/templates"
python3 build_templates.py           # render to out/
python3 build_templates.py --check   # verify out/ matches source, CI safe
```

The builder refuses to emit a template that has an unreplaced placeholder, is
missing `{{unsubscribe}}`, references the old gmail sender, carries an
unexpected tracked link, or exceeds 102KB. Any of those exits 1.

The tracked-link rule matters more than it looks. These campaigns convert by
reply, so a body full of tracked URLs adds spam signal and buys nothing.

### Rendering checks, done by eye

Send a test to all four, because they break differently:

```
brevo_send_test_email campaignId=<id> emails=["gmail","outlook","yahoo","icloud"]
```

| Client | What breaks |
|---|---|
| Gmail web | clips over 102KB, strips `<style>` blocks |
| Gmail mobile app | narrow preview, 600px is the safe ceiling |
| Outlook desktop | ignores flexbox and modern CSS, needs the table layout |
| Apple Mail | prefetches images, which is what inflates open rate |

Check on a phone, not just a laptop. Most parents read email on a phone.

### Spam scoring

Run one template through mail-tester.com before the first campaign. Aim for
9/10 or better. A score below 8 usually means SPF, DKIM or DMARC is wrong, and
SPF is the known gap here until `include:spf.brevo.com` is added.

---

## Part 3, the campaign itself

This is the part that actually decides whether the work succeeded.

### Pre-send checklist

- [ ] `brevo_preflight` returns `ready: true`
- [ ] Sender is `abir@podiumtutoring.com`, never the gmail address
- [ ] Reply-To is a mailbox someone opens daily
- [ ] SPF contains `include:spf.brevo.com` (`dig +short TXT podiumtutoring.com`)
- [ ] List verified through ZeroBounce or NeverBounce, invalids removed
- [ ] Suppression list attached as an exclusion list
- [ ] Test email read on a phone
- [ ] Recipient count matches what you expect, checked in the draft

### Send a seed batch first

Never open at full volume. Send to 20 contacts, wait 24 hours, then:

```bash
brevo_get_email_events  event=hardBounces  startDate=<today>
brevo_get_email_events  event=spam         startDate=<today>
```

Stop and fix the list if bounces exceed 3% or any spam complaint appears.
Resume at 20/day, then 50, then 100.

### The one metric that matters

Brevo cannot see replies. They go to Zoho and never touch Brevo, so open and
click rate measure nothing here. The old campaign's 0.67% click rate was a
number describing a funnel that did not exist.

Count replies by hand:

```
date | name | email | segment | creative | child grade | free session | paid
```

Targets per 100 delivered: bounces under 3%, complaints under 0.1%, replies
1-3%. Below 1% replies after 200 sends, the audience or the offer is wrong,
and sending more of the same will not fix it.

### Rollback

There is no unsend. Once a campaign fires it is gone, which is why
`brevo_send_campaign_now` requires `confirm: "SEND"`.

If a send goes wrong:

1. Pause any queued campaign in the Brevo UI immediately.
2. `brevo_blacklist_contact` for anyone who complains, same day.
3. Stop all sending for 72 hours. Continuing after a complaint spike is what
   turns a bad campaign into a blocked domain.
4. Read `audit.jsonl` to establish exactly what went out and when.
