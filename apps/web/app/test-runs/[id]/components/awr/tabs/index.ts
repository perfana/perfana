/**
 * AWR Tabs Barrel Export
 *
 * Exports all tab components for the AWR Report Card.
 * Each tab displays a different aspect of the AWR report analysis:
 * - InsightsTab: Generated insights and recommendations
 * - TopSqlTab: Top SQL statements display with metrics
 * - WaitEventsTab: Wait events analysis with charts
 * - SegmentsTab: Segment statistics and performance
 * - CompareTab: Baseline comparison view
 *
 * @example
 * ```tsx
 * import {
 *   InsightsTab,
 *   TopSqlTab,
 *   WaitEventsTab,
 *   SegmentsTab,
 *   CompareTab,
 * } from './tabs';
 *
 * function AwrReportTabs({ reportId, testRunId, activeTab }) {
 *   switch (activeTab) {
 *     case 'insights':
 *       return <InsightsTab reportId={reportId} testRunId={testRunId} />;
 *     case 'top-sql':
 *       return <TopSqlTab reportId={reportId} testRunId={testRunId} />;
 *     case 'wait-events':
 *       return <WaitEventsTab reportId={reportId} testRunId={testRunId} />;
 *     case 'segments':
 *       return <SegmentsTab reportId={reportId} testRunId={testRunId} />;
 *     case 'compare':
 *       return <CompareTab reportId={reportId} testRunId={testRunId} />;
 *     default:
 *       return null;
 *   }
 * }
 * ```
 */

// ==================== Tab Components ====================

export { TopSqlTab, default as TopSqlTabDefault } from './TopSqlTab';
export { WaitEventsTab, default as WaitEventsTabDefault } from './WaitEventsTab';
export { SegmentsTab, default as SegmentsTabDefault } from './SegmentsTab';
export { InsightsTab, default as InsightsTabDefault } from './InsightsTab';
export { CompareTab, default as CompareTabDefault } from './CompareTab';

// ==================== Type Re-exports ====================

export type {
  // Tab types
  AwrTabId,
  AwrTabConfig,
  AwrTabBaseProps,
  TopSqlTabProps,
  WaitEventsTabProps,
  SegmentsTabProps,
  InsightsTabProps,
  CompareTabProps,

  // Common types
  SnackbarSeverity,
  SnackbarCallback,

  // Data types
  SqlStatementDisplay,
  WaitEventDisplay,
  LoadProfileChartData,
  TimeModelChartData,
  ChartDataPoint,

  // Filter types
  InsightFilters,
  SqlFilters,
  WaitEventFilters,
  SqlSortField,
  WaitEventSortField,
  SortDirection,
} from '../types';

// ==================== API Type Re-exports ====================

export type {
  // Report types
  AwrReport,
  AwrReportListItem,
  ParseStatus,
  FileType,
  DatabaseInfo,
  HostInfo,
  SnapshotInfo,

  // Analysis types
  AwrAnalysis,
  AwrInsight,
  SeveritySummary,
  InsightSeverity,
  InsightCategory,

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
} from '../types';
