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

import { JobsOptions, KeepJobs } from 'bullmq';
import { getConfig } from './environment.js';

// ── Retry & backoff constants ──────────────────────────────────────────
// Each job type has a tuned retry/backoff profile based on its failure mode:
// - External API calls (Grafana, Dynatrace) get more attempts with shorter initial delays
//   because transient network issues are common and resolve quickly.
// - Batch/orchestration jobs get fewer attempts with longer delays because they are
//   heavyweight and a rapid retry would waste resources.
// - Internal compute jobs (statistics, ADAPT) get moderate settings because failures
//   are usually data-related and unlikely to self-heal with more retries.

/** Standard retry count for internal compute jobs */
const ATTEMPTS_STANDARD = 3;

/** Retry count for external API calls (Grafana) — higher due to transient network errors */
const ATTEMPTS_EXTERNAL_API = 5;

/** Retry count for Dynatrace — high but slightly less than Grafana due to longer query times */
const ATTEMPTS_DYNATRACE = 4;

/** Retry count for reevaluate-checks — only 2 because input data is already validated */
const ATTEMPTS_REEVALUATE = 2;

/** Retry count for batch/orchestration jobs — only 2 to avoid expensive duplicate work */
const ATTEMPTS_BATCH = 2;

/** Short backoff (ms) for fast-recovering failures (e.g., Grafana rate limits) */
const BACKOFF_SHORT_MS = 2_000;

/** Medium backoff (ms) for moderate recovery time (statistics, panels) */
const BACKOFF_MEDIUM_MS = 3_000;

/** Standard backoff (ms) for general retries (analyze, ADAPT, reevaluate) */
const BACKOFF_STANDARD_MS = 5_000;

/** Long backoff (ms) for Dynatrace — their API needs time to recover from rate limits */
const BACKOFF_DYNATRACE_MS = 10_000;

/** Batch backoff (ms) for orchestration jobs — long delay to let downstream jobs settle */
const BACKOFF_BATCH_MS = 30_000;

/** Extra-long backoff (ms) for top-level batch analysis — avoid thundering herd on retry */
const BACKOFF_BATCH_LONG_MS = 60_000;

/** BullMQ drainDelay (ms) — must be >50ms to enable BRPOPLPUSH blocking mode for fast pickup */
const DRAIN_DELAY_MS = 100;

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
  'transaction-stats-rollup': SIMPLE_QUEUES.ANALYZE,

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
      drainDelay: DRAIN_DELAY_MS,
    },
    [SIMPLE_QUEUES.BATCH]: {
      concurrency: config.WORKER_BATCH_CONCURRENCY,
      drainDelay: DRAIN_DELAY_MS,
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
  removeOnComplete?: number | boolean | KeepJobs;
  removeOnFail?: number | boolean | KeepJobs;
}

/**
 * Default job options per job type - NO priority anywhere
 */
export const SIMPLE_JOB_OPTIONS: Record<string, SimpleJobOptions> = {
  'analyze-test': {
    attempts: ATTEMPTS_STANDARD,
    backoff: { type: 'exponential', delay: BACKOFF_STANDARD_MS },
    removeOnComplete: 50,
    removeOnFail: 20,
  },
  'metrics-collection': {
    attempts: ATTEMPTS_EXTERNAL_API,
    backoff: { type: 'exponential', delay: BACKOFF_SHORT_MS },
    removeOnComplete: 100,
    removeOnFail: 25,
  },
  'statistics-calculation': {
    attempts: ATTEMPTS_STANDARD,
    backoff: { type: 'exponential', delay: BACKOFF_MEDIUM_MS },
    removeOnComplete: 75,
    removeOnFail: 15,
  },
  'control-groups-pipeline': {
    attempts: ATTEMPTS_STANDARD,
    backoff: { type: 'exponential', delay: BACKOFF_MEDIUM_MS },
    removeOnComplete: 50,
    removeOnFail: 10,
  },
  'adapt-analysis': {
    attempts: ATTEMPTS_STANDARD,
    backoff: { type: 'exponential', delay: BACKOFF_STANDARD_MS },
    removeOnComplete: 50,
    removeOnFail: 15,
  },
  'checks-evaluation': {
    attempts: ATTEMPTS_STANDARD,
    backoff: { type: 'exponential', delay: BACKOFF_SHORT_MS },
    removeOnComplete: 100,
    removeOnFail: 20,
  },
  'panels-processing': {
    attempts: ATTEMPTS_STANDARD,
    backoff: { type: 'exponential', delay: BACKOFF_SHORT_MS },
    removeOnComplete: 75,
    removeOnFail: 15,
  },
  'performance-test-metrics': {
    attempts: ATTEMPTS_STANDARD,
    backoff: { type: 'exponential', delay: BACKOFF_MEDIUM_MS },
    removeOnComplete: 75,
    removeOnFail: 15,
  },
  'dynatrace-collection': {
    attempts: ATTEMPTS_DYNATRACE,
    backoff: { type: 'exponential', delay: BACKOFF_DYNATRACE_MS },
    removeOnComplete: 50,
    removeOnFail: 10,
  },
  'reevaluate-checks': {
    attempts: ATTEMPTS_REEVALUATE,
    backoff: { type: 'fixed', delay: BACKOFF_STANDARD_MS },
    removeOnComplete: 50,
    removeOnFail: 10,
  },
  'batch-analysis': {
    attempts: ATTEMPTS_BATCH,
    backoff: { type: 'exponential', delay: BACKOFF_BATCH_LONG_MS },
    removeOnComplete: 10,
    removeOnFail: 5,
  },
  'batch-flow': {
    attempts: ATTEMPTS_BATCH,
    backoff: { type: 'exponential', delay: BACKOFF_BATCH_MS },
    removeOnComplete: 15,
    removeOnFail: 5,
  },
  'reevaluation-batch': {
    attempts: ATTEMPTS_BATCH,
    backoff: { type: 'exponential', delay: BACKOFF_BATCH_MS },
    removeOnComplete: 10,
    removeOnFail: 5,
  },
  'orchestrate-reevaluate-batch': {
    attempts: ATTEMPTS_BATCH,
    backoff: { type: 'exponential', delay: BACKOFF_BATCH_MS },
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
