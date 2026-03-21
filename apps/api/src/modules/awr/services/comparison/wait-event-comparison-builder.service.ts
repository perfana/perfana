/**
 * Wait Event Comparison Builder Service
 *
 * Builds detailed wait event comparisons between two AWR reports.
 * Responsible for:
 * - Extracting wait events from parsed data
 * - Comparing wait event metrics (wait time, waits, avg wait time)
 * - Identifying significant increases and decreases
 * - Grouping comparisons by wait class
 */

import { Injectable } from '@nestjs/common';
import { ParsedAwrData } from '../../entities/awr-report.entity';
import { AwrAnalysisConfig } from '../../config/awr-analysis.config';
import type {
  WaitEventComparisonResult,
  WaitEventComparison,
  ChangeDirection,
} from '../../types/analysis.types';
import type { WaitEvent, WaitEvents } from '../../types/awr-data.types';

/**
 * Service for building wait event comparison results
 */
@Injectable()
export class WaitEventComparisonBuilderService {

  /**
   * Build detailed wait event comparison result
   *
   * @param currentData - Current report parsed data
   * @param baselineData - Baseline report parsed data
   * @param config - Analysis configuration
   * @returns Wait event comparison result with all comparisons and summaries
   */
  buildWaitEventComparison(
    currentData: ParsedAwrData,
    baselineData: ParsedAwrData,
    config: AwrAnalysisConfig,
  ): WaitEventComparisonResult {
    const currentEvents = this.getWaitEventMap(currentData.waitEvents);
    const baselineEvents = this.getWaitEventMap(baselineData.waitEvents);

    const comparisons: WaitEventComparison[] = [];
    const increases: WaitEventComparison[] = [];
    const decreases: WaitEventComparison[] = [];
    const newEvents: WaitEventComparison[] = [];
    const removedEvents: WaitEventComparison[] = [];
    const byClass: Record<string, { totalChange: number; eventCount: number }> = {};

    const thresholds = config.thresholds.comparison;

    // Compare existing events
    for (const [eventName, currentEvent] of currentEvents) {
      const baselineEvent = baselineEvents.get(eventName);
      const comparison = this.compareWaitEvent(currentEvent, baselineEvent, thresholds);
      comparisons.push(comparison);

      // Track by wait class
      const waitClass = comparison.waitClass || 'Other';
      if (!byClass[waitClass]) {
        byClass[waitClass] = { totalChange: 0, eventCount: 0 };
      }
      byClass[waitClass].totalChange += comparison.deltaPercent.totalWaitTime ?? 0;
      byClass[waitClass].eventCount++;

      if (comparison.isSignificantIncrease) {
        increases.push(comparison);
      } else if (comparison.isSignificantDecrease) {
        decreases.push(comparison);
      } else if (!baselineEvent) {
        newEvents.push(comparison);
      }
    }

    // Find removed events
    for (const [eventName, baselineEvent] of baselineEvents) {
      if (!currentEvents.has(eventName)) {
        const comparison = this.createRemovedWaitEventComparison(baselineEvent);
        removedEvents.push(comparison);
      }
    }

    return {
      comparisons,
      increases,
      decreases,
      newEvents,
      removedEvents,
      byClass,
    };
  }

  /**
   * Get wait event map from WaitEvents
   */
  private getWaitEventMap(waitEvents?: WaitEvents): Map<string, WaitEvent> {
    const map = new Map<string, WaitEvent>();

    if (!waitEvents) return map;

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
   * Compare single wait event
   */
  private compareWaitEvent(
    current: WaitEvent,
    baseline: WaitEvent | undefined,
    thresholds: { significantRegressionPercent: number; significantImprovementPercent: number },
  ): WaitEventComparison {
    const currentMetrics = {
      totalWaitTime: current.totalWaitTime,
      waits: current.waits,
      avgWaitMs: current.avgWaitMs,
      percentDbTime: current.percentDbTime,
    };

    const baselineMetrics = baseline
      ? {
          totalWaitTime: baseline.totalWaitTime,
          waits: baseline.waits,
          avgWaitMs: baseline.avgWaitMs,
          percentDbTime: baseline.percentDbTime,
        }
      : undefined;

    const deltaPercent = {
      totalWaitTime: this.calcPercentChange(current.totalWaitTime, baseline?.totalWaitTime),
      waits: this.calcPercentChange(current.waits, baseline?.waits),
      avgWaitMs: this.calcPercentChange(current.avgWaitMs, baseline?.avgWaitMs),
    };

    const waitTimeChange = deltaPercent.totalWaitTime ?? 0;
    let changeDirection: ChangeDirection = 'unchanged';
    if (!baseline) changeDirection = 'new';
    else if (waitTimeChange > 10) changeDirection = 'regressed';
    else if (waitTimeChange < -10) changeDirection = 'improved';

    const isSignificantIncrease =
      baseline !== undefined && waitTimeChange >= thresholds.significantRegressionPercent;
    const isSignificantDecrease =
      baseline !== undefined && waitTimeChange <= -thresholds.significantImprovementPercent;

    return {
      event: current.event,
      waitClass: current.waitClass,
      changeDirection,
      current: currentMetrics,
      baseline: baselineMetrics,
      deltaPercent,
      isSignificantIncrease,
      isSignificantDecrease,
    };
  }

  /**
   * Create comparison for removed wait event
   */
  private createRemovedWaitEventComparison(baseline: WaitEvent): WaitEventComparison {
    return {
      event: baseline.event,
      waitClass: baseline.waitClass,
      changeDirection: 'removed',
      current: {},
      baseline: {
        totalWaitTime: baseline.totalWaitTime,
        waits: baseline.waits,
        avgWaitMs: baseline.avgWaitMs,
        percentDbTime: baseline.percentDbTime,
      },
      deltaPercent: {},
      isSignificantIncrease: false,
      isSignificantDecrease: false,
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
}
