/**
 * Pipeline Registry - Eliminates boilerplate in worker files
 *
 * Each pipeline registration declares:
 * - jobName: which BullMQ job name this handles
 * - schema: optional Zod schema for input validation
 * - createPipeline: factory that returns a pipeline instance
 * - transformInput: optional function to reshape job.data before passing to pipeline
 * - successMessage: human-readable label for log messages
 *
 * The registry produces a processor map compatible with simple-workers.ts.
 */

import { getLogger } from '../lib/utils/logger.js';
import { type JobResult } from '../types/jobs.js';
import { type ZodSchema } from 'zod';

interface PipelineInstance {
  execute: (input: any) => Promise<unknown>;
  validateInput?: (data: any) => boolean;
}

export interface PipelineRegistration {
  jobName: string;
  /** Zod validation schema. When omitted, job.data is passed through as-is. */
  schema?: ZodSchema;
  /** Factory to create the pipeline with a logger. */
  createPipeline: (logger: any) => PipelineInstance;
  /** Optional transform applied to job.data (after schema validation) before pipeline.execute(). */
  transformInput?: (data: any) => any;
  /** Human-readable pipeline name for log/error messages. */
  successMessage: string;
  /**
   * When true, a failed result returns { status: 'failed' } instead of throwing.
   * Matches the behavior of control-group-statistics which catches errors gracefully.
   */
  softFail?: boolean;
}

const registry: PipelineRegistration[] = [];

export function registerPipeline(reg: PipelineRegistration): void {
  registry.push(reg);
}

/**
 * Safely convert an error value to a readable string.
 * Fixes the [object Object] bug in error messages.
 */
function formatError(error: any): string {
  if (!error) { return 'Unknown error'; }
  if (typeof error === 'string') { return error; }
  if (error instanceof Error) { return error.message; }
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return JSON.stringify(error);
}

/**
 * Build a processor map from all registered pipelines.
 * Returns { [jobName]: async (job) => JobResult } ready for the analyze queue.
 */
export function createProcessorFromRegistry(): Record<string, (job: { data: unknown }) => Promise<JobResult>> {
  const processors: Record<string, (job: { data: unknown }) => Promise<JobResult>> = {};

  for (const reg of registry) {
    processors[reg.jobName] = async (job: { data: unknown }): Promise<JobResult> => {
      const pipelineLogger = getLogger(reg.jobName);

      try {
        // Step 1: Validate input
        let validatedData: unknown;
        if (reg.schema) {
          validatedData = reg.schema.parse(job.data);
        } else {
          validatedData = job.data;
        }

        // Step 2: Transform input if needed (e.g. dynatrace wraps testRunId in array)
        const pipelineInput = reg.transformInput
          ? reg.transformInput(validatedData)
          : validatedData;

        // Step 3: Create pipeline and optionally validate
        const pipeline = reg.createPipeline(pipelineLogger);

        if (pipeline.validateInput && !pipeline.validateInput(pipelineInput)) {
          throw new Error(`Invalid input data for ${reg.jobName}`);
        }

        // Step 4: Execute
        const result = await pipeline.execute(pipelineInput);
        const r = result as any;

        // Step 5: Handle result
        if (!r.success) {
          const errorMsg = formatError(r.error);

          if (reg.softFail) {
            return {
              status: 'failed',
              message: `${reg.successMessage} failed`,
              errors: [{ message: errorMsg }],
            };
          }

          // Log full error details for pipelines that may have object errors
          pipelineLogger.error({ error: r.error }, `${reg.successMessage} failed with details`);
          throw new Error(`${reg.successMessage} failed: ${errorMsg}`);
        }

        return {
          status: 'success',
          message: `${reg.successMessage} completed`,
          data: r.data as Record<string, unknown> | undefined,
        };
      } catch (error) {
        if (reg.softFail) {
          pipelineLogger.error(`${reg.successMessage} worker failed:`, error);
          return {
            status: 'failed',
            message: String(error),
            errors: [{ message: String(error) }],
          };
        }
        throw error;
      }
    };
  }

  return processors;
}
