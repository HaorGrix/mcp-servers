"""PRD content module for the cPanel MCP server."""

READ_TOOLS = [
    ("cp_get_account_info", "Read", "Account summary from UAPI StatsBar/ResourceUsage."),
    ("cp_get_disk_usage", "Read", "Disk quota and current usage."),
    ("cp_get_bandwidth", "Read", "Bandwidth consumption for the account."),
    ("cp_get_php_version", "Read", "Active PHP version for a domain (LangPHP)."),
    ("cp_list_ssl_certs", "Read", "Installed SSL certificates."),
    ("cp_ssl_status", "Read", "Per-domain SSL coverage and expiry status."),
    ("cp_list_ssl_capable_domains", "Read", "Domains eligible for certificate installation."),
    ("cp_list_email_accounts", "Read", "Mailboxes on the account with quota usage."),
    ("cp_list_forwarders", "Read", "Email forwarders."),
    ("cp_list_autoresponders", "Read", "Configured autoresponders."),
    ("cp_list_domains", "Read", "Main, addon, parked and sub domains."),
    ("cp_domain_info", "Read", "Document root and configuration for one domain."),
    ("cp_list_subdomains", "Read", "Subdomains only."),
    ("cp_list_dns_records", "Read", "Zone records including the Line number used for deletion."),
    ("cp_get_zone_info", "Read", "Raw zone metadata for a domain."),
    ("cp_list_crons", "Read", "Cron table with schedule fields and exact command strings."),
    ("cp_list_backups", "Read", "Available backup archives."),
    ("cp_list_databases", "Read", "MySQL databases and sizes."),
    ("cp_list_db_users", "Read", "MySQL users."),
    ("cp_list_files", "Read", "Directory listing via Fileman."),
    ("cp_read_file", "Read", "File contents via Fileman get_file_content."),
]

WRITE_TOOLS = [
    ("cp_set_php_version", "Write", "Change the PHP version bound to a domain."),
    ("cp_create_email", "Write", "Create a mailbox with password and quota."),
    ("cp_delete_email", "Write", "Delete a mailbox and its stored mail."),
    ("cp_change_email_password", "Write", "Reset a mailbox password."),
    ("cp_create_forwarder", "Write", "Add an email forwarder."),
    ("cp_delete_forwarder", "Write", "Remove an email forwarder."),
    ("cp_create_subdomain", "Write", "Create a subdomain and its document root."),
    ("cp_delete_subdomain", "Write", "Delete a subdomain."),
    ("cp_add_dns_record", "Write", "Add a zone record (A/CNAME/TXT/MX/etc.)."),
    ("cp_delete_dns_record", "Write", "Delete a zone record keyed by line number — position-dependent."),
    ("cp_add_cron", "Write", "Add a cron entry."),
    ("cp_remove_cron", "Write", "Remove a cron entry matched on exact command string."),
    ("cp_edit_cron", "Write", "Rewrite an existing cron entry matched on old command string."),
    ("cp_create_backup", "Write", "Trigger a full or partial account backup."),
    ("cp_restore_db_backup", "Write", "Restore a database from a backup archive."),
    ("cp_create_database", "Write", "Create a MySQL database."),
    ("cp_delete_database", "Write", "Drop a MySQL database."),
    ("cp_create_db_user", "Write", "Create a MySQL user."),
    ("cp_delete_db_user", "Write", "Delete a MySQL user."),
    ("cp_assign_db_user", "Write", "Grant a MySQL user privileges on a database."),
    ("cp_check_db", "Write", "Run a table check/repair pass on a database."),
    ("cp_create_dir", "Write", "Create a directory (uses legacy API2 — no UAPI equivalent)."),
    ("cp_write_file", "Write", "Write or overwrite file contents."),
    ("cp_delete_file", "Write", "Delete a file or directory; trashes by default, skip_trash forces permanent."),
    ("cp_rename_file", "Write", "Rename or move a filesystem entry."),
    ("cp_compress", "Write", "Create an archive from files or directories."),
    ("cp_extract", "Write", "Extract an archive into a target directory."),
    ("cp_deploy_cache_helper", "Write", "Install/update the Agent Cache Control WordPress mu-plugin."),
    ("cp_purge_litespeed", "Write", "Filesystem fallback that deletes on-disk LiteSpeed/page cache dirs."),
    ("cp_uapi_call", "Write (unbounded)", "Arbitrary UAPI module+function escape hatch, GET or POST."),
]

ALL_TOOLS = READ_TOOLS + WRITE_TOOLS

CONTENT = {
    "title": "PRODUCT REQUIREMENTS DOCUMENT",
    "subtitle": "cPanel MCP Server",
    "tagline": "Single Source of Truth for Engineering, Design & Product",
    "sections": [
        # ── 1 ───────────────────────────────────────────────────────────────
        {"kind": "h1", "text": "1. Document Control"},
        {"kind": "h2", "text": "1.1 Version History"},
        {
            "kind": "table",
            "header": ["Version", "Date", "Author", "Status", "Summary of Changes"],
            "rows": [
                ["0.1", "2026-07-22", "Musfiqur Tuhin", "Draft",
                 "Initial PRD written against cpanel-mcp v1.0.0 as implemented (51 tools, ~1,713 LOC)."],
            ],
        },
        {"kind": "h2", "text": "1.2 Stakeholders & Sign-off"},
        {
            "kind": "table",
            "header": ["Role", "Name", "Responsibility", "Sign-off Status"],
            "rows": [
                ["Document Owner", "Musfiqur Tuhin", "Authors and maintains this PRD.", "Draft"],
                ["Engineering Owner", "Musfiqur Tuhin", "Owns cpanel-mcp source and releases.", "Draft"],
                ["Infrastructure Owner", "TBD — named owner for the cPanel accounts under management",
                 "Owns hosting credentials and approves destructive-tool policy.", "Pending"],
                ["Security Reviewer", "TBD — reviewer name", "Reviews credential handling and TLS posture.", "Pending"],
                ["Consumer (agent operators)", "HaorGrix internal agent operators",
                 "Use the server through MCP clients; report defects.", "N/A"],
            ],
        },
        {"kind": "h2", "text": "1.3 Reference Documents"},
        {
            "kind": "bullets",
            "items": [
                "Source: HaorGrix/mcp-servers (private), branch main, folder Tooling/MCP/cpanel-mcp/.",
                "Entry point: src/index.ts — env validation, client construction, tool registration, stdio transport.",
                "HTTP layer: src/client.ts — UAPI GET/POST plus a legacy API2 path for directory creation.",
                "Tool groups: src/tools/{files,databases,email,domains,dns,backup,cron,ssl,cache,raw}.ts.",
                "Embedded asset: src/assets/cacheHelperPlugin.ts — the Agent Cache Control mu-plugin PHP source.",
                "cPanel UAPI reference documentation (vendor, external).",
                "Sibling PRDs: wordpress-mcp, brevo-mcp, mcp-meta-ads.",
                "CHANGELOG.md in the server folder. There is no README.",
            ],
        },
        # ── 2 ───────────────────────────────────────────────────────────────
        {"kind": "h1", "text": "2. Overview & Summary"},
        {"kind": "h2", "text": "2.1 Problem Statement"},
        {"kind": "para", "text":
            "Routine hosting operations on HaorGrix client sites — creating a mailbox, adding a DNS record, "
            "editing a cron entry, reading a file on the server, restoring a database — require a human to log "
            "into the cPanel web interface and click through it. That work is slow, unauditable, and cannot be "
            "delegated to the AI agents that already handle the surrounding work in WordPress, analytics and "
            "marketing tooling. Agents had no programmatic path to the hosting layer at all."},
        {"kind": "h2", "text": "2.2 Proposed Solution"},
        {"kind": "para", "text":
            "cpanel-mcp is a Node/TypeScript Model Context Protocol server that exposes 51 typed tools wrapping "
            "the cPanel UAPI over stdio. Each tool has a zod-validated input schema and a description written for "
            "an LLM caller. Coverage spans files, databases, email, domains, DNS, backups, cron, SSL, account "
            "statistics, and WordPress cache control, plus a raw UAPI escape hatch for anything not yet wrapped."},
        {"kind": "h2", "text": "2.3 Background & Context"},
        {"kind": "para", "text":
            "HaorGrix client sites run on shared cPanel hosting. The agent fleet already operates wordpress-mcp "
            "against those same sites, but several of its capabilities depend on a must-use plugin being present "
            "in wp-content/mu-plugins — a file that can only be placed there through the hosting layer. "
            "cpanel-mcp closes that loop: cp_deploy_cache_helper installs the plugin, and wordpress-mcp's "
            "post-meta and cache tools become usable."},
        {"kind": "h2", "text": "2.4 Strategic Fit"},
        {"kind": "para", "text":
            "cpanel-mcp is the infrastructure tier of the HaorGrix MCP suite. wordpress-mcp operates inside the "
            "application; brevo-mcp and mcp-meta-ads operate on external SaaS. cpanel-mcp is the only server with "
            "filesystem, database and DNS authority over the machines the other work runs on, which makes it both "
            "the highest-leverage and the highest-blast-radius member of the suite."},
        {"kind": "h2", "text": "2.5 Objectives & Business Value"},
        {
            "kind": "bullets",
            "items": [
                "Remove the manual cPanel login from routine hosting tasks performed during agent-driven work.",
                "Give agents a single, typed, self-describing surface over UAPI instead of ad-hoc curl calls.",
                "Unblock wordpress-mcp cache and post-meta features via a one-command mu-plugin deployment.",
                "Keep hosting changes attributable by routing them through named tools rather than shell access.",
            ],
        },
        # ── 3 ───────────────────────────────────────────────────────────────
        {"kind": "h1", "text": "3. Goals & Success Metrics"},
        {"kind": "h2", "text": "3.1 Goals (SMART)"},
        {
            "kind": "bullets",
            "items": [
                "G1 — Ship typed tool coverage for the nine cPanel domains an agent routinely touches "
                "(files, databases, email, domains, DNS, backups, cron, SSL, stats). Met at v1.0.0 with 51 tools.",
                "G2 — Every tool input validated by a zod schema before any network call is issued. Met.",
                "G3 — Server starts only when CPANEL_HOST, CPANEL_USERNAME and CPANEL_PASSWORD are present, "
                "failing loudly with the missing names rather than at first call. Met.",
                "G4 — Deploy the Agent Cache Control mu-plugin to a WordPress docroot in one tool call, "
                "creating mu-plugins if absent. Met.",
                "G5 — Add an automated test suite and a README covering setup and destructive-tool policy "
                "before the server is used against production accounts by more than one operator. Not met.",
                "G6 — Replace password authentication with a scoped cPanel API token, and re-enable TLS "
                "certificate verification. Not met.",
            ],
        },
        {"kind": "h2", "text": "3.2 Success Metrics / KPIs"},
        {
            "kind": "table",
            "header": ["Metric", "Baseline", "Target", "Measurement Method"],
            "rows": [
                ["Typed tool count", "0 (no server)", "51 tools registered at startup", "Count of server.tool() registrations in src/tools/."],
                ["cPanel logins for routine agent tasks", "1 per task", "0 for tasks covered by a typed tool", "Operator report per engagement."],
                ["Share of calls using cp_uapi_call rather than a typed tool", "n/a", "Under 10% of calls; each recurring use promoted to a typed tool", "Manual review of agent transcripts."],
                ["Automated test coverage", "0% (no test suite)", "Smoke coverage of client.ts request paths and all read-only tools", "Test runner output once a suite exists."],
                ["Unintended destructive changes (wrong DNS record, wrong cron, wrong file)", "Unmeasured", "0 confirmed incidents", "Incident log kept by the infrastructure owner."],
                ["wordpress-mcp cache/meta tools functional on managed sites", "Blocked without the mu-plugin", "100% of managed sites have the helper deployed", "GET /wp-json/agent-cache/v1/ping per site."],
            ],
        },
        {"kind": "h2", "text": "3.3 Non-Goals"},
        {
            "kind": "bullets",
            "items": [
                "Not a WHM/root server-management tool — everything runs as one cPanel account.",
                "No HTTP or SSE transport. stdio only.",
                "No multi-account or multi-tenant support: one process serves exactly one cPanel account, "
                "configured by environment variables.",
                "No confirmation gate, dry-run mode or undo. Unlike brevo-mcp and mcp-meta-ads, destructive tools "
                "in this server execute immediately when called.",
                "No shell or SSH execution. Anything not reachable through UAPI or API2 is out of scope.",
                "No credential storage or rotation. Credentials come from the environment.",
                "No test suite and no README exist in v1.0.0; both are tracked as gaps, not shipped features.",
            ],
        },
        # ── 4 ───────────────────────────────────────────────────────────────
        {"kind": "h1", "text": "4. Target Audience & User Personas"},
        {"kind": "h2", "text": "4.1 Primary Persona"},
        {
            "kind": "table",
            "header": ["Attribute", "Detail"],
            "rows": [
                ["Persona", "AI agent operating a HaorGrix client site through an MCP client."],
                ["Context", "Runs the server as a local child process over stdio, with credentials for one cPanel account."],
                ["Goal", "Complete a hosting task end to end — deploy a plugin, fix a DNS record, rotate a mailbox password — without a human in the cPanel UI."],
                ["Affordances", "Tool names and descriptions only. There is no UI, no docs page, and no README to consult."],
                ["Pain points", "Deletion tools keyed on line numbers and exact command strings; no confirmation step; UAPI errors surfaced largely as-is."],
                ["Technical level", "High for API semantics; zero situational awareness of concurrent human edits in the cPanel UI."],
                ["Success looks like", "The right record changes, nothing adjacent breaks, and the response text states plainly what changed."],
            ],
        },
        {"kind": "h2", "text": "4.2 Secondary Personas"},
        {
            "kind": "bullets",
            "items": [
                "HaorGrix engineer — configures .env, runs npm run dev or the built dist/index.js, extends tool groups.",
                "Infrastructure owner — holds the cPanel credentials, decides which accounts the server may point at.",
                "Incident responder — uses read-only tools (cp_list_files, cp_read_file, cp_list_crons, cp_ssl_status) to inspect a site quickly during an outage.",
            ],
        },
        # ── 5 ───────────────────────────────────────────────────────────────
        {"kind": "break"},
        {"kind": "h1", "text": "5. Scope, User Stories & Requirements"},
        {"kind": "h2", "text": "5.1 User Stories"},
        {
            "kind": "bullets",
            "items": [
                "As an agent, I want to read account, disk and bandwidth stats so I can tell whether a site is near a hosting limit.",
                "As an agent, I want to list and read files under the account home so I can inspect configuration without SSH.",
                "As an agent, I want to write files and create directories so I can deploy assets such as the cache helper plugin.",
                "As an agent, I want to create, delete and re-password mailboxes and forwarders so I can run email housekeeping.",
                "As an agent, I want to list, add and delete DNS records so I can point a domain or add a verification TXT record.",
                "As an agent, I want to manage cron entries so I can schedule or repair a site's background jobs.",
                "As an agent, I want to create, drop and grant on MySQL databases and users so I can stand up or clean up an install.",
                "As an agent, I want to trigger a backup and restore a database from an archive so I can recover from a bad change.",
                "As an agent, I want to check SSL coverage and expiry so I can flag a certificate before it lapses.",
                "As an agent, I want to set a domain's PHP version so I can meet an application's runtime requirement.",
                "As an agent, I want to install the Agent Cache Control mu-plugin so that wordpress-mcp cache and post-meta tools work on that site.",
                "As an agent, I want a raw UAPI call available so an unwrapped endpoint does not block the task.",
                "As an engineer, I want the process to exit with a clear message when required env vars are missing, rather than failing mid-task.",
                "As an infrastructure owner, I want destructive tools to be identifiable by name and documented, so I can decide what agents may call.",
            ],
        },
        {"kind": "h2", "text": "5.2 Functional Requirements"},
        {
            "kind": "table",
            "header": ["ID", "Requirement", "Priority", "Acceptance Criteria"],
            "rows": [
                ["FR-1", "Register 51 MCP tools across ten tool groups on startup.", "Must",
                 "index.ts calls registerFileTools, registerDatabaseTools, registerEmailTools, registerDomainTools, registerDnsTools, registerBackupTools, registerCronTools, registerSslTools, registerStatsTools, registerCacheTools and registerRawTools; a client listing tools sees all 51 names in section 14.3."],
                ["FR-2", "Validate configuration before serving.", "Must",
                 "Missing CPANEL_HOST, CPANEL_USERNAME or CPANEL_PASSWORD prints the missing names and exits with code 1. CPANEL_BASE_URL is optional and defaults to https://cpanel.<CPANEL_HOST>."],
                ["FR-3", "Serve over stdio only.", "Must",
                 "StdioServerTransport is connected; the startup banner goes to stderr so stdout stays a clean JSON-RPC channel."],
                ["FR-4", "Authenticate every request with HTTP Basic against UAPI.", "Must",
                 "client.ts builds an Authorization: Basic header from username:password once at construction and sends it on every call."],
                ["FR-5", "Expose account and resource statistics (read-only).", "Must",
                 "cp_get_account_info, cp_get_disk_usage, cp_get_bandwidth return current values for the configured account."],
                ["FR-6", "Expose file management.", "Must",
                 "cp_list_files, cp_read_file, cp_write_file, cp_create_dir, cp_delete_file, cp_rename_file, cp_compress, cp_extract operate relative to the cPanel home directory."],
                ["FR-7", "Delete files to trash by default.", "Must",
                 "cp_delete_file moves the target to trash unless skip_trash is explicitly true."],
                ["FR-8", "Expose MySQL database management.", "Must",
                 "cp_list_databases, cp_list_db_users, cp_create_database, cp_delete_database, cp_create_db_user, cp_delete_db_user, cp_assign_db_user, cp_check_db succeed against the account's MySQL instance."],
                ["FR-9", "Expose email account, forwarder and autoresponder management.", "Must",
                 "cp_list_email_accounts, cp_list_forwarders, cp_list_autoresponders, cp_create_email, cp_delete_email, cp_change_email_password, cp_create_forwarder, cp_delete_forwarder behave as named."],
                ["FR-10", "Expose domain and subdomain management, including PHP version.", "Must",
                 "cp_list_domains, cp_domain_info, cp_list_subdomains, cp_create_subdomain, cp_delete_subdomain, cp_get_php_version, cp_set_php_version behave as named."],
                ["FR-11", "Expose DNS zone read and edit.", "Must",
                 "cp_list_dns_records and cp_get_zone_info read the zone; cp_add_dns_record adds a record; cp_delete_dns_record removes the record at a caller-supplied line number."],
                ["FR-12", "Expose cron management.", "Must",
                 "cp_list_crons, cp_add_cron, cp_remove_cron, cp_edit_cron operate on the account crontab; removal and editing match on the exact command string."],
                ["FR-13", "Expose backup listing, creation and database restore.", "Must",
                 "cp_list_backups, cp_create_backup, cp_restore_db_backup behave as named."],
                ["FR-14", "Expose SSL inspection.", "Should",
                 "cp_list_ssl_certs, cp_ssl_status, cp_list_ssl_capable_domains report installed certificates, per-domain status and eligible domains. Certificate installation is not wrapped."],
                ["FR-15", "Deploy the Agent Cache Control WordPress mu-plugin.", "Must",
                 "cp_deploy_cache_helper creates <docroot>/wp-content/mu-plugins if absent, writes the plugin from src/assets/cacheHelperPlugin.ts, and returns the deployed filename, version, path and the ping URL to verify."],
                ["FR-16", "Provide a filesystem cache-purge fallback.", "Should",
                 "cp_purge_litespeed deletes wp-content/litespeed and wp-content/cache, reporting cleared / absent / failed per path and never failing the call because a directory is missing."],
                ["FR-17", "Provide a raw UAPI escape hatch.", "Should",
                 "cp_uapi_call accepts method (GET|POST, default GET), module, function and an optional flat params record, and returns the raw JSON response."],
                ["FR-18", "Fall back to legacy API2 where UAPI has no equivalent.", "Must",
                 "Directory creation routes through the json-api/cpanel API2 endpoint with cpanel_jsonapi_* parameters."],
                ["FR-19", "Return human-readable confirmations for write operations.", "Should",
                 "Write tools return a plain-text sentence naming the object changed (for example 'DNS record at line 7 deleted from example.com')."],
                ["FR-20", "Require a confirmation argument on destructive tools.", "Won't (v1.0.0)",
                 "Not implemented. Destructive tools execute on first call. Tracked as R-2 in section 13.1."],
                ["FR-21", "Ship an automated test suite and a README.", "Won't (v1.0.0)",
                 "Neither exists. package.json defines only build, start, dev and typecheck. Tracked as R-7 and R-8."],
            ],
        },
        {"kind": "h2", "text": "5.3 User Flows"},
        {
            "kind": "bullets",
            "items": [
                "Startup — MCP client spawns node dist/index.js; dotenv loads .env; required vars are checked; "
                "CpanelClient is constructed; eleven register* functions attach 51 tools; stdio transport connects; "
                "a banner naming the base URL and user is written to stderr.",
                "Read call — agent invokes a cp_list_* or cp_get_* tool; zod validates the arguments; client.call() "
                "issues GET {baseUrl}/execute/{Module}/{function} with query parameters and the Basic header; the "
                "UAPI JSON payload is returned to the agent as formatted text.",
                "Write call — agent invokes a write tool; zod validates; client.post() form-encodes the body to "
                "POST {baseUrl}/execute/{Module}/{function}; a confirmation sentence is returned. No confirmation "
                "is requested from the caller beforehand.",
                "Cache-helper deployment — cp_deploy_cache_helper normalises the docroot, creates the mu-plugins "
                "directory via API2, writes the plugin through Fileman save_file_content, and returns the verify URL. "
                "The site then answers on /wp-json/agent-cache/v1/, which wordpress-mcp depends on.",
                "Escape-hatch call — agent invokes cp_uapi_call with an arbitrary module and function; no typed "
                "guardrail applies; the raw response is returned.",
            ],
        },
        # ── 6 ───────────────────────────────────────────────────────────────
        {"kind": "h1", "text": "6. Non-Functional Requirements"},
        {
            "kind": "table",
            "header": ["Category", "Requirement"],
            "rows": [
                ["Performance", "Each tool call is a single HTTP round trip to the cPanel host over Node's built-in https module. Latency is dominated by the shared-hosting server. No client-side caching, batching or retry logic exists; a slow UAPI response is a slow tool call."],
                ["Scalability", "One process serves one cPanel account. Concurrency is bounded by the MCP client. Scaling to more accounts means running more processes with different environments — there is no account parameter on any tool."],
                ["Availability", "Fully dependent on the cPanel host. The server holds no state and can be restarted at any time with no recovery step. There is no health-check tool and no readiness probe beyond the startup banner."],
                ["Security", "HTTP Basic with the account's cPanel password — full-account credentials, not a scoped API token. TLS certificate verification is disabled (rejectUnauthorized: false) to tolerate self-signed certificates on cpanel.* subdomains, which removes protection against interception on that link. Credentials are read from the environment and never written to output. The process must only be run on a trusted operator machine."],
                ["Privacy / Compliance", "Tools can read arbitrary files, mailbox lists and database contents belonging to clients, so any call may surface personal data into an agent transcript. Nothing is redacted or filtered. Operators must treat transcripts as containing client data."],
                ["Accessibility", "N/A — no human-facing UI. Operator-facing output is plain text on stdout/stderr and is screen-reader compatible by nature."],
                ["Observability", "One stderr banner at startup naming the base URL and username. No structured logging, no request/response logging, no metrics, no audit trail of which tool changed what. Post-hoc attribution of a change relies on the agent transcript."],
                ["Localization", "N/A — English-only tool names, descriptions and messages, consumed by machines. UAPI error strings pass through in whatever language the host returns."],
            ],
        },
        # ── 7 ───────────────────────────────────────────────────────────────
        {"kind": "h1", "text": "7. Technical Considerations"},
        {"kind": "h2", "text": "7.1 Architecture & Dependencies"},
        {
            "kind": "bullets",
            "items": [
                "Runtime: Node.js >= 18 (engines field), TypeScript 5.7 compiled by tsc to dist/. ESM, .js import specifiers.",
                "Runtime dependencies: @modelcontextprotocol/sdk ^1.12.0, zod ^3.23.8, dotenv ^16.4.7. Dev: typescript, tsx, @types/node.",
                "Scripts: build (tsc), start (node dist/index.js), dev (tsx src/index.ts), typecheck (tsc --noEmit). No test script.",
                "Size: approximately 1,713 lines across src/, of which 376 lines are the embedded cache-helper PHP asset.",
                "Layering: index.ts (config + wiring) → tools/*.ts (zod schemas + descriptions) → client.ts (HTTP) → cPanel UAPI/API2. types.ts holds shared UAPI response types.",
                "Transport: StdioServerTransport. stdout carries JSON-RPC only; all diagnostics go to stderr.",
            ],
        },
        {"kind": "h2", "text": "7.2 Data Model & APIs"},
        {
            "kind": "bullets",
            "items": [
                "The server owns no persistent data. cPanel is the system of record for every object it touches.",
                "UAPI read: GET {baseUrl}/execute/{Module}/{function}?{query}. UAPI write: POST to the same path with a form-encoded body.",
                "API2 fallback: GET {baseUrl}/json-api/cpanel with cpanel_jsonapi_user, cpanel_jsonapi_apiversion=2, cpanel_jsonapi_module and cpanel_jsonapi_func — used for directory creation, which has no UAPI equivalent.",
                "Base URL resolution: CPANEL_BASE_URL if set, otherwise https://cpanel.{CPANEL_HOST}. Trailing slashes are stripped.",
                "UAPI modules exercised include Fileman, Mysql, Email, DomainInfo, SubDomain, DNS, Cron, Backup, SSL, LangPHP and the stats modules.",
                "Identifiers are cPanel's own and are not stable handles: DNS records are addressed by zone line number, cron entries by exact command string.",
                "Environment: CPANEL_HOST, CPANEL_USERNAME, CPANEL_PASSWORD (all required), CPANEL_BASE_URL (optional).",
            ],
        },
        {"kind": "h2", "text": "7.3 Integrations"},
        {
            "kind": "table",
            "header": ["Dependency", "Owner", "Type", "Status"],
            "rows": [
                ["cPanel UAPI (/execute)", "Hosting provider", "External HTTP API", "Live — primary interface for all 51 tools."],
                ["cPanel API2 (/json-api/cpanel)", "Hosting provider", "External legacy HTTP API", "Live — used only for directory creation."],
                ["@modelcontextprotocol/sdk", "Anthropic (OSS)", "Library", "Pinned ^1.12.0."],
                ["zod", "OSS", "Library", "Input validation on every tool."],
                ["dotenv", "OSS", "Library", "Loads .env at process start."],
                ["wordpress-mcp", "HaorGrix", "Sibling MCP server", "Hard dependency in one direction — wp_get_post_meta, wp_update_post_meta and wp_cache_status require the Agent Cache Control mu-plugin that cp_deploy_cache_helper installs."],
                ["Agent Cache Control mu-plugin (agent-cache/v1 REST namespace)", "HaorGrix", "Embedded deployable asset", "Shipped inside src/assets/cacheHelperPlugin.ts; deployed per site."],
                ["LiteSpeed / Nginx / Rocket / W3TC / Super Cache", "Client sites", "Third-party WordPress plugins", "Targeted by the helper plugin and by cp_purge_litespeed's filesystem fallback."],
                ["MCP client (Claude Code or equivalent)", "HaorGrix operators", "Host process", "Spawns the server over stdio and supplies the environment."],
            ],
        },
        {"kind": "h2", "text": "7.4 Constraints & Assumptions"},
        {
            "kind": "bullets",
            "items": [
                "Assumes one cPanel account per process; there is no way to switch accounts at call time.",
                "Assumes the account password grants the needed UAPI privileges; no capability discovery is performed.",
                "Assumes the WordPress docroot is /public_html unless the caller overrides docroot.",
                "Assumes the caller passes correct line numbers and exact command strings for deletions — the server does not re-read state to confirm the target before acting.",
                "Constrained to what UAPI and API2 expose. No SSH, no WP-CLI, no root operations.",
                "TLS verification is deliberately disabled in client.ts to work with shared-hosting certificates; this is a knowingly accepted weakness, not an oversight.",
                "No rate limiting, retry or backoff — a host-side throttle surfaces to the agent as a raw error.",
            ],
        },
        {"kind": "h2", "text": "7.5 Analytics & Instrumentation"},
        {
            "kind": "table",
            "header": ["Event", "Trigger", "Properties", "Destination"],
            "rows": [
                ["Startup banner", "Successful transport connect", "Resolved base URL, cPanel username", "stderr"],
                ["Config failure", "A required env var is missing", "Names of the missing variables", "stderr, then exit code 1"],
                ["Fatal error", "Unhandled rejection from main()", "Error object", "stderr, then exit code 1"],
                ["Per-tool invocation", "Not implemented — no tool-level logging exists", "n/a", "n/a (gap, see R-6)"],
                ["Destructive-operation audit record", "Not implemented", "n/a", "n/a (gap, see R-6)"],
            ],
        },
        # ── 8 ───────────────────────────────────────────────────────────────
        {"kind": "h1", "text": "8. Design & UX"},
        {"kind": "para", "text":
            "There is no graphical interface. The only consumer is an AI agent reading a tool list over stdio, so "
            "the design surface is the tool contract itself: names, descriptions, argument schemas and returned text."},
        {
            "kind": "bullets",
            "items": [
                "Naming — every tool carries the cp_ prefix, then a verb, then the object (cp_list_dns_records, "
                "cp_delete_forwarder). Verbs are used consistently: get/list for reads, create/add for insertion, "
                "delete/remove for removal, set/edit for mutation. The verb is the agent's fastest signal of blast radius.",
                "Descriptions are the only documentation. With no README, a tool's description string is the entire "
                "affordance, so descriptions state prerequisites explicitly — cp_delete_dns_record tells the caller to "
                "use cp_list_dns_records first to obtain line numbers; cp_remove_cron says the command must match exactly; "
                "cp_deploy_cache_helper names the downstream wordpress-mcp tools it unblocks.",
                "Preference steering — where two tools overlap, the description ranks them. cp_purge_litespeed states "
                "that wp_purge_cache is the graceful choice and that the filesystem path is for when the REST API is wedged.",
                "Error legibility — UAPI errors are surfaced largely unmodified. That is honest but uneven: a permission "
                "failure and a malformed argument can read similarly. cp_purge_litespeed is the one place with deliberate "
                "error shaping, classifying each path as cleared, absent or failed so a missing directory is not read as a failure.",
                "Confirmation ergonomics — deliberately absent in v1.0.0 and the largest UX gap. Sibling servers "
                "(brevo-mcp, mcp-meta-ads) require an explicit confirm argument on destructive tools; here cp_delete_database, "
                "cp_delete_dns_record and cp_delete_file act on first call. The only safety affordances are the trash-by-default "
                "behaviour of cp_delete_file and the naming convention itself.",
                "Return-value style — write tools reply with one plain sentence naming what changed, so the agent can quote "
                "it back to a human without re-reading state.",
            ],
        },
        # ── 9 ───────────────────────────────────────────────────────────────
        {"kind": "break"},
        {"kind": "h1", "text": "9. Release Plan & Milestones"},
        {"kind": "h2", "text": "9.1 Phases"},
        {
            "kind": "table",
            "header": ["Milestone", "Scope", "Owner", "Target Date"],
            "rows": [
                ["M1 — v1.0.0 (shipped)", "51 tools across ten groups, stdio transport, Basic auth, embedded cache-helper asset.", "Musfiqur Tuhin", "Shipped (see CHANGELOG.md)"],
                ["M2 — Safety gate", "Add a confirm argument to destructive tools; re-read-before-delete for DNS and cron.", "Musfiqur Tuhin", "TBD — pending owner scheduling"],
                ["M3 — Credential hardening", "Move to cPanel API tokens; re-enable TLS verification with a pinned or trusted CA path.", "TBD — security reviewer", "TBD"],
                ["M4 — Test suite", "Unit tests for client.ts URL/body construction; smoke tests for all read-only tools against a scratch account.", "Musfiqur Tuhin", "TBD"],
                ["M5 — Documentation", "README with setup, env vars, tool inventory and destructive-tool policy.", "Musfiqur Tuhin", "TBD"],
                ["M6 — Observability", "Structured per-call logging with an audit line for every write.", "TBD", "TBD"],
            ],
        },
        {"kind": "h2", "text": "9.2 Rollout Strategy"},
        {
            "kind": "bullets",
            "items": [
                "Distribution is by repository checkout and local build; there is no package registry release.",
                "Each operator configures .env against the account they are authorised to touch.",
                "Recommended sequence for a new account: read-only tools first to confirm credentials and base URL, "
                "then cp_create_backup, then any write tool.",
                "Roll back by reverting the checkout and rebuilding; the server holds no state, so there is nothing to migrate. "
                "Data changes it made in cPanel are not rolled back by this — restore from backup.",
            ],
        },
        {"kind": "h2", "text": "9.3 Effort & Timeline"},
        {
            "kind": "table",
            "header": ["Workstream", "Owner", "Estimate", "Dependencies"],
            "rows": [
                ["v1.0.0 implementation", "Musfiqur Tuhin", "Complete (~1,713 LOC)", "cPanel UAPI access"],
                ["Confirmation gates + re-read-before-delete", "Musfiqur Tuhin", "2-3 days", "Agreement on the confirm argument shape used by brevo-mcp and mcp-meta-ads"],
                ["API token auth + TLS verification", "TBD — security reviewer", "1-2 days", "Hosting provider support for API tokens on the relevant plan"],
                ["Test suite", "Musfiqur Tuhin", "3-4 days", "A disposable scratch cPanel account for integration smoke tests"],
                ["README and tool inventory doc", "Musfiqur Tuhin", "1 day", "This PRD"],
                ["Structured logging and write audit trail", "TBD", "2 days", "Decision on log destination"],
            ],
        },
        {"kind": "h2", "text": "9.4 Launch Readiness Checklist"},
        {
            "kind": "bullets",
            "items": [
                "Done — npm run typecheck passes; server starts and registers 51 tools.",
                "Done — required env vars validated at startup with a clear failure message.",
                "Done — cache-helper deployment verified via the agent-cache/v1 ping endpoint.",
                "Done — read-only tools exercised against a live account.",
                "Not done — no automated tests.",
                "Not done — no README or operator runbook.",
                "Not done — no confirmation gate on destructive tools.",
                "Not done — credentials are a full-account password; TLS verification disabled.",
                "Not done — no audit trail of write operations.",
                "Open — infrastructure owner has not signed off on which accounts agents may operate against.",
            ],
        },
        # ── 10 ──────────────────────────────────────────────────────────────
        {"kind": "h1", "text": "10. Cost, Resourcing & Effort"},
        {"kind": "h2", "text": "10.1 Team & Roles"},
        {
            "kind": "table",
            "header": ["Role", "Person", "Allocation"],
            "rows": [
                ["Product / document owner", "Musfiqur Tuhin", "As needed"],
                ["Maintainer (TypeScript)", "Musfiqur Tuhin", "Ad hoc — feature and defect driven"],
                ["Security reviewer", "TBD — reviewer name", "One review for M3, then annually"],
                ["Infrastructure owner", "TBD — named owner for the managed cPanel accounts", "Approval gate only"],
                ["QA", "Unstaffed — no test suite exists", "0"],
            ],
        },
        {"kind": "h2", "text": "10.2 Cost Considerations"},
        {
            "kind": "bullets",
            "items": [
                "No licence or per-call cost. cPanel access is already paid for as part of client hosting.",
                "No infrastructure cost — the server runs as a local child process of the operator's MCP client.",
                "Cost is engineering time only, plus the residual risk cost of an unguarded destructive operation "
                "(recovery from backup, client trust) which the M2 safety gate is intended to reduce.",
                "A disposable scratch cPanel account for integration tests is the one line item M4 may require.",
            ],
        },
        # ── 11 ──────────────────────────────────────────────────────────────
        {"kind": "h1", "text": "11. Operations, Support & Maintenance"},
        {"kind": "h2", "text": "11.1 Operational Ownership"},
        {
            "kind": "bullets",
            "items": [
                "Code owner: Musfiqur Tuhin, HaorGrix. Source lives in HaorGrix/mcp-servers under Tooling/MCP/cpanel-mcp/.",
                "Credential owner: the infrastructure owner for each cPanel account (TBD by account).",
                "There is no deployed service to operate — each operator runs their own process, so there is no on-call rotation and no shared uptime.",
                "Upstream cPanel outages are handled by the hosting provider; the server has no fallback path.",
            ],
        },
        {"kind": "h2", "text": "11.2 Support & Enablement"},
        {
            "kind": "bullets",
            "items": [
                "Support channel: the HaorGrix tools Slack channel.",
                "Enablement material today is the tool descriptions plus this PRD. A README is outstanding (M5).",
                "First-line triage: confirm CPANEL_BASE_URL resolves, confirm the credentials work in the cPanel UI, then retry a read-only tool such as cp_get_account_info.",
                "Because there is no request logging, reproducing a defect generally requires the agent transcript.",
            ],
        },
        {"kind": "h2", "text": "11.3 Maintenance & Deprecation"},
        {
            "kind": "bullets",
            "items": [
                "Track cPanel UAPI changes; provider upgrades can change response shapes without notice and there are no tests to catch it.",
                "Keep @modelcontextprotocol/sdk, zod and dotenv current; the SDK is the most likely source of breaking changes.",
                "The embedded mu-plugin is versioned (CACHE_HELPER_VERSION); re-running cp_deploy_cache_helper overwrites in place, so version bumps must stay backward compatible with wordpress-mcp's expectations.",
                "Promote any recurring cp_uapi_call pattern into a typed tool, then keep the escape hatch for the long tail.",
                "Deprecation: if the hosting estate moves off cPanel, this server is retired outright — nothing depends on it except the cache-helper deployment path, which would need a replacement mechanism.",
            ],
        },
        # ── 12 ──────────────────────────────────────────────────────────────
        {"kind": "h1", "text": "12. Legal, Privacy & Compliance"},
        {
            "kind": "table",
            "header": ["Area", "Consideration", "Owner / Status"],
            "rows": [
                ["Client data access", "Tools can read client files, mailbox lists and database contents; anything read enters an agent transcript unredacted.", "Infrastructure owner — policy TBD"],
                ["Credential handling", "Full-account cPanel password held in the operator's environment; no rotation process defined.", "Open — M3"],
                ["Transport security", "TLS certificate verification disabled, so the credential-bearing link is not protected against interception.", "Open — M3, accepted risk in v1.0.0"],
                ["Authorisation to act", "Client consent for automated changes to their hosting is assumed from the engagement, not recorded per account.", "TBD — infrastructure owner to confirm per client"],
                ["Data retention", "The server stores nothing. Retention risk sits in agent transcripts and MCP client logs.", "HaorGrix — covered by transcript handling policy"],
                ["Licensing", "Dependencies are permissively licensed (MIT/Apache-2.0). No package.json license field is set.", "Open — set an explicit license field"],
                ["Backups before destructive change", "No enforced pre-change backup; cp_create_backup exists but is never called automatically.", "Open — consider as part of M2"],
                ["Third-party terms", "Use of cPanel UAPI is governed by the hosting provider's terms.", "Accepted"],
            ],
        },
        # ── 13 ──────────────────────────────────────────────────────────────
        {"kind": "break"},
        {"kind": "h1", "text": "13. Risks, Dependencies & Open Questions"},
        {"kind": "h2", "text": "13.1 Risks"},
        {
            "kind": "table",
            "header": ["Risk", "Likelihood", "Impact", "Mitigation"],
            "rows": [
                ["R-1 — cp_uapi_call bypasses every typed guardrail. An agent can reach any UAPI module and function, including endpoints deliberately left unwrapped, with POST.", "High", "Critical", "Treat it as an operator-only tool; consider an allowlist of modules or an env flag that disables it by default; review transcripts for its use."],
                ["R-2 — No confirmation gate on destructive tools. cp_delete_database, cp_delete_email, cp_delete_subdomain, cp_delete_dns_record and cp_delete_file execute on first call, unlike the equivalents in brevo-mcp and mcp-meta-ads.", "High", "High", "M2 adds a confirm argument matching the sibling servers' convention. Until then, restrict which accounts agents may target."],
                ["R-3 — Deletion keyed on brittle identifiers. cp_delete_dns_record takes a zone line number and cp_remove_cron / cp_edit_cron match an exact command string. A concurrent edit in the cPanel UI between the list call and the delete call shifts line numbers, so the wrong record can be deleted silently.", "Medium", "High", "Re-read the zone or crontab immediately before acting and verify the target still matches; keep the read and the write in one tool call."],
                ["R-4 — Password authentication. Credentials are the full cPanel account password, not a scoped API token, so a leaked .env is total account compromise with no way to scope or revoke narrowly.", "Medium", "Critical", "M3 migrates to API tokens; keep .env out of version control; rotate on any suspected exposure."],
                ["R-5 — TLS verification disabled (rejectUnauthorized: false), leaving the credential-bearing connection open to interception on an untrusted network.", "Low", "Critical", "Pin the host certificate or trust the provider CA explicitly; run only from trusted networks until fixed."],
                ["R-6 — No audit trail. Nothing records which tool changed what, so an unexpected hosting change cannot be attributed without the agent transcript.", "High", "Medium", "M6 adds a structured log line per write operation."],
                ["R-7 — No automated tests. A cPanel UAPI response-shape change or a refactor breaks tools silently; typecheck is the only gate.", "High", "Medium", "M4 adds unit tests for client.ts and smoke tests for read-only tools."],
                ["R-8 — No README. Tool descriptions are the only documentation, so onboarding depends on reading source.", "High", "Low", "M5 ships a README with setup and the destructive-tool policy."],
                ["R-9 — cp_purge_litespeed deletes directories on disk with skip_trash, which is unrecoverable if pointed at a wrong docroot.", "Low", "High", "Description already steers callers to wp_purge_cache first; validate the docroot before deleting."],
                ["R-10 — Single point of failure for wordpress-mcp. If the mu-plugin asset drifts from what wordpress-mcp expects, post-meta and cache tools break across every managed site at once.", "Medium", "Medium", "Version the plugin, and check the deployed version during wordpress-mcp health checks."],
                ["R-11 — cPanel UAPI is an unversioned external dependency; a provider upgrade can change response shapes without notice.", "Medium", "Medium", "Keep parsing tolerant; add smoke tests (M4) so drift is detected early."],
                ["R-12 — Restore tools (cp_restore_db_backup) can overwrite a live database with stale data.", "Low", "High", "Require an explicit backup-file argument and confirm the target database name before calling."],
            ],
        },
        {"kind": "h2", "text": "13.2 Open Questions"},
        {
            "kind": "table",
            "header": ["Question", "Owner", "Status"],
            "rows": [
                ["Should cp_uapi_call ship enabled by default, be gated behind an env flag, or be restricted to an allowlist of modules?", "Musfiqur Tuhin", "Open"],
                ["Which confirm-argument convention should the safety gate adopt so it matches brevo-mcp and mcp-meta-ads exactly?", "Musfiqur Tuhin", "Open"],
                ["Does the hosting provider support cPanel API tokens on the plans in use, and do those tokens cover every module the 51 tools call?", "TBD — infrastructure owner", "Open"],
                ["Can TLS verification be re-enabled by trusting the provider CA, or does the cpanel.* certificate genuinely require an exception?", "TBD — security reviewer", "Open"],
                ["Which cPanel accounts are agents authorised to operate against, and does that list distinguish read-only from write access?", "TBD — infrastructure owner", "Open"],
                ["Should destructive tools automatically call cp_create_backup first, and who pays the storage cost?", "Musfiqur Tuhin", "Open"],
                ["Where should write-audit logs be written — stderr, a local file, or a central sink?", "TBD", "Open"],
                ["Is a scratch cPanel account available for integration tests, or must tests be mocked at the HTTP layer?", "Musfiqur Tuhin", "Open"],
                ["Should SSL certificate installation be wrapped, or does inspection-only remain the correct scope?", "Musfiqur Tuhin", "Open"],
            ],
        },
        {"kind": "h2", "text": "13.3 Decision Log"},
        {
            "kind": "table",
            "header": ["Date", "Decision", "Rationale", "Decided By"],
            "rows": [
                ["TBD — v1.0.0 development", "stdio transport only, no HTTP/SSE.", "The server is spawned locally by an MCP client and holds full-account credentials; exposing it over a network would widen the attack surface for no benefit.", "Musfiqur Tuhin"],
                ["TBD — v1.0.0 development", "HTTP Basic with the account password rather than an API token.", "Fastest path to working coverage across all UAPI modules; token support deferred to M3.", "Musfiqur Tuhin"],
                ["TBD — v1.0.0 development", "Disable TLS certificate verification in client.ts.", "Shared-hosting cpanel.* subdomains present intermediate or self-signed certificates that would otherwise block every call. Recorded as R-5, not treated as solved.", "Musfiqur Tuhin"],
                ["TBD — v1.0.0 development", "Ship cp_uapi_call as an unbounded escape hatch.", "51 typed tools cannot cover all of UAPI; an escape hatch prevents unwrapped endpoints from blocking a task.", "Musfiqur Tuhin"],
                ["TBD — v1.0.0 development", "No confirmation gate on destructive tools in v1.0.0.", "Deferred to reach coverage sooner. Diverges from brevo-mcp and mcp-meta-ads and is tracked as R-2.", "Musfiqur Tuhin"],
                ["TBD — v1.0.0 development", "cp_delete_file trashes by default; skip_trash must be explicit.", "Cheapest available undo for the most frequently called destructive tool.", "Musfiqur Tuhin"],
                ["TBD — v1.0.0 development", "Embed the cache-helper PHP source in the TypeScript bundle rather than fetching it.", "Makes deployment a single tool call with no network fetch and keeps the plugin version pinned to the server version.", "Musfiqur Tuhin"],
                ["TBD — v1.0.0 development", "Use legacy API2 for directory creation.", "UAPI exposes no equivalent Fileman function.", "Musfiqur Tuhin"],
                ["2026-07-22", "Document the known weaknesses in this PRD rather than defer them.", "The server already runs against production client accounts; the gaps must be visible to whoever approves that use.", "Musfiqur Tuhin"],
            ],
        },
        # ── 14 ──────────────────────────────────────────────────────────────
        {"kind": "h1", "text": "14. Appendix & Glossary"},
        {"kind": "h2", "text": "14.1 Competitive / Market Analysis"},
        {
            "kind": "bullets",
            "items": [
                "Manual cPanel UI — the status quo. Complete and safe (it confirms destructive actions) but not callable by an agent and leaves no machine-readable trail.",
                "Raw curl against UAPI — no schema, no discoverability, and every call has to be rebuilt from provider docs. cpanel-mcp is essentially this with types, names and descriptions layered on.",
                "SSH plus WP-CLI — more powerful, but shared hosting frequently disables shell access, and shell access is a far larger grant than a scoped set of named tools.",
                "Third-party cPanel MCP servers — none evaluated as trustworthy for handling full-account credentials; a first-party server keeps credentials and tool surface under HaorGrix control.",
                "Within the HaorGrix suite, cpanel-mcp is the only server operating at the infrastructure tier, and the only one whose sibling (wordpress-mcp) has a hard functional dependency on it.",
            ],
        },
        {"kind": "h2", "text": "14.2 Glossary"},
        {
            "kind": "table",
            "header": ["Term", "Definition"],
            "rows": [
                ["MCP", "Model Context Protocol — the JSON-RPC protocol by which an AI client discovers and calls tools."],
                ["stdio transport", "MCP transport where the client spawns the server as a child process and exchanges JSON-RPC over stdin/stdout."],
                ["UAPI", "cPanel's current REST-style API, reached at /execute/{Module}/{function}."],
                ["API2", "cPanel's legacy JSON API at /json-api/cpanel, still required for a few operations such as directory creation."],
                ["mu-plugin", "WordPress must-use plugin — a PHP file in wp-content/mu-plugins that loads automatically and cannot be deactivated from the admin UI."],
                ["Agent Cache Control", "The mu-plugin embedded in this server that exposes the agent-cache/v1 REST namespace consumed by wordpress-mcp."],
                ["Escape hatch", "cp_uapi_call — an untyped passthrough to arbitrary UAPI endpoints."],
                ["Zone line number", "The positional index of a record within a DNS zone file; cPanel's addressing scheme for record deletion, and unstable under concurrent edits."],
                ["Trash", "cPanel's recycle bin, where cp_delete_file places targets unless skip_trash is set."],
                ["LiteSpeed", "The web server and its WordPress caching plugin commonly used on the shared hosting in question."],
                ["MoSCoW", "Prioritisation scheme: Must, Should, Could, Won't."],
            ],
        },
        {"kind": "h2", "text": "14.3 Additional Notes & References"},
        {"kind": "para", "text":
            "Complete tool inventory for cpanel-mcp v1.0.0 — 51 tools: 21 read-only and 30 write, of which "
            "cp_uapi_call is unbounded. Classification reflects the source in src/tools/."},
        {
            "kind": "table",
            "header": ["Tool", "Classification", "Purpose"],
            "rows": [list(t) for t in ALL_TOOLS],
        },
        {"kind": "meta", "text":
            "Scope caveat: this PRD documents cpanel-mcp v1.0.0 exactly as implemented on 2026-07-22. "
            "Items marked Not met, Won't, or Open are genuine gaps in the shipped code, not planned-and-delivered work."},
        {
            "kind": "bullets",
            "items": [
                "Environment variables: CPANEL_HOST (required), CPANEL_USERNAME (required), CPANEL_PASSWORD (required), CPANEL_BASE_URL (optional override, defaults to https://cpanel.<CPANEL_HOST>).",
                "npm scripts: build, start, dev, typecheck. No test script is defined.",
                "Cross-server integration: cp_deploy_cache_helper is a prerequisite for wordpress-mcp's wp_get_post_meta, wp_update_post_meta and wp_cache_status. Verify with GET {WORDPRESS_URL}/wp-json/agent-cache/v1/ping (authenticated).",
                "Repository: HaorGrix/mcp-servers (private), branch main, path Tooling/MCP/cpanel-mcp/.",
            ],
        },
    ],
}
