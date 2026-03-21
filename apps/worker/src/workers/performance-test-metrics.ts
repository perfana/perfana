import { type JobResult } from '../types/jobs.js';
import { PerformanceTestMetricsPipeline } from '../pipelines/PerformanceTestMetricsPipeline.js';
import { getLogger } from '../lib/utils/logger.js';

const logger = getLogger('performance-test-metrics-worker');

export function performanceTestMetricsWorker() {
  return async (job: { data: unknown }): Promise<JobResult> => {
    const pipeline = new PerformanceTestMetricsPipeline(logger);

    const result = await pipeline.execute(job.data as { testRunId: string });

    if (!result.success) {
      // Log full error details including stack trace
      logger.error({ error: result.error }, 'Performance test metrics pipeline failed with details');
      throw new Error(`Performance test metrics pipeline failed: ${result.error?.message || 'Unknown error'}`);
    }

    return {
      status: 'success',
      message: 'Performance test metrics completed',
      data: result.data as Record<string, unknown>
    };
  };
}
