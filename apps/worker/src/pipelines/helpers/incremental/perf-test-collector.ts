/**
 * Performance Test Metrics Collector for Incremental Metrics Pipeline
 *
 * Handles performance test metrics collection for specific time ranges.
 * Uses PerformanceTestMetricsPipeline to process requests_raw and transactions
 * tables and store aggregated metrics in ds_metrics.
 */

import type { Logger } from 'pino';
import { PerformanceTestMetricsPipeline } from '../../PerformanceTestMetricsPipeline.js';
import type { CollectionResult } from './types.js';

/**
 * Performance Test Collector
 *
 * Manages performance test metrics collection for the Incremental Metrics Pipeline.
 */
export class PerformanceTestCollector {
  constructor(private logger: Logger) {}

  /**
   * Collect performance test metrics for a specific time range
   *
   * @param testRunId - Test run ID
   * @param fromTime - Start of time range
   * @param toTime - End of time range
   * @returns Collection result with data points and errors
   */
  async collect(
    testRunId: string,
    fromTime: Date,
    toTime: Date
  ): Promise<CollectionResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    try {
      this.logger.info(
        `Collecting performance test metrics for time range: ${fromTime.toISOString()} to ${toTime.toISOString()}`
      );

      // Use PerformanceTestMetricsPipeline with time range parameters
      const pipeline = new PerformanceTestMetricsPipeline(this.logger);
      const result = await pipeline.execute({
        testRunId,
        fromTime,
        toTime,
      });

      const duration = Date.now() - startTime;

      if (!result.success) {
        const errorMessage = result.error
          ? (typeof result.error === 'string' ? result.error : result.error.message)
          : 'Performance test metrics pipeline failed';
        errors.push(errorMessage);

        return {
          success: false,
          dataPoints: 0,
          errors,
          duration,
        };
      }

      // Extract metrics count from pipeline result
      const pipelineData = result.data as Record<string, unknown> | undefined;
      const metricsCreated = (pipelineData?.metricsCreated as number) ?? 0;

      this.logger.info(
        `Performance test metrics collection completed: ${metricsCreated} metrics stored in ds_metrics`
      );

      return {
        success: true,
        dataPoints: metricsCreated,
        errors,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error
        ? error.message
        : 'Unknown performance test collection error';
      this.logger.error(`Performance test collection failed: ${errorMessage}`);
      errors.push(errorMessage);

      return {
        success: false,
        dataPoints: 0,
        errors,
        duration,
      };
    }
  }
}
