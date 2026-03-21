/**
 * Wait Event Comparison Analyzer
 *
 * Analyzes wait event changes between current and baseline AWR reports:
 * - Wait time increases (potential regressions)
 * - Wait time decreases (improvements)
 * - Includes context-aware recommendations based on wait class
 */

import type {
  ParsedAwrData,
  WaitEvent,
  WaitEvents,
} from '../../types/awr-data.types';
import type { AwrInsight, InsightCategory } from '../../types/insights.types';
import type {
  WaitEventComparison,
  WaitEventMetrics,
  WaitEventDelta,
  ChangeDirection,
} from '../../types/analysis.types';
import type { ComparisonThresholds } from '../../config/awr-analysis.config';
import { BaseAwrAnalyzer } from '../base-analyzer';

/** Tags for wait event comparison insight types */
const WAIT_COMPARISON_TAGS = {
  INCREASE: 'wait-increase',
  DECREASE: 'wait-decrease',
} as const;

/**
 * Analyzer for wait event comparisons between reports
 */
export class WaitEventComparisonAnalyzer extends BaseAwrAnalyzer {
  /**
   * Get the analyzer name
   */
  getName(): string {
    return 'WaitEventComparisonAnalyzer';
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
   * Compare wait events between current and baseline reports
   *
   * @param current - Current AWR data
   * @param baseline - Baseline AWR data
   * @param thresholds - Comparison thresholds
   * @returns Wait event comparison insights
   */
  compareWaitEvents(
    current: ParsedAwrData,
    baseline: ParsedAwrData,
    thresholds: ComparisonThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    const currentEvents = this.getWaitEventMap(current.waitEvents);
    const baselineEvents = this.getWaitEventMap(baseline.waitEvents);

    for (const [eventName, currentEvent] of currentEvents) {
      const baselineEvent = baselineEvents.get(eventName);

      if (baselineEvent) {
        const comparison = this.compareWaitEvent(currentEvent, baselineEvent);

        if (this.isSignificantWaitIncrease(comparison, thresholds)) {
          insights.push(this.createWaitIncreaseInsight(comparison, thresholds));
        } else if (this.isSignificantWaitDecrease(comparison, thresholds)) {
          insights.push(this.createWaitDecreaseInsight(comparison, thresholds));
        }
      }
    }

    return insights;
  }

  /**
   * Create map of wait events by event name
   *
   * @param waitEvents - WaitEvents data from parsed AWR
   * @returns Map of event name to wait event
   */
  private getWaitEventMap(waitEvents?: WaitEvents): Map<string, WaitEvent> {
    const map = new Map<string, WaitEvent>();

    if (!waitEvents) {
      return map;
    }

    const sources = [waitEvents.foreground, waitEvents.topEvents, waitEvents.background];

    for (const events of sources) {
      if (!events) continue;
      for (const event of events) {
        if (!map.has(event.event)) {
          map.set(event.event, event);
        }
      }
    }

    return map;
  }

  /**
   * Compare individual wait event metrics
   *
   * @param current - Current wait event
   * @param baseline - Baseline wait event
   * @returns Wait event comparison data
   */
  private compareWaitEvent(current: WaitEvent, baseline: WaitEvent): WaitEventComparison {
    const currentMetrics = this.extractWaitEventMetrics(current);
    const baselineMetrics = this.extractWaitEventMetrics(baseline);
    const deltaPercent = this.calculateWaitEventDelta(currentMetrics, baselineMetrics);

    const waitTimeChange = deltaPercent.totalWaitTime ?? 0;
    let changeDirection: ChangeDirection = 'unchanged';
    if (waitTimeChange > 10) changeDirection = 'regressed';
    if (waitTimeChange < -10) changeDirection = 'improved';

    return {
      event: current.event,
      waitClass: current.waitClass,
      changeDirection,
      current: currentMetrics,
      baseline: baselineMetrics,
      deltaPercent,
      isSignificantIncrease: false,
      isSignificantDecrease: false,
    };
  }

  /**
   * Extract comparable metrics from wait event
   *
   * @param event - Wait event
   * @returns Wait event metrics for comparison
   */
  private extractWaitEventMetrics(event: WaitEvent): WaitEventMetrics {
    return {
      totalWaitTime: event.totalWaitTime,
      waits: event.waits,
      avgWaitMs: event.avgWaitMs,
      percentDbTime: event.percentDbTime,
    };
  }

  /**
   * Calculate percentage deltas between wait event metrics
   *
   * @param current - Current metrics
   * @param baseline - Baseline metrics
   * @returns Percentage deltas
   */
  private calculateWaitEventDelta(
    current: WaitEventMetrics,
    baseline: WaitEventMetrics
  ): WaitEventDelta {
    return {
      totalWaitTime: this.calculatePercentChange(current.totalWaitTime, baseline.totalWaitTime),
      waits: this.calculatePercentChange(current.waits, baseline.waits),
      avgWaitMs: this.calculatePercentChange(current.avgWaitMs, baseline.avgWaitMs),
    };
  }

  /**
   * Check if wait event comparison represents a significant increase
   *
   * @param comparison - Wait event comparison data
   * @param thresholds - Comparison thresholds
   * @returns True if significant increase
   */
  private isSignificantWaitIncrease(
    comparison: WaitEventComparison,
    thresholds: ComparisonThresholds
  ): boolean {
    const waitTimeChange = comparison.deltaPercent.totalWaitTime ?? 0;
    const waitTimeIncrease =
      (comparison.current.totalWaitTime ?? 0) - (comparison.baseline?.totalWaitTime ?? 0);

    const meetsPercentThreshold = waitTimeChange >= thresholds.significantRegressionPercent;
    const meetsAbsoluteThreshold = waitTimeIncrease >= thresholds.minWaitTimeIncreaseSeconds;

    return meetsPercentThreshold || meetsAbsoluteThreshold;
  }

  /**
   * Check if wait event comparison represents a significant decrease
   *
   * @param comparison - Wait event comparison data
   * @param thresholds - Comparison thresholds
   * @returns True if significant decrease
   */
  private isSignificantWaitDecrease(
    comparison: WaitEventComparison,
    thresholds: ComparisonThresholds
  ): boolean {
    const waitTimeChange = comparison.deltaPercent.totalWaitTime ?? 0;
    return waitTimeChange <= -thresholds.significantImprovementPercent;
  }

  /**
   * Create insight for wait event increase
   */
  private createWaitIncreaseInsight(
    comparison: WaitEventComparison,
    thresholds: ComparisonThresholds
  ): AwrInsight {
    const changePercent = comparison.deltaPercent.totalWaitTime ?? 0;
    const severity = this.determineSeverityByChange(changePercent);

    return this.createInsight({
      severity,
      category: 'regression',
      title: `Wait Event Increase: ${comparison.event}`,
      description:
        `Wait event "${comparison.event}" (${comparison.waitClass ?? 'Unknown'}) increased by ` +
        `${this.formatNumber(changePercent)}% (${this.formatTime(comparison.baseline?.totalWaitTime ?? 0)} → ` +
        `${this.formatTime(comparison.current.totalWaitTime ?? 0)}).`,
      recommendation: this.getWaitIncreaseRecommendation(comparison),
      waitEvent: comparison.event,
      waitClass: comparison.waitClass,
      value: changePercent,
      unit: '%',
      threshold: thresholds.significantRegressionPercent,
      percentDbTime: comparison.current.percentDbTime,
      impactScore: this.calculateComparisonImpact(changePercent, comparison.current.percentDbTime),
      isComparison: true,
      baselineValue: comparison.baseline?.totalWaitTime,
      changePercent,
      tags: [WAIT_COMPARISON_TAGS.INCREASE],
      metadata: {
        source: this.getName(),
        rawValues: {
          currentWaitTime: comparison.current.totalWaitTime ?? 0,
          baselineWaitTime: comparison.baseline?.totalWaitTime ?? 0,
          currentWaits: comparison.current.waits ?? 0,
          baselineWaits: comparison.baseline?.waits ?? 0,
        },
      },
    });
  }

  /**
   * Create insight for wait event decrease
   */
  private createWaitDecreaseInsight(
    comparison: WaitEventComparison,
    thresholds: ComparisonThresholds
  ): AwrInsight {
    const changePercent = comparison.deltaPercent.totalWaitTime ?? 0;

    return this.createInsight({
      severity: 'info',
      category: 'improvement',
      title: `Wait Event Decrease: ${comparison.event}`,
      description:
        `Wait event "${comparison.event}" (${comparison.waitClass ?? 'Unknown'}) decreased by ` +
        `${this.formatNumber(Math.abs(changePercent))}% (${this.formatTime(comparison.baseline?.totalWaitTime ?? 0)} → ` +
        `${this.formatTime(comparison.current.totalWaitTime ?? 0)}).`,
      recommendation: 'Continue monitoring this wait event to ensure the improvement is sustained.',
      waitEvent: comparison.event,
      waitClass: comparison.waitClass,
      value: changePercent,
      unit: '%',
      threshold: thresholds.significantImprovementPercent,
      percentDbTime: comparison.current.percentDbTime,
      impactScore: Math.abs(changePercent) / 2,
      isComparison: true,
      baselineValue: comparison.baseline?.totalWaitTime,
      changePercent,
      tags: [WAIT_COMPARISON_TAGS.DECREASE],
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
   * Get recommendation text for wait event increase
   */
  private getWaitIncreaseRecommendation(comparison: WaitEventComparison): string {
    const waitClass = comparison.waitClass?.toLowerCase() ?? '';

    if (waitClass.includes('i/o')) {
      return 'I/O wait increase detected. Check disk performance, review storage ' +
        'configuration, and identify queries causing excessive I/O.';
    }
    if (waitClass.includes('concurrency') || waitClass.includes('lock')) {
      return 'Lock/concurrency wait increase detected. Review for blocking sessions, ' +
        'optimize transactions to reduce lock duration, and check for row-level contention.';
    }
    if (waitClass.includes('commit')) {
      return 'Commit wait increase detected. Review redo log configuration, check ' +
        'log file I/O performance, and consider reducing commit frequency.';
    }

    return 'Wait event increase detected. Investigate the root cause based on the wait class ' +
      'and review related database activity.';
  }
}
