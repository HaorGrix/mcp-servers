# meta-mcp

One MCP server for the whole Meta business ecosystem, driven by a single System User token.
301 tools in 11 modules. Full read/write; destructive or money-spending calls require `confirm: true`.

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
| business | 26 | Business Portfolio: assets, people, roles, system users (+ API token minting), asset assignment, claims, partners (agencies/clients), credit lines + invoices, experiments (A/B, lift), pending claims, business-owned pixels |
| pages | 50 | Page profile/settings/roles/CTA button/locations/agencies, posts (publish, schedule, edit, delete, dark posts), photos/videos/albums incl. local-file upload, **Reels** and **Stories** publishing, video insights + crossposting, comments + moderation + reactions + shares, blocklist, ratings + replies, visitor posts, insights, events, Live, all-pages snapshot |
| messenger | 24 | Meta Inbox (Messenger + IG DM), send text/media/templates (generic, media, receipt), reusable attachments, reactions, sender actions, user profile, Messenger profile (menu, greeting, ice breakers), labels, recurring notifications, handover + thread control |
| instagram | 40 | profile, media, Stories, carousels, account + media insights + online followers, publishing (image, carousel, Reel, Story) with product/user tags, comments + moderation + private replies, mentions, Live comments, hashtag search, tagged, business discovery, product tagging, branded content, partnership-ad permissions, boost eligibility, DMs + reactions + ice breakers + persistent menu |
| whatsapp | 36 | WABA + health, phone numbers (add, verify, register, 2-step PIN, settings, display name), business profile, templates (list/create/edit/delete + analytics), **Flows** (create, upload JSON, publish, preview), send (template/text/media/location/interactive/reaction/sticker/contacts/flow/catalog), media upload, QR deep links, block list, commerce settings, message + conversation + pricing analytics, webhooks |
| leads | 7 | Instant Forms list/create/archive, leads per form, all leads across Page, single lead, test leads |
| catalog | 25 | catalogs, products (get/upsert/batch/delete), product groups/variants, categories, product sets, feeds (+ localized), diagnostics, batch status, pixel linking, commerce accounts, shops, orders (list/ack/ship/cancel/refund), commerce insights |
| developer | 17 | app settings/roles/permissions/test users/insights, app-level webhook subscriptions, Page + IG subscriptions, webhook sample test, token debug + long-lived exchange, Graph **batch API**, Ad Library archive |
| ads | 62 | ad accounts (+create/update/users/billing/limits), campaigns / ad sets / ads / creatives CRUD + copy + preview, catalog (DPA) creatives, **boost post** one-shot, image/video upload, labels, insights (sync + async + advanced attribution), account snapshot, delivery estimate, targeting search, automated rules + history, custom / lookalike / saved audiences + hashed customer-list upload (+ sessions) + sharing, **custom conversions**, pixels + stats + sharing, Conversions API (auto-hashed), offline event sets + uploads, attribution, publisher block lists, Reach & Frequency predictions, app ads, IG actors, ad-level leads, saved report runs |
| threads | 8 | Threads profile, posts, publish (text/image/video/carousel/reply), replies + hide, insights, publishing limit, delete. Needs `THREADS_ACCESS_TOKEN` |

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
npm run smoke                      # 69 live read calls through the MCP protocol
npx tsx scripts/write-roundtrip.ts # schedules a Page post 30 days out, verifies the confirm gate, deletes it
```

## Findings from the live HaorGrix account (2026-09-15)

- WhatsApp number `+880 1521-725028` is `platform_type: ON_PREMISE`, `status: DISCONNECTED`, `is_on_biz_app: true` — it lives on the WhatsApp Business phone app, not Cloud API. Reading works; sending via `meta_wa_send` fails with `#133010 Account not registered` until the number is migrated to Cloud API (Business settings → WhatsApp accounts → phone → Cloud API) or coexistence is set up.
- Messenger custom labels need the Page inbox labels terms accepted once in the Page Inbox UI (`#2018344`).
- Graph v23 removed `page_impressions*`, `page_fans*`, `post_impressions*`, `post_engaged_users`, the `owned_domains` edge, `secondary_receivers`, and Page `tabs`.

## Not covered (no API)

Creative Hub, Business Support, Admin Centre, Blueprint/Certification, Marketplace, Watch, Meta Verified, Meta Analytics (retired), Marketing/Business Partner directories, Meta AI tools. Partner-gated: Rights Manager, Brand Rights Protection, IP reporting, Creator Marketplace / Brand Collabs, Reach & Frequency, commercial Ad Library search. Domain verification and Aggregated Event Measurement have no Graph edge in v23 (UI only). Shops / checkout need `commerce_*` scopes and a supported country.
