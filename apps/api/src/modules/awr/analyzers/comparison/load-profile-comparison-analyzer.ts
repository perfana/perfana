/**
 * Load Profile Comparison Analyzer
 *
 * Analyzes load profile metric changes between current and baseline AWR reports:
 * - Per-second metrics (DB time, CPU, I/O, transactions, etc.)
 * - Per-transaction metrics
 * - Identifies increases (potential issues) and decreases (improvements)
 */

import type {
  ParsedAwrData,
  LoadProfile,
} from '../../types/awr-data.types';
import type { AwrInsight, InsightCategory } from '../../types/insights.types';
import type {
  LoadProfileMetricComparison,
  ChangeDirection,
} from '../../types/analysis.types';
import type { ComparisonThresholds } from '../../config/awr-analysis.config';
import { BaseAwrAnalyzer } from '../base-analyzer';

/** Tags for load profile comparison insight types */
const LOAD_PROFILE_TAGS = {
  METRIC_INCREASE: 'metric-increase',
  METRIC_DECREASE: 'metric-decrease',
} as const;

/**
 * Analyzer for load profile metric comparisons between reports
 */
export class LoadProfileComparisonAnalyzer extends BaseAwrAnalyzer {
  /**
   * Get the analyzer name
   */
  getName(): string {
    return 'LoadProfileComparisonAnalyzer';
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
   * Compare load profile metrics between current and baseline reports
   *
   * @param current - Current AWR data
   * @param baseline - Baseline AWR data
   * @param thresholds - Comparison thresholds
   * @returns Load profile comparison insights
   */
  compareLoadProfile(
    current: ParsedAwrData,
    baseline: ParsedAwrData,
    thresholds: ComparisonThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    const currentProfile = current.loadProfile;
    const baselineProfile = baseline.loadProfile;

    if (!currentProfile || !baselineProfile) {
      return insights;
    }

    const comparisons = this.buildLoadProfileComparisons(currentProfile, baselineProfile);

    for (const comparison of comparisons) {
      if (this.isSignificantLoadProfileChange(comparison, thresholds)) {
        insights.push(this.createLoadProfileInsight(comparison, thresholds));
      }
    }

    return insights;
  }

  /**
   * Build load profile metric comparisons
   *
   * @param current - Current load profile
   * @param baseline - Baseline load profile
   * @returns Array of metric comparisons
   */
  private buildLoadProfileComparisons(
    current: LoadProfile,
    baseline: LoadProfile
  ): LoadProfileMetricComparison[] {
    const comparisons: LoadProfileMetricComparison[] = [];

    // Per-second metrics
    const metricsToCompare = [
      { name: 'DB Time (per sec)', current: current.dbTimePerSecond, baseline: baseline.dbTimePerSecond, unit: 's/s' },
      { name: 'DB CPU (per sec)', current: current.dbCpuPerSecond, baseline: baseline.dbCpuPerSecond, unit: 's/s' },
      { name: 'Logical Reads (per sec)', current: current.logicalReadsPerSecond, baseline: baseline.logicalReadsPerSecond, unit: '/s' },
      { name: 'Physical Reads (per sec)', current: current.physicalReadsPerSecond, baseline: baseline.physicalReadsPerSecond, unit: '/s' },
      { name: 'Physical Writes (per sec)', current: current.physicalWritesPerSecond, baseline: baseline.physicalWritesPerSecond, unit: '/s' },
      { name: 'Hard Parses (per sec)', current: current.hardParsesPerSecond, baseline: baseline.hardParsesPerSecond, unit: '/s' },
      { name: 'Transactions (per sec)', current: current.transactionsPerSecond, baseline: baseline.transactionsPerSecond, unit: '/s' },
      { name: 'Redo Size (per sec)', current: current.redoSizePerSecond, baseline: baseline.redoSizePerSecond, unit: 'bytes/s' },
    ];

    for (const metric of metricsToCompare) {
      if (metric.current !== undefined && metric.baseline !== undefined) {
        const delta = metric.current - metric.baseline;
        const deltaPercent = this.calculatePercentChange(metric.current, metric.baseline) ?? 0;

        let changeDirection: ChangeDirection = 'unchanged';
        if (deltaPercent > 10) changeDirection = 'regressed';
        if (deltaPercent < -10) changeDirection = 'improved';

        comparisons.push({
          name: metric.name,
          currentValue: metric.current,
          baselineValue: metric.baseline,
          delta,
          deltaPercent,
          changeDirection,
          unit: metric.unit,
        });
      }
    }

    // Add per-transaction metrics if available from metrics array
    if (current.metrics && baseline.metrics && current.metrics.length > 0 && baseline.metrics.length > 0) {
      const currentMetricsMap = new Map(current.metrics.map(m => [m.name.toLowerCase(), m]));
      const baselineMetricsMap = new Map(baseline.metrics.map(m => [m.name.toLowerCase(), m]));

      // Compare key per-transaction metrics
      const perTransactionMetrics = [
        'db time(s)',
        'db cpu(s)',
        'logical reads',
        'physical reads',
        'physical writes',
        'hard parses',
        'redo size',
      ];

      for (const metricName of perTransactionMetrics) {
        const currentMetric = currentMetricsMap.get(metricName);
        const baselineMetric = baselineMetricsMap.get(metricName);

        if (currentMetric && baselineMetric &&
            currentMetric.perTransaction !== undefined &&
            baselineMetric.perTransaction !== undefined) {
          const delta = currentMetric.perTransaction - baselineMetric.perTransaction;
          const deltaPercent = this.calculatePercentChange(
            currentMetric.perTransaction,
            baselineMetric.perTransaction
          ) ?? 0;

          let changeDirection: ChangeDirection = 'unchanged';
          if (deltaPercent > 10) changeDirection = 'regressed';
          if (deltaPercent < -10) changeDirection = 'improved';

          const displayName = currentMetric.name.replace(/\(s\)/, '').trim() + ' (per txn)';

          comparisons.push({
            name: displayName,
            currentValue: currentMetric.perTransaction,
            baselineValue: baselineMetric.perTransaction,
            delta,
            deltaPercent,
            changeDirection,
            unit: currentMetric.unit || '/txn',
          });
        }
      }
    }

    return comparisons;
  }

  /**
   * Check if load profile change is significant
   *
   * @param comparison - Load profile metric comparison
   * @param thresholds - Comparison thresholds
   * @returns True if significant
   */
  private isSignificantLoadProfileChange(
    comparison: LoadProfileMetricComparison,
    thresholds: ComparisonThresholds
  ): boolean {
    const absChange = Math.abs(comparison.deltaPercent);
    return absChange >= thresholds.significantRegressionPercent;
  }

  /**
   * Create insight for load profile metric change
   */
  private createLoadProfileInsight(
    comparison: LoadProfileMetricComparison,
    thresholds: ComparisonThresholds
  ): AwrInsight {
    const isIncrease = comparison.deltaPercent > 0;
    const category: InsightCategory = isIncrease ? 'regression' : 'improvement';
    const tag = isIncrease ? LOAD_PROFILE_TAGS.METRIC_INCREASE : LOAD_PROFILE_TAGS.METRIC_DECREASE;

    const severity = isIncrease
      ? this.determineSeverityByChange(comparison.deltaPercent)
      : 'info';

    return this.createInsight({
      severity,
      category,
      title: `Load Profile Change: ${comparison.name}`,
      description:
        `${comparison.name} ${isIncrease ? 'increased' : 'decreased'} by ` +
        `${this.formatNumber(Math.abs(comparison.deltaPercent))}% ` +
        `(${this.formatNumber(comparison.baselineValue)} → ${this.formatNumber(comparison.currentValue)} ${comparison.unit}).`,
      recommendation: isIncrease
        ? `Investigate the increase in ${comparison.name} metric to identify root cause.`
        : `Improvement in ${comparison.name} metric. Continue monitoring.`,
      value: comparison.deltaPercent,
      unit: '%',
      threshold: thresholds.significantRegressionPercent,
      impactScore: Math.abs(comparison.deltaPercent) / 4,
      isComparison: true,
      baselineValue: comparison.baselineValue,
      changePercent: comparison.deltaPercent,
      tags: [tag],
      metadata: {
        source: this.getName(),
        rawValues: {
          currentValue: comparison.currentValue,
          baselineValue: comparison.baselineValue,
          delta: comparison.delta,
        },
      },
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
}
