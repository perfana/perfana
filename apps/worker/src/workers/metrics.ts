import { getLogger } from '../lib/utils/logger.js';
import { MetricsCollectionJobSchema, type MetricsCollectionJob as _MetricsCollectionJob, type JobResult } from '../types/jobs.js';
import { MetricsPipeline } from '../pipelines/MetricsPipeline.js';

const logger = getLogger('metrics-collection-worker');

/**
 * Metrics Collection Worker - Migrated to TypeORM
 * Handles individual metrics collection jobs for batch processing
 */
export function metricsCollectionWorker() {
  return async (job: { data: unknown }): Promise<JobResult> => {
    const validatedData = MetricsCollectionJobSchema.parse(job.data);
    const pipeline = new MetricsPipeline(logger);

    const result = await pipeline.execute(validatedData);

    if (!result.success) {
      throw new Error(`Metrics collection failed: ${result.error || 'Unknown error'}`);
    }

    return {
      status: 'success',
      message: `Metrics collection completed for test run ${validatedData.testRunId}`,
      data: result.data as Record<string, unknown> | undefined
    };
  };
}