import { getLogger } from '../lib/utils/logger.js';
import { type JobResult } from '../types/jobs.js';
import { ControlGroupStatisticsPipeline } from '../pipelines/ControlGroupStatisticsPipeline.js';
import { z } from 'zod';

const logger = getLogger('control-group-statistics-worker');

// Schema for control group statistics job data
export const ControlGroupStatisticsJobSchema = z.object({
  controlGroupIds: z.array(z.string()).optional(),
  testRunIds: z.array(z.string()).optional()
}).refine(
  data => (data.controlGroupIds && data.controlGroupIds.length > 0) ||
          (data.testRunIds && data.testRunIds.length > 0),
  { message: 'Either controlGroupIds or testRunIds must be provided' }
);

export type ControlGroupStatisticsJobData = z.infer<typeof ControlGroupStatisticsJobSchema>;

// Migrated to TypeORM
export function controlGroupStatisticsWorker() {
  return async (job: { data: unknown }): Promise<JobResult> => {
    try {
      const validatedData = ControlGroupStatisticsJobSchema.parse(job.data);
      const pipeline = new ControlGroupStatisticsPipeline(logger);
      const result = await pipeline.execute(validatedData);

      return {
        status: result.success ? 'success' : 'failed',
        message: `Control group statistics ${result.success ? 'completed' : 'failed'}`,
        data: result.data as Record<string, unknown> | undefined
      };
    } catch (error) {
      logger.error('Control group statistics worker failed:', error);
      return {
        status: 'failed',
        message: String(error),
        errors: [{ message: String(error) }]
      };
    }
  };
}