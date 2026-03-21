/**
 * AWR (Automatic Workload Repository) Components Barrel Export
 *
 * This file exports all AWR-related components, hooks, types, and utilities
 * for use in the test run details view.
 *
 * @example
 * ```tsx
 * import {
 *   AwrReportCard,
 *   useAwrReports,
 *   useAwrAnalysis,
 *   type AwrReportCardProps,
 * } from './components/awr';
 * ```
 */

// ==================== Main Components ====================

export { AwrReportCard, default as AwrReportCardDefault } from './AwrReportCard';
export { default as AwrUploadZone } from './AwrUploadZone';
export { default as AwrParsingStatus } from './AwrParsingStatus';

// ==================== Tab Components ====================

export {
  OverviewTab,
  TopSqlTab,
  WaitEventsTab,
  InsightsTab,
  CompareTab,
} from './tabs';

// ==================== Insight Components ====================

export { InsightCard, InsightsList, SeverityBadge } from './insights';

// ==================== SQL Components ====================

export { SqlStatementCard, SqlMetricsTable, SqlTextViewer } from './sql';

// ==================== Chart Components ====================

export { LoadProfileChart, WaitEventsChart, TimeModelChart } from './charts';

// ==================== Hooks ====================

export {
  useAwrReports,
  useInvalidateAwrReports,
  awrReportsQueryKeys,
} from './hooks/useAwrReports';

export {
  useAwrAnalysis,
  useInvalidateAwrAnalysis,
  useInsightsSummary,
  awrAnalysisQueryKeys,
} from './hooks/useAwrAnalysis';

export {
  useAwrComparison,
  awrComparisonQueryKeys,
} from './hooks/useAwrComparison';

// ==================== Types ====================

export type {
  // Component Props
  AwrReportCardProps,
  AwrUploadZoneProps,
  AwrParsingStatusProps,
  AwrTabBaseProps,
  OverviewTabProps,
  TopSqlTabProps,
  WaitEventsTabProps,
  InsightsTabProps,
  CompareTabProps,
  InsightCardProps,
  InsightsListProps,
  SeverityBadgeProps,
  SqlStatementCardProps,
  SqlMetricsTableProps,
  SqlTextViewerProps,
  LoadProfileChartProps,
  WaitEventsChartProps,
  TimeModelChartProps,

  // Data Types
  AwrTestRunInfo,
  AwrTabId,
  AwrTabConfig,
  SqlStatementDisplay,
  SqlStatementMetrics,
  WaitEventDisplay,
  ChartDataPoint,
  LoadProfileChartData,
  WaitEventChartData,
  TimeModelChartData,

  // Filter Types
  InsightFilters,
  SqlFilters,
  WaitEventFilters,
  SqlSortField,
  WaitEventSortField,
  SortDirection,

  // State Types
  AwrCardState,
  UploadState,
  ComparisonState,

  // Display Types
  SeverityColors,

  // Snackbar Types
  SnackbarSeverity,
  SnackbarCallback,

  // API Types (re-exported for convenience)
  AwrReport,
  AwrReportListItem,
  AwrReportListResponse,
  AwrReportSummary,
  ParseStatus,
  FileType,
  AwrAnalysis,
  AwrInsight,
  SeveritySummary,
  InsightSeverity,
  InsightCategory,
  AnalysisType,
  ComparisonResponse,
  ComparisonSummary,
  SqlComparisonItem,
  SqlComparisonResult,
  WaitEventComparisonItem,
  WaitEventComparisonResult,
  LoadProfileComparisonItem,
  LoadProfileComparisonResult,
  ChangeDirection,
  AvailableBaseline,
  AvailableBaselinesResponse,
  DatabaseInfo,
  HostInfo,
  SnapshotInfo,
  UploadAwrReportResponse,
} from './types';

// ==================== Constants ====================

export {
  AWR_TAB_CONFIGS,
  SEVERITY_COLORS,
  WAIT_CLASS_COLORS,
  CHANGE_DIRECTION_COLORS,
  CATEGORY_CONFIGS,
} from './types';

// ==================== Utilities ====================

export {
  formatNumber,
  formatBytes,
  formatPercentage,
  formatDbTime,
  formatDuration,
  formatDate,
  formatOracleVersion,
  formatHostCpuInfo,
  formatMemoryGb,
  formatSnapshotIdRange,
  formatCompactNumber,
  formatInteger,
  formatCompactDuration,
  formatSqlId,
  formatSqlPreview,
  safeValue,
  truncate,
} from './utils/formatters';

export {
  getSeverityColor,
  getSeverityIcon,
  getSeverityLabel,
  getSeverityPriority,
  sortBySeverity,
  filterBySeverity,
  groupBySeverity,
  groupByCategory,
  getCategoryColor,
  getCategoryIcon,
  getCategoryLabel,
  getChangeDirectionColor,
  getChangeDirectionIcon,
  getChangeDirectionLabel,
  calculateSeveritySummary,
  hasCriticalIssues,
  hasIssues,
  applyInsightFilters,
} from './utils/severity-helpers';
