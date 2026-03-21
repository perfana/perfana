import { getLogger } from '../lib/utils/logger.js';
import { type JobResult } from '../types/jobs.js';
import { DynatracePipeline } from '../pipelines/DynatracePipeline.js';

const logger = getLogger('dynatrace-worker');

// Migrated to TypeORM
export function dynatraceWorker() {
  return async (job: { data: unknown }): Promise<JobResult> => {
    // NOTE: Dynatrace configurations are stored in the database (dynatrace_configs table),
    // not in environment variables. The pipeline will check for configured instances
    // and gracefully skip if none are found for the test run.
    const pipeline = new DynatracePipeline(logger);

    // Convert single testRunId to array format expected by pipeline
    const jobData = job.data as any;
    const input = {
      testRunIds: [jobData.testRunId]
    };

    // Validate input
    if (!pipeline.validateInput(input)) {
      throw new Error('Invalid input data for Dynatrace pipeline');
    }

    const result = await pipeline.execute(input);

    if (!result.success) {
      throw new Error(`Dynatrace pipeline failed: ${result.error || 'Unknown error'}`);
    }

    return {
      status: 'success',
      message: 'Dynatrace collection completed',
      data: result.data as Record<string, unknown>
    };
  };
}
