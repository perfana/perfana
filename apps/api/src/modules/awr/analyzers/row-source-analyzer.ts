/**
 * Row Source Analyzer
 *
 * Analyzes ASH SQL data (Top SQL with Top Events and Top Row Sources) to identify
 * inefficient execution plan operations and generate actionable insights.
 *
 * Key analysis areas:
 * - Full table scans (TABLE ACCESS FULL)
 * - Inefficient index operations (INDEX SKIP SCAN, INDEX FULL SCAN)
 * - Join method inefficiencies (HASH JOIN, NESTED LOOPS)
 * - Sort and temp space operations
 * - Row source operations consuming significant DB time
 *
 * Based on Oracle best practices and AWR analysis guidelines.
 */

import type { ParsedAwrData } from '../types/awr-data.types';
import type {
  TopSqlWithEvent,
  TopSqlWithRowSource,
} from '../parsers/sections/ash-sql-parser';
import type { AwrInsight, InsightSeverity, InsightCategory } from '../types/insights.types';
import { BaseAwrAnalyzer } from './base-analyzer';
import type { AwrAnalysisConfig } from '../config/awr-analysis.config';
import type { AnalyzerOptions } from './base-analyzer';

// ==================== Constants ====================

/**
 * Thresholds for row source analysis
 */
interface RowSourceThresholds {
  /** Minimum % of DB time to consider significant (default: 2%) */
  minDbTimePercent: number;
  /** % of DB time threshold for critical severity (default: 10%) */
  criticalDbTimePercent: number;
  /** % of DB time threshold for warning severity (default: 5%) */
  warningDbTimePercent: number;
  /** Minimum % activity for a SQL to be analyzed (default: 1%) */
  minSqlActivityPercent: number;
}

const DEFAULT_THRESHOLDS: RowSourceThresholds = {
  minDbTimePercent: 2.0,
  criticalDbTimePercent: 10.0,
  warningDbTimePercent: 5.0,
  minSqlActivityPercent: 1.0,
};

/**
 * Row source operation categories and their characteristics
 */
enum RowSourceCategory {
  FULL_TABLE_SCAN = 'full_table_scan',
  INDEX_INEFFICIENT = 'index_inefficient',
  JOIN_OPERATION = 'join_operation',
  SORT_OPERATION = 'sort_operation',
  OTHER = 'other',
}

/**
 * Row source operation metadata
 */
interface RowSourceMetadata {
  category: RowSourceCategory;
  isInefficient: boolean;
  recommendedAction: string;
  explanation: string;
}

/**
 * Map of row source operations to their metadata
 */
const ROW_SOURCE_METADATA: Record<string, RowSourceMetadata> = {
  'TABLE ACCESS FULL': {
    category: RowSourceCategory.FULL_TABLE_SCAN,
    isInefficient: true,
    recommendedAction: 'Consider adding appropriate indexes or partitioning the table',
    explanation: 'Full table scan reads entire table sequentially, which is inefficient for large tables',
  },
  'TABLE ACCESS - FULL': {
    category: RowSourceCategory.FULL_TABLE_SCAN,
    isInefficient: true,
    recommendedAction: 'Consider adding appropriate indexes or partitioning the table',
    explanation: 'Full table scan reads entire table sequentially, which is inefficient for large tables',
  },
  'INDEX SKIP SCAN': {
    category: RowSourceCategory.INDEX_INEFFICIENT,
    isInefficient: true,
    recommendedAction: 'Consider creating a more selective index or rewriting the query predicate',
    explanation: 'Index skip scan is less efficient than a regular index range scan',
  },
  'INDEX - SKIP SCAN': {
    category: RowSourceCategory.INDEX_INEFFICIENT,
    isInefficient: true,
    recommendedAction: 'Consider creating a more selective index or rewriting the query predicate',
    explanation: 'Index skip scan is less efficient than a regular index range scan',
  },
  'INDEX FULL SCAN': {
    category: RowSourceCategory.INDEX_INEFFICIENT,
    isInefficient: true,
    recommendedAction: 'Consider more selective predicates or a covering index',
    explanation: 'Index full scan reads entire index, similar to table full scan',
  },
  'INDEX - FULL SCAN': {
    category: RowSourceCategory.INDEX_INEFFICIENT,
    isInefficient: true,
    recommendedAction: 'Consider more selective predicates or a covering index',
    explanation: 'Index full scan reads entire index, similar to table full scan',
  },
  'HASH JOIN': {
    category: RowSourceCategory.JOIN_OPERATION,
    isInefficient: false,
    recommendedAction: 'Hash join is efficient for large datasets, but verify PGA memory allocation',
    explanation: 'Hash join builds hash table in memory, efficient for large equijoins',
  },
  'NESTED LOOPS': {
    category: RowSourceCategory.JOIN_OPERATION,
    isInefficient: true,
    recommendedAction: 'Nested loops can be inefficient for large datasets - consider hash or merge join',
    explanation: 'Nested loops join performs full scan for each row in outer table',
  },
  'SORT': {
    category: RowSourceCategory.SORT_OPERATION,
    isInefficient: true,
    recommendedAction: 'Consider adding index to eliminate sort or increasing PGA memory',
    explanation: 'Sort operations consume CPU and memory, especially for large datasets',
  },
  'SORT ORDER BY': {
    category: RowSourceCategory.SORT_OPERATION,
    isInefficient: true,
    recommendedAction: 'Consider adding index on ORDER BY columns to eliminate sort',
    explanation: 'ORDER BY sort can be eliminated with appropriate index',
  },
  'SORT GROUP BY': {
    category: RowSourceCategory.SORT_OPERATION,
    isInefficient: true,
    recommendedAction: 'Consider adding index on GROUP BY columns or using HASH GROUP BY',
    explanation: 'GROUP BY sort can be eliminated with appropriate index or hash aggregation',
  },
};

/**
 * Row source operations grouped by SQL ID
 */
interface SqlRowSources {
  sqlId: string;
  sqlText?: string;
  planHashValue?: number;
  totalActivityPercent?: number;
  rowSources: Array<{
    operation: string;
    percentRowSource?: number;
    topEvent?: string;
    percentEvent?: number;
    metadata?: RowSourceMetadata;
  }>;
}

// ==================== Analyzer Class ====================

/**
 * Analyzer for ASH SQL row source operations
 *
 * Examines execution plan operations to identify inefficiencies like:
 * - Full table scans that should use indexes
 * - Inefficient index usage patterns
 * - Suboptimal join methods
 * - Excessive sorting operations
 */
export class RowSourceAnalyzer extends BaseAwrAnalyzer {
  private thresholds: RowSourceThresholds = DEFAULT_THRESHOLDS;

  constructor(config: AwrAnalysisConfig, options: AnalyzerOptions = {}) {
    super(config, options);
  }

  getName(): string {
    return 'Row Source Analyzer';
  }

  getCategory(): InsightCategory {
    return 'sql_performance';
  }

  /**
   * Analyze parsed AWR data for row source inefficiencies
   */
  analyze(data: ParsedAwrData): AwrInsight[] {
    const ashSql = data.ashSql;
    if (!ashSql) {
      return [];
    }

    const insights: AwrInsight[] = [];
    // Use the full SQL text from Top SQL parser's sqlTextById
    const sqlTextMap = data.topSql?.sqlTextById || {};

    // Analyze Top SQL with Top Row Sources (most detailed)
    if (ashSql.topSqlWithRowSources && ashSql.topSqlWithRowSources.length > 0) {
      insights.push(...this.analyzeRowSources(ashSql.topSqlWithRowSources, sqlTextMap));
    }

    // Analyze Top SQL with Top Events for additional context
    if (ashSql.topSqlWithEvents && ashSql.topSqlWithEvents.length > 0) {
      insights.push(...this.analyzeTopEvents(ashSql.topSqlWithEvents, sqlTextMap));
    }

    return insights;
  }

  /**
   * Analyze Top SQL with Top Row Sources
   *
   * This is the primary source of execution plan insights, showing which
   * row source operations are consuming the most DB time.
   */
  private analyzeRowSources(
    rowSources: TopSqlWithRowSource[],
    sqlTextMap: Record<string, string>,
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    // Group by SQL ID
    const groupedBySql = this.groupRowSourcesBySql(rowSources);

    for (const sqlData of groupedBySql) {
      // Only analyze SQL with significant row source activity
      for (const rs of sqlData.rowSources) {
        const percentRowSource = rs.percentRowSource || 0;

        if (percentRowSource < this.thresholds.minDbTimePercent) {
          continue;
        }

        const metadata = rs.metadata;
        if (!metadata) {
          continue; // Unknown operation
        }

        // Only generate insights for inefficient operations
        if (!metadata.isInefficient) {
          continue;
        }

        // Determine severity based on % of DB time
        const severity = this.determineSeverity(percentRowSource);

        // Calculate impact score
        const impactScore = this.calculateRowSourceImpact(
          percentRowSource,
          sqlData.totalActivityPercent || 0,
        );

        // Get full SQL text from map if available
        const fullSqlText = sqlTextMap[sqlData.sqlId];

        // Build insight
        const insight = this.createInsight({
          severity,
          category: 'io_performance',
          title: `Inefficient Row Source: ${rs.operation} (${sqlData.sqlId})`,
          description: this.buildRowSourceDescription(
            sqlData.sqlId,
            rs.operation,
            percentRowSource,
            rs.topEvent,
            metadata.explanation,
          ),
          recommendation: this.buildRowSourceRecommendation(
            metadata.recommendedAction,
            percentRowSource,
            sqlData.rowSources[0]?.percentEvent, // executions from first row source
          ),
          sqlId: sqlData.sqlId,
          sqlText: sqlData.sqlText, // Truncated from ASH SQL table
          fullSqlText, // Full SQL text from "Complete List of SQL Text"
          percentDbTime: percentRowSource,
          impactScore,
          tags: this.buildRowSourceTags(metadata.category),
          metadata: {
            rawValues: {
              rowSource: rs.operation,
              percentRowSource,
              topEvent: rs.topEvent || '',
              percentEvent: rs.percentEvent || 0,
              planHashValue: sqlData.planHashValue || 0,
            },
          },
        });

        insights.push(insight);
      }
    }

    return insights;
  }

  /**
   * Analyze Top SQL with Top Events
   *
   * Provides additional context about wait events associated with SQL statements.
   * Complements row source analysis.
   */
  private analyzeTopEvents(
    topEvents: TopSqlWithEvent[],
    sqlTextMap: Record<string, string>,
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    for (const event of topEvents) {
      const percentActivity = event.percentActivity || 0;
      const topRowSource = event.topRowSource;

      // Only analyze if there's a significant row source mentioned
      if (!topRowSource || percentActivity < this.thresholds.minSqlActivityPercent) {
        continue;
      }

      // Check if row source is inefficient
      const metadata = this.getRowSourceMetadata(topRowSource);
      if (!metadata || !metadata.isInefficient) {
        continue;
      }

      const percentRowSource = event.percentRowSource || 0;
      if (percentRowSource < this.thresholds.minDbTimePercent) {
        continue;
      }

      // Determine severity
      const severity = this.determineSeverity(percentRowSource);

      // Calculate impact
      const impactScore = this.calculateRowSourceImpact(percentRowSource, percentActivity);

      // Get full SQL text from map if available
      const fullSqlText = sqlTextMap[event.sqlId];

      const insight = this.createInsight({
        severity,
        category: 'wait_events',
        title: `SQL with Inefficient Operation: ${topRowSource} (${event.sqlId})`,
        description: `SQL ${event.sqlId} is experiencing ${event.event} wait event (${event.percentEvent?.toFixed(2)}% of DB time) while performing ${topRowSource} operation. ${metadata.explanation}`,
        recommendation: `${metadata.recommendedAction}. Review wait event '${event.event}' in context of the row source operation.`,
        sqlId: event.sqlId,
        sqlText: event.sqlText, // Truncated from ASH SQL table
        fullSqlText, // Full SQL text from "Complete List of SQL Text"
        waitEvent: event.event,
        percentDbTime: percentActivity,
        impactScore,
        tags: ['ash-analysis', 'wait-event-context', ...this.buildRowSourceTags(metadata.category)],
        metadata: {
          rawValues: {
            topRowSource,
            percentRowSource,
            topEvent: event.event || '',
            percentEvent: event.percentEvent || 0,
            planHashValue: event.planHashValue || 0,
          },
        },
      });

      insights.push(insight);
    }

    return insights;
  }

  // ==================== Helper Methods ====================

  /**
   * Group row sources by SQL ID
   */
  private groupRowSourcesBySql(rowSources: TopSqlWithRowSource[]): SqlRowSources[] {
    const grouped = new Map<string, SqlRowSources>();

    for (const rs of rowSources) {
      if (!grouped.has(rs.sqlId)) {
        grouped.set(rs.sqlId, {
          sqlId: rs.sqlId,
          sqlText: rs.sqlText,
          planHashValue: rs.planHashValue,
          totalActivityPercent: rs.percentActivity,
          rowSources: [],
        });
      }

      const sqlData = grouped.get(rs.sqlId)!;

      // Capture SQL text from first entry if not already set
      if (!sqlData.sqlText && rs.sqlText) {
        sqlData.sqlText = rs.sqlText;
      }

      sqlData.rowSources.push({
        operation: rs.rowSource || 'UNKNOWN',
        percentRowSource: rs.percentRowSource,
        topEvent: rs.topEvent,
        percentEvent: rs.percentEvent,
        metadata: this.getRowSourceMetadata(rs.rowSource || ''),
      });
    }

    return Array.from(grouped.values());
  }

  /**
   * Get metadata for a row source operation
   */
  private getRowSourceMetadata(operation: string): RowSourceMetadata | undefined {
    // Normalize operation name (remove extra spaces, convert to uppercase)
    const normalized = operation.trim().toUpperCase();

    // Try exact match first
    if (ROW_SOURCE_METADATA[normalized]) {
      return ROW_SOURCE_METADATA[normalized];
    }

    // Try partial match (contains key)
    for (const [key, metadata] of Object.entries(ROW_SOURCE_METADATA)) {
      if (normalized.includes(key)) {
        return metadata;
      }
    }

    return undefined;
  }

  /**
   * Determine severity based on % DB time
   */
  private determineSeverity(percentDbTime: number): InsightSeverity {
    if (percentDbTime >= this.thresholds.criticalDbTimePercent) {
      return 'critical';
    }
    if (percentDbTime >= this.thresholds.warningDbTimePercent) {
      return 'warning';
    }
    return 'info';
  }

  /**
   * Calculate impact score for row source insight
   *
   * Combines % of DB time from row source with overall SQL activity
   */
  private calculateRowSourceImpact(
    percentRowSource: number,
    percentSqlActivity: number,
  ): number {
    // Weight row source percentage more heavily (60%) than SQL activity (40%)
    const weighted = percentRowSource * 0.6 + percentSqlActivity * 0.4;
    return Math.min(100, Math.round(weighted * 2));
  }

  /**
   * Build description for row source insight
   */
  private buildRowSourceDescription(
    sqlId: string,
    operation: string,
    percentRowSource: number,
    topEvent?: string,
    explanation?: string,
  ): string {
    let description = `SQL ${sqlId} is using ${operation} operation consuming ${percentRowSource.toFixed(2)}% of DB time.`;

    if (explanation) {
      description += ` ${explanation}.`;
    }

    if (topEvent) {
      description += ` Top wait event: ${topEvent}`;
    }

    return description;
  }

  /**
   * Build recommendation for row source insight
   */
  private buildRowSourceRecommendation(
    recommendedAction: string,
    percentRowSource: number,
    executions?: number,
  ): string {
    let recommendation = recommendedAction;

    recommendation += `. This operation is consuming ${percentRowSource.toFixed(2)}% of total DB time`;

    if (executions) {
      recommendation += ` across ${executions} executions`;
    }

    recommendation += '. Review the execution plan using EXPLAIN PLAN or DBMS_XPLAN.DISPLAY. Check table and index statistics are up-to-date using DBMS_STATS.';

    return recommendation;
  }

  /**
   * Build tags for row source insight
   */
  private buildRowSourceTags(category: RowSourceCategory): string[] {
    const tags = ['ash-analysis', 'execution-plan'];

    switch (category) {
      case RowSourceCategory.FULL_TABLE_SCAN:
        tags.push('full-table-scan');
        break;
      case RowSourceCategory.INDEX_INEFFICIENT:
        tags.push('inefficient-index');
        break;
      case RowSourceCategory.JOIN_OPERATION:
        tags.push('join-operation');
        break;
      case RowSourceCategory.SORT_OPERATION:
        tags.push('sort-operation');
        break;
    }

    return tags;
  }
}
