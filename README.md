# Consolidated MCP Servers Workspace

This workspace consolidates the custom Model Context Protocol (MCP) servers built for automating tasks across WordPress, cPanel, and Meta Ads.

## Consolidated Servers

### 1. Meta Ads Manager MCP (`mcp-meta-ads`)
* **Path**: `mcp-meta-ads/`
* **Entrypoint**: `mcp-meta-ads/index.js`
* **Purpose**: Integrate and manage Meta Ad accounts and campaigns via the Meta Graph API.
* **Environment variables**:
  * `META_ACCESS_TOKEN`
* **Run command**:
  ```bash
  node index.js
  ```

### 2. WordPress MCP (`wordpress-mcp`)
* **Path**: `wordpress-mcp/`
* **Entrypoint**: `wordpress-mcp/dist/index.js`
* **Purpose**: Exposes tools for managing WordPress posts, pages, comments, users, media, WooCommerce integration, and taxonomies.
* **Environment variables**:
  * `WORDPRESS_URL`
  * `WORDPRESS_USERNAME`
  * `WORDPRESS_APP_PASSWORD`
  * `WC_CONSUMER_KEY` (Optional, WooCommerce)
  * `WC_CONSUMER_SECRET` (Optional, WooCommerce)
* **Build/Run**:
  ```bash
  npm run build
  npm start
  ```

### 3. cPanel MCP (`cpanel-mcp`)
* **Path**: `cpanel-mcp/`
* **Entrypoint**: `cpanel-mcp/dist/index.js`
* **Purpose**: Exposes tools to interact with cPanel UAPI for managing Databases, Email accounts, FTP, Domains, SSL, Cron jobs, Backups, and DNS.
* **Environment variables**:
  * `CPANEL_HOST`
  * `CPANEL_USERNAME`
  * `CPANEL_PASSWORD`
* **Build/Run**:
  ```bash
  npm run build
  npm start
  ```

### 4. Google Analytics MCP (`google-analytics-mcp`)
* **Path**: `google-analytics-mcp/`
* **Entrypoint**: `google-analytics-mcp/dist/index.js`
* **Purpose**: Query real-time metrics, custom reports, dimensions, metrics, and manage GA4 properties and accounts.
* **Environment variables**:
  * `GOOGLE_APPLICATION_CREDENTIALS` (Path to Google Service Account JSON key)
  * `GA4_PROPERTY_ID` (Default numeric GA4 Property ID)
* **Build/Run**:
  ```bash
  npm run build
  npm start
  ```

---

## Configuration with Claude Desktop

The path references in `~/Library/Application Support/Claude/claude_desktop_config.json` have been updated to point to the consolidated paths in this workspace.

### Example Server Entry for Google Analytics:
```json
"google-analytics": {
  "command": "node",
  "args": [
    "/Users/musfiqurtuhin/Documents/HaorGrix/MCP/google-analytics-mcp/dist/index.js"
  ],
  "env": {
    "GOOGLE_APPLICATION_CREDENTIALS": "/Users/musfiqurtuhin/Documents/HaorGrix/MCP/google-analytics-mcp/credentials.json",
    "GA4_PROPERTY_ID": "123456789"
  }
}
```
```json
"wordpress-fernhillbd": {
  "command": "node",
  "args": [
    "/Users/musfiqurtuhin/Documents/HaorGrix/MCP/wordpress-mcp/dist/index.js"
  ],
  "env": {
    "WORDPRESS_URL": "https://fernhillbd.com",
    "WORDPRESS_USERNAME": "musfiqur",
    "WORDPRESS_APP_PASSWORD": "..."
  }
}
```
