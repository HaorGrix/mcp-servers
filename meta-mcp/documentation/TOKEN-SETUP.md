# Meta MCP — Token & Permission Setup

Do this before the consolidated `meta-mcp` server is built. Every tool in that
server authenticates with one System User token; what the token is allowed to do
decides which tools work and which return "needs X permission".

Verified against the live Graph API on 2026-09-08 with the current token.

---

## 1. Where you actually stand today

Current token (`Tooling/MCP/*/.env`, `META_ACCESS_TOKEN`):

| Property | Value |
| --- | --- |
| Type | `SYSTEM_USER` — non-expiring (`expires_at: 0`) |
| Name | MCP Bot (`122107861605367455`) |
| App | `podium_ads` (`4340118169640058`) |
| Scopes | 9 (below) |

Granted: `ads_management`, `ads_read`, `business_management`,
`catalog_management`, `pages_show_list`, `pages_read_engagement`,
`pages_manage_ads`, `threads_business_basic`, `public_profile`.

Assets it can reach:

| Asset | ID | Notes |
| --- | --- | --- |
| Ad account "Podium 1" | `act_3492079200934757` | USD, active, spend $43,762, Amex \*1000 |
| Ad account "hoohj" | `act_4366636926998849` | USD, active, under *Josesp Portfolio* |
| Page "Podium Tutoring" | `739295162589583` | Education, 417 fans |
| Pixel "Podium - Liftbrand pixel" | `1390708802380577` | on Podium 1 |
| Business *Podium Tutoring* | `523747420750115` | id/name only — see 1.1 |
| Business *Josesp Portfolio* | `1318321823824319` | ad account only |

### 1.1 Three gaps you need to know about

**No HaorGrix assets on this token.** You asked for HaorGrix Facebook and
Instagram. This token sees Podium and Josesp only. There is no HaorGrix Business
Manager, Page, or ad account attached to it. Either HaorGrix assets live in a
different Business Manager, or they were never added. Section 3 covers this
first because nothing else matters until it is fixed.

**The System User is not a business admin.** `GET /523747420750115` returns only
`id` and `name`; `verification_status`, `primary_page` and `two_factor_type` are
silently dropped, and `/system_users` fails with
`(#10) requires VIEW_SYSTEM_USERS`. The user was assigned individual ad accounts,
not given a business role. Business-level tools (people, roles, asset
assignment, verification status) stay dark until this changes.

**No Instagram connection.** `/me/accounts?fields=instagram_business_account`
returns the Page with no IG account attached — no `instagram_basic` scope, and
possibly no IG Professional account linked to the Page at all. Every Instagram
tool depends on both.

### 1.2 Update 2026-09-14 — HaorGrix portfolio and app now exist

| Property | Value |
| --- | --- |
| Portfolio | HaorGrix `1126790053843527`, created 2026-04-11, not verified |
| App | `haorgrix-mcp` (`1454152840237262`), owned by the portfolio |
| System user | `MCP Bot` `122107488753468288`, role ADMIN (new, distinct from the Podium one) |
| Business admins | Md. Musfiqur Rahman, Tanvir Alam Turjoy |
| Page | HaorGrix `1108895688966297`, 502 fans, primary page |
| Ad accounts / IG / pixels / catalogs | **none in the portfolio yet** |

Current `.env` token is a **USER token for Tanvir** on `haorgrix-mcp`, 11 scopes
(the original 9 plus `leads_retrieval`, `pages_manage_metadata`), expires
**2026-11-12**. Use it for development only. Production must run on a token
minted from `MCP Bot` (never expires). Still missing: `instagram_basic` and every
messaging / publishing scope — App Review pending.

Next actions: add an ad account and Instagram account to the portfolio, assign
them to `MCP Bot`, mint the system user token, file App Review.

---

## 2. Scope matrix — what each domain costs

Add these to the System User. "Advanced access" means the app must pass App
Review before the scope works on assets your app does not own.

### Already granted — these work today
| Domain | Scopes |
| --- | --- |
| Ads Manager, campaigns, ad sets, ads, creatives | `ads_management`, `ads_read` |
| Ads reporting, insights, attribution settings | `ads_read` |
| Automated Rules, Advantage+ campaigns | `ads_management` |
| Custom / Lookalike / Saved audiences | `ads_management` |
| Pixel config, Conversions API, offline conversions | `ads_management` |
| Catalog Manager, product catalogs, product sets | `catalog_management` |
| Page listing and read-only insights | `pages_show_list`, `pages_read_engagement` |
| Business asset read (limited — see 1.1) | `business_management` |

### Must be added
| Domain | Scopes | Review |
| --- | --- | --- |
| Page publishing (post, schedule, delete) | `pages_manage_posts` | Advanced |
| Page comments, likes, moderation | `pages_manage_engagement` | Advanced |
| Read user comments / visitor posts | `pages_read_user_content` | Advanced |
| Page metadata, settings, roles | `pages_manage_metadata` | Advanced |
| Messenger send/receive, Meta Inbox | `pages_messaging` | Advanced |
| Instagram profile, media, IG Insights | `instagram_basic` | Advanced |
| IG publishing — feed, Reels, Stories | `instagram_content_publish` | Advanced |
| IG comments and moderation | `instagram_manage_comments` | Advanced |
| IG account-level insights | `instagram_manage_insights` | Advanced |
| Instagram Direct messaging | `instagram_manage_messages` | Advanced |
| Lead Ads — retrieving submitted leads | `leads_retrieval` | Advanced |
| WhatsApp — numbers, templates, WABA config | `whatsapp_business_management` | Advanced |
| WhatsApp — sending messages | `whatsapp_business_messaging` | Advanced |
| Shops, checkout, commerce orders | `commerce_account_manage_orders`, `commerce_account_read_orders`, `commerce_account_read_settings` | Advanced + Commerce eligibility |
| Facebook Groups content | `groups_access_member_info`, `publish_to_groups` | Advanced, app must be installed in the group |

### Never available via API — no scope will unlock these
These are on your list but have no public API. They stay manual in the UI, and
the server will not pretend otherwise:

Creative Hub · Business Support · Blueprint & Certification · Marketplace ·
Facebook Watch · Meta Verified · Meta Analytics (retired 2021) · Ads Manager UI
automated-rule *editor* (rules themselves are API-writable) · Meta Business
Partners / Marketing Partners directories.

Partner-gated (a Meta rep must allowlist your app — you cannot self-serve):
Brand Rights Protection · Rights Manager · IP reporting · Creator Marketplace /
Brand Collabs Manager · Reach & Frequency buying · Ad Library API (needs
separate identity-verified access for the political archive; the commercial
Ad Library has no API).

---

## 3. Steps

### Step 0 — decide the home Business Manager (blocker)
Confirm whether HaorGrix has its own Business Manager. In
[business.facebook.com](https://business.facebook.com) switch portfolios with
the top-left picker and note every portfolio you see and its ID
(Business settings → Business info).

- **If a HaorGrix portfolio exists** — do the rest of this guide inside it, and
  add the Podium/Josesp ad accounts to it as *client* assets if you want one
  token across all clients.
- **If it does not exist** — create it: Business settings → Business portfolios →
  Create. Then claim the HaorGrix Page and Instagram account into it.

Do not skip this. Building tooling against the Podium portfolio and then
migrating later means re-issuing the token and re-assigning every asset.

### Step 1 — make the System User an admin
Business settings → Users → System users → **MCP Bot** → *Edit* → role
**Admin**. Without this, business-level and asset-management tools fail with
error code 10.

If you would rather not hand admin to an existing user, create a second system
user (`haorgrix-mcp-admin`) with Admin and use its token instead.

### Step 2 — assign every asset to the System User
Business settings → Users → System users → MCP Bot → **Add assets**. For each,
grant *Full control* / *Manage*:

- Ad accounts — HaorGrix, Podium 1, hoohj
- Pages — HaorGrix, Podium Tutoring
- Instagram accounts — HaorGrix IG (link it to the Page first if it is not)
- Datasets / Pixels — Podium Liftbrand pixel, plus any HaorGrix pixel
- Catalogs — if you run Shops
- WhatsApp Business accounts — if you use WhatsApp

Assets missing here are invisible to the token regardless of scopes.

### Step 3 — link Instagram properly
Instagram tools need a **Professional (Business or Creator) account linked to a
Page inside the same portfolio**. Check in Business settings → Accounts →
Instagram accounts. Verify with:

```
GET /me/accounts?fields=id,name,instagram_business_account{id,username}
```

If `instagram_business_account` is absent after `instagram_basic` is granted,
the link itself is missing — fix it in the UI, not in code.

### Step 4 — request advanced access (App Review)
App Dashboard for `podium_ads` (`4340118169640058`) → App Review →
Permissions and Features. Request advanced access for every scope in the
"Must be added" table you intend to use.

Expect to supply, per permission: a screencast showing the feature in use, a
written use case, a Privacy Policy URL, and a Data Deletion callback. Turnaround
is usually a few days but can run to weeks. Standard access works for assets the
app owns and for development, so build and test can proceed while review is
pending.

Practical order — request what unblocks the most first:
`instagram_basic` → `instagram_manage_insights` → `pages_manage_posts` →
`instagram_content_publish` → `pages_messaging` + `instagram_manage_messages` →
`leads_retrieval` → WhatsApp pair → commerce trio.

### Step 5 — business verification
Business settings → Security Centre → Business verification. Required for
WhatsApp Business Platform, Commerce/Shops, and higher rate limits; also needed
before several advanced permissions are approved. You will submit a legal
business name, address, phone, and a registration document.

### Step 6 — mint the new token
Business settings → System users → MCP Bot → **Generate new token** → app
`podium_ads` → tick every granted scope → token never expires.

Store it as `META_ACCESS_TOKEN` in `Tooling/MCP/meta-mcp/.env` (git-ignored).
Never commit it, never paste it into Slack. Rotating the token invalidates the
old one, so update the `.env` in the same pass.

### Step 7 — verify before the build proceeds
```bash
set -a; . .env; set +a
G=https://graph.facebook.com/v23.0
curl -s "$G/debug_token?input_token=$META_ACCESS_TOKEN&access_token=$META_ACCESS_TOKEN"
curl -s "$G/me/permissions?access_token=$META_ACCESS_TOKEN"
curl -s "$G/me/accounts?fields=id,name,instagram_business_account{id,username}&access_token=$META_ACCESS_TOKEN"
curl -s "$G/me/adaccounts?fields=id,name,account_status&access_token=$META_ACCESS_TOKEN"
```
Pass condition: token `is_valid: true`, `expires_at: 0`, the scope list matches
what you granted, the HaorGrix Page appears with an
`instagram_business_account`, and every ad account you expect is listed.

---

## 4. Rate limits worth designing around

- **Marketing API** — per ad account, a points-based hourly budget. Read
  `X-Business-Use-Case-Usage` on every response and back off above 75%.
- **Graph (Pages/IG)** — 200 calls × users per hour, per app.
- **Instagram Content Publishing** — 50 posts per IG account per 24h, hard.
- **WhatsApp** — messaging tier based on quality rating; starts at 1,000 unique
  recipients per 24h.
- **Insights** — async report jobs for large date ranges; polling, not a
  synchronous call.

The server will surface these headers rather than hiding them, so a throttle
shows up as a throttle instead of a mystery failure.

---

## 5. Security

- `.env` only; `.gitignore` must cover `.env*` before the first commit.
- The token is a non-expiring admin credential over live ad accounts with real
  spend. Treat it like an SSH key.
- Errors are redacted — the token is stripped from every message. Note that the
  current servers leak it into Graph `Unknown path` errors, which is one reason
  the consolidated server rebuilds the client layer.
- Prefer a dedicated `haorgrix-mcp` System User over reusing `MCP Bot`, so
  revoking MCP access never disturbs the Podium reporting pipeline.

---

## 6. Sign-off checklist

- [ ] Step 0 — HaorGrix Business Manager identified or created; portfolio ID recorded
- [ ] Step 1 — System User has Admin role
- [ ] Step 2 — all ad accounts, Pages, IG accounts, pixels, catalogs assigned
- [ ] Step 3 — IG Professional account linked and visible on the Page
- [ ] Step 4 — advanced access requested for each needed scope
- [ ] Step 5 — business verification submitted
- [ ] Step 6 — new token minted into `meta-mcp/.env`
- [ ] Step 7 — verification curls pass

When Step 7 passes, the consolidated `meta-mcp` build starts against a token
whose real capability is known, and no tool ships that cannot be tested.
