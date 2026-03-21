/**
 * AWR Frontend Component Types
 *
 * TypeScript type definitions for AWR (Automatic Workload Repository)
 * React components, including props, state, and display types.
 *
 * @example
 * ```tsx
 * import type {
 *   AwrReportCardProps,
 *   AwrTabId,
 *   ChartDataPoint,
 * } from './types';
 * ```
 */

// Re-export API types for convenience
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

// ==================== Tab Types ====================

/**
 * AWR card tab identifiers
 */
export type AwrTabId =
  | 'insights'
  | 'top-sql'
  | 'wait-events'
  | 'segments'
  | 'compare';

/**
 * Tab configuration for AWR card
 */
export interface AwrTabConfig {
  /** Unique tab identifier */
  id: AwrTabId;
  /** Display label */
  label: string;
  /** Optional icon name (MUI icon) */
  icon?: string;
  /** Whether tab is disabled */
  disabled?: boolean;
  /** Tooltip text when disabled */
  disabledTooltip?: string;
  /** Badge count to display */
  badgeCount?: number;
  /** Badge color */
  badgeColor?: 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
}

/**
 * Default tab configurations
 */
export const AWR_TAB_CONFIGS: AwrTabConfig[] = [
  { id: 'insights', label: 'Insights', icon: 'Lightbulb' },
  { id: 'top-sql', label: 'Top SQL', icon: 'Code' },
  { id: 'wait-events', label: 'Wait Events', icon: 'HourglassEmpty' },
  { id: 'segments', label: 'Segments', icon: 'Storage' },
  { id: 'compare', label: 'Compare', icon: 'CompareArrows' },
];

// ==================== Component Props Types ====================

/**
 * Test run information needed by AWR components
 */
export interface AwrTestRunInfo {
  /** Test run UUID */
  id: string;
  /** Test run ID string (e.g., "my-test-run") */
  test_run_id: string;
  /** System under test ID */
  system_under_test_id?: string;
  /** Test environment */
  test_environment?: string;
  /** Workload name */
  workload?: string;
}

/**
 * Props for the main AWR Report Card component
 */
export interface AwrReportCardProps {
  /** Test run information */
  testRun: AwrTestRunInfo;
  /** Whether the card is expanded */
  expanded: boolean;
  /** Callback when expand/collapse is toggled */
  onExpand: () => void;
  /** Currently selected report ID (optional) */
  selectedReportId?: string;
  /** Callback when report selection changes */
  onReportSelect?: (reportId: string | null) => void;
  /** Initial tab to show */
  initialTab?: AwrTabId;
  /** Custom class name */
  className?: string;
}

/**
 * Props for the AWR upload zone component
 */
export interface AwrUploadZoneProps {
  /** Test run ID for upload */
  testRunId: string;
  /** Callback on successful upload */
  onUploadSuccess?: (report: UploadAwrReportResponse) => void;
  /** Callback on upload error */
  onUploadError?: (error: Error) => void;
  /** Callback for snackbar notifications */
  onSnackbar?: (message: string, severity: SnackbarSeverity) => void;
  /** Whether upload is disabled */
  disabled?: boolean;
  /** Custom class name */
  className?: string;
  /** Compact mode (minimal UI) */
  compact?: boolean;
}

/**
 * Props for the AWR parsing status component
 */
export interface AwrParsingStatusProps {
  /** Parse status */
  status: ParseStatus;
  /** Progress percentage (0-100) if available */
  progress?: number;
  /** Error message if parsing failed */
  error?: string;
  /** Callback to retry parsing */
  onRetry?: () => void;
  /** Compact display mode */
  compact?: boolean;
}

// ==================== Tab Component Props ====================

/**
 * Base props shared by all tab components
 */
export interface AwrTabBaseProps {
  /** Report ID to display */
  reportId: string;
  /** Test run ID for context */
  testRunId: string;
  /** Callback for snackbar notifications */
  onSnackbar?: (message: string, severity: SnackbarSeverity) => void;
}

/**
 * Props for the Top SQL tab
 */
export interface TopSqlTabProps extends AwrTabBaseProps {
  /** Maximum SQL statements to display */
  maxStatements?: number;
  /** Default sort field */
  defaultSortBy?: SqlSortField;
  /** Enable SQL text expansion */
  expandableSqlText?: boolean;
}

/**
 * Props for the Wait Events tab
 */
export interface WaitEventsTabProps extends AwrTabBaseProps {
  /** Group by wait class */
  groupByClass?: boolean;
  /** Show background events */
  showBackgroundEvents?: boolean;
}

/**
 * Props for the Segments tab
 */
export interface SegmentsTabProps extends AwrTabBaseProps {
  /** Initial segment type to display */
  initialSegmentType?: 'tableScans' | 'logicalReads' | 'physicalReads' | 'rowLockWaits' | 'bufferBusyWaits';
}

/**
 * Props for the Insights tab
 */
export interface InsightsTabProps extends AwrTabBaseProps {
  /** Initial filter state */
  initialFilters?: InsightFilters;
  /** Show comparison insights */
  showComparisonInsights?: boolean;
}

/**
 * Props for the Compare tab
 */
export interface CompareTabProps extends AwrTabBaseProps {
  /** Pre-selected baseline report ID */
  baselineReportId?: string;
  /** Pre-selected baseline test run ID */
  baselineTestRunId?: string;
  /** Callback when comparison is complete */
  onComparisonComplete?: (summary: import('@/lib/api/awr-reports').ComparisonSummary) => void;
}

// ==================== Insight Component Props ====================

/**
 * Props for the InsightCard component
 */
export interface InsightCardProps {
  /** Insight to display */
  insight: import('@/lib/api/awr-reports').AwrInsight;
  /** Whether the card is expanded */
  expanded?: boolean;
  /** Callback when expand is toggled */
  onExpandToggle?: () => void;
  /** Show SQL link if applicable */
  showSqlLink?: boolean;
  /** Callback when SQL ID is clicked */
  onSqlClick?: (sqlId: string) => void;
  /** Compact display mode */
  compact?: boolean;
}

/**
 * Props for the InsightsList component
 */
export interface InsightsListProps {
  /** Insights to display */
  insights: import('@/lib/api/awr-reports').AwrInsight[];
  /** Group by category */
  groupByCategory?: boolean;
  /** Group by severity */
  groupBySeverity?: boolean;
  /** Filter state */
  filters?: InsightFilters;
  /** Callback when filters change */
  onFiltersChange?: (filters: InsightFilters) => void;
  /** Callback when SQL ID is clicked */
  onSqlClick?: (sqlId: string) => void;
  /** Empty state message */
  emptyMessage?: string;
  /** Loading state */
  loading?: boolean;
}

/**
 * Props for the SeverityBadge component
 */
export interface SeverityBadgeProps {
  /** Severity level */
  severity: import('@/lib/api/awr-reports').InsightSeverity;
  /** Show label text */
  showLabel?: boolean;
  /** Badge size */
  size?: 'small' | 'medium' | 'large';
  /** Custom class name */
  className?: string;
}

// ==================== SQL Component Props ====================

/**
 * Props for the SqlStatementCard component
 */
export interface SqlStatementCardProps {
  /** SQL statement to display */
  statement: SqlStatementDisplay;
  /** Rank/position in the list */
  rank?: number;
  /** Whether the card is expanded */
  expanded?: boolean;
  /** Callback when expand is toggled */
  onExpandToggle?: () => void;
  /** Show comparison metrics */
  showComparison?: boolean;
  /** Baseline metrics for comparison */
  baselineMetrics?: SqlStatementMetrics;
  /** Callback for snackbar notifications */
  onSnackbar?: (message: string, severity: SnackbarSeverity) => void;
}

/**
 * Props for the SqlMetricsTable component
 */
export interface SqlMetricsTableProps {
  /** SQL statements to display */
  statements: SqlStatementDisplay[];
  /** Sort field */
  sortBy: SqlSortField;
  /** Sort direction */
  sortDirection: SortDirection;
  /** Callback when sort changes */
  onSortChange?: (field: SqlSortField) => void;
  /** Callback when row is clicked */
  onRowClick?: (sqlId: string) => void;
  /** Show rank column */
  showRank?: boolean;
  /** Maximum rows to display */
  maxRows?: number;
  /** Loading state */
  loading?: boolean;
}

/**
 * Props for the SqlTextViewer component
 */
export interface SqlTextViewerProps {
  /** SQL text to display */
  sqlText: string;
  /** SQL ID for reference */
  sqlId?: string;
  /** Enable syntax highlighting */
  highlightSyntax?: boolean;
  /** Maximum height before scrolling */
  maxHeight?: number;
  /** Show copy button */
  showCopyButton?: boolean;
  /** Show expand button */
  showExpandButton?: boolean;
  /** Callback for snackbar notifications */
  onSnackbar?: (message: string, severity: SnackbarSeverity) => void;
}

// ==================== Chart Component Props ====================

/**
 * Props for the LoadProfileChart component
 */
export interface LoadProfileChartProps {
  /** Load profile data */
  data: LoadProfileChartData;
  /** Chart height in pixels */
  height?: number;
  /** Show legend */
  showLegend?: boolean;
  /** Comparison data if available */
  comparisonData?: LoadProfileChartData;
  /** Chart type */
  chartType?: 'bar' | 'radar' | 'table';
}

/**
 * Props for the WaitEventsChart component
 */
export interface WaitEventsChartProps {
  /** Wait events data */
  data: WaitEventChartData[];
  /** Chart height in pixels */
  height?: number;
  /** Show by wait class */
  groupByClass?: boolean;
  /** Maximum events to display */
  maxEvents?: number;
  /** Chart type */
  chartType?: 'bar' | 'pie' | 'treemap';
  /** Show percentage labels */
  showPercentages?: boolean;
}

/**
 * Props for the TimeModelChart component
 */
export interface TimeModelChartProps {
  /** Time model data */
  data: TimeModelChartData;
  /** Chart height in pixels */
  height?: number;
  /** Show breakdown details */
  showBreakdown?: boolean;
  /** Chart type */
  chartType?: 'pie' | 'donut' | 'bar';
}

// ==================== Data Display Types ====================

/**
 * SQL statement for display (flattened from API response)
 */
export interface SqlStatementDisplay {
  /** SQL ID */
  sqlId: string;
  /** SQL text (may be truncated) */
  sqlText?: string;
  /** Executions */
  executions?: number;
  /** Elapsed time in seconds */
  elapsedTime?: number;
  /** Elapsed time per execution */
  elapsedTimePerExec?: number;
  /** CPU time in seconds */
  cpuTime?: number;
  /** CPU time per execution */
  cpuTimePerExec?: number;
  /** Buffer gets */
  bufferGets?: number;
  /** Buffer gets per execution */
  bufferGetsPerExec?: number;
  /** Disk reads */
  diskReads?: number;
  /** Disk reads per execution */
  diskReadsPerExec?: number;
  /** Rows processed */
  rowsProcessed?: number;
  /** Percentage of DB time */
  percentDbTime?: number;
  /** Module/application */
  module?: string;
  /** Parsing schema */
  parsingSchemaName?: string;
  /** Plan hash value */
  planHashValue?: number;
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
}

/**
 * Wait event for display
 */
export interface WaitEventDisplay {
  /** Event name */
  event: string;
  /** Wait class */
  waitClass?: string;
  /** Total waits */
  waits: number;
  /** Total wait time in seconds */
  totalWaitTime: number;
  /** Average wait time in milliseconds */
  avgWaitMs?: number;
  /** Percentage of DB time */
  percentDbTime?: number;
  /** Percentage of total wait time */
  percentWaitTime?: number;
  /** Timeouts count */
  timeouts?: number;
}

// ==================== Chart Data Types ====================

/**
 * Generic chart data point
 */
export interface ChartDataPoint {
  /** Label/name */
  name: string;
  /** Primary value */
  value: number;
  /** Secondary value for comparison */
  compareValue?: number;
  /** Color for rendering */
  color?: string;
  /** Percentage of total */
  percent?: number;
}

/**
 * Load profile chart data
 */
export interface LoadProfileChartData {
  /** Metrics for display */
  metrics: ChartDataPoint[];
  /** DB Time per second */
  dbTimePerSecond?: number;
  /** DB CPU per second */
  dbCpuPerSecond?: number;
  /** Transactions per second */
  transactionsPerSecond?: number;
  /** Logical reads per second */
  logicalReadsPerSecond?: number;
  /** Physical reads per second */
  physicalReadsPerSecond?: number;
  /** Physical writes per second */
  physicalWritesPerSecond?: number;
}

/**
 * Wait event chart data
 */
export interface WaitEventChartData {
  /** Event name */
  event: string;
  /** Wait class */
  waitClass: string;
  /** Total wait time in seconds */
  waitTime: number;
  /** Percentage of total */
  percent: number;
  /** Color based on wait class */
  color?: string;
}

/**
 * Time model chart data
 */
export interface TimeModelChartData {
  /** DB Time in seconds */
  dbTime: number;
  /** DB CPU time */
  dbCpu?: number;
  /** SQL execute time */
  sqlExecute?: number;
  /** Parse time */
  parseTime?: number;
  /** PL/SQL time */
  plsqlTime?: number;
  /** Background time */
  backgroundTime?: number;
  /** Segments for pie/donut chart */
  segments?: ChartDataPoint[];
}

// ==================== Filter & Sort Types ====================

/**
 * Sort direction
 */
export type SortDirection = 'asc' | 'desc';

/**
 * SQL sort fields
 */
export type SqlSortField =
  | 'elapsedTime'
  | 'cpuTime'
  | 'bufferGets'
  | 'diskReads'
  | 'executions'
  | 'percentDbTime'
  | 'elapsedTimePerExec';

/**
 * Wait event sort fields
 */
export type WaitEventSortField =
  | 'totalWaitTime'
  | 'waits'
  | 'avgWaitMs'
  | 'percentDbTime'
  | 'event';

/**
 * Insight filter state
 */
export interface InsightFilters {
  /** Filter by severity levels */
  severities?: import('@/lib/api/awr-reports').InsightSeverity[];
  /** Filter by categories */
  categories?: import('@/lib/api/awr-reports').InsightCategory[];
  /** Search text */
  searchText?: string;
  /** Show only SQL-related insights */
  sqlOnly?: boolean;
  /** Show only comparison insights */
  comparisonOnly?: boolean;
  /** Minimum impact score */
  minImpactScore?: number;
}

/**
 * SQL filter state
 */
export interface SqlFilters {
  /** Search by SQL ID or text */
  searchText?: string;
  /** Minimum elapsed time */
  minElapsedTime?: number;
  /** Minimum DB time percentage */
  minPercentDbTime?: number;
  /** Filter by module */
  module?: string;
}

/**
 * Wait event filter state
 */
export interface WaitEventFilters {
  /** Filter by wait class */
  waitClasses?: string[];
  /** Search by event name */
  searchText?: string;
  /** Minimum wait time */
  minWaitTime?: number;
  /** Minimum DB time percentage */
  minPercentDbTime?: number;
}

// ==================== Snackbar Types ====================

/**
 * Snackbar severity for MUI Snackbar notifications
 */
export type SnackbarSeverity = 'success' | 'error' | 'warning' | 'info';

/**
 * Snackbar callback function type
 */
export type SnackbarCallback = (message: string, severity?: SnackbarSeverity) => void;

// ==================== UI State Types ====================

/**
 * Card expansion state
 */
export interface AwrCardState {
  /** Whether the card is expanded */
  expanded: boolean;
  /** Currently active tab */
  activeTab: AwrTabId;
  /** Selected report ID */
  selectedReportId: string | null;
  /** Selected baseline report ID for comparison */
  baselineReportId: string | null;
}

/**
 * Upload state
 */
export interface UploadState {
  /** Whether upload is in progress */
  isUploading: boolean;
  /** Upload progress (0-100) */
  progress: number;
  /** Current file being uploaded */
  file: File | null;
  /** Error message if upload failed */
  error: string | null;
}

/**
 * Comparison state
 */
export interface ComparisonState {
  /** Whether comparison is loading */
  isComparing: boolean;
  /** Selected baseline report ID */
  baselineReportId: string | null;
  /** Comparison result */
  result: import('@/lib/api/awr-reports').ComparisonResponse | null;
  /** Error message if comparison failed */
  error: string | null;
}

// ==================== Display Helper Types ====================

/**
 * Color configuration for severity levels
 */
export interface SeverityColors {
  /** Background color */
  background: string;
  /** Text/foreground color */
  text: string;
  /** Border color */
  border: string;
  /** Icon color */
  icon: string;
}

/**
 * Severity color map
 */
export const SEVERITY_COLORS: Record<import('@/lib/api/awr-reports').InsightSeverity, SeverityColors> = {
  critical: {
    background: 'rgba(211, 47, 47, 0.08)',
    text: '#d32f2f',
    border: 'rgba(211, 47, 47, 0.3)',
    icon: '#d32f2f',
  },
  warning: {
    background: 'rgba(237, 108, 2, 0.08)',
    text: '#ed6c02',
    border: 'rgba(237, 108, 2, 0.3)',
    icon: '#ed6c02',
  },
  info: {
    background: 'rgba(2, 136, 209, 0.08)',
    text: '#0288d1',
    border: 'rgba(2, 136, 209, 0.3)',
    icon: '#0288d1',
  },
};

/**
 * Wait class color map for charts
 */
export const WAIT_CLASS_COLORS: Record<string, string> = {
  'User I/O': '#4caf50',
  'System I/O': '#8bc34a',
  Concurrency: '#ff9800',
  Application: '#2196f3',
  Commit: '#9c27b0',
  Configuration: '#795548',
  Network: '#00bcd4',
  Scheduler: '#607d8b',
  Cluster: '#e91e63',
  Administrative: '#9e9e9e',
  Other: '#bdbdbd',
  Idle: '#f5f5f5',
};

/**
 * Change direction colors
 */
export const CHANGE_DIRECTION_COLORS: Record<import('@/lib/api/awr-reports').ChangeDirection, string> = {
  improved: '#4caf50',
  regressed: '#f44336',
  unchanged: '#9e9e9e',
  new: '#2196f3',
  removed: '#ff9800',
};

// ==================== Category Display Configuration ====================

/**
 * Category display configuration
 */
export interface CategoryDisplayConfig {
  /** Category ID */
  id: import('@/lib/api/awr-reports').InsightCategory;
  /** Display label */
  label: string;
  /** MUI icon name */
  icon: string;
  /** Color for the category */
  color: string;
  /** Description */
  description: string;
}

/**
 * Category display configurations
 */
export const CATEGORY_CONFIGS: CategoryDisplayConfig[] = [
  {
    id: 'sql_performance',
    label: 'SQL Performance',
    icon: 'Code',
    color: '#2196f3',
    description: 'Issues related to SQL statement execution',
  },
  {
    id: 'wait_events',
    label: 'Wait Events',
    icon: 'HourglassEmpty',
    color: '#ff9800',
    description: 'Database wait events and their impact',
  },
  {
    id: 'resource_utilization',
    label: 'Resource Utilization',
    icon: 'Speed',
    color: '#9c27b0',
    description: 'CPU, memory, and I/O resource usage',
  },
  {
    id: 'io_performance',
    label: 'I/O Performance',
    icon: 'Storage',
    color: '#4caf50',
    description: 'Disk and storage I/O patterns',
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: 'Memory',
    color: '#00bcd4',
    description: 'SGA, PGA, and buffer cache issues',
  },
  {
    id: 'lock_contention',
    label: 'Lock Contention',
    icon: 'Lock',
    color: '#f44336',
    description: 'Row locks, latches, and enqueue waits',
  },
  {
    id: 'parse_overhead',
    label: 'Parse Overhead',
    icon: 'TextSnippet',
    color: '#795548',
    description: 'Hard and soft parsing issues',
  },
  {
    id: 'network',
    label: 'Network',
    icon: 'Wifi',
    color: '#607d8b',
    description: 'Network-related performance issues',
  },
  {
    id: 'configuration',
    label: 'Configuration',
    icon: 'Settings',
    color: '#9e9e9e',
    description: 'Database parameter and configuration issues',
  },
  {
    id: 'regression',
    label: 'Regressions',
    icon: 'TrendingDown',
    color: '#f44336',
    description: 'Performance regressions vs baseline',
  },
  {
    id: 'improvement',
    label: 'Improvements',
    icon: 'TrendingUp',
    color: '#4caf50',
    description: 'Performance improvements vs baseline',
  },
];

// ==================== Upload Response Types ====================

// Re-export the UploadAwrReportResponse for convenience
import type { UploadAwrReportResponse } from '@/lib/api/awr-reports';
export type { UploadAwrReportResponse };
