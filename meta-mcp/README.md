# meta-mcp

One MCP server for the whole Meta business ecosystem, driven by a single System User token.
185 tools in 10 modules. Full read/write; destructive or money-spending calls require `confirm: true`.

Replaces `mcp-meta-ads_new` and `meta-business-mcp`.

## Setup

```bash
npm install
cp .env.example .env   # paste the System User token + default asset ids
npm run build
claude mcp add --scope user meta -- node /Users/musfiqurtuhin/Documents/HaorGrix/Tooling/MCP/meta-mcp/dist/index.js
```

Token requirements and Business Manager steps: [documentation/TOKEN-SETUP.md](documentation/TOKEN-SETUP.md).

## Modules

| Module | Tools | Covers |
| --- | --- | --- |
| overview | 6 | whoami, ecosystem map, rate limits, raw GET/POST/DELETE escape hatches |
| business | 16 | Business Portfolio: assets, people, roles, system users, asset assignment, claims, client requests, verification status |
| pages | 32 | Page profile/settings/roles, posts (publish, schedule, edit, delete, photos, videos, albums), comments + moderation, blocklist, ratings, visitor posts, insights, events, Live |
| messenger | 13 | Meta Inbox (Messenger + IG DM conversations), send, sender actions, user profile, Messenger profile (menu, greeting, ice breakers), labels, handover |
| instagram | 27 | profile, media, Stories, account + media insights, publishing (image, carousel, Reel, Story) with product/user tags, comments + moderation, hashtag search, tagged, business discovery, product tagging, branded content, DMs + ice breakers |
| whatsapp | 13 | WABA, phone numbers, business profile, templates (list/create/delete), send (template/text/media/location/interactive), mark read, media URL, analytics, register, webhooks |
| leads | 7 | Instant Forms list/create/archive, leads per form, all leads across Page, single lead, test leads |
| catalog | 16 | catalogs, products (get/upsert/batch/delete), product sets, feeds, diagnostics, commerce accounts |
| developer | 10 | app settings/roles, app-level webhook subscriptions, Page subscriptions, webhook sample test, token debug, Ad Library archive |
| ads | 44 | ad accounts (+create), campaigns / ad sets / ads / creatives CRUD + copy + preview, image/video upload, labels, insights (sync + async + breakdowns), account snapshot, delivery estimate, targeting search, automated rules, custom / lookalike / saved audiences + hashed customer-list upload + sharing, pixels + stats + sharing, Conversions API (auto-hashed), offline event sets + uploads, attribution |

Set `META_*_ID` defaults in `.env` so tools can omit ids.

## Safety model

- `META_ALLOW_WRITES=false` turns the whole server read-only.
- Deletes, budget changes, activating campaigns/ad sets/ads, sending messages (Messenger, IG DM, WhatsApp), publishing to Instagram, live CAPI / offline uploads, audience removals and rule creation all require `confirm: true`.
- Tools that need a scope the token lacks fail with `needs <scope>` instead of a raw Graph error.
- Access tokens are stripped from every error message.
- Rate-limit headers (`x-app-usage`, `x-ad-account-usage`, `x-business-use-case-usage`) are tracked; the client throttles itself above 80%.
- Graph v23 removed `page_impressions*`, `page_fans*`, `post_impressions*`, `post_engaged_users`; the defaults here are validated against v23.

## Testing

```bash
npm run smoke                      # 41 live read calls through the MCP protocol
npx tsx scripts/write-roundtrip.ts # schedules a Page post 30 days out, verifies the confirm gate, deletes it
```

## Not covered (no API)

Creative Hub, Business Support, Admin Centre, Blueprint/Certification, Marketplace, Watch, Meta Verified, Meta Analytics (retired), Marketing/Business Partner directories, Meta AI tools. Partner-gated: Rights Manager, Brand Rights Protection, IP reporting, Creator Marketplace / Brand Collabs, Reach & Frequency, commercial Ad Library search. Domain verification and Aggregated Event Measurement have no Graph edge in v23 (UI only). Shops / checkout need `commerce_*` scopes and a supported country.
