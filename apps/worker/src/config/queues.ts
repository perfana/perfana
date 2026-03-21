/**
 * Enhanced Queue Configuration for BullMQ
 * Implements the queue organization strategy from BULLMQ_EXTERNAL_INTEGRATION.md
 * UPDATED: Uses standardized priority system from priorities.ts
 */

import { PRIORITY_LEVELS as _PRIORITY_LEVELS, QUEUE_PRIORITIES, PRIORITY_CONFIG } from './priorities.js';

export const QUEUE_TYPES = {
  // High Priority - Critical Path
  CRITICAL: 'perfana-critical',           // analyze-test main pipeline

  // Medium Priority - Parallel Processing
  PROCESSING: 'perfana-processing',       // metrics, statistics, panels

  // Low Priority - Background Tasks
  BACKGROUND: 'perfana-background',       // dynatrace, cleanup

  // Special Queues
  BATCH: 'perfana-batch',                // batch operations
  DELAYED: 'perfana-delayed'             // scheduled/retry jobs
} as const;

export type QueueType = typeof QUEUE_TYPES[keyof typeof QUEUE_TYPES];

/**
 * Queue-specific configurations based on priority and use case
 */
export const QUEUE_CONFIGURATIONS = {
  [QUEUE_TYPES.CRITICAL]: {
    priority: QUEUE_PRIORITIES[QUEUE_TYPES.CRITICAL],
    concurrency: PRIORITY_CONFIG.getRecommendedConcurrency(QUEUE_PRIORITIES[QUEUE_TYPES.CRITICAL]),
    // rateLimiter: PRIORITY_CONFIG.getRecommendedRateLimit(QUEUE_PRIORITIES[QUEUE_TYPES.CRITICAL]), // DISABLED: Breaks blocking mode
    defaultJobOptions: {
      ...PRIORITY_CONFIG.getCleanupPolicy(QUEUE_PRIORITIES[QUEUE_TYPES.CRITICAL]),
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 }
      // priority: QUEUE_PRIORITIES[QUEUE_TYPES.CRITICAL] // DISABLED: Job priorities force Lua scripts, breaking BRPOPLPUSH
    }
  },

  [QUEUE_TYPES.PROCESSING]: {
    priority: QUEUE_PRIORITIES[QUEUE_TYPES.PROCESSING],
    concurrency: PRIORITY_CONFIG.getRecommendedConcurrency(QUEUE_PRIORITIES[QUEUE_TYPES.PROCESSING]),
    // rateLimiter: PRIORITY_CONFIG.getRecommendedRateLimit(QUEUE_PRIORITIES[QUEUE_TYPES.PROCESSING]), // DISABLED: Breaks blocking mode
    defaultJobOptions: {
      ...PRIORITY_CONFIG.getCleanupPolicy(QUEUE_PRIORITIES[QUEUE_TYPES.PROCESSING]),
      attempts: 5,
      backoff: { type: 'exponential' as const, delay: 2000 }
      // priority: QUEUE_PRIORITIES[QUEUE_TYPES.PROCESSING] // DISABLED: Job priorities force Lua scripts, breaking BRPOPLPUSH
    }
  },

  [QUEUE_TYPES.BACKGROUND]: {
    priority: QUEUE_PRIORITIES[QUEUE_TYPES.BACKGROUND],
    concurrency: PRIORITY_CONFIG.getRecommendedConcurrency(QUEUE_PRIORITIES[QUEUE_TYPES.BACKGROUND]),
    // rateLimiter: PRIORITY_CONFIG.getRecommendedRateLimit(QUEUE_PRIORITIES[QUEUE_TYPES.BACKGROUND]), // DISABLED: Breaks blocking mode
    defaultJobOptions: {
      ...PRIORITY_CONFIG.getCleanupPolicy(QUEUE_PRIORITIES[QUEUE_TYPES.BACKGROUND]),
      attempts: 2,
      backoff: { type: 'fixed' as const, delay: 10000 }
      // priority: QUEUE_PRIORITIES[QUEUE_TYPES.BACKGROUND] // DISABLED: Job priorities force Lua scripts, breaking BRPOPLPUSH
    }
  },

  [QUEUE_TYPES.BATCH]: {
    priority: QUEUE_PRIORITIES[QUEUE_TYPES.BATCH],
    concurrency: PRIORITY_CONFIG.getRecommendedConcurrency(QUEUE_PRIORITIES[QUEUE_TYPES.BATCH]),
    // rateLimiter: { max: 10, duration: 60000 }, // DISABLED: Breaks blocking mode
    defaultJobOptions: {
      ...PRIORITY_CONFIG.getCleanupPolicy(QUEUE_PRIORITIES[QUEUE_TYPES.BATCH]),
      attempts: 2,
      backoff: { type: 'exponential' as const, delay: 30000 }
      // priority: QUEUE_PRIORITIES[QUEUE_TYPES.BATCH] // DISABLED: Job priorities force Lua scripts, breaking BRPOPLPUSH
    }
  },

  [QUEUE_TYPES.DELAYED]: {
    priority: QUEUE_PRIORITIES[QUEUE_TYPES.DELAYED],
    concurrency: PRIORITY_CONFIG.getRecommendedConcurrency(QUEUE_PRIORITIES[QUEUE_TYPES.DELAYED]),
    // rateLimiter: PRIORITY_CONFIG.getRecommendedRateLimit(QUEUE_PRIORITIES[QUEUE_TYPES.DELAYED]), // DISABLED: Breaks blocking mode
    defaultJobOptions: {
      ...PRIORITY_CONFIG.getCleanupPolicy(QUEUE_PRIORITIES[QUEUE_TYPES.DELAYED]),
      attempts: 1
      // priority: QUEUE_PRIORITIES[QUEUE_TYPES.DELAYED] // DISABLED: Job priorities force Lua scripts, breaking BRPOPLPUSH
    }
  }
} as const;

/**
 * Job to Queue mapping - determines which queue each job type uses
 */
export const JOB_QUEUE_MAPPING = {
  // Critical pipeline jobs
  'analyze-test': QUEUE_TYPES.CRITICAL,
  'batch-analysis': QUEUE_TYPES.BATCH,
  'batch-flow': QUEUE_TYPES.BATCH,

  // Processing stage jobs
  'metrics-collection': QUEUE_TYPES.PROCESSING,
  'statistics-calculation': QUEUE_TYPES.PROCESSING,
  'checks-evaluation': QUEUE_TYPES.PROCESSING,
  'adapt-analysis': QUEUE_TYPES.PROCESSING,
  'panels-processing': QUEUE_TYPES.PROCESSING,
  'reevaluate-checks': QUEUE_TYPES.PROCESSING,
  'control-groups-pipeline': QUEUE_TYPES.PROCESSING,

  // Background jobs
  'dynatrace-collection': QUEUE_TYPES.BACKGROUND,
  'cleanup-expired': QUEUE_TYPES.BACKGROUND,
  'maintenance': QUEUE_TYPES.BACKGROUND,

  // Special jobs
  'reevaluation-batch': QUEUE_TYPES.BATCH,
  'orchestrate-reevaluate-batch': QUEUE_TYPES.BATCH,
  'delayed-retry': QUEUE_TYPES.DELAYED
} as const;

export type JobName = keyof typeof JOB_QUEUE_MAPPING;

/**
 * Get the appropriate queue type for a job name
 */
export function getQueueForJob(jobName: string): QueueType {
  return JOB_QUEUE_MAPPING[jobName as JobName] || QUEUE_TYPES.PROCESSING;
}

/**
 * Get queue configuration for a specific queue type
 */
export function getQueueConfig(queueType: QueueType) {
  return QUEUE_CONFIGURATIONS[queueType];
}