/**
 * Reporting Hooks Barrel Export
 *
 * This module exports all React hooks for Custom Reporting feature
 * management, including:
 * - useReports: Fetch and manage generated reports list
 * - useReportSummary: Fetch report summary for card view
 * - useReportDetail: Fetch single report details
 * - useReportHtml: Fetch report HTML content
 * - useGenerateReport: Generate reports from templates or ad-hoc
 * - useReportActions: Report actions (delete, retry, PDF, sharing)
 * - useTemplates: Fetch and manage report templates
 * - useTemplateSummaries: Fetch template summaries for dropdowns
 * - useTemplateDetail: Fetch single template details
 * - useTemplateActions: Template CRUD and section management
 *
 * All hooks use TanStack React Query v5 for data fetching and caching,
 * with optional snackbar callback pattern for notifications.
 *
 * @example
 * ```tsx
 * import {
 *   useReports,
 *   useReportSummary,
 *   useGenerateReport,
 *   useTemplates,
 *   useTemplateSummaries,
 * } from './hooks';
 *
 * function ReportingCard({ testRunId, testRun }) {
 *   const { summary, loading: summaryLoading } = useReportSummary(testRunId);
 *   const { reports, loading: reportsLoading } = useReports(testRunId);
 *   const { summaries } = useTemplateSummaries(
 *     testRun.system_under_test_id,
 *     testRun.test_environment,
 *     testRun.workload
 *   );
 *   const { generateFromTemplate, isGenerating } = useGenerateReport({ testRunId });
 *
 *   // ... component logic
 * }
 * ```
 */

// ==================== useReports ====================
export {
  useReports,
  useReportSummary,
  useReportDetail,
  useReportHtml,
  useGenerateReport,
  useReportActions,
  useInvalidateReports,
  reportsQueryKeys,
  type UseReportsOptions,
  type UseReportsReturn,
  type UseReportSummaryOptions,
  type UseReportSummaryReturn,
  type UseReportDetailOptions,
  type UseReportDetailReturn,
  type UseReportHtmlOptions,
  type UseReportHtmlReturn,
  type UseGenerateReportOptions,
  type UseGenerateReportReturn,
  type UseReportActionsOptions,
  type UseReportActionsReturn,
  type SnackbarCallback,
} from './useReports';

// ==================== useTemplates ====================
export {
  useTemplates,
  useTemplateSummaries,
  useTemplateDetail,
  useTemplateActions,
  useInvalidateTemplates,
  templatesQueryKeys,
  type UseTemplatesOptions,
  type UseTemplatesReturn,
  type UseTemplateSummariesOptions,
  type UseTemplateSummariesReturn,
  type UseTemplateDetailOptions,
  type UseTemplateDetailReturn,
  type UseTemplateActionsOptions,
  type UseTemplateActionsReturn,
} from './useTemplates';

// ==================== Re-export API types for convenience ====================
export type {
  // Report types
  ReportListItem,
  ReportListResponse,
  ReportSummary,
  ReportDetail,
  ReportStatus,
  JobProgress,
  JobStage,

  // Template types
  TemplateListItem,
  TemplateListResponse,
  TemplateSummary,
  TemplateDetail,

  // Section types
  ReportSectionConfig,
  ReportSectionType,
  CommentableSectionType,
  ReportStyling,

  // Request types
  GenerateReportFromTemplateRequest,
  GenerateAdHocReportRequest,
  GeneratePdfRequest,
  CreateTemplateRequest,
  UpdateTemplateRequest,
  DuplicateTemplateRequest,
  UpdateShareSettingsRequest,

  // Response types
  GenerateReportResponse,
  GeneratePdfResponse,
  ShareSettingsResponse,
  PublicShareResponse,

  // Query options
  ListReportsOptions,
  ListTemplatesOptions,
  ReportSortField,
  TemplateSortField,
  SortOrder,
  PaperFormat,
  PageOrientation,
} from '@/lib/api/reports';

// ==================== Re-export utility functions ====================
export {
  isCommentableSection,
  isCompletedStatus,
  isProcessingStatus,
  isFailedStatus,
  getSectionTypeLabel,
  getReportStatusLabel,
  getReportStatusColor,
  buildShareUrl,
  DEFAULT_REPORT_STYLING,
  REPORT_LIMITS,
  REPORT_SECTION_TYPES,
  COMMENTABLE_SECTION_TYPES,
  REPORT_STATUS_VALUES,
} from '@/lib/api/reports';
