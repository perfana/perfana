/**
 * SQL Comparison Builder Service
 *
 * Builds detailed SQL statement comparisons between two AWR reports.
 * Responsible for:
 * - Extracting SQL statements from parsed data
 * - Comparing SQL metrics (elapsed time, CPU, buffer gets, etc.)
 * - Identifying regressions, improvements, new and removed statements
 * - Calculating summary statistics
 */

import { Injectable } from '@nestjs/common';
import { ParsedAwrData } from '../../entities/awr-report.entity';
import { AwrAnalysisConfig } from '../../config/awr-analysis.config';
import type {
  SqlComparisonResult,
  SqlStatementComparison,
  ChangeDirection,
} from '../../types/analysis.types';
import type { SqlStatement, TopSql } from '../../types/awr-data.types';

/**
 * Service for building SQL comparison results
 */
@Injectable()
export class SqlComparisonBuilderService {
  /**
   * Build detailed SQL comparison result
   *
   * @param currentData - Current report parsed data
   * @param baselineData - Baseline report parsed data
   * @param config - Analysis configuration
   * @param maxStatements - Maximum SQL statements to compare
   * @returns SQL comparison result with all comparisons and summaries
   */
  buildSqlComparison(
    currentData: ParsedAwrData,
    baselineData: ParsedAwrData,
    config: AwrAnalysisConfig,
    maxStatements: number = 50,
  ): SqlComparisonResult {
    const currentSql = this.getSqlStatementMap(currentData.topSql);
    const baselineSql = this.getSqlStatementMap(baselineData.topSql);

    const comparisons: SqlStatementComparison[] = [];
    const regressions: SqlStatementComparison[] = [];
    const improvements: SqlStatementComparison[] = [];
    const newStatements: SqlStatementComparison[] = [];
    const removedStatements: SqlStatementComparison[] = [];

    const thresholds = config.thresholds.comparison;

    // Compare existing statements
    let processed = 0;
    for (const [sqlId, currentStmt] of currentSql) {
      if (processed >= maxStatements) break;

      const baselineStmt = baselineSql.get(sqlId);
      const comparison = this.compareSqlStatement(currentStmt, baselineStmt, thresholds);
      comparisons.push(comparison);

      if (comparison.isSignificantRegression) {
        regressions.push(comparison);
      } else if (comparison.isSignificantImprovement) {
        improvements.push(comparison);
      } else if (!baselineStmt) {
        newStatements.push(comparison);
      }

      processed++;
    }

    // Find removed statements
    for (const [sqlId, baselineStmt] of baselineSql) {
      if (!currentSql.has(sqlId)) {
        const comparison = this.createRemovedSqlComparison(baselineStmt);
        removedStatements.push(comparison);
      }
    }

    // Calculate summary statistics
    const avgChange = this.calculateAverageChange(comparisons);

    return {
      comparisons,
      regressions,
      improvements,
      newStatements,
      removedStatements,
      summary: {
        total: comparisons.length,
        regressionCount: regressions.length,
        improvementCount: improvements.length,
        newCount: newStatements.length,
        removedCount: removedStatements.length,
        avgElapsedTimeChange: avgChange,
      },
    };
  }

  /**
   * Get SQL statement map from TopSql
   * Merges metrics from all sections (byElapsedTime, byCpuTime, byBufferGets, byDiskReads)
   * to ensure complete data for each SQL statement
   */
  private getSqlStatementMap(topSql?: TopSql): Map<string, SqlStatement> {
    const map = new Map<string, SqlStatement>();

    if (!topSql) return map;

    const sources = [
      topSql.byElapsedTime,
      topSql.byCpuTime,
      topSql.byBufferGets,
      topSql.byDiskReads,
    ];

    for (const statements of sources) {
      if (!statements) continue;
      for (const stmt of statements) {
        const existing = map.get(stmt.sqlId);
        if (!existing) {
          // First occurrence - add the statement
          map.set(stmt.sqlId, stmt);
        } else {
          // Merge metrics from all sections - preserve non-undefined values
          map.set(stmt.sqlId, {
            ...existing,
            // Merge all metrics, preferring non-undefined values
            elapsedTime: existing.elapsedTime ?? stmt.elapsedTime,
            cpuTime: existing.cpuTime ?? stmt.cpuTime,
            bufferGets: existing.bufferGets ?? stmt.bufferGets,
            diskReads: existing.diskReads ?? stmt.diskReads,
            executions: existing.executions ?? stmt.executions,
            rowsProcessed: existing.rowsProcessed ?? stmt.rowsProcessed,
            planHashValue: existing.planHashValue ?? stmt.planHashValue,
          });
        }
      }
    }

    return map;
  }

  /**
   * Compare single SQL statement
   */
  private compareSqlStatement(
    current: SqlStatement,
    baseline: SqlStatement | undefined,
    thresholds: { significantRegressionPercent: number; significantImprovementPercent: number },
  ): SqlStatementComparison {
    const currentMetrics = {
      elapsedTime: current.elapsedTime,
      cpuTime: current.cpuTime,
      bufferGets: current.bufferGets,
      diskReads: current.diskReads,
      executions: current.executions,
      planHashValue: current.planHashValue,
    };

    const baselineMetrics = baseline
      ? {
          elapsedTime: baseline.elapsedTime,
          cpuTime: baseline.cpuTime,
          bufferGets: baseline.bufferGets,
          diskReads: baseline.diskReads,
          executions: baseline.executions,
          planHashValue: baseline.planHashValue,
        }
      : undefined;

    const deltaPercent = {
      elapsedTime: this.calcPercentChange(current.elapsedTime, baseline?.elapsedTime),
      cpuTime: this.calcPercentChange(current.cpuTime, baseline?.cpuTime),
      bufferGets: this.calcPercentChange(current.bufferGets, baseline?.bufferGets),
      diskReads: this.calcPercentChange(current.diskReads, baseline?.diskReads),
    };

    const elapsedChange = deltaPercent.elapsedTime ?? 0;
    let changeDirection: ChangeDirection = 'unchanged';
    if (!baseline) changeDirection = 'new';
    else if (elapsedChange > 0) changeDirection = 'regressed';
    else if (elapsedChange < 0) changeDirection = 'improved';

    const isSignificantRegression =
      baseline !== undefined && elapsedChange >= thresholds.significantRegressionPercent;
    const isSignificantImprovement =
      baseline !== undefined && elapsedChange <= -thresholds.significantImprovementPercent;

    // Check if execution plan changed
    const planChanged =
      currentMetrics.planHashValue !== undefined &&
      baselineMetrics?.planHashValue !== undefined &&
      currentMetrics.planHashValue !== baselineMetrics.planHashValue;

    // Calculate relative performance factor
    const performanceFactor =
      baseline !== undefined && baseline.elapsedTime && current.elapsedTime
        ? current.elapsedTime / baseline.elapsedTime
        : undefined;

    return {
      sqlId: current.sqlId,
      sqlText: current.sqlText?.substring(0, 200),
      fullSqlText: current.fullSqlText || current.sqlText,
      changeDirection,
      current: currentMetrics,
      baseline: baselineMetrics,
      deltaPercent,
      isSignificantRegression,
      isSignificantImprovement,
      planChanged,
      currentPlanHash: currentMetrics.planHashValue,
      baselinePlanHash: baselineMetrics?.planHashValue,
      performanceFactor,
    };
  }

  /**
   * Create comparison for removed SQL statement
   */
  private createRemovedSqlComparison(baseline: SqlStatement): SqlStatementComparison {
    return {
      sqlId: baseline.sqlId,
      sqlText: baseline.sqlText?.substring(0, 200),
      fullSqlText: baseline.fullSqlText || baseline.sqlText,
      changeDirection: 'removed',
      current: {},
      baseline: {
        elapsedTime: baseline.elapsedTime,
        cpuTime: baseline.cpuTime,
        bufferGets: baseline.bufferGets,
        diskReads: baseline.diskReads,
        executions: baseline.executions,
        planHashValue: baseline.planHashValue,
      },
      deltaPercent: {},
      isSignificantRegression: false,
      isSignificantImprovement: false,
      planChanged: false,
      currentPlanHash: undefined,
      baselinePlanHash: baseline.planHashValue,
      performanceFactor: undefined,
    };
  }

  /**
   * Calculate percentage change
   */
  private calcPercentChange(current?: number, baseline?: number): number | undefined {
    if (current === undefined || baseline === undefined) return undefined;
    if (baseline === 0) return current > 0 ? 100 : 0;
    return ((current - baseline) / Math.abs(baseline)) * 100;
  }

  /**
   * Calculate average elapsed time change
   */
  private calculateAverageChange(comparisons: SqlStatementComparison[]): number {
    const changes = comparisons
      .map((c) => c.deltaPercent.elapsedTime)
      .filter((c): c is number => c !== undefined);

    if (changes.length === 0) return 0;
    return changes.reduce((sum, c) => sum + c, 0) / changes.length;
  }
}
