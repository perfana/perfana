/**
 * AWR Reports API Client
 *
 * Client functions for AWR (Automatic Workload Repository) report endpoints.
 * Uses authenticatedFetch for automatic auth header injection and token refresh.
 */

import { authenticatedFetch } from '../api';

// ==================== Type Definitions ====================

/**
 * Parse status for AWR reports
 */
export type ParseStatus = 'pending' | 'parsing' | 'completed' | 'failed';

/**
 * File type for AWR reports
 */
export type FileType = 'html' | 'text';

/**
 * Analysis type for AWR analysis
 */
export type AnalysisType = 'single' | 'comparison';

/**
 * Insight severity levels
 */
export type InsightSeverity = 'critical' | 'warning' | 'info';

/**
 * Insight category types
 */
export type InsightCategory =
  | 'sql_performance'
  | 'wait_events'
  | 'resource_utilization'
  | 'io_performance'
  | 'memory'
  | 'lock_contention'
  | 'parse_overhead'
  | 'network'
  | 'configuration'
  | 'regression'
  | 'improvement';

/**
 * Change direction for comparison metrics
 */
export type ChangeDirection = 'improved' | 'regressed' | 'unchanged' | 'new' | 'removed';

/**
 * Database information from AWR report
 */
export interface DatabaseInfo {
  dbName?: string;
  dbId?: string;
  instanceName?: string;
  dbEdition?: string;
  dbRelease?: string;
  isRac?: boolean;
  isCdb?: boolean;
}

/**
 * Host information from AWR report
 */
export interface HostInfo {
  hostName?: string;
  platform?: string;
  cpus?: number;
  cores?: number;
  sockets?: number;
  memoryGb?: number;
}

/**
 * Snapshot information from AWR report
 */
export interface SnapshotInfo {
  snapIdBegin?: number;
  snapIdEnd?: number;
  beginTime?: string;
  endTime?: string;
  elapsedMinutes?: number;
  dbTimeMinutes?: number;
  sessionsBegin?: number;
  sessionsEnd?: number;
}

/**
 * Severity summary for analysis results
 */
export interface SeveritySummary {
  critical: number;
  warning: number;
  info: number;
  total: number;
}

/**
 * Individual insight from AWR analysis
 */
export interface AwrInsight {
  id: string;
  severity: InsightSeverity;
  category: InsightCategory;
  title: string;
  description: string;
  recommendation?: string;
  sqlId?: string;
  sqlText?: string;
  fullSqlText?: string;
  waitEvent?: string;
  waitClass?: string;
  value?: number;
  unit?: string;
  threshold?: number;
  percentDbTime?: number;
  impactScore?: number;
  isComparison?: boolean;
  baselineValue?: number;
  changePercent?: number;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

/**
 * Full AWR report response
 */
export interface AwrReport {
  id: string;
  testRunId: string;
  fileName: string;
  fileSize: number;
  fileType: FileType;
  database?: DatabaseInfo;
  host?: HostInfo;
  snapshot?: SnapshotInfo;
  parsedData?: {
    header?: unknown;
    loadProfile?: unknown;
    topSql?: unknown;
    waitEvents?: unknown;
    [key: string]: unknown;
  };
  parseStatus: ParseStatus;
  parseError?: string;
  parsedAt?: string;
  uploadedAt: string;
  uploadedBy: string;
  hasAnalysis?: boolean;
  severitySummary?: SeveritySummary;
}

/**
 * AWR report list item (compact version)
 */
export interface AwrReportListItem {
  id: string;
  testRunId: string;
  fileName: string;
  fileSize: number;
  dbName?: string;
  beginTime?: string;
  endTime?: string;
  parseStatus: ParseStatus;
  uploadedAt: string;
  severitySummary?: SeveritySummary;
}

/**
 * Paginated AWR report list response
 */
export interface AwrReportListResponse {
  items: AwrReportListItem[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * AWR analysis response
 */
export interface AwrAnalysis {
  id: string;
  awrReportId: string;
  analysisType: AnalysisType;
  baselineReportId?: string;
  insights: AwrInsight[];
  severitySummary: SeveritySummary;
  analysisVersion?: string;
  analyzedAt: string;
}

/**
 * AWR report summary for collapsed card view
 */
export interface AwrReportSummary {
  id: string;
  dbName?: string;
  beginTime?: string;
  endTime?: string;
  elapsedMinutes?: number;
  dbTimeMinutes?: number;
  transactionsPerSecond?: number;
  avgActiveSessions?: number;
  parseStatus: ParseStatus;
  severitySummary?: SeveritySummary;
  topIssue?: {
    severity: InsightSeverity;
    title: string;
  };
}

/**
 * Upload response after successful upload
 */
export interface UploadAwrReportResponse {
  id: string;
  fileName: string;
  fileSize: number;
  parseStatus: ParseStatus;
  message: string;
}

/**
 * SQL statement metrics for comparison
 */
export interface SqlStatementMetrics {
  elapsedTime?: number;
  cpuTime?: number;
  bufferGets?: number;
  diskReads?: number;
  executions?: number;
  planHashValue?: number;
}

/**
 * SQL statement comparison item
 */
export interface SqlComparisonItem {
  sqlId: string;
  sqlText?: string;
  fullSqlText?: string;
  changeDirection: ChangeDirection;
  current: SqlStatementMetrics;
  baseline?: SqlStatementMetrics;
  deltaPercent: {
    elapsedTime?: number;
    cpuTime?: number;
    bufferGets?: number;
    diskReads?: number;
  };
  isSignificantRegression: boolean;
  isSignificantImprovement: boolean;
  planChanged: boolean;
  currentPlanHash?: number;
  baselinePlanHash?: number;
  performanceFactor?: number;
}

/**
 * SQL comparison result
 */
export interface SqlComparisonResult {
  comparisons: SqlComparisonItem[];
  regressions: SqlComparisonItem[];
  improvements: SqlComparisonItem[];
  newStatements: SqlComparisonItem[];
  removedStatements: SqlComparisonItem[];
  summary: {
    total: number;
    regressionCount: number;
    improvementCount: number;
    newCount: number;
    removedCount: number;
    avgElapsedTimeChange?: number;
    totalElapsedTimeChange?: number;
  };
}

/**
 * Wait event metrics for comparison
 */
export interface WaitEventMetrics {
  totalWaitTime?: number;
  waits?: number;
  avgWaitMs?: number;
  percentDbTime?: number;
}

/**
 * Wait event comparison item
 */
export interface WaitEventComparisonItem {
  event: string;
  waitClass?: string;
  changeDirection: ChangeDirection;
  current: WaitEventMetrics;
  baseline?: WaitEventMetrics;
  deltaPercent: {
    totalWaitTime?: number;
    waits?: number;
    avgWaitMs?: number;
  };
}

/**
 * Wait event comparison result
 */
export interface WaitEventComparisonResult {
  comparisons: WaitEventComparisonItem[];
  increases: WaitEventComparisonItem[];
  decreases: WaitEventComparisonItem[];
  newEvents: WaitEventComparisonItem[];
  removedEvents: WaitEventComparisonItem[];
  byClass: Record<string, {
    totalChange: number;
    eventCount: number;
  }>;
}

/**
 * Load profile metric comparison item
 */
export interface LoadProfileComparisonItem {
  name: string;
  currentValue: number;
  baselineValue: number;
  delta: number;
  deltaPercent: number;
  changeDirection: ChangeDirection;
  unit?: string;
}

/**
 * Load profile comparison result
 */
export interface LoadProfileComparisonResult {
  metrics: LoadProfileComparisonItem[];
  highlights: {
    largestIncreases: LoadProfileComparisonItem[];
    largestDecreases: LoadProfileComparisonItem[];
    dbTimeChange?: number;
    transactionRateChange?: number;
  };
}

/**
 * Comparison response between two AWR reports
 */
export interface ComparisonResponse {
  currentReportId: string;
  baselineReportId: string;
  insights: AwrInsight[];
  severitySummary: SeveritySummary;
  sqlComparison?: SqlComparisonResult;
  waitEventComparison?: WaitEventComparisonResult;
  loadProfileComparison?: LoadProfileComparisonResult;
  comparedAt: string;
  comparisonVersion?: string;
  comparisonDurationMs?: number;
}

/**
 * Quick comparison summary
 */
export interface ComparisonSummary {
  sqlRegressions: number;
  sqlImprovements: number;
  newSqlStatements: number;
  waitEventIncreases: number;
  waitEventDecreases: number;
  dbTimeChangePercent?: number;
  transactionRateChangePercent?: number;
  overallStatus: 'improved' | 'regressed' | 'stable';
}

/**
 * Available baseline for comparison
 */
export interface AvailableBaseline {
  testRunId: string;
  testRunName?: string;
  awrReportId: string;
  dbName?: string;
  beginTime?: string;
  endTime?: string;
  uploadedAt?: string;
}

/**
 * Available baselines response
 */
export interface AvailableBaselinesResponse {
  baselines: AvailableBaseline[];
  total: number;
}

/**
 * Options for comparing reports
 */
export interface CompareReportsOptions {
  currentReportId: string;
  baselineReportId: string;
  regressionThresholdPercent?: number;
  improvementThresholdPercent?: number;
  includeSqlComparison?: boolean;
  includeWaitEventComparison?: boolean;
  includeLoadProfileComparison?: boolean;
  includeInfoInsights?: boolean;
  maxSqlStatements?: number;
}

/**
 * Options for comparing test run AWR reports
 */
export interface CompareTestRunReportsOptions {
  currentTestRunId: string;
  baselineTestRunId: string;
  currentReportId?: string;
  baselineReportId?: string;
  significantChangeThreshold?: number;
}

/**
 * Query options for listing AWR reports
 */
export interface ListAwrReportsOptions {
  parseStatus?: ParseStatus;
  limit?: number;
  offset?: number;
}

// ==================== API Functions ====================

/**
 * Upload an AWR report file for a test run
 */
export async function uploadAwrReport(
  testRunId: string,
  file: File
): Promise<UploadAwrReportResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await authenticatedFetch(
    `test-runs/${testRunId}/awr-reports`,
    {
      method: 'POST',
      body: formData,
      // Don't set Content-Type - browser will set it with boundary for FormData
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Upload failed';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Upload an AWR report from a URL
 */
export async function uploadAwrReportByUrl(
  testRunId: string,
  url: string
): Promise<UploadAwrReportResponse> {
  const response = await authenticatedFetch(
    `test-runs/${testRunId}/awr-reports/url`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Upload from URL failed';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * List AWR reports for a test run
 */
export async function listAwrReports(
  testRunId: string,
  options: ListAwrReportsOptions = {}
): Promise<AwrReportListResponse> {
  const params = new URLSearchParams();
  if (options.parseStatus) params.append('parseStatus', options.parseStatus);
  if (options.limit !== undefined) params.append('limit', String(options.limit));
  if (options.offset !== undefined) params.append('offset', String(options.offset));

  const queryString = params.toString();
  const url = `test-runs/${testRunId}/awr-reports${queryString ? `?${queryString}` : ''}`;

  const response = await authenticatedFetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch AWR reports: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get a single AWR report by ID
 */
export async function getAwrReport(reportId: string): Promise<AwrReport> {
  const response = await authenticatedFetch(`awr-reports/${reportId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch AWR report: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get AWR report summary (for collapsed card view)
 */
export async function getAwrReportSummary(reportId: string): Promise<AwrReportSummary> {
  const response = await authenticatedFetch(`awr-reports/${reportId}/summary`);

  if (!response.ok) {
    throw new Error(`Failed to fetch AWR report summary: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get raw content of an AWR report
 */
export async function getAwrReportRaw(reportId: string): Promise<string> {
  const response = await authenticatedFetch(`awr-reports/${reportId}/raw`);

  if (!response.ok) {
    throw new Error(`Failed to fetch AWR report raw content: ${response.statusText}`);
  }

  return response.text();
}

/**
 * Delete an AWR report
 */
export async function deleteAwrReport(reportId: string): Promise<{ message: string }> {
  const response = await authenticatedFetch(`awr-reports/${reportId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete AWR report: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get analysis results for an AWR report
 * Will trigger analysis if not yet analyzed
 */
export async function getAwrAnalysis(reportId: string): Promise<AwrAnalysis> {
  const response = await authenticatedFetch(`awr-reports/${reportId}/analysis`);

  if (!response.ok) {
    throw new Error(`Failed to fetch AWR analysis: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Force re-analysis of an AWR report
 */
export async function reanalyzeAwrReport(reportId: string): Promise<AwrAnalysis> {
  const response = await authenticatedFetch(`awr-reports/${reportId}/analysis`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Failed to re-analyze AWR report: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Compare two AWR reports
 */
export async function compareAwrReports(
  options: CompareReportsOptions
): Promise<ComparisonResponse> {
  const response = await authenticatedFetch('awr-reports/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Comparison failed';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Compare AWR reports across test runs
 */
export async function compareTestRunAwrReports(
  options: CompareTestRunReportsOptions
): Promise<ComparisonResponse> {
  const response = await authenticatedFetch('awr-reports/compare-test-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? (error as { message: string }).message
      : 'Test run comparison failed';
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Get quick comparison summary for an AWR report
 */
export async function getComparisonSummary(
  reportId: string,
  baselineReportId: string
): Promise<ComparisonSummary> {
  const response = await authenticatedFetch(
    `awr-reports/${reportId}/comparison-summary?baselineReportId=${baselineReportId}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch comparison summary: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get available baselines for a report
 */
export async function getAvailableBaselines(
  reportId: string
): Promise<AvailableBaselinesResponse> {
  const response = await authenticatedFetch(`awr-reports/${reportId}/available-baselines`);

  if (!response.ok) {
    throw new Error(`Failed to fetch available baselines: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get available baselines for a test run
 */
export async function getTestRunAvailableBaselines(
  testRunId: string
): Promise<AvailableBaselinesResponse> {
  const response = await authenticatedFetch(
    `test-runs/${testRunId}/awr-reports/available-baselines`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch available baselines: ${response.statusText}`);
  }

  return response.json();
}
