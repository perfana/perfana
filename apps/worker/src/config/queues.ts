/**
 * Enhanced Queue Configuration for BullMQ
 * Implements the queue organization strategy from BULLMQ_EXTERNAL_INTEGRATION.md
 * UPDATED: Uses standardized priority system from priorities.ts
 */

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

