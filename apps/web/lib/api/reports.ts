/**
 * Reports API Client
 *
 * Client functions for Custom Reporting Feature endpoints.
 * Uses authenticatedFetch for automatic auth header injection and token refresh.
 */

import { authenticatedFetch } from '../api';
import { env } from '../env';

// ==================== Type Definitions ====================

/**
 * Report section types supported by the reporting system.
 * Uses underscores (not hyphens) as per project conventions.
 */
export const REPORT_SECTION_TYPES = [
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

export type ReportSectionType = (typeof REPORT_SECTION_TYPES)[number];

/**
 * Section types that support accompanying text — every type except
 * text_block, whose `content` already is the text.
 */
export const SECTION_TYPES_WITH_TEXT = [
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

export type TextableSectionType = (typeof SECTION_TYPES_WITH_TEXT)[number];

/**
 * Report status values
 */
export const REPORT_STATUS_VALUES = [
  'pending',
  'processing',
  'html_complete',
  'pdf_processing',
  'pdf_complete',
  'failed',
] as const;

export type ReportStatus = (typeof REPORT_STATUS_VALUES)[number];

/**
 * Job progress stages
 */
export type JobStage = 'initializing' | 'fetching_data' | 'rendering_html' | 'saving' | 'complete';

/**
 * Paper format for PDF generation
 */
export type PaperFormat = 'a4' | 'letter' | 'legal' | 'a3';

/**
 * Page orientation for PDF
 */
export type PageOrientation = 'portrait' | 'landscape';

/**
 * Sort field for reports
 */
export type ReportSortField = 'created_at' | 'name' | 'status' | 'completed_at';

/**
 * Sort field for templates
 */
export type TemplateSortField = 'created_at' | 'name' | 'updated_at' | 'is_default';

/**
 * Sort order
 */
export type SortOrder = 'asc' | 'desc';

// ==================== Section Configuration ====================

/**
 * Configuration options for a report section
 */
export interface ReportSectionConfig {
  type: ReportSectionType;
  order: number;
  title?: string;
  config?: Record<string, unknown>;
  /** Accompanying text, rendered as markdown prose under the section header. */
  text?: string;
  /** @deprecated Read-only fallback for templates saved before 2026-08-02. Use `text`. */
  comment?: string;
}

/**
 * Styling options for a report
 */
export interface ReportStyling {
  primaryColor?: string;
  secondaryColor?: string;
  logo?: string;
  fontFamily?: string;
  customCss?: string;
}

// ==================== Report Types ====================

/**
 * Response DTO for report generation
 */
export interface GenerateReportResponse {
  report_id: string;
  job_id: string;
  status: ReportStatus;
  estimated_completion_seconds?: number;
}

/**
 * Response DTO for PDF generation
 */
export interface GeneratePdfResponse {
  report_id: string;
  job_id: string;
  status: ReportStatus;
}

/**
 * Response DTO for share settings
 */
export interface ShareSettingsResponse {
  share_id: string;
  share_enabled: boolean;
  share_url: string;
  share_view_count: number;
  last_shared_at?: string;
  expires_at?: string;
}

/**
 * Response DTO for public share access
 */
export interface PublicShareResponse {
  html_content: string;
  name: string;
  test_run_name?: string;
  generated_at: string;
}

/**
 * Report list item (compact version)
 */
export interface ReportListItem {
  id: string;
  test_run_id: string;
  template_name: string;
  name: string;
  generated_by: string;
  status: ReportStatus;
  share_enabled: boolean;
  share_id: string;
  share_view_count: number;
  download_count: number;
  has_pdf: boolean;
  file_size?: number;
  created_at: string;
  completed_at?: string;
}

/**
 * Paginated report list response
 */
export interface ReportListResponse {
  items: ReportListItem[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Report summary for test run card
 */
export interface ReportSummary {
  total_reports: number;
  completed_reports: number;
  pending_reports: number;
  failed_reports: number;
  latest_report?: ReportListItem;
  total_downloads: number;
  total_share_views: number;
}

/**
 * Full report details
 */
export interface ReportDetail {
  id: string;
  test_run_id: string;
  template_id: string;
  name: string;
  generated_by: string;
  html_content?: string;
  html_generated_at?: string;
  share_id: string;
  share_enabled: boolean;
  share_view_count: number;
  last_shared_at?: string;
  has_pdf: boolean;
  file_size?: number;
  mime_type: string;
  status: ReportStatus;
  error_code?: string;
  error_message?: string;
  job_id?: string;
  retry_count: number;
  max_retries: number;
  download_count: number;
  last_downloaded_at?: string;
  expires_at?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
}

/**
 * Job progress information
 */
export interface JobProgress {
  job_id: string;
  report_id: string;
  stage: JobStage;
  progress: number;
  message: string;
}

// ==================== Template Types ====================

/**
 * Template list item (compact version)
 */
export interface TemplateListItem {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  section_count: number;
  section_types: ReportSectionType[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Paginated template list response
 */
export interface TemplateListResponse {
  items: TemplateListItem[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Full template details
 */
export interface TemplateDetail {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  system_id: string;
  test_environment: string;
  workload: string;
  sections: ReportSectionConfig[];
  styling?: ReportStyling;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Template summary for dropdowns
 */
export interface TemplateSummary {
  id: string;
  name: string;
  is_default: boolean;
  section_count: number;
}

// ==================== Request Types ====================

/**
 * Request to generate report from template
 */
export interface GenerateReportFromTemplateRequest {
  test_run_id: string;
  template_id: string;
  name?: string;
}

/**
 * Request to generate ad-hoc report
 */
export interface GenerateAdHocReportRequest {
  test_run_id: string;
  name: string;
  sections: ReportSectionConfig[];
  styling?: ReportStyling;
  save_as_template?: boolean;
  template_name?: string;
  template_description?: string;
}

/**
 * Request to generate PDF
 */
export interface GeneratePdfRequest {
  paperFormat?: PaperFormat;
  orientation?: PageOrientation;
  includeHeader?: boolean;
  includeFooter?: boolean;
}

/**
 * Request to update share settings
 */
export interface UpdateShareSettingsRequest {
  share_enabled: boolean;
  expires_at?: string;
}

/**
 * Request to create a template
 */
export interface CreateTemplateRequest {
  name: string;
  description?: string;
  system_id: string;
  test_environment: string;
  workload: string;
  sections: ReportSectionConfig[];
  styling?: ReportStyling;
  is_default?: boolean;
}

/**
 * Request to update a template
 */
export interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  sections?: ReportSectionConfig[];
  styling?: ReportStyling;
  is_default?: boolean;
}

/**
 * Request to duplicate a template
 */
export interface DuplicateTemplateRequest {
  name: string;
  system_id?: string;
  test_environment?: string;
  workload?: string;
}

/**
 * Query options for listing reports
 */
export interface ListReportsOptions {
  status?: ReportStatus;
  limit?: number;
  offset?: number;
  sortBy?: ReportSortField;
  sortOrder?: SortOrder;
}

/**
 * Query options for listing templates
 */
export interface ListTemplatesOptions {
  system_id?: string;
  test_environment?: string;
  workload?: string;
  default_only?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: TemplateSortField;
  sortOrder?: SortOrder;
}

// ==================== API Functions - Reports ====================

/**
 * Generate a report from an existing template
 */
export async function generateReportFromTemplate(
  request: GenerateReportFromTemplateRequest
): Promise<GenerateReportResponse> {
  const response = await authenticatedFetch('reports/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to generate report';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Generate an ad-hoc report with custom sections
 */
export async function generateAdHocReport(
  request: GenerateAdHocReportRequest
): Promise<GenerateReportResponse> {
  const response = await authenticatedFetch('reports/generate/ad-hoc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to generate ad-hoc report';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Preview a single section with styling
 * Returns raw HTML that can be displayed in an iframe
 */
export async function previewSection(
  section: ReportSectionConfig,
  testRunId?: string,
  styling?: ReportStyling,
  signal?: AbortSignal
): Promise<string> {
  const response = await authenticatedFetch('reports/preview-section', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      test_run_id: testRunId,
      section,
      styling,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Failed to preview section: ${errorText}`);
  }

  // Return raw HTML text
  return response.text();
}

/**
 * List reports for a test run
 */
export async function listReports(
  testRunId: string,
  options: ListReportsOptions = {}
): Promise<ReportListResponse> {
  const params = new URLSearchParams();
  if (options.status) params.append('status', options.status);
  if (options.limit !== undefined) params.append('limit', String(options.limit));
  if (options.offset !== undefined) params.append('offset', String(options.offset));
  if (options.sortBy) params.append('sortBy', options.sortBy);
  if (options.sortOrder) params.append('sortOrder', options.sortOrder);

  const queryString = params.toString();
  const url = `reports/test-run/${testRunId}${queryString ? `?${queryString}` : ''}`;

  const response = await authenticatedFetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch reports: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get report summary for a test run (for card view)
 */
export async function getReportSummary(testRunId: string): Promise<ReportSummary> {
  const response = await authenticatedFetch(`reports/test-run/${testRunId}/summary`);

  if (!response.ok) {
    throw new Error(`Failed to fetch report summary: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get a single report by ID
 */
export async function getReport(reportId: string): Promise<ReportDetail> {
  const response = await authenticatedFetch(`reports/${reportId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch report: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get report HTML content
 */
export async function getReportHtml(reportId: string): Promise<string> {
  const response = await authenticatedFetch(`reports/${reportId}/html`);

  if (!response.ok) {
    throw new Error(`Failed to fetch report HTML: ${response.statusText}`);
  }

  return response.text();
}

/**
 * Delete a report
 */
export async function deleteReport(reportId: string): Promise<void> {
  const response = await authenticatedFetch(`reports/${reportId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete report: ${response.statusText}`);
  }

  // DELETE returns 204 No Content with no body
  return;
}

/**
 * Retry a failed report generation
 */
export async function retryReport(reportId: string): Promise<GenerateReportResponse> {
  const response = await authenticatedFetch(`reports/${reportId}/retry`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to retry report generation';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Get job progress for a report
 */
export async function getJobProgress(reportId: string): Promise<JobProgress> {
  const response = await authenticatedFetch(`reports/${reportId}/progress`);

  if (!response.ok) {
    throw new Error(`Failed to fetch job progress: ${response.statusText}`);
  }

  return response.json();
}

// ==================== API Functions - PDF ====================

/**
 * Generate PDF from an HTML report
 */
export async function generatePdf(
  reportId: string,
  options: GeneratePdfRequest = {}
): Promise<GeneratePdfResponse> {
  const response = await authenticatedFetch(`reports/${reportId}/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to generate PDF';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Download PDF as blob
 *
 * Throws an error with a user-friendly message if:
 * - The PDF is still being generated (HTTP 202)
 * - The request fails (HTTP 4xx/5xx)
 */
export async function downloadPdf(reportId: string): Promise<Blob> {
  const response = await authenticatedFetch(`reports/${reportId}/pdf/download`);

  // HTTP 202 means the PDF is queued/processing - not ready yet
  if (response.status === 202) {
    const body = await response.json().catch(() => ({}));
    const message = body && typeof body === 'object' && 'message' in body
      ? (body as { message: string }).message
      : 'PDF is being generated. Please try again in a few moments.';
    throw new Error(message);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : `Failed to download PDF: ${response.statusText}`;
    throw new Error(errorMessage);
  }

  // Verify we actually got a PDF, not a JSON error response
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('application/pdf')) {
    throw new Error('PDF is not ready yet. Please try again in a few moments.');
  }

  return response.blob();
}

/**
 * Get PDF download URL (for direct link)
 */
export function getPdfDownloadUrl(reportId: string): string {
  // This returns the URL that can be used for direct download links
  // The actual request will need authentication headers
  return `reports/${reportId}/pdf/download`;
}

// ==================== API Functions - Sharing ====================

/**
 * Get share settings for a report
 */
export async function getShareSettings(reportId: string): Promise<ShareSettingsResponse> {
  const response = await authenticatedFetch(`reports/${reportId}/share`);

  if (!response.ok) {
    throw new Error(`Failed to fetch share settings: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Update share settings for a report
 */
export async function updateShareSettings(
  reportId: string,
  request: UpdateShareSettingsRequest
): Promise<ShareSettingsResponse> {
  const response = await authenticatedFetch(`reports/${reportId}/share`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to update share settings';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Enable sharing for a report (convenience function)
 */
export async function enableSharing(
  reportId: string,
  expiresAt?: string
): Promise<ShareSettingsResponse> {
  return updateShareSettings(reportId, {
    share_enabled: true,
    expires_at: expiresAt,
  });
}

/**
 * Disable sharing for a report (convenience function)
 */
export async function disableSharing(reportId: string): Promise<ShareSettingsResponse> {
  return updateShareSettings(reportId, { share_enabled: false });
}

/**
 * Get publicly shared report (no authentication required)
 * Note: This is the only public endpoint in this module
 */
export async function getPublicReport(shareId: string): Promise<PublicShareResponse> {
  // Use direct fetch without auth headers for public endpoint
  const response = await fetch(
    `${env.API_URL}/reports/share/${shareId}`
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Report not found or sharing is disabled');
    }
    if (response.status === 400) {
      throw new Error('Share link has expired');
    }
    throw new Error(`Failed to fetch shared report: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Build the full share URL for a report (PDF download, no authentication required)
 */
export function buildShareUrl(shareId: string): string {
  const apiUrl = env.API_URL;

  // Remove /api suffix if present to avoid duplication
  const baseUrl = apiUrl.endsWith('/api') ? apiUrl.slice(0, -4) : apiUrl;

  return `${baseUrl}/api/reports/share/${shareId}/pdf`;
}

// ==================== API Functions - Templates ====================

/**
 * List templates with optional filtering
 */
export async function listTemplates(
  options: ListTemplatesOptions = {}
): Promise<TemplateListResponse> {
  const params = new URLSearchParams();
  if (options.system_id) params.append('system_id', options.system_id);
  if (options.test_environment) params.append('test_environment', options.test_environment);
  if (options.workload) params.append('workload', options.workload);
  if (options.default_only !== undefined) params.append('default_only', String(options.default_only));
  if (options.search) params.append('search', options.search);
  if (options.limit !== undefined) params.append('limit', String(options.limit));
  if (options.offset !== undefined) params.append('offset', String(options.offset));
  if (options.sortBy) params.append('sortBy', options.sortBy);
  if (options.sortOrder) params.append('sortOrder', options.sortOrder);

  const queryString = params.toString();
  const url = `report-templates${queryString ? `?${queryString}` : ''}`;

  const response = await authenticatedFetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch templates: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get templates for a specific scope (system, environment, workload)
 */
export async function getTemplatesForScope(
  systemId: string,
  testEnvironment: string,
  workload: string
): Promise<TemplateListResponse> {
  return listTemplates({
    system_id: systemId,
    test_environment: testEnvironment,
    workload: workload,
  });
}

/**
 * Get template summaries for dropdown/selection
 */
export async function getTemplateSummaries(
  systemId: string,
  testEnvironment: string,
  workload: string
): Promise<TemplateSummary[]> {
  const url = `report-templates/summaries?system_id=${encodeURIComponent(systemId)}&test_environment=${encodeURIComponent(testEnvironment)}&workload=${encodeURIComponent(workload)}`;

  const response = await authenticatedFetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch template summaries: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get a single template by ID
 */
export async function getTemplate(templateId: string): Promise<TemplateDetail> {
  const response = await authenticatedFetch(`report-templates/${templateId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch template: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Create a new template
 */
export async function createTemplate(
  request: CreateTemplateRequest
): Promise<TemplateDetail> {
  const response = await authenticatedFetch('report-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to create template';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Update an existing template
 */
export async function updateTemplate(
  templateId: string,
  request: UpdateTemplateRequest
): Promise<TemplateDetail> {
  const response = await authenticatedFetch(`report-templates/${templateId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to update template';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Delete a template
 */
export async function deleteTemplate(templateId: string): Promise<void> {
  const response = await authenticatedFetch(`report-templates/${templateId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete template: ${response.statusText}`);
  }

  // DELETE returns 204 No Content with no body
  return;
}

/**
 * Duplicate a template
 */
export async function duplicateTemplate(
  templateId: string,
  request: DuplicateTemplateRequest
): Promise<TemplateDetail> {
  const response = await authenticatedFetch(`report-templates/${templateId}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to duplicate template';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Set a template as the default for its scope
 */
export async function setDefaultTemplate(templateId: string): Promise<TemplateDetail> {
  const response = await authenticatedFetch(`report-templates/${templateId}/set-default`, {
    method: 'PUT',
  });

  if (!response.ok) {
    throw new Error(`Failed to set default template: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Add a section to a template
 */
export async function addTemplateSection(
  templateId: string,
  section: ReportSectionConfig
): Promise<TemplateDetail> {
  const response = await authenticatedFetch(`report-templates/${templateId}/sections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(section),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to add section';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Remove a section from a template
 */
export async function removeTemplateSection(
  templateId: string,
  sectionIndex: number
): Promise<TemplateDetail> {
  const response = await authenticatedFetch(
    `report-templates/${templateId}/sections/${sectionIndex}`,
    { method: 'DELETE' }
  );

  if (!response.ok) {
    throw new Error(`Failed to remove section: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Reorder sections in a template
 */
export async function reorderTemplateSections(
  templateId: string,
  sectionOrders: number[]
): Promise<TemplateDetail> {
  const response = await authenticatedFetch(
    `report-templates/${templateId}/sections/reorder`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section_orders: sectionOrders }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Failed to reorder sections';
    throw new Error(errorMessage);
  }

  return response.json();
}

// ==================== Utility Functions ====================

/**
 * Check if a section type supports accompanying text
 */
export function sectionSupportsText(type: ReportSectionType): type is TextableSectionType {
  return SECTION_TYPES_WITH_TEXT.includes(type as TextableSectionType);
}

/**
 * Read a section's accompanying text, falling back to the deprecated
 * `comment` for templates saved before 2026-08-02. Nullish coalescing so a
 * deliberately cleared '' wins over a stale comment.
 */
export function getSectionText(
  section: Pick<ReportSectionConfig, 'text' | 'comment'>,
): string | undefined {
  return section.text ?? section.comment;
}

/**
 * Check if a report status indicates completion
 */
export function isCompletedStatus(status: ReportStatus): boolean {
  return status === 'html_complete' || status === 'pdf_complete';
}

/**
 * Check if a report status indicates processing
 */
export function isProcessingStatus(status: ReportStatus): boolean {
  return status === 'pending' || status === 'processing' || status === 'pdf_processing';
}

/**
 * Check if a report status indicates failure
 */
export function isFailedStatus(status: ReportStatus): boolean {
  return status === 'failed';
}

/**
 * Get human-readable label for section type
 */
export function getSectionTypeLabel(type: ReportSectionType): string {
  const labels: Record<ReportSectionType, string> = {
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
  };
  return labels[type] || type;
}

/**
 * Get human-readable label for report status
 */
export function getReportStatusLabel(status: ReportStatus): string {
  const labels: Record<ReportStatus, string> = {
    pending: 'Pending',
    processing: 'Processing',
    html_complete: 'HTML Ready',
    pdf_processing: 'Generating PDF',
    pdf_complete: 'PDF Ready',
    failed: 'Failed',
  };
  return labels[status] || status;
}

/**
 * Get status color for UI display
 */
export function getReportStatusColor(status: ReportStatus): 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' {
  const colors: Record<ReportStatus, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
    pending: 'default',
    processing: 'info',
    html_complete: 'success',
    pdf_processing: 'info',
    pdf_complete: 'success',
    failed: 'error',
  };
  return colors[status] || 'default';
}

/**
 * Default styling values
 */
export const DEFAULT_REPORT_STYLING: ReportStyling = {
  primaryColor: '#1976d2',
  secondaryColor: '#9c27b0',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

/**
 * Maximum values for validation
 */
export const REPORT_LIMITS = {
  MAX_SECTIONS: 50,
  MAX_TITLE_LENGTH: 255,
  MAX_SECTION_TEXT_LENGTH: 5000,
  MAX_NAME_LENGTH: 255,
  MAX_DESCRIPTION_LENGTH: 1000,
  MAX_CUSTOM_CSS_LENGTH: 10000,
} as const;
