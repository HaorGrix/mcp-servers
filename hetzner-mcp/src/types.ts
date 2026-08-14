/** Hetzner Cloud API v1 response shapes. Only the fields we actually consume. */

export interface HcloudPagination {
  readonly page: number;
  readonly per_page: number;
  readonly total_entries: number | null;
  readonly next_page: number | null;
}

/** Hetzner nests pagination under `meta`, not at the top level of the envelope. */
export interface HcloudMeta {
  readonly meta?: { readonly pagination?: HcloudPagination };
}

export interface HcloudError {
  readonly code: string;
  readonly message: string;
}

export interface ServerPublicNet {
  readonly ipv4: { readonly ip: string; readonly blocked: boolean } | null;
  readonly ipv6: { readonly ip: string; readonly blocked: boolean } | null;
  readonly firewalls?: readonly { readonly id: number; readonly status: string }[];
}

export interface Server {
  readonly id: number;
  readonly name: string;
  readonly status: string;
  readonly created: string;
  readonly public_net: ServerPublicNet;
  readonly server_type: { readonly name: string; readonly cores: number; readonly memory: number; readonly disk: number } | null;
  /** Null in the /servers list response; populated on GET /servers/{id}. */
  readonly datacenter: { readonly name: string; readonly location: { readonly name: string } } | null;
  readonly image: { readonly name: string | null; readonly os_flavor: string } | null;
  readonly locked: boolean;
  readonly backup_window: string | null;
  readonly protection: { readonly delete: boolean; readonly rebuild: boolean };
  readonly labels: Readonly<Record<string, string>>;
}

export type FirewallDirection = "in" | "out";

export interface FirewallRule {
  readonly direction: FirewallDirection;
  readonly protocol: "tcp" | "udp" | "icmp" | "esp" | "gre";
  readonly port?: string | null;
  readonly source_ips?: readonly string[];
  readonly destination_ips?: readonly string[];
  readonly description?: string | null;
}

export interface FirewallAppliedTo {
  readonly type: string;
  readonly server?: { readonly id: number } | null;
}

export interface Firewall {
  readonly id: number;
  readonly name: string;
  readonly created: string;
  readonly rules: readonly FirewallRule[];
  readonly applied_to: readonly FirewallAppliedTo[];
  readonly labels: Readonly<Record<string, string>>;
}

export interface Image {
  readonly id: number;
  readonly type: string;
  readonly status: string;
  readonly name: string | null;
  readonly description: string;
  readonly image_size: number | null;
  readonly disk_size: number;
  readonly created: string;
  readonly created_from?: { readonly id: number; readonly name: string } | null;
  readonly protection: { readonly delete: boolean };
  readonly labels: Readonly<Record<string, string>>;
}

export interface SshKey {
  readonly id: number;
  readonly name: string;
  readonly fingerprint: string;
  readonly public_key: string;
  readonly created: string;
  readonly labels: Readonly<Record<string, string>>;
}

export interface HcloudAction {
  readonly id: number;
  readonly command: string;
  readonly status: "running" | "success" | "error";
  readonly progress: number;
  readonly started: string;
  readonly finished: string | null;
  readonly error: HcloudError | null;
  readonly resources: readonly { readonly id: number; readonly type: string }[];
}

export interface MetricsResponse {
  readonly metrics: {
    readonly start: string;
    readonly end: string;
    readonly step: number;
    readonly time_series: Readonly<Record<string, { readonly values: readonly [number, string][] }>>;
  };
}
