import { type JobResult } from '../types/jobs.js';
import { PanelsPipeline } from '../pipelines/PanelsPipeline.js';
import { getLogger } from '../lib/utils/logger.js';

const logger = getLogger('panels-worker');

export function panelsWorker() {
  return async (job: { data: unknown }): Promise<JobResult> => {
    const pipeline = new PanelsPipeline(logger);

    // Validate input
    if (!pipeline.validateInput(job.data)) {
      throw new Error('Invalid input data for panels pipeline');
    }

    const result = await pipeline.execute(job.data as { testRunId: string; includeDynatrace?: boolean });

    if (!result.success) {
      throw new Error(`Panels pipeline failed: ${result.error || 'Unknown error'}`);
    }

    return {
      status: 'success',
      message: 'Panels completed',
      data: result.data as Record<string, unknown>
    };
  };
}