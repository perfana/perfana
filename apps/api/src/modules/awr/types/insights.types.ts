/**
 * AWR Insights Types
 *
 * TypeScript type definitions for insights generated from AWR analysis.
 * Includes severity levels, categories, and recommendation structures.
 */

// ==================== Severity & Category Enums ====================

/**
 * Severity levels for AWR insights
 * - critical: Requires immediate attention, significant performance impact
 * - warning: Should be investigated, moderate performance impact
 * - info: Informational, minor or potential impact
 */
export type InsightSeverity = 'critical' | 'warning' | 'info';

/**
 * Insight category types for grouping and filtering insights
 */
export type InsightCategory =
  | 'sql_performance'
  | 'wait_events'
  | 'resource_utilization'
  | 'io_performance'
  | 'memory'
  | 'memory_efficiency'
  | 'lock_contention'
  | 'parse_overhead'
  | 'network'
  | 'configuration'
  | 'regression'
  | 'improvement';

// ==================== Insight Types ====================

/**
 * Individual insight generated from AWR analysis
 */
export interface AwrInsight {
  /** Unique identifier for the insight */
  id: string;
  /** Severity level of the insight */
  severity: InsightSeverity;
  /** Category of the insight for grouping */
  category: InsightCategory;
  /** Short title describing the insight */
  title: string;
  /** Detailed description of the insight */
  description: string;
  /** Recommendation for addressing the issue */
  recommendation?: string;
  /** Related SQL ID if applicable */
  sqlId?: string;
  /** SQL text snippet if applicable (truncated for display) */
  sqlText?: string;
  /** Full SQL text if applicable (for detailed view) */
  fullSqlText?: string;
  /** Related wait event name if applicable */
  waitEvent?: string;
  /** Wait class if applicable */
  waitClass?: string;
  /** Primary numeric value associated with the insight */
  value?: number;
  /** Unit for the numeric value */
  unit?: string;
  /** Threshold that was exceeded */
  threshold?: number;
  /** Percentage of DB time if applicable */
  percentDbTime?: number;
  /** Impact score (0-100) for prioritization */
  impactScore?: number;
  /** Whether this is a comparison insight (regression/improvement) */
  isComparison?: boolean;
  /** Baseline value if comparison insight */
  baselineValue?: number;
  /** Change percentage if comparison insight */
  changePercent?: number;
  /** Additional metadata for the insight */
  metadata?: InsightMetadata;
  /** Tags for filtering and grouping */
  tags?: string[];
}

/**
 * Additional metadata for insights
 */
export interface InsightMetadata {
  /** Source of the insight (analyzer name) */
  source?: string;
  /** Confidence level (0-1) */
  confidence?: number;
  /** Related object names (tables, indexes, etc.) */
  relatedObjects?: string[];
  /** Module or application name if applicable */
  module?: string;
  /** User/schema name if applicable */
  schemaName?: string;
  /** Execution count if SQL-related */
  executions?: number;
  /** Time range if applicable */
  timeRange?: {
    begin: Date;
    end: Date;
  };
  /** Raw values for detailed display */
  rawValues?: Record<string, number | string>;
}

// ==================== Recommendation Types ====================

/**
 * Action type for recommendations
 */
export type RecommendationAction =
  | 'investigate'
  | 'tune_sql'
  | 'add_index'
  | 'increase_memory'
  | 'adjust_parameter'
  | 'review_code'
  | 'optimize_io'
  | 'reduce_contention'
  | 'scale_resources'
  | 'monitor';

/**
 * Priority level for recommendations
 */
export type RecommendationPriority = 'high' | 'medium' | 'low';

/**
 * Detailed recommendation for addressing an insight
 */
export interface Recommendation {
  /** Recommended action type */
  action: RecommendationAction;
  /** Priority level */
  priority: RecommendationPriority;
  /** Short summary of the recommendation */
  summary: string;
  /** Detailed steps to take */
  details?: string[];
  /** Estimated effort */
  effort?: 'low' | 'medium' | 'high';
  /** Potential impact */
  impact?: 'low' | 'medium' | 'high';
  /** Related documentation links */
  documentationLinks?: string[];
  /** SQL or script to run if applicable */
  script?: string;
}

// ==================== Grouped Insights Types ====================

/**
 * Insights grouped by category
 */
export interface InsightsByCategory {
  /** Category name */
  category: InsightCategory;
  /** Display label for the category */
  label: string;
  /** Insights in this category */
  insights: AwrInsight[];
  /** Count by severity */
  severityCounts: {
    critical: number;
    warning: number;
    info: number;
  };
  /** Highest severity in this category */
  highestSeverity: InsightSeverity;
}

/**
 * Insights grouped by severity
 */
export interface InsightsBySeverity {
  /** Severity level */
  severity: InsightSeverity;
  /** Insights at this severity */
  insights: AwrInsight[];
  /** Count of insights */
  count: number;
}

// ==================== SQL-Specific Insight Types ====================

/**
 * SQL performance insight with detailed metrics
 */
export interface SqlPerformanceInsight extends AwrInsight {
  category: 'sql_performance';
  /** SQL ID */
  sqlId: string;
  /** SQL text */
  sqlText?: string;
  /** Performance metrics */
  metrics: {
    elapsedTime?: number;
    cpuTime?: number;
    bufferGets?: number;
    diskReads?: number;
    executions?: number;
    rowsProcessed?: number;
  };
  /** Performance issues identified */
  issues: SqlPerformanceIssue[];
}

/**
 * Specific SQL performance issue
 */
export interface SqlPerformanceIssue {
  /** Issue type */
  type:
    | 'high_cpu'
    | 'high_io'
    | 'high_buffer_gets'
    | 'low_rows_per_exec'
    | 'high_parse_calls'
    | 'version_count'
    | 'full_table_scan'
    | 'cartesian_product';
  /** Severity */
  severity: InsightSeverity;
  /** Description */
  description: string;
  /** Value that triggered the issue */
  value: number;
  /** Threshold exceeded */
  threshold: number;
}

// ==================== Wait Event-Specific Insight Types ====================

/**
 * Wait event insight with detailed metrics
 */
export interface WaitEventInsight extends AwrInsight {
  category: 'wait_events';
  /** Wait event name */
  waitEvent: string;
  /** Wait class */
  waitClass: string;
  /** Wait metrics */
  metrics: {
    totalWaitTime: number;
    waits: number;
    avgWaitMs: number;
    percentDbTime: number;
  };
  /** Common causes for this wait event */
  commonCauses?: string[];
}

// ==================== Comparison Insight Types ====================

/**
 * Regression insight from comparison analysis
 */
export interface RegressionInsight extends AwrInsight {
  category: 'regression';
  isComparison: true;
  /** What regressed (sql, wait_event, metric) */
  regressionType: 'sql' | 'wait_event' | 'metric';
  /** Baseline value */
  baselineValue: number;
  /** Current value */
  currentValue: number;
  /** Change amount */
  changeAmount: number;
  /** Change percentage */
  changePercent: number;
}

/**
 * Improvement insight from comparison analysis
 */
export interface ImprovementInsight extends AwrInsight {
  category: 'improvement';
  isComparison: true;
  /** What improved (sql, wait_event, metric) */
  improvementType: 'sql' | 'wait_event' | 'metric';
  /** Baseline value */
  baselineValue: number;
  /** Current value */
  currentValue: number;
  /** Change amount */
  changeAmount: number;
  /** Change percentage */
  changePercent: number;
}

// ==================== Insight Builder Types ====================

/**
 * Input for creating an insight
 */
export interface InsightBuilderInput {
  /** Severity level */
  severity: InsightSeverity;
  /** Category */
  category: InsightCategory;
  /** Title */
  title: string;
  /** Description */
  description: string;
  /** Optional fields */
  recommendation?: string;
  sqlId?: string;
  sqlText?: string;
  waitEvent?: string;
  waitClass?: string;
  value?: number;
  unit?: string;
  threshold?: number;
  percentDbTime?: number;
  metadata?: InsightMetadata;
  tags?: string[];
}

// ==================== Display Label Helpers ====================

/**
 * Display labels for insight categories
 */
export const INSIGHT_CATEGORY_LABELS: Record<InsightCategory, string> = {
  sql_performance: 'SQL Performance',
  wait_events: 'Wait Events',
  resource_utilization: 'Resource Utilization',
  io_performance: 'I/O Performance',
  memory: 'Memory',
  memory_efficiency: 'Memory Efficiency',
  lock_contention: 'Lock Contention',
  parse_overhead: 'Parse Overhead',
  network: 'Network',
  configuration: 'Configuration',
  regression: 'Regressions',
  improvement: 'Improvements',
};

/**
 * Display labels for severity levels
 */
export const INSIGHT_SEVERITY_LABELS: Record<InsightSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

/**
 * Colors for severity levels (for UI reference)
 */
export const INSIGHT_SEVERITY_COLORS: Record<InsightSeverity, string> = {
  critical: '#d32f2f', // red
  warning: '#ed6c02', // orange
  info: '#0288d1', // blue
};
