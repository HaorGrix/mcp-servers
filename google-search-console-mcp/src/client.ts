import { google, searchconsole_v1, indexing_v3 } from 'googleapis';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

export interface SearchAnalyticsOptions {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
  startRow?: number;
  searchType?: 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';
  dimensionFilterGroups?: {
    filters: {
      dimension: string;
      operator: 'equals' | 'contains' | 'notContains' | 'includingRegex' | 'excludingRegex';
      expression: string;
    }[];
  }[];
  aggregationType?: 'auto' | 'byPage' | 'byProperty';
  dataState?: 'all' | 'final';
}

export class GoogleSearchConsoleClient {
  private searchConsole: searchconsole_v1.Searchconsole;
  private indexingApi: indexing_v3.Indexing | null = null;
  private isInitialized = false;
  private siteUrl: string;
  private auth: InstanceType<typeof google.auth.GoogleAuth> | null = null;

  constructor() {
    this.siteUrl = process.env.GSC_SITE_URL || 'sc-domain:haorgrix.com';
    
    try {
      const credentialsPath = path.resolve(__dirname, '../credentials.json');
      if (!fs.existsSync(credentialsPath)) {
        console.error(`Credentials file not found at ${credentialsPath}`);
        this.searchConsole = google.searchconsole({ version: 'v1' });
        return;
      }

      this.auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: [
          'https://www.googleapis.com/auth/webmasters.readonly',
          'https://www.googleapis.com/auth/webmasters',
          'https://www.googleapis.com/auth/indexing',
        ],
      });

      this.searchConsole = google.searchconsole({
        version: 'v1',
        auth: this.auth as any,
      });

      this.indexingApi = google.indexing({
        version: 'v3',
        auth: this.auth as any,
      });
      
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize Google Search Console client:', error);
      this.searchConsole = google.searchconsole({ version: 'v1' });
    }
  }

  private checkInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Google Search Console client is not properly initialized. Please check credentials.json.');
    }
  }

  // ── Site Management ─────────────────────────────────────────────────────────

  async listSites(): Promise<searchconsole_v1.Schema$SitesListResponse> {
    this.checkInitialized();
    const response = await this.searchConsole.sites.list();
    return response.data;
  }

  async getSiteInfo(siteUrl?: string): Promise<searchconsole_v1.Schema$WmxSite> {
    this.checkInitialized();
    const response = await this.searchConsole.sites.get({
      siteUrl: siteUrl || this.siteUrl,
    });
    return response.data;
  }

  // ── Search Analytics ────────────────────────────────────────────────────────

  async querySearchAnalytics(options: SearchAnalyticsOptions): Promise<searchconsole_v1.Schema$SearchAnalyticsQueryResponse> {
    this.checkInitialized();
    const response = await this.searchConsole.searchanalytics.query({
      siteUrl: this.siteUrl,
      requestBody: {
        startDate: options.startDate,
        endDate: options.endDate,
        dimensions: options.dimensions || ['query'],
        rowLimit: Math.min(options.rowLimit || 1000, 25000),
        startRow: options.startRow || 0,
        type: options.searchType || 'web',
        dimensionFilterGroups: options.dimensionFilterGroups,
        aggregationType: options.aggregationType || 'auto',
        dataState: options.dataState || 'all',
      },
    });
    return response.data;
  }

  // ── URL Inspection ──────────────────────────────────────────────────────────

  async inspectUrl(inspectionUrl: string): Promise<Record<string, unknown>> {
    this.checkInitialized();
    const response = await this.searchConsole.urlInspection.index.inspect({
      requestBody: {
        inspectionUrl,
        siteUrl: this.siteUrl,
      },
    });
    return response.data as unknown as Record<string, unknown>;
  }

  // ── Sitemap Management ──────────────────────────────────────────────────────

  async listSitemaps(siteUrl?: string): Promise<searchconsole_v1.Schema$SitemapsListResponse> {
    this.checkInitialized();
    const response = await this.searchConsole.sitemaps.list({
      siteUrl: siteUrl || this.siteUrl,
    });
    return response.data;
  }

  async getSitemap(feedpath: string, siteUrl?: string): Promise<searchconsole_v1.Schema$WmxSitemap> {
    this.checkInitialized();
    const response = await this.searchConsole.sitemaps.get({
      siteUrl: siteUrl || this.siteUrl,
      feedpath,
    });
    return response.data;
  }

  async submitSitemap(feedpath: string, siteUrl?: string): Promise<void> {
    this.checkInitialized();
    await this.searchConsole.sitemaps.submit({
      siteUrl: siteUrl || this.siteUrl,
      feedpath,
    });
  }

  async deleteSitemap(feedpath: string, siteUrl?: string): Promise<void> {
    this.checkInitialized();
    await this.searchConsole.sitemaps.delete({
      siteUrl: siteUrl || this.siteUrl,
      feedpath,
    });
  }

  // ── URL Submission (Google Indexing API) ─────────────────────────────────────

  async submitUrlForIndexing(url: string, type: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED'): Promise<Record<string, unknown>> {
    this.checkInitialized();
    if (!this.indexingApi) {
      throw new Error('Indexing API not initialized. Ensure the service account has indexing permissions.');
    }
    const response = await this.indexingApi.urlNotifications.publish({
      requestBody: { url, type },
    });
    return response.data as unknown as Record<string, unknown>;
  }

  async getUrlNotificationStatus(url: string): Promise<Record<string, unknown>> {
    this.checkInitialized();
    if (!this.indexingApi) {
      throw new Error('Indexing API not initialized.');
    }
    const response = await this.indexingApi.urlNotifications.getMetadata({
      url,
    });
    return response.data as unknown as Record<string, unknown>;
  }

  // ── Bulk Analysis Helpers ───────────────────────────────────────────────────

  /**
   * Get pages with high impressions but low CTR (CTR rescue candidates).
   * Returns queries where position < maxPosition but CTR < maxCTR.
   */
  async getCTRRescueCandidates(
    startDate: string,
    endDate: string,
    maxPosition: number = 20,
    maxCTR: number = 0.02,
    rowLimit: number = 1000
  ): Promise<searchconsole_v1.Schema$ApiDataRow[]> {
    const data = await this.querySearchAnalytics({
      startDate,
      endDate,
      dimensions: ['query'],
      rowLimit,
    });

    return (data.rows || []).filter((row) => {
      const position = row.position || 100;
      const ctr = row.ctr || 0;
      const impressions = row.impressions || 0;
      return position <= maxPosition && ctr < maxCTR && impressions >= 5;
    });
  }

  /**
   * Get pages losing position (comparing two date ranges).
   */
  async getPositionChanges(
    period1Start: string,
    period1End: string,
    period2Start: string,
    period2End: string,
    dimension: 'query' | 'page' = 'page'
  ): Promise<{ key: string; oldPosition: number; newPosition: number; change: number }[]> {
    const [period1, period2] = await Promise.all([
      this.querySearchAnalytics({ startDate: period1Start, endDate: period1End, dimensions: [dimension], rowLimit: 5000 }),
      this.querySearchAnalytics({ startDate: period2Start, endDate: period2End, dimensions: [dimension], rowLimit: 5000 }),
    ]);

    const period1Map = new Map<string, number>();
    for (const row of period1.rows || []) {
      const key = row.keys?.[0] || '';
      period1Map.set(key, row.position || 100);
    }

    const changes: { key: string; oldPosition: number; newPosition: number; change: number }[] = [];
    for (const row of period2.rows || []) {
      const key = row.keys?.[0] || '';
      const oldPosition = period1Map.get(key);
      if (oldPosition !== undefined) {
        const newPosition = row.position || 100;
        changes.push({
          key,
          oldPosition,
          newPosition,
          change: oldPosition - newPosition, // positive = improved
        });
      }
    }

    return changes.sort((a, b) => a.change - b.change); // worst drops first
  }
}
