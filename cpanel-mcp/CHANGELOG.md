# CHANGELOG

## 2026-06-14 — Cache helper + full-control tools

### Added
- **Cache group** (2 tools): `cp_deploy_cache_helper` (installs/updates the `agent-cache-control.php` must-use plugin into `wp-content/mu-plugins`, exposing the `agent-cache/v1` REST API the wordpress-mcp cache tools call), `cp_purge_litespeed` (filesystem fallback that clears on-disk LiteSpeed/page cache dirs).
- **Full-control** (1 tool): `cp_uapi_call` — call any cPanel UAPI module/function directly (GET or POST).
- `src/assets/cacheHelperPlugin.ts` — single source of truth for the mu-plugin PHP (unified purge across LiteSpeed/Nginx Helper/WP Rocket/W3TC/WP Super Cache/Autoptimize/SiteGround + Elementor CSS regen + safe `_elementor_data` URL rewrite + generic post-meta read/write). Auth piggybacks on Application Passwords (`manage_options`).

### Why
Media overwritten on disk was still served stale because the edge/proxy cache keyed on the unchanged URL. The mu-plugin gives a reliable, plugin-aware purge surface so agents can invalidate cache after deploys instead of hacking `footer.php`.

## 2026-06-13 — cPanel MCP Server v1.0.0

### Added
- `cpanel-mcp/` — New TypeScript MCP server for cPanel UAPI
- **43 tools** across 9 modules:
  - **Files** (7): `cp_list_files`, `cp_read_file`, `cp_create_dir`, `cp_delete_file`, `cp_rename_file`, `cp_compress`, `cp_extract`
  - **Databases** (8): `cp_list_databases`, `cp_create_database`, `cp_delete_database`, `cp_list_db_users`, `cp_create_db_user`, `cp_delete_db_user`, `cp_assign_db_user`, `cp_check_db`
  - **Email** (8): `cp_list_email_accounts`, `cp_create_email`, `cp_delete_email`, `cp_change_email_password`, `cp_list_forwarders`, `cp_create_forwarder`, `cp_delete_forwarder`, `cp_list_autoresponders`
  - **Domains** (5): `cp_list_domains`, `cp_domain_info`, `cp_list_subdomains`, `cp_create_subdomain`, `cp_delete_subdomain`
  - **DNS** (4): `cp_list_dns_records`, `cp_add_dns_record`, `cp_delete_dns_record`, `cp_get_zone_info`
  - **Backup** (3): `cp_create_backup`, `cp_list_backups`, `cp_restore_db_backup`
  - **Cron** (4): `cp_list_crons`, `cp_add_cron`, `cp_remove_cron`, `cp_edit_cron`
  - **SSL** (3): `cp_list_ssl_certs`, `cp_ssl_status`, `cp_list_ssl_capable_domains`
  - **Stats** (5): `cp_get_disk_usage`, `cp_get_bandwidth`, `cp_get_account_info`, `cp_get_php_version`, `cp_set_php_version`
- Basic Auth via HTTPS + `https.Agent({ rejectUnauthorized: false })` for shared hosting SSL certs
- Fixed: `.env` passwords with `#` must be quoted to avoid dotenv comment truncation
- Both cPanel accounts registered in Claude Desktop `claude_desktop_config.json`
- Full backups triggered on both sites via `cp_create_backup`:
  - fernhillbd.com (euqzoopq) — backup running, email notification to musfiqurrahmantuhin@gmail.com
  - fernhillconsulting.co.uk (ndygthdu) — backup running, email notification to musfiqurrahmantuhin@gmail.com

### Sites Configured
- `cpanel-fernhillbd` → fernhillbd.com (euqzoopq)
- `cpanel-fernhilluk` → fernhillconsulting.co.uk (ndygthdu)
