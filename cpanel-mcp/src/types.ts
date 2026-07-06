// Shared types for cPanel UAPI responses

export interface UAPIResponse<T> {
  status: 0 | 1;
  errors: string[] | null;
  warnings: string[] | null;
  messages: string[] | null;
  data: T;
  metadata?: Record<string, unknown>;
}

// ── Fileman ────────────────────────────────────────────────────────────────

export interface CPFile {
  file: string;
  fullpath: string;
  type: 'file' | 'dir' | 'link';
  size: number;
  mtime: number;
  nicesize: string;
  mimetype: string;
  permissions: string;
  owner: string;
  group: string;
}

// ── Databases ──────────────────────────────────────────────────────────────

export interface CPDatabase {
  database: string;
  users: string[];
  disk_usage: number;
}

export interface CPDatabaseUser {
  user: string;
  databases: string[];
}

// ── Email ──────────────────────────────────────────────────────────────────

export interface CPEmailAccount {
  login: string;
  email: string;
  domain: string;
  user: string;
  diskused: number;
  diskquota: number;
  _diskused_bytes: number;
  _diskquota_bytes: number;
}

export interface CPForwarder {
  dest: string;
  forward: string;
  html: string;
  uri: string;
}

export interface CPAutoresponder {
  email: string;
  from: string;
  subject: string;
  body: string;
  start: number;
  stop: number;
  interval: number;
  is_enabled: number;
}

// ── Domains ────────────────────────────────────────────────────────────────

export interface CPDomainInfo {
  domain: string;
  type: 'main' | 'addon' | 'sub' | 'parked';
  documentroot: string;
  homedir: string;
}

export interface CPSubDomain {
  domain: string;
  rootdomain: string;
  dir: string;
  basedir: string;
}

// ── DNS ───────────────────────────────────────────────────────────────────

export interface CPDNSRecord {
  Line: number;
  Line_index: number;
  address?: string;
  class: string;
  name: string;
  record_type: string;
  ttl: number;
  type: string;
  raw: string;
}

// ── Backup ────────────────────────────────────────────────────────────────

export interface CPBackup {
  file: string;
  nicesize: string;
  size: number;
  mtime: number;
  backuptype: string;
}

// ── Cron ──────────────────────────────────────────────────────────────────

export interface CPCronJob {
  command: string;
  day: string;
  hour: string;
  minute: string;
  month: string;
  weekday: string;
  linekey?: string;
}

// ── SSL ───────────────────────────────────────────────────────────────────

export interface CPSSLCert {
  id: string;
  domains: string[];
  issuer: string;
  subject: string;
  activation_time: number;
  expiration_time: number;
  is_self_signed: number;
}

// ── Stats ─────────────────────────────────────────────────────────────────

export interface CPStat {
  id: string;
  name: string;
  value: string | number;
  units: string;
}

export interface CPAccountInfo {
  user: string;
  email: string;
  domain: string;
  plan: string;
  ip: string;
  theme: string;
  startdate: string;
}
