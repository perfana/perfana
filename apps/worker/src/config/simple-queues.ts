/**
 * Simplified Queue Configuration - Based on Working Minimal Test
 *
 * This configuration achieves <10ms job pickup by:
 * 1. NO priority values anywhere
 * 2. NO rate limiting
 * 3. Separate blocking connections per worker
 * 4. drainDelay > 50ms (enables BRPOPLPUSH blocking mode)
 *
 * Architecture: 2 simple queues
 * - perfana-analyze: Single test run analysis pipeline
 * - perfana-batch: Batch reevaluation pipeline
 */

import { JobsOptions } from 'bullmq';
import { getConfig } from './environment.js';

/**
 * Queue names - simple and clear
 */
export const SIMPLE_QUEUES = {
  ANALYZE: 'perfana-analyze',
  BATCH: 'perfana-batch',
} as const;

export type SimpleQueueName = typeof SIMPLE_QUEUES[keyof typeof SIMPLE_QUEUES];

/**
 * Job type to queue mapping
 */
export const JOB_TO_QUEUE_MAP: Record<string, SimpleQueueName> = {
  // Single test run pipeline → perfana-analyze
  'analyze-test': SIMPLE_QUEUES.ANALYZE,
  'metrics-collection': SIMPLE_QUEUES.ANALYZE,
  'statistics-calculation': SIMPLE_QUEUES.ANALYZE,
  'control-groups-pipeline': SIMPLE_QUEUES.ANALYZE,
  'adapt-analysis': SIMPLE_QUEUES.ANALYZE,
  'checks-evaluation': SIMPLE_QUEUES.ANALYZE,
  'panels-processing': SIMPLE_QUEUES.ANALYZE,
  'performance-test-metrics': SIMPLE_QUEUES.ANALYZE,
  'dynatrace-collection': SIMPLE_QUEUES.ANALYZE,
  'reevaluate-checks': SIMPLE_QUEUES.ANALYZE,

  // Batch processing → perfana-batch
  'batch-analysis': SIMPLE_QUEUES.BATCH,
  'batch-flow': SIMPLE_QUEUES.BATCH,
  'reevaluation-batch': SIMPLE_QUEUES.BATCH,
  'orchestrate-reevaluate-batch': SIMPLE_QUEUES.BATCH,
};

/**
 * Simple worker configuration - based on test-blocking.cjs that achieved 8ms pickup
 */
export interface SimpleWorkerConfig {
  concurrency: number;
  drainDelay: number;  // MUST be > 50ms for blocking mode
}

// Worker configs are now dynamic - loaded from environment variables
let workerConfigsCache: Record<SimpleQueueName, SimpleWorkerConfig> | null = null;

export function getSimpleWorkerConfigs(): Record<SimpleQueueName, SimpleWorkerConfig> {
  if (workerConfigsCache) {
    return workerConfigsCache;
  }

  const config = getConfig();

  workerConfigsCache = {
    [SIMPLE_QUEUES.ANALYZE]: {
      concurrency: config.WORKER_ANALYZE_CONCURRENCY,
      drainDelay: 100, // Enable BRPOPLPUSH blocking mode
    },
    [SIMPLE_QUEUES.BATCH]: {
      concurrency: config.WORKER_BATCH_CONCURRENCY,
      drainDelay: 100, // Enable BRPOPLPUSH blocking mode
    },
  };

  return workerConfigsCache;
}

/**
 * Simple job options - NO priority, minimal configuration
 */
export interface SimpleJobOptions extends JobsOptions {
  attempts: number;
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  removeOnComplete?: number | boolean | { age?: number; count?: number };
  removeOnFail?: number | boolean | { age?: number; count?: number };
}

/**
 * Default job options per job type - NO priority anywhere
 */
export const SIMPLE_JOB_OPTIONS: Record<string, SimpleJobOptions> = {
  'analyze-test': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 20,
  },
  'metrics-collection': {
    attempts: 5, // External API, more retries
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 25,
  },
  'statistics-calculation': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 75,
    removeOnFail: 15,
  },
  'control-groups-pipeline': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 50,
    removeOnFail: 10,
  },
  'adapt-analysis': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 15,
  },
  'checks-evaluation': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 20,
  },
  'panels-processing': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 75,
    removeOnFail: 15,
  },
  'performance-test-metrics': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 75,
    removeOnFail: 15,
  },
  'dynatrace-collection': {
    attempts: 4,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: 50,
    removeOnFail: 10,
  },
  'reevaluate-checks': {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 10,
  },
  'batch-analysis': {
    attempts: 2,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: 10,
    removeOnFail: 5,
  },
  'batch-flow': {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: 15,
    removeOnFail: 5,
  },
  'reevaluation-batch': {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: 10,
    removeOnFail: 5,
  },
  'orchestrate-reevaluate-batch': {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: 10,
    removeOnFail: 5,
  },
};

/**
 * Get queue name for a job type
 */
export function getQueueForJobType(jobType: string): SimpleQueueName {
  return JOB_TO_QUEUE_MAP[jobType] || SIMPLE_QUEUES.ANALYZE;
}

/**
 * Get worker config for a queue
 */
export function getWorkerConfig(queueName: SimpleQueueName): SimpleWorkerConfig {
  const configs = getSimpleWorkerConfigs();
  return configs[queueName];
}

/**
 * Get job options for a job type
 */
export function getJobOptions(jobType: string): SimpleJobOptions {
  return SIMPLE_JOB_OPTIONS[jobType] || SIMPLE_JOB_OPTIONS['analyze-test'];
}
