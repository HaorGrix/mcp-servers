# CHANGELOG

## 2026-06-14 — Cache invalidation + full-control tools

### Added
- **Cache group** (5 tools): `wp_purge_cache` (LiteSpeed/Nginx Helper/WP Rocket/W3TC/WP Super Cache/Autoptimize/SiteGround via the `agent-cache/v1` mu-plugin), `wp_regenerate_elementor_css`, `wp_bust_elementor_image_urls` (safe server-side `_elementor_data` URL rewrite — no SQL corruption), `wp_purge_cloudflare` (Cloudflare zone/file purge), `wp_cache_status`.
- **Full-control group** (3 tools): `wp_rest_request` (call any `/wp-json` route, any method), `wp_get_post_meta`, `wp_update_post_meta` (arbitrary meta incl. `_elementor_data`).
- `client.ts`: custom-namespace methods (`getRoot`/`postRoot`), raw passthrough (`raw`), and `cloudflarePurge`.
- `.env.example`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID` (optional; only for `wp_purge_cloudflare`).

### Why
Overwriting media on disk left the live site serving stale bytes because the edge/proxy cache keyed on the unchanged URL. These tools purge that cache (preferred) or version the URL inside Elementor data (fallback), replacing the previous client-side `footer.php` JS hack. The mu-plugin is deployed by cpanel-mcp's `cp_deploy_cache_helper`.

## 2026-06-13 — WordPress MCP Server v1.0.0

### Added
- `wordpress-mcp/` — New TypeScript MCP server for WordPress REST API
- **35 tools** across 7 groups:
  - Posts CRUD: `wp_list_posts`, `wp_get_post`, `wp_create_post`, `wp_update_post`, `wp_delete_post`
  - Pages CRUD: `wp_list_pages`, `wp_get_page`, `wp_create_page`, `wp_update_page`, `wp_delete_page`
  - Media library: `wp_list_media`, `wp_get_media`, `wp_upload_media`, `wp_update_media`, `wp_delete_media`
  - Users & roles: `wp_list_users`, `wp_get_user`, `wp_create_user`, `wp_update_user`, `wp_delete_user`
  - Comments & moderation: `wp_list_comments`, `wp_get_comment`, `wp_create_comment`, `wp_update_comment`, `wp_delete_comment`
  - Taxonomy: `wp_list_categories`, `wp_create_category`, `wp_list_tags`, `wp_create_tag`, `wp_list_post_types`, `wp_list_cpt_items`
  - WooCommerce: `wc_list_products`, `wc_get_product`, `wc_create_product`, `wc_update_product`, `wc_delete_product`, `wc_list_orders`, `wc_get_order`, `wc_update_order`, `wc_list_customers`, `wc_get_customer`
- Application Password auth (zero-cost, built-in WP 5.6+)
- Multi-site support via `WORDPRESS_URL` env var
- Registered both sites in Claude Desktop `claude_desktop_config.json`
- Smoke-tested live against fernhillbd.com — confirmed real post data returned

### Sites Configured
- `fernhillbd.com` — WooCommerce active
- `fernhillconsulting.co.uk` — WordPress only
