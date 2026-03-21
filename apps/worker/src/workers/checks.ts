import { getLogger } from '../lib/utils/logger.js';
import { ChecksJobSchema, type JobResult } from '../types/jobs.js';
import { ChecksPipeline } from '../pipelines/ChecksPipeline.js';

const logger = getLogger('checks-worker');

// Migrated to TypeORM
export function checksWorker() {
  return async (job: { data: unknown }): Promise<JobResult> => {
    const validatedData = ChecksJobSchema.parse(job.data);
    const pipeline = new ChecksPipeline(logger);
    const result = await pipeline.execute(validatedData);

    if (!result.success) {
      throw new Error(`Checks pipeline failed: ${result.error || 'Unknown error'}`);
    }

    return {
      status: 'success',
      message: 'Checks completed',
      data: result.data as Record<string, unknown> | undefined
    };
  };
}