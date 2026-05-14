import { Job } from 'bullmq';
import { getLogger } from '../lib/utils/logger.js';
import { IncrementalCollectionJobSchema, type IncrementalCollectionJob as _IncrementalCollectionJob, type JobResult } from '../types/jobs.js';
import { IncrementalMetricsPipeline } from '../pipelines/IncrementalMetricsPipeline.js';
import { PerformanceTestMetricsPipeline as _PerformanceTestMetricsPipeline } from '../pipelines/PerformanceTestMetricsPipeline.js';
import { getDatabaseService } from '../common/database-accessor.js';
import { randomBytes } from 'node:crypto';
import { acquireRedisConnection, releaseRedisConnection } from '../config/redis-pool.js';
import { JobLockService } from '../services/JobLockService.js';

/**
 * Per-test_run_id lock key for performance-test incremental collection.
 * Prevents overlapping ticks of `collectPerformanceTestMetrics` for the same
 * test run from racing on `ds_metric_statistics`. See issue #134.
 *
 * TTL = 15 min: deliberately tighter than `JOB_DEFAULTS.LOCK_TTL_SECONDS` (30
 * min, which targets long analysis jobs). A single perf-test incremental tick
 * should not exceed a few minutes even under load (the incident in #134 saw a
 * pathological 97 s DELETE); 15 min gives generous headroom while ensuring a
 * crashed worker releases the lock reasonably fast so the next scheduler tick
 * can proceed.
 */
const PERF_TEST_LOCK_PREFIX = 'job:lock:perf-test-metrics:';
const PERF_TEST_LOCK_TTL_SECONDS = 15 * 60;

const logger = getLogger('incremental-metrics-worker');

/**
 * Collection result from pipeline execution
 */
interface CollectionResult {
  success: boolean;
  dataPoints?: number;
  error?: string;
  /** MAX timestamp from actually collected data - used to avoid skipping data due to API delays */
  maxDataTimestamp?: Date;
}

/**
 * Incremental Metrics Collection Worker
 *
 * Processes incremental collection jobs that collect metrics for specific time ranges
 * during test execution. This enables real-time metric visibility without waiting for
 * test completion.
 *
 * Architecture:
 * - Scheduler identifies in-progress test runs (via heartbeat check)
 * - Creates incremental collection jobs for uncollected time ranges
 * - This worker processes jobs and updates DsMetricCollectionStatus
 * - Failed ranges are retried with exponential backoff
 *
 * Integration:
 * - Uses existing pipelines (MetricsPipeline, DynatracePipeline, PerformanceTestMetricsPipeline)
 * - Updates ds_metric_collection_status.collected_ranges on success
 * - Records failed ranges in ds_metric_collection_status.failed_ranges
 *
 * @returns Worker handler function
 */
export function incrementalMetricsWorker() {
  return async (job: Job<unknown>): Promise<JobResult> => {
    // Get database service from NestJS DI container
    const db = getDatabaseService();
    // Validate and parse job data
    const validatedData = IncrementalCollectionJobSchema.parse(job.data);
    const {
      testRunId,
      sourceType,
      sourceId,
      applicationDashboardIds,
      fromTime,
      toTime,
      attempt,
      maxAttempts
    } = validatedData;

    logger.info({
      testRunId,
      sourceType,
      sourceId: sourceId ?? 'null',
      timeRange: `${fromTime} to ${toTime}`,
      attempt,
      maxAttempts,
    }, 'Starting incremental metrics collection');

    try {
      let result: CollectionResult;

      // Execute appropriate pipeline based on source type
      switch (sourceType) {
        case 'grafana':
          result = await collectGrafanaMetrics(
            testRunId,
            sourceId!,
            applicationDashboardIds,
            new Date(fromTime),
            new Date(toTime)
          );
          break;

        case 'dynatrace':
          result = await collectDynatraceMetrics(
            testRunId,
            sourceId!,
            new Date(fromTime),
            new Date(toTime)
          );
          break;

        case 'performance_test':
          result = await collectPerformanceTestMetrics(
            testRunId,
            new Date(fromTime),
            new Date(toTime),
            job.id
          );
          break;

        default:
          throw new Error(`Unknown source type: ${sourceType}`);
      }

      // Handle collection result
      if (result.success) {
        // Determine the effective 'to' time for the collected range
        // If we have actual data, use maxDataTimestamp + 1 minute to avoid re-fetching
        // If no data was returned (dataPoints === 0), don't advance the range at all
        // This prevents skipping data that wasn't available yet due to API delays
        let effectiveToTime: Date;

        if (result.dataPoints === 0) {
          // No data collected - don't advance the range, keep fromTime as-is
          // This allows the next collection to retry the same range
          effectiveToTime = new Date(fromTime);
          logger.info({
            testRunId,
            sourceType,
            sourceId: sourceId ?? 'null',
          }, 'No data collected - not advancing collection range');
        } else if (result.maxDataTimestamp) {
          // Use the MAX timestamp from actual data directly (no buffer)
          // Dynatrace API's `from` parameter is effectively exclusive for minute buckets,
          // so if we add 1 minute, we skip the data point at the boundary.
          // By using maxDataTimestamp directly, the next query will start from this time,
          // and UPSERT will handle any duplicate data points.
          effectiveToTime = new Date(result.maxDataTimestamp.getTime());
          logger.info({
            testRunId,
            sourceType,
            sourceId: sourceId ?? 'null',
            maxDataTimestamp: result.maxDataTimestamp.toISOString(),
            effectiveToTime: effectiveToTime.toISOString(),
          }, 'Advancing collection range based on actual data timestamp');
        } else {
          // Fallback: use query's toTime (original behavior)
          effectiveToTime = new Date(toTime);
        }

        // Update collected_ranges to mark this time range as collected
        await db.updateCollectedRanges(
          testRunId,
          sourceType,
          sourceId,
          { from: new Date(fromTime), to: effectiveToTime }
        );

        logger.info({
          testRunId,
          sourceType,
          sourceId: sourceId ?? 'null',
          dataPoints: result.dataPoints ?? 0,
          timeRange: `${fromTime} to ${toTime}`,
        }, 'Incremental collection successful');

        return {
          status: 'success',
          message: `Incremental collection successful for ${sourceType}`,
          data: {
            testRunId,
            sourceType,
            sourceId,
            dataPoints: result.dataPoints ?? 0,
            timeRange: { from: fromTime, to: toTime },
          },
        };
      } else {
        // Collection failed but didn't throw error
        throw new Error(result.error || 'Unknown error');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Record failed range in database
      try {
        await db.recordFailedRange(
          testRunId,
          sourceType,
          sourceId,
          { from: new Date(fromTime), to: new Date(toTime) },
          errorMessage
        );
      } catch (dbError) {
        logger.error({
          testRunId,
          sourceType,
          error: dbError instanceof Error ? dbError.message : String(dbError),
        }, 'Failed to record failed range in database');
      }

      // Determine if we should retry
      if (attempt < maxAttempts) {
        logger.warn({
          testRunId,
          sourceType,
          sourceId: sourceId ?? 'null',
          attempt,
          maxAttempts,
          error: errorMessage,
        }, 'Incremental collection failed, will retry on next scheduler cycle');

        // Return failed status but don't throw (job will be retried by scheduler)
        return {
          status: 'failed',
          message: `Incremental collection failed, attempt ${attempt}/${maxAttempts}`,
          errors: [{
            message: errorMessage,
            details: { attempt, maxAttempts, willRetry: true },
          }],
        };
      } else {
        logger.error({
          testRunId,
          sourceType,
          sourceId: sourceId ?? 'null',
          attempt,
          error: errorMessage,
        }, 'Incremental collection failed, max retries exceeded');

        // Throw error to mark job as permanently failed
        throw new Error(`Incremental collection failed after ${maxAttempts} attempts: ${errorMessage}`);
      }
    }
  };
}

/**
 * Collect Grafana metrics for a specific time range
 *
 * Uses IncrementalMetricsPipeline with time-range filtering for true incremental collection.
 *
 * @param testRunId - Test run identifier
 * @param grafanaInstanceId - Grafana instance ID
 * @param applicationDashboardIds - Dashboard IDs to collect
 * @param fromTime - Start of time range
 * @param toTime - End of time range
 * @returns Collection result
 */
async function collectGrafanaMetrics(
  testRunId: string,
  grafanaInstanceId: string,
  applicationDashboardIds: string[],
  fromTime: Date,
  toTime: Date
): Promise<CollectionResult> {
  logger.info({
    testRunId,
    grafanaInstanceId,
    dashboardCount: applicationDashboardIds.length,
    timeRange: `${fromTime.toISOString()} to ${toTime.toISOString()}`,
  }, 'Collecting Grafana metrics for time range');

  try {
    const pipeline = new IncrementalMetricsPipeline(logger);

    // Execute incremental collection with time range and Grafana-only filtering
    const result = await pipeline.execute({
      testRunId,
      fromTime,
      toTime,
      grafanaInstanceId,
      applicationDashboardIds,
      collectGrafanaMetrics: true,
      collectDynatraceMetrics: false,
      collectPerformanceTestMetrics: false,
    });

    if (!result.success) {
      const errorMessage = result.error
        ? (typeof result.error === 'string' ? result.error : result.error.message)
        : 'Grafana metrics collection failed';

      return {
        success: false,
        error: errorMessage,
      };
    }

    // Extract data points from pipeline result
    const data = result.data as { grafana?: { dataPoints?: number }; totalDataPoints?: number } | undefined;
    const dataPoints = data?.grafana?.dataPoints ?? data?.totalDataPoints ?? 0;

    return {
      success: true,
      dataPoints,
    };

  } catch (error) {
    logger.error({
      testRunId,
      grafanaInstanceId,
      error: error instanceof Error ? error.message : String(error),
    }, 'Grafana metrics collection error');

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Collect Dynatrace metrics for a specific time range
 *
 * Uses IncrementalMetricsPipeline with time-range filtering for true incremental collection.
 *
 * @param testRunId - Test run identifier
 * @param dynatraceConfigId - Dynatrace config ID
 * @param fromTime - Start of time range
 * @param toTime - End of time range
 * @returns Collection result
 */
async function collectDynatraceMetrics(
  testRunId: string,
  dynatraceConfigId: string,
  fromTime: Date,
  toTime: Date
): Promise<CollectionResult> {
  logger.info({
    testRunId,
    dynatraceConfigId,
    timeRange: `${fromTime.toISOString()} to ${toTime.toISOString()}`,
  }, 'Collecting Dynatrace metrics for time range');

  try {
    const pipeline = new IncrementalMetricsPipeline(logger);

    // Execute incremental collection with time range and Dynatrace-only filtering
    const result = await pipeline.execute({
      testRunId,
      fromTime,
      toTime,
      dynatraceConfigId,
      collectGrafanaMetrics: false,
      collectDynatraceMetrics: true,
      collectPerformanceTestMetrics: false,
    });

    if (!result.success) {
      const errorMessage = result.error
        ? (typeof result.error === 'string' ? result.error : result.error.message)
        : 'Dynatrace metrics collection failed';

      return {
        success: false,
        error: errorMessage,
      };
    }

    // Extract data points and max timestamp from pipeline result
    const data = result.data as { dynatrace?: { dataPoints?: number; maxDataTimestamp?: string }; totalDataPoints?: number } | undefined;
    const dataPoints = data?.dynatrace?.dataPoints ?? data?.totalDataPoints ?? 0;
    const maxDataTimestamp = data?.dynatrace?.maxDataTimestamp
      ? new Date(data.dynatrace.maxDataTimestamp)
      : undefined;

    return {
      success: true,
      dataPoints,
      maxDataTimestamp,
    };

  } catch (error) {
    logger.error({
      testRunId,
      dynatraceConfigId,
      error: error instanceof Error ? error.message : String(error),
    }, 'Dynatrace metrics collection error');

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Collect performance test metrics for a specific time range
 *
 * Uses IncrementalMetricsPipeline to collect JMeter/Gatling/k6 metrics with time-range filtering.
 *
 * Concurrency: guarded by a per-test_run_id Redis lock. If another tick is already
 * running for the same test run, this call returns success with `dataPoints: 0` and
 * skips advancing the collected range, so the scheduler retries on its next tick.
 * This prevents the DELETE+INSERT race on `ds_metric_statistics` (issue #134).
 *
 * @param testRunId - Test run identifier
 * @param fromTime - Start of time range
 * @param toTime - End of time range
 * @param ownerToken - Unique token (BullMQ job id) used for lock ownership.
 *   When undefined (e.g. a non-BullMQ caller), a `${testRunId}:${now}` token
 *   is generated locally. Centralizing the fallback here avoids each call
 *   site reinventing it and risking non-unique tokens.
 * @returns Collection result
 */
async function collectPerformanceTestMetrics(
  testRunId: string,
  fromTime: Date,
  toTime: Date,
  ownerToken?: string
): Promise<CollectionResult> {
  const lockKey = `${PERF_TEST_LOCK_PREFIX}${testRunId}`;
  // 8 random bytes appended so two concurrent fallback tokens computed in the
  // same millisecond cannot collide on the release path.
  const token = ownerToken ?? `${testRunId}:${Date.now()}:${randomBytes(8).toString('hex')}`;

  let redis: Awaited<ReturnType<typeof acquireRedisConnection>> | null = null;
  let lockService: JobLockService | null = null;
  let lockAcquired = false;

  try {
    redis = await acquireRedisConnection();
    lockService = new JobLockService(redis);
    lockAcquired = await lockService.acquireKeyLock(
      lockKey,
      token,
      PERF_TEST_LOCK_TTL_SECONDS
    );

    if (!lockAcquired) {
      logger.warn({
        testRunId,
        lockKey,
      }, '⏭️  Skipping performance test metrics tick — another invocation is already in flight');
      // Return success with 0 dataPoints so the worker does NOT advance the
      // collected range; the next scheduler tick will pick up where we left off.
      return { success: true, dataPoints: 0 };
    }

    logger.info({
      testRunId,
      timeRange: `${fromTime.toISOString()} to ${toTime.toISOString()}`,
    }, 'Collecting performance test metrics for time range');

    const pipeline = new IncrementalMetricsPipeline(logger);

    // Execute incremental collection with time range and performance test-only filtering
    const result = await pipeline.execute({
      testRunId,
      fromTime,
      toTime,
      collectGrafanaMetrics: false,
      collectDynatraceMetrics: false,
      collectPerformanceTestMetrics: true,
    });

    if (!result.success) {
      const errorMessage = result.error
        ? (typeof result.error === 'string' ? result.error : result.error.message)
        : 'Performance test metrics collection failed';

      return {
        success: false,
        error: errorMessage,
      };
    }

    // Extract data points from pipeline result
    const data = result.data as { performanceTest?: { dataPoints?: number }; totalDataPoints?: number } | undefined;
    const dataPoints = data?.performanceTest?.dataPoints ?? data?.totalDataPoints ?? 0;

    return {
      success: true,
      dataPoints,
    };

  } catch (error) {
    logger.error({
      testRunId,
      error: error instanceof Error ? error.message : String(error),
    }, 'Performance test metrics collection error');

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (lockAcquired && lockService) {
      try {
        await lockService.releaseKeyLock(lockKey, token);
      } catch (releaseError) {
        logger.warn({
          testRunId,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError),
        }, 'Failed to release perf-test metrics lock — TTL will reclaim');
      }
    }
    if (redis) {
      try {
        releaseRedisConnection(redis);
      } catch (poolError) {
        // Connection-pool release shouldn't normally throw, but if it does
        // we want a log line — silent swallowing here would hide a leak.
        logger.warn({
          testRunId,
          error: poolError instanceof Error ? poolError.message : String(poolError),
        }, 'Failed to release Redis connection back to pool');
      }
    }
  }
}
