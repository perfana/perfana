/**
 * Load Profile Comparison Builder Service
 *
 * Builds load profile metric comparisons between two AWR reports.
 * Responsible for:
 * - Comparing load profile metrics (DB Time, CPU, I/O, etc.)
 * - Identifying largest increases and decreases
 * - Highlighting key performance indicators
 */

import { Injectable } from '@nestjs/common';
import { ParsedAwrData } from '../../entities/awr-report.entity';
import { AwrAnalysisConfig } from '../../config/awr-analysis.config';
import type {
  LoadProfileComparisonResult,
  LoadProfileMetricComparison,
  ChangeDirection,
} from '../../types/analysis.types';
import type { LoadProfile } from '../../types/awr-data.types';

/**
 * Service for building load profile comparison results
 */
@Injectable()
export class LoadProfileComparisonBuilderService {

  /**
   * Build load profile comparison result
   *
   * @param currentData - Current report parsed data
   * @param baselineData - Baseline report parsed data
   * @param config - Analysis configuration
   * @returns Load profile comparison with metrics and highlights
   */
  buildLoadProfileComparison(
    currentData: ParsedAwrData,
    baselineData: ParsedAwrData,
    _config: AwrAnalysisConfig,
  ): LoadProfileComparisonResult {
    const currentProfile = currentData.loadProfile;
    const baselineProfile = baselineData.loadProfile;

    const metrics: LoadProfileMetricComparison[] = [];

    if (currentProfile && baselineProfile) {
      const metricsToCompare = this.getLoadProfileMetrics(currentProfile, baselineProfile);
      metrics.push(...metricsToCompare);
    }

    // Sort by absolute delta percent
    const sortedMetrics = [...metrics].sort(
      (a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent),
    );

    const largestIncreases = sortedMetrics.filter((m) => m.deltaPercent > 0).slice(0, 5);

    const largestDecreases = sortedMetrics.filter((m) => m.deltaPercent < 0).slice(0, 5);

    const dbTimeMetric = metrics.find((m) => m.name === 'DB Time');
    const txRateMetric = metrics.find((m) => m.name === 'Transactions');

    return {
      metrics,
      highlights: {
        largestIncreases,
        largestDecreases,
        dbTimeChange: dbTimeMetric?.deltaPercent,
        transactionRateChange: txRateMetric?.deltaPercent,
      },
    };
  }

  /**
   * Get load profile metric comparisons
   */
  private getLoadProfileMetrics(
    current: LoadProfile,
    baseline: LoadProfile,
  ): LoadProfileMetricComparison[] {
    const metricsToCompare = [
      {
        name: 'DB Time',
        current: current.dbTimePerSecond,
        baseline: baseline.dbTimePerSecond,
        unit: 's/s',
      },
      {
        name: 'DB CPU',
        current: current.dbCpuPerSecond,
        baseline: baseline.dbCpuPerSecond,
        unit: 's/s',
      },
      {
        name: 'Logical Reads',
        current: current.logicalReadsPerSecond,
        baseline: baseline.logicalReadsPerSecond,
        unit: '/s',
      },
      {
        name: 'Physical Reads',
        current: current.physicalReadsPerSecond,
        baseline: baseline.physicalReadsPerSecond,
        unit: '/s',
      },
      {
        name: 'Physical Writes',
        current: current.physicalWritesPerSecond,
        baseline: baseline.physicalWritesPerSecond,
        unit: '/s',
      },
      {
        name: 'Hard Parses',
        current: current.hardParsesPerSecond,
        baseline: baseline.hardParsesPerSecond,
        unit: '/s',
      },
      {
        name: 'Transactions',
        current: current.transactionsPerSecond,
        baseline: baseline.transactionsPerSecond,
        unit: '/s',
      },
      {
        name: 'Redo Size',
        current: current.redoSizePerSecond,
        baseline: baseline.redoSizePerSecond,
        unit: 'bytes/s',
      },
    ];

    const metrics: LoadProfileMetricComparison[] = [];

    for (const metric of metricsToCompare) {
      if (metric.current !== undefined && metric.baseline !== undefined) {
        const delta = metric.current - metric.baseline;
        const deltaPercent = this.calcPercentChange(metric.current, metric.baseline) ?? 0;

        let changeDirection: ChangeDirection = 'unchanged';
        if (deltaPercent > 10) changeDirection = 'regressed';
        if (deltaPercent < -10) changeDirection = 'improved';

        metrics.push({
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

    return metrics;
  }

  /**
   * Calculate percentage change
   */
  private calcPercentChange(current?: number, baseline?: number): number | undefined {
    if (current === undefined || baseline === undefined) return undefined;
    if (baseline === 0) return current > 0 ? 100 : 0;
    return ((current - baseline) / Math.abs(baseline)) * 100;
  }
}
