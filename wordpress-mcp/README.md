# WordPress MCP Server

A fully-typed TypeScript MCP server exposing **35+ tools** covering the full WordPress REST API and WooCommerce — authenticated via Application Passwords (zero-cost, built-in since WP 5.6).

## Supported Sites

| Site | Admin | WooCommerce |
|---|---|---|
| fernhillbd.com | https://fernhillbd.com/wp-admin/ | ✅ Active |
| fernhillconsulting.co.uk | https://fernhillconsulting.co.uk/wp-admin/ | ❌ Not installed |

---

## Tools

| Group | Tools |
|---|---|
| **Posts** | `wp_list_posts`, `wp_get_post`, `wp_create_post`, `wp_update_post`, `wp_delete_post` |
| **Pages** | `wp_list_pages`, `wp_get_page`, `wp_create_page`, `wp_update_page`, `wp_delete_page` |
| **Media** | `wp_list_media`, `wp_get_media`, `wp_upload_media`, `wp_update_media`, `wp_delete_media` |
| **Users** | `wp_list_users`, `wp_get_user`, `wp_create_user`, `wp_update_user`, `wp_delete_user` |
| **Comments** | `wp_list_comments`, `wp_get_comment`, `wp_create_comment`, `wp_update_comment`, `wp_delete_comment` |
| **Taxonomy** | `wp_list_categories`, `wp_create_category`, `wp_list_tags`, `wp_create_tag`, `wp_list_post_types`, `wp_list_cpt_items` |
| **WooCommerce** | `wc_list_products`, `wc_get_product`, `wc_create_product`, `wc_update_product`, `wc_delete_product`, `wc_list_orders`, `wc_get_order`, `wc_update_order`, `wc_list_customers`, `wc_get_customer` |
| **Cache** | `wp_purge_cache`, `wp_regenerate_elementor_css`, `wp_bust_elementor_image_urls`, `wp_purge_cloudflare`, `wp_cache_status` |
| **Full control** | `wp_rest_request` (any /wp-json route), `wp_get_post_meta`, `wp_update_post_meta` |

---

## Cache invalidation (the "stale image" fix)

When you overwrite a media file but the site keeps serving the old one, the edge/proxy cache (LiteSpeed, Nginx, Cloudflare) is serving stale bytes for the **same URL**. Two correct fixes — no `footer.php` JS hack:

1. **Purge** — same URL, fresh bytes. Preferred; mutates nothing.
   - Run `cp_deploy_cache_helper` **once** (from cpanel-mcp) to install the `agent-cache/v1` mu-plugin.
   - After replacing media/content: `wp_purge_cache` (origin caches) and, if Cloudflare fronts the site, `wp_purge_cloudflare`.
2. **Version** — fallback when the edge can't be purged. `wp_bust_elementor_image_urls` appends `?ver=<token>` to image URLs **inside `_elementor_data`**, edited server-side via `json_decode`/`json_encode` so the stored JSON can never be corrupted (unlike a raw SQL search-and-replace).

Typical media-replace flow:
```
upload (overwrite) → wp_purge_cache → wp_purge_cloudflare → wp_regenerate_elementor_css
```
If the edge is unpurgeable, swap the last steps for `wp_bust_elementor_image_urls { post_id, version: "<timestamp>" }`.

---

## Quick Start

```bash
cd wordpress-mcp
cp .env.example .env   # fill in credentials
npm install
npm run build
npm start
```

## Claude Desktop Integration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wordpress-fernhillbd": {
      "command": "node",
      "args": ["/Users/musfiqurtuhin/Dev/Active/automation/wordpress-mcp/dist/index.js"],
      "env": {
        "WORDPRESS_URL": "https://fernhillbd.com",
        "WORDPRESS_USERNAME": "musfiqur",
        "WORDPRESS_APP_PASSWORD": "UPQc tyLc mll1 uWVe zILY pPqI"
      }
    },
    "wordpress-fernhilluk": {
      "command": "node",
      "args": ["/Users/musfiqurtuhin/Dev/Active/automation/wordpress-mcp/dist/index.js"],
      "env": {
        "WORDPRESS_URL": "https://fernhillconsulting.co.uk",
        "WORDPRESS_USERNAME": "musfiqur",
        "WORDPRESS_APP_PASSWORD": "FtJs tUve 0v3T LnWL xUFY 9L8B"
      }
    }
  }
}
```

## WooCommerce Setup (fernhillbd.com only)

1. Go to https://fernhillbd.com/wp-admin/admin.php?page=wc-settings&tab=advanced&section=keys
2. Add Key → Permissions: Read/Write → Generate
3. Add to `.env`:
   ```
   WC_CONSUMER_KEY=ck_...
   WC_CONSUMER_SECRET=cs_...
   ```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `WORDPRESS_URL` | ✅ | Site URL (no trailing slash) |
| `WORDPRESS_USERNAME` | ✅ | WP username |
| `WORDPRESS_APP_PASSWORD` | ✅ | Application Password from WP Admin |
| `WC_CONSUMER_KEY` | WC only | WooCommerce consumer key |
| `WC_CONSUMER_SECRET` | WC only | WooCommerce consumer secret |
