import { getLogger } from '../lib/utils/logger.js';
import { ControlGroupsJobSchema, type JobResult } from '../types/jobs.js';
import { ControlGroupsPipeline } from '../pipelines/ControlGroupsPipeline.js';

const logger = getLogger('control-groups-worker');

// Migrated to TypeORM
export function controlGroupsWorker() {
  return async (job: { data: unknown }): Promise<JobResult> => {
    const validatedData = ControlGroupsJobSchema.parse(job.data);
    const pipeline = new ControlGroupsPipeline(logger);
    const result = await pipeline.execute(validatedData);

    if (!result.success) {
      throw new Error(`Control groups pipeline failed: ${result.error || 'Unknown error'}`);
    }

    return {
      status: 'success',
      message: 'Control groups completed',
      data: result.data as Record<string, unknown> | undefined
    };
  };
}