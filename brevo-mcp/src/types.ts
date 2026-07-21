// Shared types for Brevo API v3 responses.
// Only the fields this server actually reads are modelled; Brevo returns more.

export interface BrevoError {
  code: string;
  message: string;
}

export interface BrevoAccount {
  email: string;
  firstName: string;
  lastName: string;
  companyName: string;
  plan: Array<{ type: string; credits?: number; creditsType?: string }>;
}

export interface BrevoSender {
  id: number;
  name: string;
  email: string;
  active: boolean;
  ips?: Array<{ ip: string; domain: string; weight: number }>;
}

export interface BrevoList {
  id: number;
  name: string;
  totalBlacklisted: number;
  totalSubscribers: number;
  folderId: number;
}

export interface BrevoContact {
  id: number;
  email: string;
  emailBlacklisted: boolean;
  smsBlacklisted: boolean;
  createdAt: string;
  modifiedAt: string;
  listIds: number[];
  attributes: Record<string, unknown>;
}

export interface BrevoCampaignStats {
  uniqueClicks: number;
  clickers: number;
  complaints: number;
  delivered: number;
  sent: number;
  softBounces: number;
  hardBounces: number;
  uniqueViews: number;
  unsubscriptions: number;
  viewed: number;
}

export interface BrevoCampaign {
  id: number;
  name: string;
  subject: string;
  type: string;
  status: string;
  scheduledAt?: string;
  sender: { name: string; email: string; id?: number };
  replyTo?: string;
  recipients?: { lists?: number[]; exclusionLists?: number[] };
  statistics?: { globalStats?: BrevoCampaignStats };
}

export interface BrevoCampaignList {
  count: number;
  campaigns: BrevoCampaign[] | null;
}

export interface BrevoListsResponse {
  lists: BrevoList[];
  count: number;
}

export interface BrevoContactsResponse {
  contacts: BrevoContact[];
  count: number;
}

export interface BrevoImportResponse {
  processId: number;
}

export interface BrevoTransactionalResponse {
  messageId: string;
}
