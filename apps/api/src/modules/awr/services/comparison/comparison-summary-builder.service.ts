/**
 * Comparison Summary Builder Service
 *
 * Builds comparison summaries and response DTOs.
 * Responsible for:
 * - Creating severity summaries from insights
 * - Building quick comparison summaries
 * - Mapping results to response DTOs
 * - Extracting key metrics and status
 */

import { Injectable } from '@nestjs/common';
import { AwrAnalysis, SeveritySummary } from '../../entities/awr-analysis.entity';
import type { AwrInsight } from '../../types/insights.types';
import type {
  LoadProfileComparisonResult,
} from '../../types/analysis.types';
import {
  ComparisonSummaryDto,
} from '../../dto';

/**
 * Service for building comparison summaries
 */
@Injectable()
export class ComparisonSummaryBuilderService {

  /**
   * Calculate severity summary from insights
   *
   * @param insights - Array of insights
   * @returns Severity summary with counts
   */
  calculateSeveritySummary(insights: AwrInsight[]): SeveritySummary {
    const summary: SeveritySummary = {
      critical: 0,
      warning: 0,
      info: 0,
      total: insights.length,
    };

    for (const insight of insights) {
      switch (insight.severity) {
        case 'critical':
          summary.critical++;
          break;
        case 'warning':
          summary.warning++;
          break;
        case 'info':
          summary.info++;
          break;
      }
    }

    return summary;
  }

  /**
   * Create empty severity summary
   *
   * @returns Empty severity summary
   */
  createEmptySeveritySummary(): SeveritySummary {
    return { critical: 0, warning: 0, info: 0, total: 0 };
  }

  /**
   * Build summary from existing analysis
   *
   * @param analysis - Existing analysis entity
   * @returns Comparison summary DTO
   */
  buildSummaryFromAnalysis(analysis: AwrAnalysis): ComparisonSummaryDto {
    const insights = analysis.insights || [];
    return this.buildSummaryFromInsights(insights);
  }

  /**
   * Build summary from insights with optional load profile data
   *
   * @param insights - Array of insights
   * @param loadProfileComparison - Optional load profile comparison result
   * @returns Comparison summary DTO
   */
  buildSummaryFromInsights(
    insights: AwrInsight[],
    loadProfileComparison?: LoadProfileComparisonResult,
  ): ComparisonSummaryDto {
    let sqlRegressions = 0;
    let sqlImprovements = 0;
    let newSqlStatements = 0;
    let waitEventIncreases = 0;
    let waitEventDecreases = 0;

    for (const insight of insights) {
      const tags = insight.tags || [];
      if (tags.includes('sql-regression')) sqlRegressions++;
      if (tags.includes('sql-improvement')) sqlImprovements++;
      if (tags.includes('sql-new')) newSqlStatements++;
      if (tags.includes('wait-increase')) waitEventIncreases++;
      if (tags.includes('wait-decrease')) waitEventDecreases++;
    }

    // Determine overall status
    let overallStatus: 'improved' | 'regressed' | 'stable' = 'stable';
    if (sqlRegressions > sqlImprovements + newSqlStatements) {
      overallStatus = 'regressed';
    } else if (sqlImprovements > sqlRegressions) {
      overallStatus = 'improved';
    }

    const summary: ComparisonSummaryDto = {
      sqlRegressions,
      sqlImprovements,
      newSqlStatements,
      waitEventIncreases,
      waitEventDecreases,
      overallStatus,
    };

    // Add load profile metrics if available
    if (loadProfileComparison?.highlights) {
      summary.dbTimeChangePercent = loadProfileComparison.highlights.dbTimeChange;
      summary.transactionRateChangePercent = loadProfileComparison.highlights.transactionRateChange;
    }

    return summary;
  }
}
