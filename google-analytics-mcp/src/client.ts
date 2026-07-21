import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { AnalyticsAdminServiceClient } from "@google-analytics/admin";
import * as fs from "fs";
import * as path from "path";

export class GoogleAnalyticsClient {
  private dataClient: BetaAnalyticsDataClient | null = null;
  private adminClient: AnalyticsAdminServiceClient | null = null;
  private defaultPropertyId: string | null = null;
  private credsError: string | null = null;

  constructor() {
    this.defaultPropertyId = process.env.GA4_PROPERTY_ID || null;
    this.initClients();
  }

  /**
   * Initializes the Google Analytics client libraries.
   * If credentials are not configured, it captures the error rather than crashing
   * so the server can start successfully and report clean errors to the user later.
   */
  private initClients() {
    const credPathEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    
    if (!credPathEnv) {
      this.credsError = "GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. Please set this to the path of your Google Service Account JSON key.";
      return;
    }

    // Resolve path relative to the server workspace if relative, otherwise absolute
    const resolvedPath = path.isAbsolute(credPathEnv)
      ? credPathEnv
      : path.resolve(process.cwd(), credPathEnv);

    if (!fs.existsSync(resolvedPath)) {
      this.credsError = `Credentials JSON file not found at path: ${resolvedPath}. Please place the Service Account JSON key file there.`;
      return;
    }

    try {
      this.dataClient = new BetaAnalyticsDataClient({ keyFilename: resolvedPath });
      this.adminClient = new AnalyticsAdminServiceClient({ keyFilename: resolvedPath });
    } catch (error: any) {
      this.credsError = `Failed to initialize Google Analytics clients with credentials at ${resolvedPath}: ${error.message}`;
    }
  }

  /**
   * Helper to assert that clients are ready or throw a clean user-facing error.
   */
  private ensureClientsReady() {
    if (this.credsError || !this.dataClient || !this.adminClient) {
      throw new Error(
        `Google Analytics Credentials Error: ${this.credsError || "Clients not initialized."}\n\n` +
        "Please follow the setup instructions in the google-analytics-mcp/README.md to configure your Service Account key."
      );
    }
  }

  /**
   * Helper to resolve property ID (passed parameter or default environment variable).
   */
  public resolvePropertyId(propertyId?: string): string {
    const resolved = propertyId || this.defaultPropertyId;
    if (!resolved) {
      throw new Error(
        "GA4 Property ID not provided and no GA4_PROPERTY_ID default found in environment variables.\n" +
        "Please provide 'propertyId' or configure GA4_PROPERTY_ID in your server settings."
      );
    }
    // Strip "properties/" prefix if it was included in input
    return resolved.replace(/^properties\//, "");
  }

  /**
   * List all accounts and properties the credentials have access to.
   */
  public async listProperties(accountIdFilter?: string) {
    this.ensureClientsReady();
    const admin = this.adminClient!;
    const results: any[] = [];

    try {
      const [accounts] = await admin.listAccounts({});
      
      for (const account of accounts) {
        // If filter is provided and doesn't match, skip account
        if (accountIdFilter && account.name !== accountIdFilter && account.name?.split("/")[1] !== accountIdFilter) {
          continue;
        }

        const [properties] = await admin.listProperties({ filter: `parent:${account.name}` });
        
        results.push({
          accountId: account.name,
          displayName: account.displayName,
          regionCode: account.regionCode,
          properties: properties.map(p => ({
            propertyId: p.name, // e.g. "properties/123456"
            displayName: p.displayName,
            industryCategory: p.industryCategory,
            timeZone: p.timeZone,
            currencyCode: p.currencyCode
          }))
        });
      }

      return results;
    } catch (error: any) {
      throw new Error(`Failed to list accounts and properties: ${error.message}`);
    }
  }

  /**
   * Run a real-time report for active users and quick metrics (last 30 minutes).
   */
  public async getRealtimeReport(options: {
    propertyId?: string;
    dimensions?: { name: string }[];
    metrics?: { name: string }[];
    limit?: number;
  }) {
    this.ensureClientsReady();
    const targetPropertyId = this.resolvePropertyId(options.propertyId);
    
    // Set default metric and dimension if not provided
    const metrics = options.metrics && options.metrics.length > 0
      ? options.metrics
      : [{ name: "activeUsers" }];

    const dimensions = options.dimensions && options.dimensions.length > 0
      ? options.dimensions
      : [{ name: "country" }];

    try {
      const [response] = await this.dataClient!.runRealtimeReport({
        property: `properties/${targetPropertyId}`,
        dimensions,
        metrics,
        limit: options.limit || 50,
      });

      return this.formatReportResponse(response);
    } catch (error: any) {
      throw new Error(`Failed to fetch real-time report for GA4 Property ${targetPropertyId}: ${error.message}`);
    }
  }

  /**
   * Run standard/historical report query.
   */
  public async runReport(options: {
    propertyId?: string;
    startDate: string;
    endDate: string;
    dimensions: { name: string }[];
    metrics: { name: string }[];
    limit?: number;
  }) {
    this.ensureClientsReady();
    const targetPropertyId = this.resolvePropertyId(options.propertyId);

    try {
      const [response] = await this.dataClient!.runReport({
        property: `properties/${targetPropertyId}`,
        dateRanges: [{ startDate: options.startDate, endDate: options.endDate }],
        dimensions: options.dimensions,
        metrics: options.metrics,
        limit: options.limit || 100,
      });

      return this.formatReportResponse(response);
    } catch (error: any) {
      throw new Error(`Failed to run historical report for GA4 Property ${targetPropertyId}: ${error.message}`);
    }
  }

  /**
   * Fetch GA4 Property metadata (valid dimensions and metrics for querying).
   */
  public async getMetadata(propertyId?: string) {
    this.ensureClientsReady();
    const targetPropertyId = this.resolvePropertyId(propertyId);

    try {
      const [metadata] = await this.dataClient!.getMetadata({
        name: `properties/${targetPropertyId}/metadata`
      });

      return {
        property: `properties/${targetPropertyId}`,
        dimensions: metadata.dimensions?.map(d => ({
          apiName: d.apiName,
          uiName: d.uiName,
          description: d.description,
          category: d.category
        })) || [],
        metrics: metadata.metrics?.map(m => ({
          apiName: m.apiName,
          uiName: m.uiName,
          description: m.description,
          category: m.category,
          type: m.type
        })) || []
      };
    } catch (error: any) {
      throw new Error(`Failed to fetch metadata for GA4 Property ${targetPropertyId}: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ADMIN API — WRITE / MANAGEMENT (requires SA = Editor/Administrator on the
  //  GA4 property). All mutations are scoped to a single property.
  // ═══════════════════════════════════════════════════════════════════════════

  /** Build a fully-qualified admin resource name from a short id or pass-through full name. */
  private resolveResourceName(collection: string, propertyId: string, idOrName: string): string {
    if (idOrName.startsWith("properties/")) return idOrName;
    return `properties/${propertyId}/${collection}/${idOrName}`;
  }

  // ─── Custom Dimensions ───────────────────────────────────────────────────────
  public async listCustomDimensions(propertyId?: string) {
    this.ensureClientsReady();
    const id = this.resolvePropertyId(propertyId);
    try {
      const [dims] = await this.adminClient!.listCustomDimensions({ parent: `properties/${id}` });
      return dims.map(d => ({
        name: d.name,
        parameterName: d.parameterName,
        displayName: d.displayName,
        scope: d.scope,
        description: d.description,
        disallowAdsPersonalization: d.disallowAdsPersonalization,
      }));
    } catch (error: any) {
      throw new Error(`Failed to list custom dimensions for property ${id}: ${error.message}`);
    }
  }

  public async createCustomDimension(options: {
    propertyId?: string;
    parameterName: string;
    displayName: string;
    scope?: "EVENT" | "USER" | "ITEM";
    description?: string;
    disallowAdsPersonalization?: boolean;
  }) {
    this.ensureClientsReady();
    const id = this.resolvePropertyId(options.propertyId);
    try {
      const [dim] = await this.adminClient!.createCustomDimension({
        parent: `properties/${id}`,
        customDimension: {
          parameterName: options.parameterName,
          displayName: options.displayName,
          scope: options.scope || "EVENT",
          description: options.description,
          disallowAdsPersonalization: options.disallowAdsPersonalization ?? false,
        },
      });
      return { created: true, name: dim.name, parameterName: dim.parameterName, displayName: dim.displayName, scope: dim.scope };
    } catch (error: any) {
      throw new Error(`Failed to create custom dimension '${options.parameterName}' on property ${id}: ${error.message}`);
    }
  }

  public async archiveCustomDimension(options: { propertyId?: string; name: string }) {
    this.ensureClientsReady();
    const id = this.resolvePropertyId(options.propertyId);
    const name = this.resolveResourceName("customDimensions", id, options.name);
    try {
      await this.adminClient!.archiveCustomDimension({ name });
      return { archived: true, name };
    } catch (error: any) {
      throw new Error(`Failed to archive custom dimension '${name}': ${error.message}`);
    }
  }

  // ─── Custom Metrics ──────────────────────────────────────────────────────────
  public async listCustomMetrics(propertyId?: string) {
    this.ensureClientsReady();
    const id = this.resolvePropertyId(propertyId);
    try {
      const [metrics] = await this.adminClient!.listCustomMetrics({ parent: `properties/${id}` });
      return metrics.map(m => ({
        name: m.name,
        parameterName: m.parameterName,
        displayName: m.displayName,
        measurementUnit: m.measurementUnit,
        scope: m.scope,
        description: m.description,
      }));
    } catch (error: any) {
      throw new Error(`Failed to list custom metrics for property ${id}: ${error.message}`);
    }
  }

  public async createCustomMetric(options: {
    propertyId?: string;
    parameterName: string;
    displayName: string;
    measurementUnit?: "STANDARD" | "CURRENCY" | "FEET" | "MILES" | "METERS" | "KILOMETERS" | "MILLISECONDS" | "SECONDS" | "MINUTES" | "HOURS";
    description?: string;
  }) {
    this.ensureClientsReady();
    const id = this.resolvePropertyId(options.propertyId);
    try {
      const [metric] = await this.adminClient!.createCustomMetric({
        parent: `properties/${id}`,
        customMetric: {
          parameterName: options.parameterName,
          displayName: options.displayName,
          measurementUnit: options.measurementUnit || "STANDARD",
          scope: "EVENT",
          description: options.description,
        },
      });
      return { created: true, name: metric.name, parameterName: metric.parameterName, displayName: metric.displayName, measurementUnit: metric.measurementUnit };
    } catch (error: any) {
      throw new Error(`Failed to create custom metric '${options.parameterName}' on property ${id}: ${error.message}`);
    }
  }

  public async archiveCustomMetric(options: { propertyId?: string; name: string }) {
    this.ensureClientsReady();
    const id = this.resolvePropertyId(options.propertyId);
    const name = this.resolveResourceName("customMetrics", id, options.name);
    try {
      await this.adminClient!.archiveCustomMetric({ name });
      return { archived: true, name };
    } catch (error: any) {
      throw new Error(`Failed to archive custom metric '${name}': ${error.message}`);
    }
  }

  // ─── Conversion / Key Events ─────────────────────────────────────────────────
  //  GA4 renamed "conversion events" → "key events" (2024). We use the current,
  //  non-deprecated Key Events API. Tool names keep the familiar "conversion"
  //  wording; the underlying resource collection is `keyEvents`.
  public async listConversionEvents(propertyId?: string) {
    this.ensureClientsReady();
    const id = this.resolvePropertyId(propertyId);
    try {
      const [events] = await this.adminClient!.listKeyEvents({ parent: `properties/${id}` });
      return events.map(e => ({
        name: e.name,
        eventName: e.eventName,
        countingMethod: e.countingMethod,
        custom: e.custom,
        deletable: e.deletable,
        createTime: e.createTime,
      }));
    } catch (error: any) {
      throw new Error(`Failed to list key events for property ${id}: ${error.message}`);
    }
  }

  public async createConversionEvent(options: {
    propertyId?: string;
    eventName: string;
    countingMethod?: "ONCE_PER_EVENT" | "ONCE_PER_SESSION";
  }) {
    this.ensureClientsReady();
    const id = this.resolvePropertyId(options.propertyId);
    try {
      const [ev] = await this.adminClient!.createKeyEvent({
        parent: `properties/${id}`,
        keyEvent: {
          eventName: options.eventName,
          countingMethod: options.countingMethod || "ONCE_PER_EVENT",
        },
      });
      return { created: true, name: ev.name, eventName: ev.eventName, countingMethod: ev.countingMethod };
    } catch (error: any) {
      throw new Error(`Failed to create key event '${options.eventName}' on property ${id}: ${error.message}`);
    }
  }

  public async deleteConversionEvent(options: { propertyId?: string; name: string }) {
    this.ensureClientsReady();
    const id = this.resolvePropertyId(options.propertyId);
    const name = this.resolveResourceName("keyEvents", id, options.name);
    try {
      await this.adminClient!.deleteKeyEvent({ name });
      return { deleted: true, name };
    } catch (error: any) {
      throw new Error(`Failed to delete key event '${name}': ${error.message}`);
    }
  }

  // ─── Data Streams (read — surfaces Measurement IDs for pipeline verification) ─
  public async listDataStreams(propertyId?: string) {
    this.ensureClientsReady();
    const id = this.resolvePropertyId(propertyId);
    try {
      const [streams] = await this.adminClient!.listDataStreams({ parent: `properties/${id}` });
      return streams.map(s => ({
        name: s.name,
        displayName: s.displayName,
        type: s.type,
        measurementId: s.webStreamData?.measurementId,
        defaultUri: s.webStreamData?.defaultUri,
        firebaseAppId: s.webStreamData?.firebaseAppId,
      }));
    } catch (error: any) {
      throw new Error(`Failed to list data streams for property ${id}: ${error.message}`);
    }
  }

  /**
   * Format Google Analytics response to a clean, readable JSON format.
   */
  private formatReportResponse(response: any) {
    const dimensionHeaders = response.dimensionHeaders?.map((h: any) => h.name) || [];
    const metricHeaders = response.metricHeaders?.map((h: any) => h.name) || [];

    const rows = response.rows?.map((row: any) => {
      const rowData: Record<string, string | number> = {};
      
      row.dimensionValues?.forEach((val: any, index: number) => {
        const header = dimensionHeaders[index] || `dimension_${index}`;
        rowData[header] = val.value || "";
      });

      row.metricValues?.forEach((val: any, index: number) => {
        const header = metricHeaders[index] || `metric_${index}`;
        // Convert to number if numeric
        const rawVal = val.value || "0";
        rowData[header] = isNaN(Number(rawVal)) ? rawVal : Number(rawVal);
      });

      return rowData;
    }) || [];

    const totals = response.totals?.map((totalRow: any) => {
      const totalData: Record<string, string | number> = {};
      totalRow.metricValues?.forEach((val: any, index: number) => {
        const header = metricHeaders[index] || `metric_${index}`;
        const rawVal = val.value || "0";
        totalData[header] = isNaN(Number(rawVal)) ? rawVal : Number(rawVal);
      });
      return totalData;
    }) || [];

    return {
      rowCount: response.rowCount || rows.length,
      columns: {
        dimensions: dimensionHeaders,
        metrics: metricHeaders
      },
      rows,
      totals: totals.length > 0 ? totals[0] : null
    };
  }
}
