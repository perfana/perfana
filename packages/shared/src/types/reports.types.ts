/**
 * Type definitions for Custom Reporting Feature
 *
 * These types provide proper TypeScript typing for report API operations,
 * DTOs, and utility functions. Entity-level types (ReportSectionType,
 * ReportSectionConfig, ReportStyling, ReportStatus) are defined in the
 * entity files and re-exported from entities/index.ts.
 *
 * CRITICAL: Section type names use underscores (e.g., 'text_block' not 'text-block')
 */

import type {
  ReportSectionType,
  ReportSectionConfig,
  ReportStyling,
  ReportStatus,
  ReportFileMetadata,
} from '../entities';

// Re-export entity types for convenience
export type { ReportSectionType, ReportSectionConfig, ReportStyling, ReportStatus, ReportFileMetadata };

// ==================== Section Configuration Extensions ====================

/**
 * Section types that support accompanying text.
 * All except 'text_block' — a text block's `content` already is the text.
 */
export type TextableSectionType = Exclude<ReportSectionType, 'text_block'>;

/**
 * Report file MIME types
 */
export type ReportMimeType = 'text/html' | 'application/pdf';

// ==================== Extended Section Configurations ====================

/**
 * Header section extended configuration
 */
export interface HeaderSectionOptions {
  /** Report title */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Whether to include logo */
  includeLogo?: boolean;
  /** Whether to include timestamp */
  includeTimestamp?: boolean;
  /** Whether to include test run info */
  includeTestRunInfo?: boolean;
}

/**
 * Text block section extended configuration
 */
export interface TextBlockSectionOptions {
  /** Text content (supports markdown) */
  content: string;
  /** Text alignment */
  alignment?: 'left' | 'center' | 'right';
}

/**
 * SLO (Service Level Objective) section configuration options
 */
export interface SloSectionOptions {
  /** Whether to include summary table */
  includeSummary?: boolean;
  /** Whether to include detailed breakdown */
  includeDetails?: boolean;
  /** Filter by SLO names (empty = all) */
  filterNames?: string[];
  /** Whether to show only failed SLOs */
  showFailedOnly?: boolean;
}

/**
 * Apdex section configuration options
 */
export interface ApdexSectionOptions {
  /** Whether to include overview chart */
  includeChart?: boolean;
  /** Whether to include transaction breakdown */
  includeTransactionBreakdown?: boolean;
  /** Apdex threshold for coloring (e.g., 0.85) */
  thresholdWarning?: number;
  /** Apdex threshold for critical (e.g., 0.7) */
  thresholdCritical?: number;
}

/**
 * Transaction response times section configuration options
 */
export interface TransactionResponseTimesSectionOptions {
  /** Filter by transaction names (empty = all) */
  filterTransactions?: string[];
  /** Maximum number of transactions to show */
  maxTransactions?: number;
  /** Sort order */
  sortBy?: 'name' | 'avg_response_time' | 'max_response_time' | 'count';
  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
  /** Whether to include percentile data */
  includePercentiles?: boolean;
  /** Percentiles to show (e.g., [50, 90, 95, 99]) */
  percentiles?: number[];
  /** Whether to include the "All aggregated" series alongside per-transaction series */
  includeAggregated?: boolean;
}

/**
 * Regressions section configuration options
 */
export interface RegressionsSectionOptions {
  /** Whether to show only significant regressions */
  significantOnly?: boolean;
  /** Threshold percentage for significance (e.g., 5.0 = 5%) */
  significanceThreshold?: number;
  /** Whether to include comparison charts */
  includeCharts?: boolean;
  /** Baseline test run ID for comparison */
  baselineTestRunId?: string;
}

/**
 * AWR (Automatic Workload Repository) section configuration options
 */
export interface AwrSectionOptions {
  /** AWR report IDs to include (empty = all) */
  awrReportIds?: string[];
  /** Whether to include insights */
  includeInsights?: boolean;
  /** Filter insights by severity */
  insightSeverity?: ('critical' | 'warning' | 'info')[];
  /** Whether to include top SQL */
  includeTopSql?: boolean;
  /** Whether to include wait events */
  includeWaitEvents?: boolean;
}

/**
 * Trends section configuration options
 */
export interface TrendsSectionOptions {
  /** Number of historical test runs to include */
  historicalRuns?: number;
  /** Metrics to include in trend analysis */
  metrics?: string[];
  /** Whether to include trend charts */
  includeCharts?: boolean;
  /** Time range for trends */
  timeRange?: 'last_7_days' | 'last_30_days' | 'last_90_days' | 'all';
}

/**
 * Comparisons section configuration options
 */
export interface ComparisonsSectionOptions {
  /** Test run IDs to compare against */
  compareTestRunIds?: string[];
  /** Whether to include difference highlighting */
  highlightDifferences?: boolean;
  /** Threshold percentage for highlighting */
  differenceThreshold?: number;
  /** Comparison metrics to include */
  metrics?: string[];
  /** Whether to include the "All aggregated" row (performance-metrics source only) */
  includeAggregated?: boolean;
}

/**
 * Custom graphs section configuration options
 */
export interface GraphsSectionOptions {
  /** Grafana panel IDs to include */
  panelIds?: string[];
  /** Dashboard UIDs to pull panels from */
  dashboardUids?: string[];
  /** Time range for graphs */
  timeRange?: 'test_duration' | 'custom';
  /** Custom time range start (ISO string) */
  customTimeStart?: string;
  /** Custom time range end (ISO string) */
  customTimeEnd?: string;
  /** Graph width in pixels */
  width?: number;
  /** Graph height in pixels */
  height?: number;
  /** Whether to include the "All aggregated" series (performance test metrics) */
  includeAggregated?: boolean;
}

/**
 * Union type for all section configuration options
 */
export type SectionConfigOptions =
  | HeaderSectionOptions
  | TextBlockSectionOptions
  | SloSectionOptions
  | ApdexSectionOptions
  | TransactionResponseTimesSectionOptions
  | RegressionsSectionOptions
  | AwrSectionOptions
  | TrendsSectionOptions
  | ComparisonsSectionOptions
  | GraphsSectionOptions;

// ==================== Template List Types ====================

/**
 * Report template list item (compact version for API responses)
 */
export interface ReportTemplateListItem {
  /** Unique template ID (UUID) */
  id: string;
  /** Template name */
  name: string;
  /** Template description */
  description?: string;
  /** User who created the template */
  created_by: string;
  /** Number of sections */
  section_count: number;
  /** Section type summary */
  section_types: ReportSectionType[];
  /** Whether this is the default template */
  is_default: boolean;
  /** Creation timestamp */
  created_at: Date;
  /** Last update timestamp */
  updated_at: Date;
}

// ==================== Generated Report List Types ====================

/**
 * Generated report list item (compact version for API responses)
 */
export interface GeneratedReportListItem {
  /** Unique report ID (UUID) */
  id: string;
  /** Associated test run ID */
  test_run_id: string;
  /** Template name */
  template_name: string;
  /** Report name */
  name: string;
  /** User who generated the report */
  generated_by: string;
  /** Generation status */
  status: ReportStatus;
  /** Whether sharing is enabled */
  share_enabled: boolean;
  /** Share link ID (for constructing URL) */
  share_id: string;
  /** Share view count */
  share_view_count: number;
  /** Download count */
  download_count: number;
  /** Whether PDF is available */
  has_pdf: boolean;
  /** File size in bytes */
  file_size?: number;
  /** Creation timestamp */
  created_at: Date;
  /** Completion timestamp */
  completed_at?: Date;
}

/**
 * Paginated report list response
 */
export interface GeneratedReportListResponse {
  /** List of reports */
  items: GeneratedReportListItem[];
  /** Total count */
  total: number;
  /** Current offset */
  offset: number;
  /** Page size limit */
  limit: number;
}

// ==================== Report Generation Request/Response Types ====================

/**
 * Request to generate a new report from a template
 */
export interface GenerateReportFromTemplateRequest {
  /** Test run ID */
  test_run_id: string;
  /** Template ID to use */
  template_id: string;
  /** Optional custom name (defaults to template name + timestamp) */
  name?: string;
}

/**
 * Request to generate an ad-hoc report
 */
export interface GenerateAdHocReportRequest {
  /** Test run ID */
  test_run_id: string;
  /** Report name */
  name: string;
  /** Section configurations */
  sections: ReportSectionConfig[];
  /** Optional styling */
  styling?: ReportStyling;
  /** Whether to save as template */
  save_as_template?: boolean;
  /** Template name (required if save_as_template is true) */
  template_name?: string;
  /** Template description */
  template_description?: string;
}

/**
 * Report generation response
 */
export interface GenerateReportResponse {
  /** Generated report ID */
  report_id: string;
  /** BullMQ job ID */
  job_id: string;
  /** Initial status */
  status: ReportStatus;
  /** Estimated completion time in seconds */
  estimated_completion_seconds?: number;
}

/**
 * Request to generate PDF from existing HTML report
 */
export interface GeneratePdfRequest {
  /** Report ID with HTML content */
  report_id: string;
}

/**
 * PDF generation response
 */
export interface GeneratePdfResponse {
  /** Report ID */
  report_id: string;
  /** BullMQ job ID */
  job_id: string;
  /** Status */
  status: ReportStatus;
}

// ==================== Share Types ====================

/**
 * Share settings update request
 */
export interface UpdateShareSettingsRequest {
  /** Whether to enable sharing */
  share_enabled: boolean;
  /** Optional expiration timestamp */
  expires_at?: Date | string;
}

/**
 * Share settings response
 */
export interface ShareSettingsResponse {
  /** Share ID (UUID) */
  share_id: string;
  /** Whether sharing is enabled */
  share_enabled: boolean;
  /** Full share URL */
  share_url: string;
  /** View count */
  share_view_count: number;
  /** Last accessed */
  last_shared_at?: Date;
  /** Expiration */
  expires_at?: Date;
}

/**
 * Public share response (for unauthenticated access)
 */
export interface PublicShareResponse {
  /** HTML content */
  html_content: string;
  /** Report name */
  name: string;
  /** Test run name (for context) */
  test_run_name?: string;
  /** When report was generated */
  generated_at: Date;
}

// ==================== Job Event Types ====================

/**
 * Report generation job data
 */
export interface ReportGenerationJobData {
  /** Report ID */
  report_id: string;
  /** Test run ID */
  test_run_id: string;
  /** Template ID (if using template) */
  template_id?: string;
  /** Section configs (for ad-hoc) */
  sections?: ReportSectionConfig[];
  /** Styling options */
  styling?: ReportStyling;
  /** User who triggered generation */
  generated_by: string;
}

/**
 * PDF generation job data
 */
export interface PdfGenerationJobData {
  /** Report ID */
  report_id: string;
  /** User who triggered generation */
  requested_by: string;
}

/**
 * Report job progress event
 */
export interface ReportJobProgressEvent {
  /** Job ID */
  job_id: string;
  /** Report ID */
  report_id: string;
  /** Current stage */
  stage: 'initializing' | 'fetching_data' | 'rendering_html' | 'saving' | 'complete';
  /** Progress percentage (0-100) */
  progress: number;
  /** Human-readable message */
  message: string;
}

// ==================== Template CRUD Types ====================

/**
 * Create template request
 */
export interface CreateTemplateRequest {
  /** Template name */
  name: string;
  /** Template description */
  description?: string;
  /** System ID for scoping */
  system_id: string;
  /** Test environment for scoping */
  test_environment: string;
  /** Workload for scoping */
  workload: string;
  /** Section configurations */
  sections: ReportSectionConfig[];
  /** Styling options */
  styling?: ReportStyling;
  /** Whether this is the default template */
  is_default?: boolean;
}

/**
 * Update template request
 */
export interface UpdateTemplateRequest {
  /** Template name */
  name?: string;
  /** Template description */
  description?: string;
  /** Section configurations */
  sections?: ReportSectionConfig[];
  /** Styling options */
  styling?: ReportStyling;
  /** Whether this is the default template */
  is_default?: boolean;
}

/**
 * Template list query parameters
 */
export interface TemplateListQuery {
  /** Filter by system ID */
  system_id?: string;
  /** Filter by test environment */
  test_environment?: string;
  /** Filter by workload */
  workload?: string;
  /** Include only default templates */
  default_only?: boolean;
  /** Offset for pagination */
  offset?: number;
  /** Limit for pagination */
  limit?: number;
}

/**
 * Template list response
 */
export interface TemplateListResponse {
  /** List of templates */
  items: ReportTemplateListItem[];
  /** Total count */
  total: number;
  /** Current offset */
  offset: number;
  /** Page size limit */
  limit: number;
}

// ==================== Summary Types ====================

/**
 * Report summary for test run card
 */
export interface ReportSummary {
  /** Total number of reports */
  total_reports: number;
  /** Number of completed reports */
  completed_reports: number;
  /** Number of pending/processing reports */
  pending_reports: number;
  /** Number of failed reports */
  failed_reports: number;
  /** Most recent report */
  latest_report?: GeneratedReportListItem;
  /** Total downloads across all reports */
  total_downloads: number;
  /** Total share views across all reports */
  total_share_views: number;
}

// ==================== Constants ====================

/**
 * All available section types
 */
export const REPORT_SECTION_TYPES: readonly ReportSectionType[] = [
  'header',
  'text_block',
  'slo',
  'apdex',
  'transaction_response_times',
  'regressions',
  'awr',
  'trends',
  'comparisons',
  'graphs',
  'top_10_lists',
] as const;

/**
 * Section types that support accompanying text
 */
export const SECTION_TYPES_WITH_TEXT: readonly TextableSectionType[] = [
  'header',
  'slo',
  'apdex',
  'transaction_response_times',
  'regressions',
  'awr',
  'trends',
  'comparisons',
  'graphs',
  'top_10_lists',
] as const;

/**
 * Section type display names
 */
export const SECTION_TYPE_LABELS: Record<ReportSectionType, string> = {
  header: 'Header',
  text_block: 'Text Block',
  slo: 'SLO Results',
  apdex: 'Apdex Report',
  transaction_response_times: 'Transaction Response Times',
  regressions: 'Regressions',
  awr: 'AWR Analysis',
  trends: 'Trends',
  comparisons: 'Comparisons',
  graphs: 'Custom Graphs',
  top_10_lists: 'Top 10 Lists',
} as const;

/**
 * Report status display labels
 */
export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  html_complete: 'Ready',
  pdf_processing: 'Generating PDF',
  pdf_complete: 'PDF Ready',
  failed: 'Failed',
} as const;

/**
 * Default styling options
 */
export const DEFAULT_REPORT_STYLING: ReportStyling = {
  primaryColor: '#1976d2',
  secondaryColor: '#9c27b0',
  fontFamily: 'system-ui, sans-serif',
} as const;

/**
 * Report generation defaults
 */
export const REPORT_DEFAULTS = {
  /** Default max retries for job processing */
  MAX_RETRIES: 3,
  /** Default expiration in days (null = never) */
  DEFAULT_EXPIRATION_DAYS: null,
  /** Maximum sections per report */
  MAX_SECTIONS: 50,
  /** Maximum custom CSS length */
  MAX_CUSTOM_CSS_LENGTH: 10000,
  /** Maximum accompanying-text length per section */
  MAX_SECTION_TEXT_LENGTH: 5000,
} as const;

// ==================== Type Guards ====================

/**
 * Check if a section type supports accompanying text
 */
export function sectionSupportsText(type: ReportSectionType): type is TextableSectionType {
  return SECTION_TYPES_WITH_TEXT.includes(type as TextableSectionType);
}

/**
 * Read a section's accompanying text.
 *
 * Templates saved before 2026-08-02 store the value under the deprecated
 * `comment` key; there is no data migration, so every reader goes through
 * here. Nullish coalescing (not `||`) so a deliberately cleared '' wins over
 * a stale comment.
 */
export function getSectionText(
  section: Pick<ReportSectionConfig, 'text' | 'comment'>,
): string | undefined {
  return section.text ?? section.comment;
}

/**
 * Check if a status indicates completion
 */
export function isCompletedStatus(status: ReportStatus): boolean {
  return status === 'html_complete' || status === 'pdf_complete';
}

/**
 * Check if a status indicates the report is still processing
 */
export function isProcessingStatus(status: ReportStatus): boolean {
  return status === 'pending' || status === 'processing' || status === 'pdf_processing';
}

/**
 * Get section type label
 */
export function getSectionTypeLabel(type: ReportSectionType): string {
  return SECTION_TYPE_LABELS[type] ?? type;
}

/**
 * Get status label
 */
export function getReportStatusLabel(status: ReportStatus): string {
  return REPORT_STATUS_LABELS[status] ?? status;
}

/**
 * Reserved value for a comparison section's `baselineTestRunId`.
 *
 * Resolved per report to the run immediately before the reported one in the same system,
 * environment and workload, so a template compares each report against its own predecessor
 * rather than a run pinned when the template was written.
 *
 * Shared because both sides must agree on the exact string: the API resolves it in the
 * comparisons renderer, the builder offers it as a synthetic option. Declared twice, a rename
 * on one side would silently stop resolving instead of failing the build.
 */
export const PREVIOUS_RUN_BASELINE = 'previous';

/**
 * Most sections one report may contain.
 *
 * The builder enforces this while composing, and the ad-hoc generate DTO enforces it at the
 * API boundary. One number so the UI cannot offer what the API will reject.
 */
export const MAX_REPORT_SECTIONS = 20;
