/**
 * Wait Events Analyzer for AWR Reports
 *
 * Analyzes wait events from AWR reports to identify performance issues:
 * - I/O waits: db file sequential/scattered read, direct path operations
 * - Lock contention: row lock, TM contention, library cache locks
 * - Commit waits: log file sync, log buffer space
 * - High average wait times: events with excessive per-wait duration
 * - Timeout issues: events with high timeout rates
 *
 * @example
 * const analyzer = new WaitEventsAnalyzer(config);
 * const insights = analyzer.analyze(parsedAwrData);
 */

import type { ParsedAwrData, WaitEvent, WaitEvents } from '../types/awr-data.types';
import type { AwrInsight, InsightCategory, InsightSeverity } from '../types/insights.types';
import type {
  AwrAnalysisConfig,
  WaitEventThresholds,
} from '../config/awr-analysis.config';
import { KNOWN_PROBLEMATIC_WAIT_EVENTS } from '../config/awr-analysis.config';
import { BaseAwrAnalyzer, type AnalyzerOptions } from './base-analyzer';

// ==================== Constants ====================

/** Category for all wait event insights */
const WAIT_EVENTS_CATEGORY: InsightCategory = 'wait_events';

/** Tags for different wait event issue types */
const WAIT_TAGS = {
  IO_WAIT: 'io-wait',
  LOCK_CONTENTION: 'lock-contention',
  COMMIT_WAIT: 'commit-wait',
  HIGH_AVG_WAIT: 'high-avg-wait',
  HIGH_TIMEOUT: 'high-timeout',
  HIGH_DB_TIME: 'high-db-time',
  NETWORK: 'network',
  MEMORY: 'memory',
} as const;

// ==================== Wait Events Analyzer ====================

/**
 * Analyzer for wait events from AWR reports
 *
 * Identifies problematic wait events by analyzing:
 * - I/O wait patterns
 * - Lock and contention issues
 * - Commit/redo log bottlenecks
 * - Network wait events
 * - Memory-related waits
 */
export class WaitEventsAnalyzer extends BaseAwrAnalyzer {
  /**
   * Create a new Wait Events Analyzer
   *
   * @param config - Analysis configuration with wait event thresholds
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
    return 'WaitEventsAnalyzer';
  }

  /**
   * Get the primary insight category
   *
   * @returns Wait events category
   */
  getCategory(): InsightCategory {
    return WAIT_EVENTS_CATEGORY;
  }

  /**
   * Analyze AWR data for wait event issues
   *
   * @param data - Parsed AWR data containing wait events
   * @returns Array of wait event insights
   */
  analyze(data: ParsedAwrData): AwrInsight[] {
    const insights: AwrInsight[] = [];

    if (!data.waitEvents) {
      this.debug('No wait events data available for analysis');
      return insights;
    }

    const thresholds = this.config.thresholds.waitEvents;

    // Combine foreground and top events for analysis
    const eventsToAnalyze = this.getEventsToAnalyze(data.waitEvents);

    // Analyze by different wait event categories
    insights.push(...this.analyzeHighDbTimeWaits(eventsToAnalyze, thresholds));
    insights.push(...this.analyzeIoWaits(eventsToAnalyze, thresholds));
    insights.push(...this.analyzeLockContention(eventsToAnalyze, thresholds));
    insights.push(...this.analyzeCommitWaits(eventsToAnalyze, thresholds));
    insights.push(...this.analyzeHighAvgWaitTime(eventsToAnalyze, thresholds));
    insights.push(...this.analyzeTimeoutIssues(eventsToAnalyze, thresholds));

    // Sort by impact score descending
    insights.sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0));

    this.debug(`Generated ${insights.length} wait event insights`);
    return insights;
  }

  // ==================== Analysis Methods ====================

  /**
   * Get events to analyze, combining foreground and top events
   *
   * @param waitEvents - Wait events data
   * @returns Array of wait events to analyze
   */
  private getEventsToAnalyze(waitEvents: WaitEvents): WaitEvent[] {
    const events: WaitEvent[] = [];
    const seen = new Set<string>();

    // Add foreground events first (primary focus)
    if (waitEvents.foreground) {
      for (const event of waitEvents.foreground) {
        if (!seen.has(event.event)) {
          events.push(event);
          seen.add(event.event);
        }
      }
    }

    // Add top events if available
    if (waitEvents.topEvents) {
      for (const event of waitEvents.topEvents) {
        if (!seen.has(event.event)) {
          events.push(event);
          seen.add(event.event);
        }
      }
    }

    return events;
  }

  /**
   * Analyze wait events consuming significant DB time
   *
   * @param events - Wait events to analyze
   * @param thresholds - Wait event thresholds
   * @returns Insights for high DB time wait events
   */
  private analyzeHighDbTimeWaits(
    events: WaitEvent[],
    thresholds: WaitEventThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const maxToAnalyze = thresholds.maxEventsToAnalyze;

    for (const event of events.slice(0, maxToAnalyze)) {
      const percentDbTime = event.percentDbTime ?? 0;

      if (percentDbTime >= thresholds.minDbTimePercent) {
        const severity = this.determineWaitSeverity(percentDbTime, thresholds);
        const insight = this.createHighDbTimeWaitInsight(event, percentDbTime, severity);
        insights.push(insight);
      }
    }

    return insights;
  }

  /**
   * Analyze I/O-related wait events
   *
   * @param events - Wait events to analyze
   * @param thresholds - Wait event thresholds
   * @returns Insights for I/O wait events
   */
  private analyzeIoWaits(
    events: WaitEvent[],
    thresholds: WaitEventThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const ioEvents = this.filterKnownEvents(events, 'io');

    for (const event of ioEvents) {
      const percentDbTime = event.percentDbTime ?? 0;

      if (percentDbTime >= thresholds.ioWaitThresholdPercent) {
        const insight = this.createIoWaitInsight(event, percentDbTime);
        insights.push(insight);
      }
    }

    return insights;
  }

  /**
   * Analyze lock contention wait events
   *
   * @param events - Wait events to analyze
   * @param thresholds - Wait event thresholds
   * @returns Insights for lock contention
   */
  private analyzeLockContention(
    events: WaitEvent[],
    thresholds: WaitEventThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const lockEvents = this.filterKnownEvents(events, 'lock');

    for (const event of lockEvents) {
      const percentDbTime = event.percentDbTime ?? 0;

      if (percentDbTime >= thresholds.lockWaitThresholdPercent) {
        const insight = this.createLockContentionInsight(event, percentDbTime);
        insights.push(insight);
      }
    }

    return insights;
  }

  /**
   * Analyze commit-related wait events
   *
   * @param events - Wait events to analyze
   * @param thresholds - Wait event thresholds
   * @returns Insights for commit waits
   */
  private analyzeCommitWaits(
    events: WaitEvent[],
    thresholds: WaitEventThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const commitEvents = this.filterKnownEvents(events, 'commit');

    for (const event of commitEvents) {
      const percentDbTime = event.percentDbTime ?? 0;

      if (percentDbTime >= thresholds.commitWaitThresholdPercent) {
        const insight = this.createCommitWaitInsight(event, percentDbTime);
        insights.push(insight);
      }
    }

    return insights;
  }

  /**
   * Analyze events with high average wait time
   *
   * @param events - Wait events to analyze
   * @param thresholds - Wait event thresholds
   * @returns Insights for high average wait time
   */
  private analyzeHighAvgWaitTime(
    events: WaitEvent[],
    thresholds: WaitEventThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    for (const event of events) {
      const avgWaitMs = event.avgWaitMs ?? this.calculateAvgWaitMs(event);

      if (avgWaitMs >= thresholds.highAvgWaitTimeMs) {
        const insight = this.createHighAvgWaitInsight(event, avgWaitMs, thresholds);
        insights.push(insight);
      }
    }

    return insights;
  }

  /**
   * Analyze events with high timeout rates
   *
   * @param events - Wait events to analyze
   * @param thresholds - Wait event thresholds
   * @returns Insights for timeout issues
   */
  private analyzeTimeoutIssues(
    events: WaitEvent[],
    thresholds: WaitEventThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    for (const event of events) {
      if (!event.timeouts || event.waits <= 0) {
        continue;
      }

      const timeoutPercent = (event.timeouts / event.waits) * 100;

      if (timeoutPercent >= thresholds.timeoutThresholdPercent) {
        const insight = this.createTimeoutInsight(event, timeoutPercent);
        insights.push(insight);
      }
    }

    return insights;
  }

  // ==================== Helper Methods ====================

  /**
   * Filter events by known problematic event type
   *
   * @param events - All wait events
   * @param category - Category to filter (io, lock, commit, network, memory)
   * @returns Filtered events matching the category
   */
  private filterKnownEvents(
    events: WaitEvent[],
    category: keyof typeof KNOWN_PROBLEMATIC_WAIT_EVENTS
  ): WaitEvent[] {
    const knownEvents = KNOWN_PROBLEMATIC_WAIT_EVENTS[category];

    return events.filter((event) => {
      const eventNameLower = event.event.toLowerCase();
      return knownEvents.some((known) => eventNameLower.includes(known.toLowerCase()));
    });
  }

  /**
   * Calculate average wait time in milliseconds
   *
   * @param event - Wait event
   * @returns Average wait time in ms
   */
  private calculateAvgWaitMs(event: WaitEvent): number {
    if (event.waits <= 0) {
      return 0;
    }
    // totalWaitTime is in seconds, convert to ms
    return (event.totalWaitTime / event.waits) * 1000;
  }

  /**
   * Determine severity based on DB time percentage
   *
   * @param percentDbTime - Percentage of DB time
   * @param thresholds - Wait event thresholds
   * @returns Appropriate severity level
   */
  private determineWaitSeverity(
    percentDbTime: number,
    thresholds: WaitEventThresholds
  ): InsightSeverity {
    if (percentDbTime >= thresholds.criticalDbTimePercent) {
      return 'critical';
    }
    if (percentDbTime >= thresholds.minDbTimePercent * 2) {
      return 'warning';
    }
    return 'info';
  }

  /**
   * Get wait class from event (or infer from name)
   *
   * @param event - Wait event
   * @returns Wait class name
   */
  private getWaitClass(event: WaitEvent): string {
    if (event.waitClass) {
      return event.waitClass;
    }

    // Infer wait class from event name
    const eventLower = event.event.toLowerCase();

    if (eventLower.includes('db file') || eventLower.includes('direct path')) {
      return 'User I/O';
    }
    if (eventLower.includes('log file') || eventLower.includes('log buffer')) {
      return 'Commit';
    }
    if (eventLower.includes('enq:') || eventLower.includes('latch:')) {
      return 'Concurrency';
    }
    if (eventLower.includes('sql*net')) {
      return 'Network';
    }

    return 'Other';
  }

  // ==================== Insight Creation Methods ====================

  /**
   * Create insight for high DB time wait event
   *
   * @param event - Wait event
   * @param percentDbTime - Percentage of DB time
   * @param severity - Severity level
   * @returns High DB time wait insight
   */
  private createHighDbTimeWaitInsight(
    event: WaitEvent,
    percentDbTime: number,
    severity: InsightSeverity
  ): AwrInsight {
    const waitClass = this.getWaitClass(event);
    const totalWaitTime = this.formatTime(event.totalWaitTime);

    return this.createInsight({
      severity,
      category: WAIT_EVENTS_CATEGORY,
      title: `High DB Time Wait: ${event.event}`,
      description: `Wait event "${event.event}" (${waitClass}) accounts for ` +
        `${this.formatNumber(percentDbTime)}% of total DB time (${totalWaitTime} total wait).`,
      recommendation: this.getHighDbTimeWaitRecommendation(event, percentDbTime),
      waitEvent: event.event,
      waitClass,
      value: percentDbTime,
      unit: '%',
      threshold: this.config.thresholds.waitEvents.minDbTimePercent,
      percentDbTime,
      impactScore: this.calculateImpactScore(percentDbTime),
      tags: [WAIT_TAGS.HIGH_DB_TIME],
      metadata: {
        rawValues: {
          totalWaitTime: event.totalWaitTime,
          waits: event.waits,
          avgWaitMs: event.avgWaitMs ?? this.calculateAvgWaitMs(event),
        },
      },
    });
  }

  /**
   * Create insight for I/O wait event
   *
   * @param event - Wait event
   * @param percentDbTime - Percentage of DB time
   * @returns I/O wait insight
   */
  private createIoWaitInsight(event: WaitEvent, percentDbTime: number): AwrInsight {
    const severity: InsightSeverity = percentDbTime >= 20 ? 'warning' : 'info';
    const avgWaitMs = event.avgWaitMs ?? this.calculateAvgWaitMs(event);

    return this.createInsight({
      severity,
      category: 'io_performance',
      title: `I/O Wait Detected: ${event.event}`,
      description: `I/O wait event "${event.event}" accounts for ${this.formatNumber(percentDbTime)}% ` +
        `of DB time with ${this.formatNumber(avgWaitMs, 1)}ms average wait.`,
      recommendation: this.getIoWaitRecommendation(event),
      waitEvent: event.event,
      waitClass: this.getWaitClass(event),
      value: percentDbTime,
      unit: '%',
      threshold: this.config.thresholds.waitEvents.ioWaitThresholdPercent,
      percentDbTime,
      impactScore: this.calculateImpactScore(percentDbTime),
      tags: [WAIT_TAGS.IO_WAIT],
      metadata: {
        rawValues: {
          totalWaitTime: event.totalWaitTime,
          waits: event.waits,
          avgWaitMs,
        },
      },
    });
  }

  /**
   * Create insight for lock contention
   *
   * @param event - Wait event
   * @param percentDbTime - Percentage of DB time
   * @returns Lock contention insight
   */
  private createLockContentionInsight(
    event: WaitEvent,
    percentDbTime: number
  ): AwrInsight {
    const severity: InsightSeverity = percentDbTime >= 10 ? 'critical' : 'warning';

    return this.createInsight({
      severity,
      category: 'lock_contention',
      title: `Lock Contention: ${event.event}`,
      description: `Lock/contention event "${event.event}" accounts for ` +
        `${this.formatNumber(percentDbTime)}% of DB time with ${event.waits.toLocaleString()} waits.`,
      recommendation: this.getLockContentionRecommendation(event),
      waitEvent: event.event,
      waitClass: this.getWaitClass(event),
      value: percentDbTime,
      unit: '%',
      threshold: this.config.thresholds.waitEvents.lockWaitThresholdPercent,
      percentDbTime,
      impactScore: this.calculateImpactScore(percentDbTime * 1.5), // Lock issues have higher impact
      tags: [WAIT_TAGS.LOCK_CONTENTION],
      metadata: {
        rawValues: {
          totalWaitTime: event.totalWaitTime,
          waits: event.waits,
        },
      },
    });
  }

  /**
   * Create insight for commit wait
   *
   * @param event - Wait event
   * @param percentDbTime - Percentage of DB time
   * @returns Commit wait insight
   */
  private createCommitWaitInsight(
    event: WaitEvent,
    percentDbTime: number
  ): AwrInsight {
    const severity: InsightSeverity = percentDbTime >= 15 ? 'warning' : 'info';
    const avgWaitMs = event.avgWaitMs ?? this.calculateAvgWaitMs(event);

    return this.createInsight({
      severity,
      category: WAIT_EVENTS_CATEGORY,
      title: `Commit Wait Issue: ${event.event}`,
      description: `Commit-related wait "${event.event}" accounts for ` +
        `${this.formatNumber(percentDbTime)}% of DB time with ${this.formatNumber(avgWaitMs, 1)}ms avg wait.`,
      recommendation: this.getCommitWaitRecommendation(event),
      waitEvent: event.event,
      waitClass: 'Commit',
      value: percentDbTime,
      unit: '%',
      threshold: this.config.thresholds.waitEvents.commitWaitThresholdPercent,
      percentDbTime,
      impactScore: this.calculateImpactScore(percentDbTime),
      tags: [WAIT_TAGS.COMMIT_WAIT],
      metadata: {
        rawValues: {
          totalWaitTime: event.totalWaitTime,
          waits: event.waits,
          avgWaitMs,
        },
      },
    });
  }

  /**
   * Create insight for high average wait time
   *
   * @param event - Wait event
   * @param avgWaitMs - Average wait time in milliseconds
   * @param thresholds - Wait event thresholds
   * @returns High average wait insight
   */
  private createHighAvgWaitInsight(
    event: WaitEvent,
    avgWaitMs: number,
    thresholds: WaitEventThresholds
  ): AwrInsight {
    const severity: InsightSeverity = avgWaitMs >= thresholds.highAvgWaitTimeMs * 5 ? 'warning' : 'info';

    return this.createInsight({
      severity,
      category: WAIT_EVENTS_CATEGORY,
      title: `High Average Wait: ${event.event}`,
      description: `Wait event "${event.event}" has high average wait time of ` +
        `${this.formatNumber(avgWaitMs, 1)}ms (threshold: ${thresholds.highAvgWaitTimeMs}ms).`,
      recommendation: 'Investigate the root cause of high wait times. Check for resource ' +
        'contention, undersized buffers, or slow storage subsystem.',
      waitEvent: event.event,
      waitClass: this.getWaitClass(event),
      value: avgWaitMs,
      unit: 'ms',
      threshold: thresholds.highAvgWaitTimeMs,
      percentDbTime: event.percentDbTime,
      impactScore: this.calculateImpactScore(event.percentDbTime ?? 5),
      tags: [WAIT_TAGS.HIGH_AVG_WAIT],
      metadata: {
        rawValues: {
          totalWaitTime: event.totalWaitTime,
          waits: event.waits,
          avgWaitMs,
        },
      },
    });
  }

  /**
   * Create insight for high timeout rate
   *
   * @param event - Wait event
   * @param timeoutPercent - Timeout percentage
   * @returns Timeout insight
   */
  private createTimeoutInsight(
    event: WaitEvent,
    timeoutPercent: number
  ): AwrInsight {
    const severity: InsightSeverity = timeoutPercent >= 50 ? 'warning' : 'info';

    return this.createInsight({
      severity,
      category: WAIT_EVENTS_CATEGORY,
      title: `High Timeout Rate: ${event.event}`,
      description: `Wait event "${event.event}" has ${this.formatNumber(timeoutPercent)}% timeout rate ` +
        `(${event.timeouts?.toLocaleString()} of ${event.waits.toLocaleString()} waits).`,
      recommendation: 'High timeout rates may indicate resource unavailability or configuration ' +
        'issues. Review timeout settings and resource availability.',
      waitEvent: event.event,
      waitClass: this.getWaitClass(event),
      value: timeoutPercent,
      unit: '%',
      threshold: this.config.thresholds.waitEvents.timeoutThresholdPercent,
      percentDbTime: event.percentDbTime,
      impactScore: Math.min(50, Math.round(timeoutPercent / 2)),
      tags: [WAIT_TAGS.HIGH_TIMEOUT],
      metadata: {
        rawValues: {
          timeouts: event.timeouts ?? 0,
          waits: event.waits,
          timeoutPercent,
        },
      },
    });
  }

  // ==================== Recommendation Methods ====================

  /**
   * Get recommendation for high DB time wait event
   *
   * @param _event - Wait event
   * @param percentDbTime - Percentage of DB time
   * @returns Recommendation text
   */
  private getHighDbTimeWaitRecommendation(
    _event: WaitEvent,
    percentDbTime: number
  ): string {
    if (percentDbTime >= 20) {
      return 'CRITICAL: This wait event significantly impacts database performance. ' +
        'Immediate investigation required. Review top SQL statements, system resources, ' +
        'and consider tuning recommendations specific to this wait class.';
    }
    return 'Monitor this wait event and investigate contributing factors. ' +
      'Review related SQL statements and system configuration.';
  }

  /**
   * Get recommendation for I/O wait event
   *
   * @param event - Wait event
   * @returns Recommendation text
   */
  private getIoWaitRecommendation(event: WaitEvent): string {
    const eventLower = event.event.toLowerCase();

    if (eventLower.includes('sequential')) {
      return 'Sequential read waits indicate single-block reads, often from index lookups. ' +
        'Review top SQL for missing indexes or full table scans. Consider increasing ' +
        'db_file_multiblock_read_count or improving storage performance.';
    }
    if (eventLower.includes('scattered')) {
      return 'Scattered read waits indicate multi-block reads, typically from full table/index scans. ' +
        'Review queries causing large scans. Consider adding indexes, partitioning, or ' +
        'increasing PGA aggregate target for sorting/hashing operations.';
    }
    if (eventLower.includes('direct path')) {
      return 'Direct path I/O bypasses the buffer cache. Review large sort/hash operations, ' +
        'parallel query execution, or LOB operations. Consider increasing PGA memory or ' +
        'tuning parallel execution parameters.';
    }
    return 'Review storage subsystem performance, check for I/O bottlenecks, and ' +
      'ensure appropriate indexing to reduce unnecessary I/O operations.';
  }

  /**
   * Get recommendation for lock contention
   *
   * @param event - Wait event
   * @returns Recommendation text
   */
  private getLockContentionRecommendation(event: WaitEvent): string {
    const eventLower = event.event.toLowerCase();

    if (eventLower.includes('tx - row lock')) {
      return 'Row lock contention indicates concurrent updates to the same rows. ' +
        'Review application logic for transaction scope, consider reducing transaction ' +
        'duration, or implement optimistic locking patterns.';
    }
    if (eventLower.includes('tm - contention')) {
      return 'TM lock contention often occurs during DML on tables with unindexed foreign keys. ' +
        'Add indexes to foreign key columns and review concurrent DML patterns.';
    }
    if (eventLower.includes('library cache')) {
      return 'Library cache contention indicates high parsing activity or cursor invalidation. ' +
        'Implement bind variables, increase shared_pool_size, and review hard parse rates.';
    }
    if (eventLower.includes('latch:')) {
      return 'Latch contention indicates memory structure access conflicts. Review SQL that ' +
        'causes excessive shared pool activity, consider increasing related memory pools, ' +
        'and check for hot blocks in buffer cache.';
    }
    if (eventLower.includes('buffer busy')) {
      return 'Buffer busy waits indicate contention for data blocks. Identify hot blocks, ' +
        'consider implementing reverse key indexes, or increase buffer cache size.';
    }
    return 'Review concurrent operations causing contention. Consider redesigning ' +
      'application logic, implementing queuing mechanisms, or increasing resource allocation.';
  }

  /**
   * Get recommendation for commit wait event
   *
   * @param event - Wait event
   * @returns Recommendation text
   */
  private getCommitWaitRecommendation(event: WaitEvent): string {
    const eventLower = event.event.toLowerCase();

    if (eventLower.includes('log file sync')) {
      return 'Log file sync waits occur during commit operations. Review commit frequency ' +
        '(consider batching), check redo log I/O performance, ensure log files are on fast ' +
        'storage, and consider increasing log_buffer if appropriate.';
    }
    if (eventLower.includes('log file parallel write')) {
      return 'Parallel write waits indicate LGWR is waiting for I/O completion. ' +
        'Ensure redo logs are on fast, dedicated storage. Consider increasing ' +
        'log file size or adding log groups.';
    }
    if (eventLower.includes('log buffer space')) {
      return 'Log buffer space waits indicate the log buffer is filling faster than it ' +
        'can be written. Increase LOG_BUFFER parameter and ensure redo log disk performance.';
    }
    return 'Review redo log configuration and I/O subsystem performance. ' +
      'Consider reducing commit frequency or improving storage performance.';
  }
}
