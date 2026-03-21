/**
 * AWR Hooks Barrel Export
 *
 * This module exports all React hooks for AWR (Automatic Workload Repository)
 * report management, including:
 * - useAwrReports: Fetch and manage AWR reports list
 * - useAwrAnalysis: Fetch and manage analysis results
 * - useUploadAwrReport: Upload AWR reports (file and URL)
 * - useAwrComparison: Compare AWR reports and manage baselines
 *
 * All hooks use TanStack React Query v5 for data fetching and caching,
 * with MUI Snackbar callback pattern for notifications.
 *
 * @example
 * ```tsx
 * import {
 *   useAwrReports,
 *   useAwrAnalysis,
 *   useUploadAwrReport,
 *   useAwrComparison,
 * } from './hooks';
 *
 * function AwrReportCard({ testRunId, reportId }) {
 *   const { reports, loading } = useAwrReports(testRunId);
 *   const { analysis, insights } = useAwrAnalysis(reportId);
 *   const { uploadFile, isUploading } = useUploadAwrReport(testRunId);
 *   const { compare, comparison } = useAwrComparison(reportId, testRunId);
 *
 *   // ... component logic
 * }
 * ```
 */

// ==================== useAwrReports ====================
export {
  useAwrReports,
  useInvalidateAwrReports,
  awrReportsQueryKeys,
  type UseAwrReportsOptions,
  type UseAwrReportsReturn,
} from './useAwrReports';

// ==================== useAwrAnalysis ====================
export {
  useAwrAnalysis,
  useInvalidateAwrAnalysis,
  useInsightsSummary,
  awrAnalysisQueryKeys,
  type UseAwrAnalysisOptions,
  type UseAwrAnalysisReturn,
  type InsightFilters,
} from './useAwrAnalysis';

// ==================== useUploadAwrReport ====================
export {
  useUploadAwrReport,
  useInvalidateAwrUpload,
  validateAwrFile,
  validateAwrUrl,
  ACCEPTED_AWR_FILE_TYPES,
  MAX_AWR_FILE_SIZE,
  type UseUploadAwrReportOptions,
  type UseUploadAwrReportReturn,
  type SnackbarSeverity,
} from './useUploadAwrReport';

// ==================== useAwrComparison ====================
export {
  useAwrComparison,
  useInvalidateAwrComparison,
  useComparisonStats,
  awrComparisonQueryKeys,
  type UseAwrComparisonOptions,
  type UseAwrComparisonReturn,
  type ComparisonOptions,
  type SqlComparisonFilters,
} from './useAwrComparison';

// ==================== Re-export API types for convenience ====================
export type {
  // Report types
  AwrReport,
  AwrReportListItem,
  AwrReportListResponse,
  AwrReportSummary,
  ParseStatus,
  FileType,

  // Analysis types
  AwrAnalysis,
  AwrInsight,
  SeveritySummary,
  InsightSeverity,
  InsightCategory,
  AnalysisType,

  // Comparison types
  ComparisonResponse,
  ComparisonSummary,
  SqlComparisonItem,
  SqlComparisonResult,
  WaitEventComparisonItem,
  WaitEventComparisonResult,
  LoadProfileComparisonItem,
  LoadProfileComparisonResult,
  ChangeDirection,

  // Baseline types
  AvailableBaseline,
  AvailableBaselinesResponse,

  // Report metadata types
  DatabaseInfo,
  HostInfo,
  SnapshotInfo,

  // Upload types
  UploadAwrReportResponse,
} from '@/lib/api/awr-reports';
