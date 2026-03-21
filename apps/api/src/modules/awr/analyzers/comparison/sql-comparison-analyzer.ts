/**
 * SQL Comparison Analyzer
 *
 * Analyzes SQL statement changes between current and baseline AWR reports:
 * - Performance regressions (elapsed time increases)
 * - Performance improvements (elapsed time decreases)
 * - New SQL statements that weren't in baseline
 * - Removed SQL statements
 * - Execution plan changes
 */

import type {
  ParsedAwrData,
  SqlStatement,
  TopSql,
} from '../../types/awr-data.types';
import type { AwrInsight, InsightCategory } from '../../types/insights.types';
import type {
  SqlStatementComparison,
  SqlStatementMetrics,
  SqlStatementDelta,
  ChangeDirection,
} from '../../types/analysis.types';
import type { ComparisonThresholds } from '../../config/awr-analysis.config';
import { BaseAwrAnalyzer } from '../base-analyzer';

/** Tags for SQL comparison insight types */
const SQL_COMPARISON_TAGS = {
  REGRESSION: 'sql-regression',
  IMPROVEMENT: 'sql-improvement',
  NEW: 'sql-new',
  REMOVED: 'sql-removed',
} as const;

/**
 * Analyzer for SQL statement comparisons between reports
 */
export class SqlComparisonAnalyzer extends BaseAwrAnalyzer {
  /**
   * Get the analyzer name
   */
  getName(): string {
    return 'SqlComparisonAnalyzer';
  }

  /**
   * Get the primary insight category
   */
  getCategory(): InsightCategory {
    return 'regression';
  }

  /**
   * Standard analyze method - not applicable for comparison analysis
   */
  analyze(_data: ParsedAwrData): AwrInsight[] {
    return [];
  }

  /**
   * Compare SQL statements between current and baseline reports
   *
   * @param current - Current AWR data
   * @param baseline - Baseline AWR data
   * @param thresholds - Comparison thresholds
   * @returns SQL comparison insights
   */
  compareSqlStatements(
    current: ParsedAwrData,
    baseline: ParsedAwrData,
    thresholds: ComparisonThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    const currentSql = this.getSqlStatementMap(current.topSql);
    const baselineSql = this.getSqlStatementMap(baseline.topSql);

    // Check for regressions and improvements in existing statements
    for (const [sqlId, currentStmt] of currentSql) {
      const baselineStmt = baselineSql.get(sqlId);

      if (baselineStmt) {
        const comparison = this.compareSqlStatement(currentStmt, baselineStmt);

        if (this.isSignificantSqlRegression(comparison, thresholds)) {
          insights.push(this.createSqlRegressionInsight(comparison, thresholds));
        } else if (this.isSignificantSqlImprovement(comparison, thresholds)) {
          insights.push(this.createSqlImprovementInsight(comparison, thresholds));
        }
      } else if (this.isSignificantNewStatement(currentStmt, thresholds)) {
        insights.push(this.createNewSqlInsight(currentStmt));
      }
    }

    // Check for removed statements (were significant in baseline)
    for (const [sqlId, baselineStmt] of baselineSql) {
      if (!currentSql.has(sqlId) && this.isSignificantNewStatement(baselineStmt, thresholds)) {
        insights.push(this.createRemovedSqlInsight(baselineStmt));
      }
    }

    return insights;
  }

  /**
   * Create map of SQL statements by SQL ID from TopSql data
   *
   * @param topSql - TopSql data from parsed AWR
   * @returns Map of SQL ID to SQL statement
   */
  private getSqlStatementMap(topSql?: TopSql): Map<string, SqlStatement> {
    const map = new Map<string, SqlStatement>();

    if (!topSql) {
      return map;
    }

    // Collect from all categories, preferring byElapsedTime
    const sources = [
      topSql.byElapsedTime,
      topSql.byCpuTime,
      topSql.byBufferGets,
      topSql.byDiskReads,
    ];

    for (const statements of sources) {
      if (!statements) continue;
      for (const stmt of statements) {
        if (!map.has(stmt.sqlId)) {
          map.set(stmt.sqlId, stmt);
        }
      }
    }

    return map;
  }

  /**
   * Compare individual SQL statement metrics
   *
   * @param current - Current statement
   * @param baseline - Baseline statement
   * @returns Statement comparison data
   */
  private compareSqlStatement(
    current: SqlStatement,
    baseline: SqlStatement
  ): SqlStatementComparison {
    const currentMetrics = this.extractSqlMetrics(current);
    const baselineMetrics = this.extractSqlMetrics(baseline);
    const deltaPercent = this.calculateSqlDelta(currentMetrics, baselineMetrics);

    const changeDirection = this.determineSqlChangeDirection(deltaPercent);

    // Check if execution plan changed
    const planChanged = this.hasExecutionPlanChanged(currentMetrics, baselineMetrics);

    // Calculate relative performance factor (e.g., 2.5x slower)
    const performanceFactor = this.calculatePerformanceFactor(
      currentMetrics.elapsedTime,
      baselineMetrics.elapsedTime
    );

    return {
      sqlId: current.sqlId,
      sqlText: current.sqlText,
      fullSqlText: current.fullSqlText || current.sqlText,
      changeDirection,
      current: currentMetrics,
      baseline: baselineMetrics,
      deltaPercent,
      isSignificantRegression: false, // Set by threshold check
      isSignificantImprovement: false,
      planChanged,
      currentPlanHash: currentMetrics.planHashValue,
      baselinePlanHash: baselineMetrics.planHashValue,
      performanceFactor,
    };
  }

  /**
   * Extract comparable metrics from SQL statement
   *
   * @param stmt - SQL statement
   * @returns SQL metrics for comparison
   */
  private extractSqlMetrics(stmt: SqlStatement): SqlStatementMetrics {
    return {
      elapsedTime: stmt.elapsedTime,
      elapsedTimePerExec: stmt.elapsedTimePerExec,
      cpuTime: stmt.cpuTime,
      bufferGets: stmt.bufferGets,
      diskReads: stmt.diskReads,
      executions: stmt.executions,
      rowsProcessed: stmt.rowsProcessed,
      percentDbTime: stmt.percentDbTime,
      planHashValue: stmt.planHashValue,
    };
  }

  /**
   * Calculate percentage deltas between SQL metrics
   *
   * @param current - Current metrics
   * @param baseline - Baseline metrics
   * @returns Percentage deltas
   */
  private calculateSqlDelta(
    current: SqlStatementMetrics,
    baseline: SqlStatementMetrics
  ): SqlStatementDelta {
    return {
      elapsedTime: this.calculatePercentChange(current.elapsedTime, baseline.elapsedTime),
      elapsedTimePerExec: this.calculatePercentChange(
        current.elapsedTimePerExec,
        baseline.elapsedTimePerExec
      ),
      cpuTime: this.calculatePercentChange(current.cpuTime, baseline.cpuTime),
      bufferGets: this.calculatePercentChange(current.bufferGets, baseline.bufferGets),
      diskReads: this.calculatePercentChange(current.diskReads, baseline.diskReads),
      executions: this.calculatePercentChange(current.executions, baseline.executions),
    };
  }

  /**
   * Determine overall change direction for SQL comparison
   *
   * @param delta - Percentage deltas
   * @returns Change direction
   */
  private determineSqlChangeDirection(delta: SqlStatementDelta): ChangeDirection {
    const elapsedChange = delta.elapsedTime ?? 0;

    if (elapsedChange > 0) {
      return 'regressed';
    }
    if (elapsedChange < 0) {
      return 'improved';
    }
    return 'unchanged';
  }

  /**
   * Check if SQL comparison represents a significant regression
   *
   * @param comparison - SQL comparison data
   * @param thresholds - Comparison thresholds
   * @returns True if significant regression
   */
  private isSignificantSqlRegression(
    comparison: SqlStatementComparison,
    thresholds: ComparisonThresholds
  ): boolean {
    const elapsedChange = comparison.deltaPercent.elapsedTime ?? 0;
    const elapsedTimeIncrease =
      (comparison.current.elapsedTime ?? 0) - (comparison.baseline?.elapsedTime ?? 0);

    // Check percentage threshold
    const meetsPercentThreshold = elapsedChange >= thresholds.significantRegressionPercent;

    // Check absolute time increase
    const meetsAbsoluteThreshold = elapsedTimeIncrease >= thresholds.minElapsedTimeIncreaseSeconds;

    // Require significant DB time percentage
    const meetsDbTimeThreshold =
      (comparison.current.percentDbTime ?? 0) >= thresholds.minSqlDbTimePercentForComparison;

    return (meetsPercentThreshold || meetsAbsoluteThreshold) && meetsDbTimeThreshold;
  }

  /**
   * Check if SQL comparison represents a significant improvement
   *
   * @param comparison - SQL comparison data
   * @param thresholds - Comparison thresholds
   * @returns True if significant improvement
   */
  private isSignificantSqlImprovement(
    comparison: SqlStatementComparison,
    thresholds: ComparisonThresholds
  ): boolean {
    const elapsedChange = comparison.deltaPercent.elapsedTime ?? 0;

    // Improvement is negative change (faster)
    const meetsThreshold = elapsedChange <= -thresholds.significantImprovementPercent;

    // Baseline must have been significant to care about improvement
    const wasSignificant =
      (comparison.baseline?.percentDbTime ?? 0) >= thresholds.minSqlDbTimePercentForComparison;

    return meetsThreshold && wasSignificant;
  }

  /**
   * Check if a new SQL statement is significant enough to report
   *
   * @param stmt - New SQL statement
   * @param thresholds - Comparison thresholds
   * @returns True if significant
   */
  private isSignificantNewStatement(
    stmt: SqlStatement,
    thresholds: ComparisonThresholds
  ): boolean {
    return (stmt.percentDbTime ?? 0) >= thresholds.minSqlDbTimePercentForComparison;
  }

  /**
   * Create insight for SQL regression
   */
  private createSqlRegressionInsight(
    comparison: SqlStatementComparison,
    thresholds: ComparisonThresholds
  ): AwrInsight {
    const changePercent = comparison.deltaPercent.elapsedTime ?? 0;
    const severity = this.determineSeverityByChange(changePercent);
    const sqlText = this.truncateSql(comparison.sqlText ?? 'N/A');

    // Build performance description with factor
    let performanceDesc = `elapsed time increased by ${this.formatNumber(changePercent)}% ` +
      `(${this.formatTime(comparison.baseline?.elapsedTime ?? 0)} → ` +
      `${this.formatTime(comparison.current.elapsedTime ?? 0)})`;

    if (comparison.performanceFactor && comparison.performanceFactor !== 1) {
      const factor = comparison.performanceFactor;
      if (factor > 1) {
        performanceDesc += ` - ${this.formatNumber(factor)}x slower`;
      } else {
        performanceDesc += ` - ${this.formatNumber(1 / factor)}x faster`;
      }
    }

    // Add plan change indicator
    if (comparison.planChanged) {
      performanceDesc += ` [EXECUTION PLAN CHANGED]`;
    }

    // Build recommendation with plan change guidance
    let recommendation = this.getRegressionRecommendation(changePercent, thresholds);
    if (comparison.planChanged) {
      recommendation = `⚠️ EXECUTION PLAN CHANGED (${comparison.baselinePlanHash} → ${comparison.currentPlanHash}). ` +
        `This is likely the root cause of the regression. ` +
        `Use EXPLAIN PLAN or DBMS_XPLAN to review the new execution plan. ` +
        `Check for missing or stale statistics, changed initialization parameters, or optimizer hints. ` +
        recommendation;
    }

    return this.createInsight({
      severity,
      category: 'regression',
      title: `SQL Regression: ${comparison.sqlId}${comparison.planChanged ? ' (Plan Changed)' : ''}`,
      description: `SQL ID ${comparison.sqlId} ${performanceDesc}. ${sqlText}`,
      recommendation,
      sqlId: comparison.sqlId,
      sqlText: comparison.sqlText,
      fullSqlText: comparison.fullSqlText || comparison.sqlText,
      value: changePercent,
      unit: '%',
      threshold: thresholds.significantRegressionPercent,
      percentDbTime: comparison.current.percentDbTime,
      impactScore: this.calculateComparisonImpact(changePercent, comparison.current.percentDbTime),
      isComparison: true,
      baselineValue: comparison.baseline?.elapsedTime,
      changePercent,
      tags: comparison.planChanged
        ? [SQL_COMPARISON_TAGS.REGRESSION, 'plan-change']
        : [SQL_COMPARISON_TAGS.REGRESSION],
      metadata: {
        source: this.getName(),
        rawValues: {
          currentElapsed: comparison.current.elapsedTime ?? 0,
          baselineElapsed: comparison.baseline?.elapsedTime ?? 0,
          currentExecs: comparison.current.executions ?? 0,
          baselineExecs: comparison.baseline?.executions ?? 0,
          planChanged: comparison.planChanged ? 1 : 0,
          currentPlanHash: comparison.currentPlanHash ?? 0,
          baselinePlanHash: comparison.baselinePlanHash ?? 0,
          performanceFactor: comparison.performanceFactor ?? 0,
        },
      },
    });
  }

  /**
   * Create insight for SQL improvement
   */
  private createSqlImprovementInsight(
    comparison: SqlStatementComparison,
    thresholds: ComparisonThresholds
  ): AwrInsight {
    const changePercent = comparison.deltaPercent.elapsedTime ?? 0;
    const sqlText = this.truncateSql(comparison.sqlText ?? 'N/A');

    // Build performance description with factor
    let performanceDesc = `elapsed time decreased by ${this.formatNumber(Math.abs(changePercent))}% ` +
      `(${this.formatTime(comparison.baseline?.elapsedTime ?? 0)} → ` +
      `${this.formatTime(comparison.current.elapsedTime ?? 0)})`;

    if (comparison.performanceFactor && comparison.performanceFactor < 1) {
      const factor = 1 / comparison.performanceFactor;
      performanceDesc += ` - ${this.formatNumber(factor)}x faster`;
    }

    // Note plan change if applicable
    if (comparison.planChanged) {
      performanceDesc += ` [EXECUTION PLAN CHANGED]`;
    }

    let recommendation = 'Continue monitoring this query to ensure the improvement is sustained.';
    if (comparison.planChanged) {
      recommendation = `Execution plan changed (${comparison.baselinePlanHash} → ${comparison.currentPlanHash}), ` +
        `which improved performance. ${recommendation}`;
    }

    return this.createInsight({
      severity: 'info',
      category: 'improvement',
      title: `SQL Improvement: ${comparison.sqlId}${comparison.planChanged ? ' (Plan Changed)' : ''}`,
      description: `SQL ID ${comparison.sqlId} ${performanceDesc}. ${sqlText}`,
      recommendation,
      sqlId: comparison.sqlId,
      sqlText: comparison.sqlText,
      fullSqlText: comparison.fullSqlText || comparison.sqlText,
      value: changePercent,
      unit: '%',
      threshold: thresholds.significantImprovementPercent,
      percentDbTime: comparison.current.percentDbTime,
      impactScore: Math.abs(changePercent) / 2,
      isComparison: true,
      baselineValue: comparison.baseline?.elapsedTime,
      changePercent,
      tags: comparison.planChanged
        ? [SQL_COMPARISON_TAGS.IMPROVEMENT, 'plan-change']
        : [SQL_COMPARISON_TAGS.IMPROVEMENT],
      metadata: {
        source: this.getName(),
        rawValues: {
          planChanged: comparison.planChanged ? 1 : 0,
          currentPlanHash: comparison.currentPlanHash ?? 0,
          baselinePlanHash: comparison.baselinePlanHash ?? 0,
          performanceFactor: comparison.performanceFactor ?? 0,
        },
      },
    });
  }

  /**
   * Create insight for new SQL statement
   */
  private createNewSqlInsight(stmt: SqlStatement): AwrInsight {
    const sqlText = this.truncateSql(stmt.sqlText ?? 'N/A');
    const severity = this.determineSeverityByDbTime(stmt.percentDbTime ?? 0);

    return this.createInsight({
      severity,
      category: 'regression',
      title: `New SQL Statement: ${stmt.sqlId}`,
      description:
        `New SQL ID ${stmt.sqlId} appeared consuming ${this.formatNumber(stmt.percentDbTime ?? 0)}% ` +
        `of DB time (${this.formatTime(stmt.elapsedTime ?? 0)}). ${sqlText}`,
      recommendation:
        'Investigate this new query to ensure it is performing as expected. ' +
        'Check if this is a new feature or an unexpected change in application behavior.',
      sqlId: stmt.sqlId,
      sqlText: stmt.sqlText,
      fullSqlText: stmt.fullSqlText || stmt.sqlText,
      value: stmt.percentDbTime,
      unit: '%',
      percentDbTime: stmt.percentDbTime,
      impactScore: this.calculateImpactScore(stmt.percentDbTime ?? 0),
      isComparison: true,
      tags: [SQL_COMPARISON_TAGS.NEW],
    });
  }

  /**
   * Create insight for removed SQL statement
   */
  private createRemovedSqlInsight(stmt: SqlStatement): AwrInsight {
    const sqlText = this.truncateSql(stmt.sqlText ?? 'N/A');

    return this.createInsight({
      severity: 'info',
      category: 'improvement',
      title: `SQL Removed: ${stmt.sqlId}`,
      description:
        `SQL ID ${stmt.sqlId} no longer appears in top SQL. It previously consumed ` +
        `${this.formatNumber(stmt.percentDbTime ?? 0)}% of DB time. ${sqlText}`,
      recommendation:
        'Verify this query removal was intentional and not due to application issues.',
      sqlId: stmt.sqlId,
      sqlText: stmt.sqlText,
      fullSqlText: stmt.fullSqlText || stmt.sqlText,
      value: stmt.percentDbTime,
      unit: '%',
      percentDbTime: stmt.percentDbTime,
      impactScore: (stmt.percentDbTime ?? 0) / 2,
      isComparison: true,
      tags: [SQL_COMPARISON_TAGS.REMOVED],
    });
  }

  // Helper methods

  /**
   * Calculate percentage change between two values
   */
  private calculatePercentChange(current?: number, baseline?: number): number | undefined {
    if (current === undefined || baseline === undefined) {
      return undefined;
    }

    if (baseline === 0) {
      return current > 0 ? 100 : 0;
    }

    return ((current - baseline) / Math.abs(baseline)) * 100;
  }

  /**
   * Calculate comparison impact score based on change and DB time
   */
  private calculateComparisonImpact(changePercent: number, percentDbTime?: number): number {
    const changeImpact = Math.min(50, Math.abs(changePercent) / 2);
    const dbTimeImpact = Math.min(50, (percentDbTime ?? 0) * 2);
    return changeImpact + dbTimeImpact;
  }

  /**
   * Get recommendation text for SQL regression
   */
  private getRegressionRecommendation(
    changePercent: number,
    thresholds: ComparisonThresholds
  ): string {
    if (changePercent >= thresholds.criticalRegressionPercent) {
      return 'CRITICAL REGRESSION: This query has significantly degraded. ' +
        'Immediately investigate execution plan changes, check for missing statistics, ' +
        'and review any recent database or application changes.';
    }
    if (changePercent >= thresholds.significantRegressionPercent * 2) {
      return 'Significant performance degradation detected. Review the execution plan ' +
        'for changes, check if statistics are current, and verify index usage.';
    }
    return 'Performance regression detected. Monitor this query and investigate ' +
      'if the degradation persists or worsens.';
  }

  /**
   * Check if execution plan changed between baseline and current
   */
  private hasExecutionPlanChanged(
    current: SqlStatementMetrics,
    baseline: SqlStatementMetrics
  ): boolean {
    if (!current.planHashValue || !baseline.planHashValue) {
      return false;
    }
    return current.planHashValue !== baseline.planHashValue;
  }

  /**
   * Calculate relative performance factor (e.g., 2.5 means 2.5x slower)
   */
  private calculatePerformanceFactor(
    currentValue?: number,
    baselineValue?: number
  ): number | undefined {
    if (currentValue === undefined || baselineValue === undefined) {
      return undefined;
    }

    if (baselineValue === 0) {
      return currentValue > 0 ? 999 : 1; // Avoid division by zero
    }

    return currentValue / baselineValue;
  }
}
