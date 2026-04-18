import { Job } from 'bullmq';
import { getLogger } from '../lib/utils/logger.js';
import { IncrementalCollectionJobSchema, type IncrementalCollectionJob as _IncrementalCollectionJob, type JobResult } from '../types/jobs.js';
import { IncrementalMetricsPipeline } from '../pipelines/IncrementalMetricsPipeline.js';
import { PerformanceTestMetricsPipeline as _PerformanceTestMetricsPipeline } from '../pipelines/PerformanceTestMetricsPipeline.js';
import { getDatabaseService } from '../common/database-accessor.js';

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
            new Date(toTime)
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
    const data = result.data as any;
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
    const data = result.data as any;
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
 * @param testRunId - Test run identifier
 * @param fromTime - Start of time range
 * @param toTime - End of time range
 * @returns Collection result
 */
async function collectPerformanceTestMetrics(
  testRunId: string,
  fromTime: Date,
  toTime: Date
): Promise<CollectionResult> {
  logger.info({
    testRunId,
    timeRange: `${fromTime.toISOString()} to ${toTime.toISOString()}`,
  }, 'Collecting performance test metrics for time range');

  try {
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
    const data = result.data as any;
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
  }
}
