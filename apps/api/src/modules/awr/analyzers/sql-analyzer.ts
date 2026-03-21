/**
 * SQL Performance Analyzer for AWR Reports
 *
 * Analyzes SQL statements from AWR reports to identify performance issues:
 * - High DB time queries: Statements consuming significant database time
 * - CPU-bound queries: Statements where CPU time dominates elapsed time
 * - I/O-bound queries: Statements with excessive physical reads
 * - High buffer gets: Statements with excessive logical reads
 * - Inefficient queries: Low rows per execution with high resource usage
 * - Parse overhead: Statements with excessive parse calls
 *
 * @example
 * const analyzer = new SqlPerformanceAnalyzer(config);
 * const insights = analyzer.analyze(parsedAwrData);
 */

import type { ParsedAwrData, SqlStatement, TopSql } from '../types/awr-data.types';
import type { AwrInsight, InsightCategory, InsightSeverity } from '../types/insights.types';
import type { AwrAnalysisConfig, SqlThresholds } from '../config/awr-analysis.config';
import { BaseAwrAnalyzer, type AnalyzerOptions } from './base-analyzer';

// ==================== Constants ====================

/** Category for all SQL performance insights */
const SQL_CATEGORY: InsightCategory = 'sql_performance';

/** Tags for different SQL issue types */
const SQL_TAGS = {
  HIGH_DB_TIME: 'high-db-time',
  CPU_BOUND: 'cpu-bound',
  IO_BOUND: 'io-bound',
  HIGH_BUFFER_GETS: 'high-buffer-gets',
  INEFFICIENT: 'inefficient',
  HIGH_PARSE: 'high-parse',
  HIGH_ELAPSED_TIME: 'high-elapsed-time',
} as const;

// ==================== SQL Performance Analyzer ====================

/**
 * Analyzer for SQL statement performance from AWR reports
 *
 * Identifies problematic SQL statements by analyzing:
 * - DB time consumption
 * - CPU vs elapsed time ratio
 * - Physical I/O operations
 * - Logical reads (buffer gets)
 * - Rows processed efficiency
 * - Parse call frequency
 */
export class SqlPerformanceAnalyzer extends BaseAwrAnalyzer {
  /**
   * Create a new SQL Performance Analyzer
   *
   * @param config - Analysis configuration with SQL thresholds
   * @param options - Optional analyzer behavior settings
   */
  constructor(config: AwrAnalysisConfig, options: AnalyzerOptions = {}) {
    super(config, options);
  }

  /**
   * Get the analyzer name
   *
   * @returns Analyzer name for logging and identification
   */
  getName(): string {
    return 'SqlPerformanceAnalyzer';
  }

  /**
   * Get the primary insight category
   *
   * @returns SQL performance category
   */
  getCategory(): InsightCategory {
    return SQL_CATEGORY;
  }

  /**
   * Analyze AWR data for SQL performance issues
   *
   * @param data - Parsed AWR data containing SQL statements
   * @returns Array of SQL performance insights
   */
  analyze(data: ParsedAwrData): AwrInsight[] {
    const insights: AwrInsight[] = [];

    if (!data.topSql) {
      this.debug('No Top SQL data available for analysis');
      return insights;
    }

    const sqlThresholds = this.config.thresholds.sql;

    // Analyze SQL by different categories
    insights.push(...this.analyzeHighDbTimeQueries(data.topSql, sqlThresholds));
    insights.push(...this.analyzeCpuBoundQueries(data.topSql, sqlThresholds));
    insights.push(...this.analyzeIoBoundQueries(data.topSql, sqlThresholds));
    insights.push(...this.analyzeHighBufferGetsQueries(data.topSql, sqlThresholds));
    insights.push(...this.analyzeInefficicientQueries(data.topSql, sqlThresholds));
    insights.push(...this.analyzeHighParseQueries(data.topSql, sqlThresholds));

    // Sort by impact score descending
    insights.sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0));

    this.debug(`Generated ${insights.length} SQL performance insights`);
    return insights;
  }

  // ==================== Analysis Methods ====================

  /**
   * Analyze queries with high DB time consumption
   *
   * @param topSql - Top SQL data from AWR report
   * @param thresholds - SQL analysis thresholds
   * @returns Insights for high DB time queries
   */
  private analyzeHighDbTimeQueries(
    topSql: TopSql,
    thresholds: SqlThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const statements = topSql.byElapsedTime ?? [];
    const maxToAnalyze = thresholds.maxStatementsToAnalyze;

    for (const stmt of statements.slice(0, maxToAnalyze)) {
      const percentDbTime = stmt.percentDbTime ?? 0;

      if (percentDbTime >= thresholds.minDbTimePercent) {
        const severity = this.determineSqlSeverity(percentDbTime, thresholds);
        const insight = this.createHighDbTimeInsight(stmt, percentDbTime, severity);
        insights.push(insight);
      }
    }

    return insights;
  }

  /**
   * Analyze CPU-bound queries where CPU dominates elapsed time
   *
   * @param topSql - Top SQL data from AWR report
   * @param thresholds - SQL analysis thresholds
   * @returns Insights for CPU-bound queries
   */
  private analyzeCpuBoundQueries(
    topSql: TopSql,
    thresholds: SqlThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const statements = topSql.byCpuTime ?? topSql.byElapsedTime ?? [];
    const maxToAnalyze = thresholds.maxStatementsToAnalyze;

    for (const stmt of statements.slice(0, maxToAnalyze)) {
      if (!this.isSignificantStatement(stmt, thresholds)) {
        continue;
      }

      const cpuPercent = this.calculateCpuPercent(stmt);
      if (cpuPercent >= thresholds.cpuBoundPercent) {
        const insight = this.createCpuBoundInsight(stmt, cpuPercent);
        insights.push(insight);
      }
    }

    return insights;
  }

  /**
   * Analyze I/O-bound queries with high physical reads
   *
   * @param topSql - Top SQL data from AWR report
   * @param thresholds - SQL analysis thresholds
   * @returns Insights for I/O-bound queries
   */
  private analyzeIoBoundQueries(
    topSql: TopSql,
    thresholds: SqlThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const statements = topSql.byDiskReads ?? topSql.byElapsedTime ?? [];
    const maxToAnalyze = thresholds.maxStatementsToAnalyze;

    for (const stmt of statements.slice(0, maxToAnalyze)) {
      if (!this.isSignificantStatement(stmt, thresholds)) {
        continue;
      }

      const diskReadsPerExec = this.calculateDiskReadsPerExec(stmt);
      if (diskReadsPerExec >= thresholds.highDiskReadsPerExec) {
        const insight = this.createIoBoundInsight(stmt, diskReadsPerExec, thresholds);
        insights.push(insight);
      }
    }

    return insights;
  }

  /**
   * Analyze queries with excessive buffer gets (logical reads)
   *
   * @param topSql - Top SQL data from AWR report
   * @param thresholds - SQL analysis thresholds
   * @returns Insights for high buffer gets queries
   */
  private analyzeHighBufferGetsQueries(
    topSql: TopSql,
    thresholds: SqlThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const statements = topSql.byBufferGets ?? topSql.byElapsedTime ?? [];
    const maxToAnalyze = thresholds.maxStatementsToAnalyze;

    for (const stmt of statements.slice(0, maxToAnalyze)) {
      if (!this.isSignificantStatement(stmt, thresholds)) {
        continue;
      }

      const bufferGetsPerExec = this.calculateBufferGetsPerExec(stmt);
      if (bufferGetsPerExec >= thresholds.highBufferGetsPerExec) {
        const insight = this.createHighBufferGetsInsight(stmt, bufferGetsPerExec, thresholds);
        insights.push(insight);
      }
    }

    return insights;
  }

  /**
   * Analyze inefficient queries with low rows per execution
   *
   * @param topSql - Top SQL data from AWR report
   * @param thresholds - SQL analysis thresholds
   * @returns Insights for inefficient queries
   */
  private analyzeInefficicientQueries(
    topSql: TopSql,
    thresholds: SqlThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const statements = topSql.byElapsedTime ?? [];
    const maxToAnalyze = thresholds.maxStatementsToAnalyze;

    for (const stmt of statements.slice(0, maxToAnalyze)) {
      if (!this.isSignificantStatement(stmt, thresholds)) {
        continue;
      }

      const inefficiencyResult = this.checkInefficiency(stmt, thresholds);
      if (inefficiencyResult.isInefficient) {
        const insight = this.createInefficiencyInsight(stmt, inefficiencyResult);
        insights.push(insight);
      }
    }

    return insights;
  }

  /**
   * Analyze queries with high parse calls
   *
   * @param topSql - Top SQL data from AWR report
   * @param thresholds - SQL analysis thresholds
   * @returns Insights for high parse queries
   */
  private analyzeHighParseQueries(
    topSql: TopSql,
    thresholds: SqlThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const statements = topSql.byParseCalls ?? [];
    const maxToAnalyze = thresholds.maxStatementsToAnalyze;

    for (const stmt of statements.slice(0, maxToAnalyze)) {
      // For parse analysis, we look at the statement's parse call count
      // which may be stored as executions in byParseCalls sorted list
      const parseCalls = stmt.executions ?? 0;

      if (parseCalls >= thresholds.highParseCalls) {
        const insight = this.createHighParseInsight(stmt, parseCalls, thresholds);
        insights.push(insight);
      }
    }

    return insights;
  }

  // ==================== Helper Methods ====================

  /**
   * Check if a statement is significant enough to analyze
   *
   * @param stmt - SQL statement to check
   * @param thresholds - Analysis thresholds
   * @returns True if statement should be analyzed
   */
  private isSignificantStatement(stmt: SqlStatement, thresholds: SqlThresholds): boolean {
    // Must have a minimum DB time percentage to be worth analyzing
    const percentDbTime = stmt.percentDbTime ?? 0;
    return percentDbTime >= thresholds.minDbTimePercent / 2;
  }

  /**
   * Calculate CPU percentage of elapsed time
   *
   * @param stmt - SQL statement
   * @returns CPU time as percentage of elapsed time
   */
  private calculateCpuPercent(stmt: SqlStatement): number {
    const elapsedTime = stmt.elapsedTime ?? 0;
    const cpuTime = stmt.cpuTime ?? 0;

    if (elapsedTime <= 0) {
      return 0;
    }

    return (cpuTime / elapsedTime) * 100;
  }

  /**
   * Calculate disk reads per execution
   *
   * @param stmt - SQL statement
   * @returns Disk reads per execution
   */
  private calculateDiskReadsPerExec(stmt: SqlStatement): number {
    if (stmt.diskReadsPerExec !== undefined) {
      return stmt.diskReadsPerExec;
    }

    const diskReads = stmt.diskReads ?? 0;
    const executions = stmt.executions ?? 1;

    return executions > 0 ? diskReads / executions : diskReads;
  }

  /**
   * Calculate buffer gets per execution
   *
   * @param stmt - SQL statement
   * @returns Buffer gets per execution
   */
  private calculateBufferGetsPerExec(stmt: SqlStatement): number {
    if (stmt.bufferGetsPerExec !== undefined) {
      return stmt.bufferGetsPerExec;
    }

    const bufferGets = stmt.bufferGets ?? 0;
    const executions = stmt.executions ?? 1;

    return executions > 0 ? bufferGets / executions : bufferGets;
  }

  /**
   * Check for query inefficiency (high resources, low output)
   *
   * @param stmt - SQL statement to check
   * @param thresholds - Analysis thresholds
   * @returns Inefficiency check result
   */
  private checkInefficiency(
    stmt: SqlStatement,
    thresholds: SqlThresholds
  ): InefficiencyResult {
    const result: InefficiencyResult = {
      isInefficient: false,
      bufferGetsPerRow: 0,
      rowsPerExec: 0,
    };

    const bufferGetsPerExec = this.calculateBufferGetsPerExec(stmt);
    const rowsPerExec = stmt.rowsProcessedPerExec ?? this.calculateRowsPerExec(stmt);

    result.rowsPerExec = rowsPerExec;

    if (rowsPerExec > 0) {
      result.bufferGetsPerRow = bufferGetsPerExec / rowsPerExec;

      // High buffer gets per row indicates inefficiency
      if (result.bufferGetsPerRow >= thresholds.highBufferGetsPerRow) {
        result.isInefficient = true;
      }
    } else if (bufferGetsPerExec >= thresholds.highBufferGetsPerExec) {
      // Low or no rows returned but high buffer gets
      result.isInefficient = true;
    }

    return result;
  }

  /**
   * Calculate rows processed per execution
   *
   * @param stmt - SQL statement
   * @returns Rows per execution
   */
  private calculateRowsPerExec(stmt: SqlStatement): number {
    const rowsProcessed = stmt.rowsProcessed ?? 0;
    const executions = stmt.executions ?? 1;

    return executions > 0 ? rowsProcessed / executions : rowsProcessed;
  }

  /**
   * Determine severity based on DB time percentage
   *
   * @param percentDbTime - Percentage of DB time
   * @param thresholds - SQL thresholds
   * @returns Appropriate severity level
   */
  private determineSqlSeverity(
    percentDbTime: number,
    thresholds: SqlThresholds
  ): InsightSeverity {
    if (percentDbTime >= thresholds.criticalDbTimePercent) {
      return 'critical';
    }
    if (percentDbTime >= thresholds.minDbTimePercent * 2) {
      return 'warning';
    }
    return 'info';
  }

  // ==================== Insight Creation Methods ====================

  /**
   * Create insight for high DB time query
   *
   * @param stmt - SQL statement
   * @param percentDbTime - Percentage of DB time
   * @param severity - Severity level
   * @returns High DB time insight
   */
  private createHighDbTimeInsight(
    stmt: SqlStatement,
    percentDbTime: number,
    severity: InsightSeverity
  ): AwrInsight {
    const sqlText = this.truncateSql(stmt.sqlText ?? 'N/A');
    const elapsedTime = this.formatTime(stmt.elapsedTime ?? 0);

    return this.createInsight({
      severity,
      category: SQL_CATEGORY,
      title: `High DB Time Query: ${stmt.sqlId}`,
      description: `SQL ID ${stmt.sqlId} consumes ${this.formatNumber(percentDbTime)}% of total ` +
        `DB time (${elapsedTime} elapsed). ${sqlText}`,
      recommendation: this.getHighDbTimeRecommendation(percentDbTime),
      sqlId: stmt.sqlId,
      sqlText: stmt.sqlText,
      fullSqlText: stmt.fullSqlText || stmt.sqlText,
      value: percentDbTime,
      unit: '%',
      threshold: this.config.thresholds.sql.minDbTimePercent,
      percentDbTime,
      impactScore: this.calculateImpactScore(percentDbTime),
      tags: [SQL_TAGS.HIGH_DB_TIME],
      metadata: {
        executions: stmt.executions,
        rawValues: {
          elapsedTime: stmt.elapsedTime ?? 0,
          cpuTime: stmt.cpuTime ?? 0,
          bufferGets: stmt.bufferGets ?? 0,
          diskReads: stmt.diskReads ?? 0,
        },
      },
    });
  }

  /**
   * Create insight for CPU-bound query
   *
   * @param stmt - SQL statement
   * @param cpuPercent - CPU time as percentage of elapsed time
   * @returns CPU-bound insight
   */
  private createCpuBoundInsight(stmt: SqlStatement, cpuPercent: number): AwrInsight {
    const sqlText = this.truncateSql(stmt.sqlText ?? 'N/A');
    const cpuTime = this.formatTime(stmt.cpuTime ?? 0);

    return this.createInsight({
      severity: cpuPercent >= 90 ? 'warning' : 'info',
      category: SQL_CATEGORY,
      title: `CPU-Bound Query: ${stmt.sqlId}`,
      description: `SQL ID ${stmt.sqlId} is CPU-bound with ${this.formatNumber(cpuPercent)}% ` +
        `of elapsed time spent on CPU (${cpuTime}). ${sqlText}`,
      recommendation: 'Review query execution plan for CPU-intensive operations. ' +
        'Consider optimizing calculations, reducing data volume processed, or ' +
        'using parallel execution for large data sets.',
      sqlId: stmt.sqlId,
      sqlText: stmt.sqlText,
      fullSqlText: stmt.fullSqlText || stmt.sqlText,
      value: cpuPercent,
      unit: '%',
      threshold: this.config.thresholds.sql.cpuBoundPercent,
      percentDbTime: stmt.percentDbTime,
      impactScore: this.calculateImpactScore(stmt.percentDbTime ?? 0),
      tags: [SQL_TAGS.CPU_BOUND],
      metadata: {
        executions: stmt.executions,
        rawValues: {
          cpuTime: stmt.cpuTime ?? 0,
          elapsedTime: stmt.elapsedTime ?? 0,
        },
      },
    });
  }

  /**
   * Create insight for I/O-bound query
   *
   * @param stmt - SQL statement
   * @param diskReadsPerExec - Disk reads per execution
   * @param thresholds - SQL thresholds
   * @returns I/O-bound insight
   */
  private createIoBoundInsight(
    stmt: SqlStatement,
    diskReadsPerExec: number,
    thresholds: SqlThresholds
  ): AwrInsight {
    const sqlText = this.truncateSql(stmt.sqlText ?? 'N/A');
    const severity: InsightSeverity =
      diskReadsPerExec >= thresholds.highDiskReadsPerExec * 5 ? 'warning' : 'info';

    return this.createInsight({
      severity,
      category: SQL_CATEGORY,
      title: `I/O-Bound Query: ${stmt.sqlId}`,
      description: `SQL ID ${stmt.sqlId} performs ${this.formatNumber(diskReadsPerExec, 0)} ` +
        `physical reads per execution, indicating heavy disk I/O. ${sqlText}`,
      recommendation: 'Review query for missing indexes or full table scans. ' +
        'Consider adding appropriate indexes, optimizing predicates, or increasing ' +
        'buffer cache if disk I/O is causing performance issues.',
      sqlId: stmt.sqlId,
      sqlText: stmt.sqlText,
      fullSqlText: stmt.fullSqlText || stmt.sqlText,
      value: diskReadsPerExec,
      unit: 'reads/exec',
      threshold: thresholds.highDiskReadsPerExec,
      percentDbTime: stmt.percentDbTime,
      impactScore: this.calculateImpactScore(stmt.percentDbTime ?? 0),
      tags: [SQL_TAGS.IO_BOUND],
      metadata: {
        executions: stmt.executions,
        rawValues: {
          diskReads: stmt.diskReads ?? 0,
          diskReadsPerExec,
        },
      },
    });
  }

  /**
   * Create insight for high buffer gets query
   *
   * @param stmt - SQL statement
   * @param bufferGetsPerExec - Buffer gets per execution
   * @param thresholds - SQL thresholds
   * @returns High buffer gets insight
   */
  private createHighBufferGetsInsight(
    stmt: SqlStatement,
    bufferGetsPerExec: number,
    thresholds: SqlThresholds
  ): AwrInsight {
    const sqlText = this.truncateSql(stmt.sqlText ?? 'N/A');
    const severity: InsightSeverity =
      bufferGetsPerExec >= thresholds.highBufferGetsPerExec * 5 ? 'warning' : 'info';

    return this.createInsight({
      severity,
      category: SQL_CATEGORY,
      title: `High Buffer Gets: ${stmt.sqlId}`,
      description: `SQL ID ${stmt.sqlId} performs ${this.formatNumber(bufferGetsPerExec, 0)} ` +
        `logical reads per execution, consuming significant memory bandwidth. ${sqlText}`,
      recommendation: 'Review query execution plan for inefficient access paths. ' +
        'Consider adding or modifying indexes to reduce buffer gets, or restructure ' +
        'the query to access less data.',
      sqlId: stmt.sqlId,
      sqlText: stmt.sqlText,
      fullSqlText: stmt.fullSqlText || stmt.sqlText,
      value: bufferGetsPerExec,
      unit: 'gets/exec',
      threshold: thresholds.highBufferGetsPerExec,
      percentDbTime: stmt.percentDbTime,
      impactScore: this.calculateImpactScore(stmt.percentDbTime ?? 0),
      tags: [SQL_TAGS.HIGH_BUFFER_GETS],
      metadata: {
        executions: stmt.executions,
        rawValues: {
          bufferGets: stmt.bufferGets ?? 0,
          bufferGetsPerExec,
        },
      },
    });
  }

  /**
   * Create insight for inefficient query
   *
   * @param stmt - SQL statement
   * @param result - Inefficiency check result
   * @returns Inefficiency insight
   */
  private createInefficiencyInsight(
    stmt: SqlStatement,
    result: InefficiencyResult
  ): AwrInsight {
    const sqlText = this.truncateSql(stmt.sqlText ?? 'N/A');

    return this.createInsight({
      severity: 'warning',
      category: SQL_CATEGORY,
      title: `Inefficient Query: ${stmt.sqlId}`,
      description: `SQL ID ${stmt.sqlId} has high resource usage relative to output: ` +
        `${this.formatNumber(result.bufferGetsPerRow, 0)} buffer gets per row returned, ` +
        `${this.formatNumber(result.rowsPerExec, 1)} rows per execution. ${sqlText}`,
      recommendation: 'Review query for opportunities to reduce data processed. ' +
        'Consider adding more selective predicates, creating covering indexes, ' +
        'or restructuring joins to minimize unnecessary data access.',
      sqlId: stmt.sqlId,
      sqlText: stmt.sqlText,
      fullSqlText: stmt.fullSqlText || stmt.sqlText,
      value: result.bufferGetsPerRow,
      unit: 'gets/row',
      threshold: this.config.thresholds.sql.highBufferGetsPerRow,
      percentDbTime: stmt.percentDbTime,
      impactScore: this.calculateImpactScore(stmt.percentDbTime ?? 0),
      tags: [SQL_TAGS.INEFFICIENT],
      metadata: {
        executions: stmt.executions,
        rawValues: {
          bufferGetsPerRow: result.bufferGetsPerRow,
          rowsPerExec: result.rowsPerExec,
        },
      },
    });
  }

  /**
   * Create insight for high parse calls query
   *
   * @param stmt - SQL statement
   * @param parseCalls - Number of parse calls
   * @param thresholds - SQL thresholds
   * @returns High parse calls insight
   */
  private createHighParseInsight(
    stmt: SqlStatement,
    parseCalls: number,
    thresholds: SqlThresholds
  ): AwrInsight {
    const sqlText = this.truncateSql(stmt.sqlText ?? 'N/A');

    return this.createInsight({
      severity: parseCalls >= thresholds.highParseCalls * 5 ? 'warning' : 'info',
      category: 'parse_overhead',
      title: `High Parse Calls: ${stmt.sqlId}`,
      description: `SQL ID ${stmt.sqlId} has ${this.formatNumber(parseCalls, 0)} parse calls, ` +
        `indicating potential cursor management issues. ${sqlText}`,
      recommendation: 'Enable cursor sharing or modify application to use bind variables. ' +
        'Review session cursor cache settings (SESSION_CACHED_CURSORS). ' +
        'Consider using PL/SQL with static SQL for frequently executed statements.',
      sqlId: stmt.sqlId,
      sqlText: stmt.sqlText,
      fullSqlText: stmt.fullSqlText || stmt.sqlText,
      value: parseCalls,
      unit: 'parses',
      threshold: thresholds.highParseCalls,
      impactScore: Math.min(50, Math.round(parseCalls / thresholds.highParseCalls * 10)),
      tags: [SQL_TAGS.HIGH_PARSE],
      metadata: {
        rawValues: {
          parseCalls,
        },
      },
    });
  }

  /**
   * Get recommendation text based on DB time percentage
   *
   * @param percentDbTime - Percentage of DB time
   * @returns Recommendation text
   */
  private getHighDbTimeRecommendation(percentDbTime: number): string {
    if (percentDbTime >= 20) {
      return 'CRITICAL: This query is a primary contributor to database workload. ' +
        'Prioritize immediate investigation. Review execution plan, check for missing ' +
        'indexes, and consider query restructuring or caching strategies.';
    }
    if (percentDbTime >= 10) {
      return 'This query significantly impacts database performance. Review the ' +
        'execution plan for optimization opportunities, check for full table scans, ' +
        'and ensure appropriate indexes exist.';
    }
    return 'Monitor this query for performance trends. Consider reviewing the execution ' +
      'plan and checking for potential index improvements.';
  }
}

// ==================== Types ====================

/**
 * Result from inefficiency check
 */
interface InefficiencyResult {
  /** Whether the query is inefficient */
  isInefficient: boolean;
  /** Buffer gets per row returned */
  bufferGetsPerRow: number;
  /** Rows processed per execution */
  rowsPerExec: number;
}
