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
import type pino from 'pino';
import type { Job } from 'bullmq';
import { type PipelineResult } from '../types/pipeline.js';
import { getRedisPool } from '../config/redis-pool.js';
import { HEAVY_STAGES, HeavyStageMutex } from '../services/HeavyStageMutex.js';

/** The slice of a BullMQ Job the registry processors touch. */
export type RegistryJob = Pick<Job, 'id' | 'data' | 'updateProgress'>;

/**
 * Serialise a heavy pipeline job behind the deployment-wide HeavyStageMutex — the same
 * lock the analyze-test orchestrator takes around these stages, so a re-evaluate's
 * statistics job and a finishing test's statistics stage never aggregate at once.
 *
 * The CHILD holds the lock, not the re-evaluate orchestrator that enqueued it: the
 * orchestrator runs on perfana-batch while analyze-test jobs park on perfana-analyze
 * waiting for the same lock, so an orchestrator-held lock could pin both analyze slots
 * behind a child that can never be picked up. While parked the job's BullMQ progress is
 * `{ queuedBehind: <holder> }`, which waitForJobs reads to stop its own clock.
 */
async function withHeavyStageLock<T>(jobName: string, job: RegistryJob, fn: () => Promise<T>): Promise<T> {
  if (!HEAVY_STAGES.has(jobName)) {return fn();}
  const pool = getRedisPool();
  const redis = await pool.acquire();
  try {
    if (!job.id) {throw new Error(`${jobName} job has no id; refusing to take the heavy-stage lock anonymously`);}
    const release = await new HeavyStageMutex(redis, job.id).acquire(async (holder) => {
      await job.updateProgress({ queuedBehind: holder });
    });
    try {
      // Clears { queuedBehind } so waitForJobs starts charging the running clock —
      // parkedBehind() reads that marker; without this reset the child looks parked forever.
      await job.updateProgress(0);
      return await fn();
    } finally {
      await release();
    }
  } finally {
    pool.release(redis);
  }
}

interface PipelineInstance {
  execute(input: unknown): Promise<unknown>;
  validateInput?(data: unknown): boolean;
}

export interface PipelineRegistration {
  jobName: string;
  /** Zod validation schema. When omitted, job.data is passed through as-is. */
  schema?: ZodSchema;
  /** Factory to create the pipeline with a logger. */
  createPipeline: (logger: pino.Logger) => PipelineInstance;
  /** Optional transform applied to job.data (after schema validation) before pipeline.execute(). */
  transformInput?: (data: unknown) => unknown;
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
function formatError(error: unknown): string {
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
export function createProcessorFromRegistry(): Record<string, (job: RegistryJob) => Promise<JobResult>> {
  const processors: Record<string, (job: RegistryJob) => Promise<JobResult>> = {};

  for (const reg of registry) {
    processors[reg.jobName] = async (job: RegistryJob): Promise<JobResult> => {
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

        // Step 4: Execute (heavy pipelines one at a time across the deployment)
        const r = await withHeavyStageLock(reg.jobName, job, () => pipeline.execute(pipelineInput)) as PipelineResult;

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
