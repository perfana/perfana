import { getLogger } from '../lib/utils/logger.js';
import { AdaptJobSchema, type JobResult } from '../types/jobs.js';
import { AdaptPipeline } from '../pipelines/AdaptPipeline.js';

const logger = getLogger('adapt-worker');

// Migrated to TypeORM
export function adaptWorker() {
  return async (job: { data: unknown }): Promise<JobResult> => {
    const validatedData = AdaptJobSchema.parse(job.data);
    const pipeline = new AdaptPipeline(logger);
    const result = await pipeline.execute(validatedData);

    if (!result.success) {
      throw new Error(`ADAPT pipeline failed: ${result.error || 'Unknown error'}`);
    }

    return {
      status: 'success',
      message: 'ADAPT completed',
      data: result.data as Record<string, unknown> | undefined
    };
  };
}