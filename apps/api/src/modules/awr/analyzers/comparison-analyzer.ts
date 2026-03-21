/**
 * Comparison Analyzer for AWR Reports (Orchestrator)
 *
 * Orchestrates comparison analysis between two AWR reports (current vs baseline).
 * Delegates to specialized analyzers for different comparison types:
 * - SQL statement comparisons (SqlComparisonAnalyzer)
 * - Wait event comparisons (WaitEventComparisonAnalyzer)
 * - Load profile metric comparisons (LoadProfileComparisonAnalyzer)
 *
 * @example
 * const analyzer = new ComparisonAnalyzer(config);
 * const insights = analyzer.compareReports(currentData, baselineData);
 */

import type { ParsedAwrData } from '../types/awr-data.types';
import type { AwrInsight, InsightCategory } from '../types/insights.types';
import type { ComparisonAnalysisInput } from '../types/analysis.types';
import type { AwrAnalysisConfig } from '../config/awr-analysis.config';
import { BaseAwrAnalyzer, type AnalyzerOptions } from './base-analyzer';
import {
  SqlComparisonAnalyzer,
  WaitEventComparisonAnalyzer,
  LoadProfileComparisonAnalyzer,
} from './comparison';

/**
 * Orchestrator for comparing two AWR reports to detect regressions and improvements
 *
 * Compares current report against a baseline to identify:
 * - SQL statements with degraded or improved performance
 * - New SQL statements that weren't in baseline
 * - Wait events with significant increases or decreases
 * - Load profile metric changes
 */
export class ComparisonAnalyzer extends BaseAwrAnalyzer {
  private readonly sqlAnalyzer: SqlComparisonAnalyzer;
  private readonly waitEventAnalyzer: WaitEventComparisonAnalyzer;
  private readonly loadProfileAnalyzer: LoadProfileComparisonAnalyzer;

  /**
   * Create a new Comparison Analyzer
   *
   * @param config - Analysis configuration with comparison thresholds
   * @param options - Optional analyzer behavior settings
   */
  constructor(config: AwrAnalysisConfig, options: AnalyzerOptions = {}) {
    super(config, options);

    // Initialize specialized analyzers
    this.sqlAnalyzer = new SqlComparisonAnalyzer(config, options);
    this.waitEventAnalyzer = new WaitEventComparisonAnalyzer(config, options);
    this.loadProfileAnalyzer = new LoadProfileComparisonAnalyzer(config, options);
  }

  /**
   * Get the analyzer name
   *
   * @returns Analyzer name for logging and identification
   */
  getName(): string {
    return 'ComparisonAnalyzer';
  }

  /**
   * Get the primary insight category
   *
   * @returns Regression category (comparison produces both regression and improvement)
   */
  getCategory(): InsightCategory {
    return 'regression';
  }

  /**
   * Standard analyze method - not applicable for comparison analysis
   *
   * Use compareReports() instead for comparison analysis.
   *
   * @param _data - Parsed AWR data (unused)
   * @returns Empty array - use compareReports() instead
   */
  analyze(_data: ParsedAwrData): AwrInsight[] {
    this.debug('analyze() called on ComparisonAnalyzer - use compareReports() instead');
    return [];
  }

  /**
   * Compare two AWR reports and generate insights for regressions and improvements
   *
   * Delegates to specialized analyzers for each comparison type and combines results.
   *
   * @param currentData - Current AWR report data
   * @param baselineData - Baseline AWR report data for comparison
   * @returns Array of comparison insights (regressions and improvements)
   */
  compareReports(currentData: ParsedAwrData, baselineData: ParsedAwrData): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const comparisonThresholds = this.config.thresholds.comparison;

    // Delegate to specialized analyzers
    insights.push(
      ...this.sqlAnalyzer.compareSqlStatements(currentData, baselineData, comparisonThresholds)
    );

    insights.push(
      ...this.waitEventAnalyzer.compareWaitEvents(currentData, baselineData, comparisonThresholds)
    );

    insights.push(
      ...this.loadProfileAnalyzer.compareLoadProfile(currentData, baselineData, comparisonThresholds)
    );

    // Sort by impact score descending
    insights.sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0));

    this.debug(`Generated ${insights.length} comparison insights`);
    return insights;
  }

  /**
   * Compare reports using input structure (for service integration)
   *
   * @param input - Comparison analysis input with both reports
   * @returns Array of comparison insights
   */
  compareFromInput(input: ComparisonAnalysisInput): AwrInsight[] {
    return this.compareReports(input.currentData, input.baselineData);
  }
}
