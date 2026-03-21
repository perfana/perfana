import { getLogger } from '../lib/utils/logger.js';
import { StatisticsJobSchema, type JobResult } from '../types/jobs.js';
import { StatisticsPipeline } from '../pipelines/StatisticsPipeline.js';

const logger = getLogger('statistics-worker');

// Migrated to TypeORM
export function statisticsWorker() {
  return async (job: { data: unknown }): Promise<JobResult> => {
    const validatedData = StatisticsJobSchema.parse(job.data);
    const pipeline = new StatisticsPipeline(logger);
    const result = await pipeline.execute(validatedData);

    if (!result.success) {
      throw new Error(`Statistics pipeline failed: ${result.error || 'Unknown error'}`);
    }

    return {
      status: 'success',
      message: 'Statistics completed',
      data: result.data as Record<string, unknown> | undefined
    };
  };
}