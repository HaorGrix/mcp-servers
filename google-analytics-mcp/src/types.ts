import { z } from "zod";

// Shared Schemas
export const DimensionSchema = z.object({
  name: z.string().describe("The name of the dimension (e.g. 'city', 'pagePath', 'sessionSource')")
});

export const MetricSchema = z.object({
  name: z.string().describe("The name of the metric (e.g. 'activeUsers', 'screenPageViews', 'conversions')")
});

// Tool Parameter Schemas

export const GetRealtimeReportSchema = z.object({
  propertyId: z.string().optional().describe("GA4 Property ID (numeric). Defaults to the one configured in the environment."),
  dimensions: z.array(DimensionSchema).optional().describe("The dimensions to request."),
  metrics: z.array(MetricSchema).optional().describe("The metrics to request."),
  limit: z.number().optional().describe("Limit on the number of rows returned.")
});

export const RunReportSchema = z.object({
  propertyId: z.string().optional().describe("GA4 Property ID (numeric). Defaults to the one configured in the environment."),
  startDate: z.string().describe("Start date for the report query. Format: 'YYYY-MM-DD' or relative dates like 'today', 'yesterday', '30daysAgo'."),
  endDate: z.string().describe("End date for the report query. Format: 'YYYY-MM-DD' or relative dates like 'today', 'yesterday'."),
  dimensions: z.array(DimensionSchema).describe("The dimensions to request (e.g. pagePath, sessionSource)."),
  metrics: z.array(MetricSchema).describe("The metrics to request (e.g. activeUsers, conversions)."),
  limit: z.number().optional().describe("Limit on the number of rows returned.")
});

export const GetMetadataSchema = z.object({
  propertyId: z.string().optional().describe("GA4 Property ID (numeric) to fetch metadata for. Defaults to the one configured in the environment.")
});

export const ListPropertiesSchema = z.object({
  // No strict requirements, optional account ID filter
  accountId: z.string().optional().describe("Optional GA4 Account ID (e.g., 'accounts/12345') to filter properties for.")
});

// TypeScript Types
export type GetRealtimeReportInput = z.infer<typeof GetRealtimeReportSchema>;
export type RunReportInput = z.infer<typeof RunReportSchema>;
export type GetMetadataInput = z.infer<typeof GetMetadataSchema>;
export type ListPropertiesInput = z.infer<typeof ListPropertiesSchema>;
