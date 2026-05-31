/**
 * AWR Analysis Types
 *
 * TypeScript type definitions for AWR analysis results, comparison data,
 * and related structures used by the analyzers.
 */

import type { ParsedAwrData } from './awr-data.types';
import type { AwrInsight, InsightSeverity } from './insights.types';

// ==================== Analysis Result Types ====================

/**
 * Analysis type for distinguishing single vs comparison analysis
 */
/** @public */
export type AnalysisType = 'single' | 'comparison';

/**
 * Severity summary counts for quick overview
 */
export interface SeveritySummary {
  /** Number of critical severity insights */
  critical: number;
  /** Number of warning severity insights */
  warning: number;
  /** Number of info severity insights */
  info: number;
  /** Total number of insights */
  total: number;
}

/**
 * Single report analysis result
 */
/** @public */
export interface SingleAnalysisResult {
  /** Analysis type identifier */
  type: 'single';
  /** AWR report ID that was analyzed */
  reportId: string;
  /** Generated insights */
  insights: AwrInsight[];
  /** Summary of insight severities */
  severitySummary: SeveritySummary;
  /** Timestamp of analysis */
  analyzedAt: Date;
  /** Version of analysis algorithm */
  analysisVersion: string;
  /** Analysis duration in milliseconds */
  analysisDurationMs?: number;
}

/**
 * Comparison analysis result between two AWR reports
 */
/** @public */
export interface ComparisonAnalysisResult {
  /** Analysis type identifier */
  type: 'comparison';
  /** Current AWR report ID */
  currentReportId: string;
  /** Baseline AWR report ID */
  baselineReportId: string;
  /** Generated insights including regressions and improvements */
  insights: AwrInsight[];
  /** Summary of insight severities */
  severitySummary: SeveritySummary;
  /** SQL comparison details */
  sqlComparison?: SqlComparisonResult;
  /** Wait event comparison details */
  waitEventComparison?: WaitEventComparisonResult;
  /** Load profile comparison */
  loadProfileComparison?: LoadProfileComparisonResult;
  /** Timestamp of analysis */
  analyzedAt: Date;
  /** Version of analysis algorithm */
  analysisVersion: string;
  /** Analysis duration in milliseconds */
  analysisDurationMs?: number;
}

/**
 * Union type for all analysis results
 */
/** @public */
export type AnalysisResult = SingleAnalysisResult | ComparisonAnalysisResult;

// ==================== SQL Comparison Types ====================

/**
 * Change direction for comparison metrics
 */
export type ChangeDirection = 'improved' | 'regressed' | 'unchanged' | 'new' | 'removed';

/**
 * Comparison data for a single SQL statement
 */
export interface SqlStatementComparison {
  /** SQL ID */
  sqlId: string;
  /** SQL text (truncated) */
  sqlText?: string;
  /** Full SQL text */
  fullSqlText?: string;
  /** Change direction */
  changeDirection: ChangeDirection;
  /** Current report values */
  current: SqlStatementMetrics;
  /** Baseline report values */
  baseline?: SqlStatementMetrics;
  /** Percentage changes */
  deltaPercent: SqlStatementDelta;
  /** Whether this regression is significant */
  isSignificantRegression: boolean;
  /** Whether this improvement is significant */
  isSignificantImprovement: boolean;
  /** Whether execution plan changed */
  planChanged: boolean;
  /** Current plan hash value */
  currentPlanHash?: number;
  /** Baseline plan hash value */
  baselinePlanHash?: number;
  /** Relative performance factor (e.g., 2.5 means 2.5x slower) */
  performanceFactor?: number;
}

/**
 * Key metrics for SQL statement comparison
 */
export interface SqlStatementMetrics {
  /** Elapsed time in seconds */
  elapsedTime?: number;
  /** Elapsed time per execution */
  elapsedTimePerExec?: number;
  /** CPU time in seconds */
  cpuTime?: number;
  /** Buffer gets */
  bufferGets?: number;
  /** Disk reads */
  diskReads?: number;
  /** Executions */
  executions?: number;
  /** Rows processed */
  rowsProcessed?: number;
  /** Percentage of DB time */
  percentDbTime?: number;
  /** Execution plan hash value */
  planHashValue?: number;
}

/**
 * Percentage delta values for SQL comparison
 */
export interface SqlStatementDelta {
  /** Elapsed time change percentage */
  elapsedTime?: number;
  /** Elapsed time per exec change percentage */
  elapsedTimePerExec?: number;
  /** CPU time change percentage */
  cpuTime?: number;
  /** Buffer gets change percentage */
  bufferGets?: number;
  /** Disk reads change percentage */
  diskReads?: number;
  /** Executions change percentage */
  executions?: number;
}

/**
 * SQL comparison result with aggregated statistics
 */
export interface SqlComparisonResult {
  /** All SQL comparisons */
  comparisons: SqlStatementComparison[];
  /** SQL statements with significant regressions */
  regressions: SqlStatementComparison[];
  /** SQL statements with significant improvements */
  improvements: SqlStatementComparison[];
  /** New SQL statements in current report */
  newStatements: SqlStatementComparison[];
  /** SQL statements removed in current report */
  removedStatements: SqlStatementComparison[];
  /** Summary statistics */
  summary: {
    /** Total statements compared */
    total: number;
    /** Number of regressions */
    regressionCount: number;
    /** Number of improvements */
    improvementCount: number;
    /** Number of new statements */
    newCount: number;
    /** Number of removed statements */
    removedCount: number;
    /** Average elapsed time change percentage */
    avgElapsedTimeChange?: number;
    /** Total elapsed time change percentage */
    totalElapsedTimeChange?: number;
  };
}

// ==================== Wait Event Comparison Types ====================

/**
 * Comparison data for a single wait event
 */
export interface WaitEventComparison {
  /** Wait event name */
  event: string;
  /** Wait class */
  waitClass?: string;
  /** Change direction */
  changeDirection: ChangeDirection;
  /** Current report values */
  current: WaitEventMetrics;
  /** Baseline report values */
  baseline?: WaitEventMetrics;
  /** Percentage changes */
  deltaPercent: WaitEventDelta;
  /** Whether this is a significant increase */
  isSignificantIncrease: boolean;
  /** Whether this is a significant decrease */
  isSignificantDecrease: boolean;
}

/**
 * Key metrics for wait event comparison
 */
export interface WaitEventMetrics {
  /** Total wait time in seconds */
  totalWaitTime?: number;
  /** Number of waits */
  waits?: number;
  /** Average wait time in ms */
  avgWaitMs?: number;
  /** Percentage of DB time */
  percentDbTime?: number;
}

/**
 * Percentage delta values for wait event comparison
 */
export interface WaitEventDelta {
  /** Total wait time change percentage */
  totalWaitTime?: number;
  /** Wait count change percentage */
  waits?: number;
  /** Average wait time change percentage */
  avgWaitMs?: number;
}

/**
 * Wait event comparison result
 */
export interface WaitEventComparisonResult {
  /** All wait event comparisons */
  comparisons: WaitEventComparison[];
  /** Wait events with significant increases */
  increases: WaitEventComparison[];
  /** Wait events with significant decreases */
  decreases: WaitEventComparison[];
  /** New wait events */
  newEvents: WaitEventComparison[];
  /** Removed wait events */
  removedEvents: WaitEventComparison[];
  /** Summary by wait class */
  byClass: Record<string, {
    totalChange: number;
    eventCount: number;
  }>;
}

// ==================== Load Profile Comparison Types ====================

/**
 * Comparison data for a single load profile metric
 */
export interface LoadProfileMetricComparison {
  /** Metric name */
  name: string;
  /** Current value */
  currentValue: number;
  /** Baseline value */
  baselineValue: number;
  /** Absolute change */
  delta: number;
  /** Percentage change */
  deltaPercent: number;
  /** Change direction */
  changeDirection: ChangeDirection;
  /** Unit of measurement */
  unit?: string;
}

/**
 * Load profile comparison result
 */
export interface LoadProfileComparisonResult {
  /** Individual metric comparisons */
  metrics: LoadProfileMetricComparison[];
  /** Key highlights */
  highlights: {
    /** Metrics with largest increases */
    largestIncreases: LoadProfileMetricComparison[];
    /** Metrics with largest decreases */
    largestDecreases: LoadProfileMetricComparison[];
    /** DB time comparison */
    dbTimeChange?: number;
    /** Transaction rate comparison */
    transactionRateChange?: number;
  };
}

// ==================== Analyzer Input/Output Types ====================

/**
 * Input for single report analysis
 */
/** @public */
export interface SingleAnalysisInput {
  /** Report ID */
  reportId: string;
  /** Parsed AWR data */
  data: ParsedAwrData;
}

/**
 * Input for comparison analysis
 */
export interface ComparisonAnalysisInput {
  /** Current report ID */
  currentReportId: string;
  /** Current report parsed data */
  currentData: ParsedAwrData;
  /** Baseline report ID */
  baselineReportId: string;
  /** Baseline report parsed data */
  baselineData: ParsedAwrData;
}

/**
 * Configuration options for analysis
 */
/** @public */
export interface AnalysisConfig {
  /** Minimum percentage change to consider significant regression */
  regressionThresholdPercent?: number;
  /** Minimum percentage change to consider significant improvement */
  improvementThresholdPercent?: number;
  /** Minimum percentage of DB time to consider SQL statement */
  minSqlDbTimePercent?: number;
  /** Minimum wait time percentage to consider wait event */
  minWaitTimePercent?: number;
  /** Maximum number of SQL statements to analyze */
  maxSqlStatementsToAnalyze?: number;
  /** Maximum number of wait events to analyze */
  maxWaitEventsToAnalyze?: number;
  /** Include info-level insights */
  includeInfoInsights?: boolean;
}

// ==================== Report Summary Types ====================

/**
 * Summary data for collapsed card view
 */
/** @public */
export interface AwrReportSummary {
  /** Report ID */
  id: string;
  /** Database name */
  dbName?: string;
  /** Snapshot time range */
  timeRange?: {
    begin: Date;
    end: Date;
    elapsedMinutes: number;
  };
  /** Key metrics */
  metrics: {
    /** DB time in minutes */
    dbTimeMinutes?: number;
    /** Transactions per second */
    transactionsPerSecond?: number;
    /** Average active sessions */
    avgActiveSessions?: number;
    /** CPU percentage */
    cpuPercent?: number;
  };
  /** Parse status */
  parseStatus: 'pending' | 'parsing' | 'completed' | 'failed';
  /** Severity summary if analyzed */
  severitySummary?: SeveritySummary;
  /** Top issue if available */
  topIssue?: {
    severity: InsightSeverity;
    title: string;
  };
}
