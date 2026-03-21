import { Injectable, Logger } from '@nestjs/common';
import { WorkerDatabaseService } from '../common/database.service.js';
import { TimeRange, FailedRange } from '@perfana/shared/entities';

/**
 * Time Range Representation
 * Used for gap detection and range operations
 */
interface TimeRangeInternal {
  from: Date;
  to: Date;
}

/**
 * Collection Gap Information
 * Represents missing or failed data collection for a specific source
 */
export interface CollectionGap {
  sourceType: string;
  sourceId: string | null;
  missingRanges: TimeRange[];
  failedRanges: FailedRange[];
}

/**
 * Incomplete Source Information
 * Represents a source that has not completed data collection
 */
export interface IncompleteSource {
  sourceType: string;
  sourceId: string | null;
  failedRanges: FailedRange[];
  lastCollectedAt: Date | null;
}

/**
 * Metric Collection Gap Service
 *
 * Detects gaps in collected data and manages completion status for metric collection.
 * Used by PipelineOrchestrator to decide whether to skip metric collection stages.
 *
 * Key Responsibilities:
 * - Detect missing time ranges in collected data
 * - Track failed collection attempts
 * - Determine if collection is complete for a test run
 * - Identify sources with incomplete collection
 * - Mark sources as complete after filling gaps
 *
 * Pattern: Uses WorkerDatabaseService for database access (TypeORM)
 */
@Injectable()
export class MetricCollectionGapService {
  private readonly logger = new Logger(MetricCollectionGapService.name);

  constructor(private readonly databaseService: WorkerDatabaseService) {}

  /**
   * Detect gaps in collected data for a test run
   *
   * Compares collected_ranges against test run time window (startTime to endTime)
   * to identify missing time ranges that need to be collected.
   *
   * @param testRunId - The test run ID to check for gaps
   * @returns Array of collection gaps per source
   */
  async detectGaps(testRunId: string): Promise<CollectionGap[]> {
    this.logger.debug(`Detecting gaps for test run: ${testRunId}`);

    // Get test run to determine expected time window
    const testRun = await this.databaseService.getTestRunByTestRunId(testRunId);
    if (!testRun) {
      throw new Error(`Test run not found: ${testRunId}`);
    }

    if (!testRun.startTime || !testRun.endTime) {
      this.logger.warn(`Test run ${testRunId} missing startTime or endTime`);
      return [];
    }

    // Get all collection statuses for this test run
    const statuses = await this.databaseService.getAllCollectionStatuses(testRunId);

    if (statuses.length === 0) {
      this.logger.debug(`No collection statuses found for test run: ${testRunId}`);
      return [];
    }

    const gaps: CollectionGap[] = [];

    for (const status of statuses) {
      // Find missing time ranges by comparing collected_ranges to [startTime, endTime]
      const missingRanges = this.findMissingRanges(
        testRun.startTime,
        testRun.endTime,
        status.collected_ranges || []
      );

      // Also include failed_ranges that haven't exceeded max retries (5 attempts)
      const retriableFailedRanges = (status.failed_ranges || []).filter(
        (r) => r.attempts < 5
      );

      if (missingRanges.length > 0 || retriableFailedRanges.length > 0) {
        gaps.push({
          sourceType: status.source_type,
          sourceId: status.source_id ?? null,
          missingRanges,
          failedRanges: retriableFailedRanges,
        });

        this.logger.debug(
          `Found gaps for ${status.source_type}/${status.source_id ?? 'null'}: ` +
            `${missingRanges.length} missing ranges, ${retriableFailedRanges.length} retriable failed ranges`
        );
      }
    }

    this.logger.log(`Detected ${gaps.length} sources with gaps for test run: ${testRunId}`);

    return gaps;
  }

  /**
   * Check if all metric collection is complete for a test run
   *
   * Returns true only if:
   * 1. At least one collection status exists
   * 2. All collection statuses have is_complete = true
   *
   * @param testRunId - The test run ID to check
   * @returns True if all collection is complete, false otherwise
   */
  async isCollectionComplete(testRunId: string): Promise<boolean> {
    const statuses = await this.databaseService.getAllCollectionStatuses(testRunId);

    // No statuses means collection hasn't started
    if (statuses.length === 0) {
      this.logger.debug(`No collection statuses found for test run: ${testRunId}`);
      return false;
    }

    const allComplete = statuses.every((s) => s.is_complete);

    this.logger.debug(
      `Collection complete check for ${testRunId}: ${allComplete} ` +
        `(${statuses.filter((s) => s.is_complete).length}/${statuses.length} complete)`
    );

    return allComplete;
  }

  /**
   * Get sources that have incomplete collection
   *
   * Useful for debugging and monitoring which sources need attention.
   *
   * @param testRunId - The test run ID to check
   * @returns Array of incomplete sources with details
   */
  async getIncompleteSources(testRunId: string): Promise<IncompleteSource[]> {
    const incompleteStatuses =
      await this.databaseService.getIncompleteCollectionStatuses(testRunId);

    const incompleteSources = incompleteStatuses.map((s) => ({
      sourceType: s.source_type,
      sourceId: s.source_id ?? null,
      failedRanges: s.failed_ranges || [],
      lastCollectedAt: s.last_collected_at ?? null,
    }));

    this.logger.debug(
      `Found ${incompleteSources.length} incomplete sources for test run: ${testRunId}`
    );

    return incompleteSources;
  }

  /**
   * Mark collection complete for a source after filling gaps
   *
   * Should be called after successfully collecting all missing ranges.
   *
   * @param testRunId - The test run ID
   * @param sourceType - Type of source ('grafana', 'dynatrace', 'performance_test')
   * @param sourceId - Source identifier (or null for performance_test)
   */
  async markSourceComplete(
    testRunId: string,
    sourceType: string,
    sourceId: string | null
  ): Promise<void> {
    await this.databaseService.markCollectionComplete(testRunId, sourceType, sourceId);

    this.logger.log(
      `Marked collection complete for test_run=${testRunId}, source=${sourceType}/${sourceId ?? 'null'}`
    );
  }

  /**
   * Find missing time ranges by comparing collected ranges to expected window
   *
   * Algorithm:
   * 1. Sort collected ranges by start time
   * 2. Merge overlapping ranges
   * 3. Find gaps between merged ranges and at boundaries
   *
   * Example:
   *   Expected: [10:00 - 11:00]
   *   Collected: [[10:00-10:15], [10:30-10:45]]
   *   Missing: [[10:15-10:30], [10:45-11:00]]
   *
   * Edge Cases:
   * - No collected ranges: Returns entire expected window
   * - Fully covered: Returns empty array
   * - Partially covered: Returns missing segments
   *
   * @param expectedStart - Start of expected time window
   * @param expectedEnd - End of expected time window
   * @param collectedRanges - Array of collected time ranges
   * @returns Array of missing time ranges
   */
  private findMissingRanges(
    expectedStart: Date,
    expectedEnd: Date,
    collectedRanges: TimeRange[]
  ): TimeRangeInternal[] {
    // Handle empty collected ranges - entire window is missing
    if (!collectedRanges || collectedRanges.length === 0) {
      return [{ from: expectedStart, to: expectedEnd }];
    }

    // Convert to internal format and sort by start time
    const sortedRanges = collectedRanges
      .map((r) => ({
        from: new Date(r.from),
        to: new Date(r.to),
      }))
      .sort((a, b) => a.from.getTime() - b.from.getTime());

    // Merge overlapping ranges
    const mergedRanges = this.mergeOverlappingRanges(sortedRanges);

    // Find gaps
    const missingRanges: TimeRangeInternal[] = [];
    const expectedStartTime = expectedStart.getTime();
    const expectedEndTime = expectedEnd.getTime();

    // Check for gap before first collected range
    if (mergedRanges[0].from.getTime() > expectedStartTime) {
      missingRanges.push({
        from: expectedStart,
        to: new Date(Math.min(mergedRanges[0].from.getTime(), expectedEndTime)),
      });
    }

    // Check for gaps between consecutive ranges
    for (let i = 0; i < mergedRanges.length - 1; i++) {
      const currentEnd = mergedRanges[i].to.getTime();
      const nextStart = mergedRanges[i + 1].from.getTime();

      // Gap exists if there's space between ranges
      if (currentEnd < nextStart) {
        missingRanges.push({
          from: new Date(Math.max(currentEnd, expectedStartTime)),
          to: new Date(Math.min(nextStart, expectedEndTime)),
        });
      }
    }

    // Check for gap after last collected range
    const lastRange = mergedRanges[mergedRanges.length - 1];
    if (lastRange.to.getTime() < expectedEndTime) {
      missingRanges.push({
        from: new Date(Math.max(lastRange.to.getTime(), expectedStartTime)),
        to: expectedEnd,
      });
    }

    // Filter out zero-duration ranges and ranges outside expected window
    const validMissingRanges = missingRanges.filter((range) => {
      const rangeStart = range.from.getTime();
      const rangeEnd = range.to.getTime();

      return (
        rangeStart < rangeEnd && // Non-zero duration
        rangeStart < expectedEndTime && // Starts before expected end
        rangeEnd > expectedStartTime // Ends after expected start
      );
    });

    if (validMissingRanges.length > 0) {
      this.logger.debug(
        `Found ${validMissingRanges.length} missing ranges between ${expectedStart.toISOString()} and ${expectedEnd.toISOString()}`
      );
    }

    return validMissingRanges;
  }

  /**
   * Merge overlapping or adjacent time ranges
   *
   * Combines ranges that overlap or touch to create consolidated ranges.
   * Assumes input ranges are sorted by start time.
   *
   * Example:
   *   Input: [[10:00-10:30], [10:25-10:45], [11:00-11:30]]
   *   Output: [[10:00-10:45], [11:00-11:30]]
   *
   * @param ranges - Sorted array of time ranges
   * @returns Array of merged time ranges
   */
  private mergeOverlappingRanges(ranges: TimeRangeInternal[]): TimeRangeInternal[] {
    if (ranges.length === 0) {
      return [];
    }

    const merged: TimeRangeInternal[] = [];
    let current = { ...ranges[0] };

    for (let i = 1; i < ranges.length; i++) {
      const next = ranges[i];

      // Check if ranges overlap or are adjacent (within 1 second)
      if (next.from.getTime() <= current.to.getTime() + 1000) {
        // Merge by extending the current range
        current.to = new Date(Math.max(current.to.getTime(), next.to.getTime()));
      } else {
        // No overlap - save current and start new range
        merged.push(current);
        current = { ...next };
      }
    }

    // Add the last range
    merged.push(current);

    return merged;
  }

  /**
   * Calculate coverage percentage for a test run
   *
   * Useful for monitoring and reporting purposes.
   *
   * @param testRunId - The test run ID
   * @returns Coverage percentage (0-100)
   */
  async calculateCoverage(testRunId: string): Promise<number> {
    const testRun = await this.databaseService.getTestRunByTestRunId(testRunId);
    if (!testRun || !testRun.startTime || !testRun.endTime) {
      return 0;
    }

    const statuses = await this.databaseService.getAllCollectionStatuses(testRunId);
    if (statuses.length === 0) {
      return 0;
    }

    const expectedDuration =
      testRun.endTime.getTime() - testRun.startTime.getTime();
    let totalCoveredDuration = 0;

    for (const status of statuses) {
      const collectedRanges = status.collected_ranges || [];
      const mergedRanges = this.mergeOverlappingRanges(
        collectedRanges.map((r) => ({
          from: new Date(r.from),
          to: new Date(r.to),
        }))
      );

      // Sum up duration of all merged ranges
      for (const range of mergedRanges) {
        totalCoveredDuration += range.to.getTime() - range.from.getTime();
      }
    }

    // Average coverage across all sources
    const averageCoverage =
      totalCoveredDuration / (expectedDuration * statuses.length);
    const coveragePercentage = Math.min(100, averageCoverage * 100);

    this.logger.debug(
      `Coverage for test run ${testRunId}: ${coveragePercentage.toFixed(2)}%`
    );

    return coveragePercentage;
  }

  /**
   * Get summary of collection status for a test run
   *
   * Provides a high-level overview of collection progress.
   *
   * @param testRunId - The test run ID
   * @returns Collection summary
   */
  async getCollectionSummary(testRunId: string): Promise<{
    totalSources: number;
    completeSources: number;
    incompleteSources: number;
    coverage: number;
    gaps: number;
    failedRanges: number;
  }> {
    const statuses = await this.databaseService.getAllCollectionStatuses(testRunId);
    const gaps = await this.detectGaps(testRunId);
    const coverage = await this.calculateCoverage(testRunId);

    const completeSources = statuses.filter((s) => s.is_complete).length;
    const failedRangesCount = statuses.reduce(
      (sum, s) => sum + (s.failed_ranges?.length || 0),
      0
    );

    return {
      totalSources: statuses.length,
      completeSources,
      incompleteSources: statuses.length - completeSources,
      coverage,
      gaps: gaps.length,
      failedRanges: failedRangesCount,
    };
  }
}
