# zoho-mail-mcp

Reads a Zoho mailbox over IMAP. Built to close the one blind spot in the
Podium email work: Brevo cannot see replies, so the leads land in Zoho and
nobody could read them programmatically. Now they can.

## Why IMAP and not the Zoho API

The Zoho REST API needs an interactive OAuth flow, which a headless MCP cannot
complete. IMAP with an app-specific password does the same reading job with a
single credential and no browser step. Read-only by default, so it can never
alter, move or delete a message.

## Setup

```bash
npm install
cp .env.example .env      # fill in the app password
npm run build
```

Two things to enable in Zoho first:

1. **IMAP access.** Zoho Mail, Settings, Mail Accounts, IMAP Access, Enable.
2. **App password.** Zoho Mail, Settings, Security, App Passwords, generate one.
   The normal login password will not work once two-factor is on.

Then register it:

```bash
claude mcp add zoho -- node /Users/musfiqurtuhin/Documents/HaorGrix/Tooling/MCP/zoho-mail-mcp/dist/index.js
```

## Tools

- `zoho_list_folders` — Inbox, Sent, Spam, custom folders
- `zoho_recent` — newest messages in a folder
- `zoho_read` — one full message by UID, including body
- `zoho_search` — by sender, subject, body text, date, or unread
- `zoho_campaign_replies` — the important one. Scans recent mail, filters out
  bounces and automated noise, and ranks what looks like a parent replying.
  Flags which replies contain a grade or a subject, so the leads sort
  themselves to the top.

## The reply detector

`zoho_campaign_replies` scores each recent message:

- Machine mail (mailer-daemon, no-reply, out-of-office, bounces) is dropped.
- A grade mention (`8th`, `grade 6`) adds the most weight.
- A subject mention (math, Regents, English) adds more.
- A `Re:` subject or a short personal body adds a little.

What comes back is a ranked list of probable leads with a one-line preview
each, plus a count of how many included a grade. That is the number that turns
an open rate into a follow-up list.

## Safety

`ZOHO_READ_ONLY=1` (the default) opens every mailbox with a read-only lock, so
the server physically cannot flag, move or delete anything. The app password
is redacted from every error message. Set `ZOHO_READ_ONLY=0` only if a future
tool needs to mark messages read, and even then nothing here deletes.
