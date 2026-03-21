/**
 * Unified Priority System for BullMQ Jobs and Queues
 * CRITICAL FIX: Standardizes priority values across all configurations
 */

/**
 * Priority levels - Lower numbers = Higher priority (BullMQ standard)
 * This replaces the inconsistent string/number priority systems
 */
export const PRIORITY_LEVELS = {
  CRITICAL: 1,    // Highest priority - analyze-test, critical failures
  HIGH: 2,        // High priority - metrics, statistics, checks, adapt
  MEDIUM: 3,      // Medium priority - panels, reevaluate, batch coordination
  LOW: 4,         // Low priority - dynatrace, cleanup, background tasks
  DELAYED: 5      // Lowest priority - scheduled/retry jobs
} as const;

export type PriorityLevel = typeof PRIORITY_LEVELS[keyof typeof PRIORITY_LEVELS];

/**
 * Priority mapping for job types
 * Replaces string-based priorities in ENHANCED_JOB_CONFIGS
 */
export const JOB_PRIORITIES: Record<string, PriorityLevel> = {
  // Critical pipeline jobs
  'analyze-test': PRIORITY_LEVELS.CRITICAL,

  // High priority processing jobs
  'metrics-collection': PRIORITY_LEVELS.HIGH,
  'statistics-calculation': PRIORITY_LEVELS.HIGH,
  'checks-evaluation': PRIORITY_LEVELS.HIGH,
  'adapt-analysis': PRIORITY_LEVELS.HIGH,

  // High priority jobs (aligned with processing queue)
  'panels-processing': PRIORITY_LEVELS.HIGH,
  'reevaluate-checks': PRIORITY_LEVELS.HIGH,
  'control-groups-pipeline': PRIORITY_LEVELS.HIGH,

  // Medium priority jobs
  'batch-analysis': PRIORITY_LEVELS.MEDIUM,
  'batch-flow': PRIORITY_LEVELS.MEDIUM,
  'reevaluation-batch': PRIORITY_LEVELS.MEDIUM,
  'orchestrate-reevaluate-batch': PRIORITY_LEVELS.HIGH, // User-initiated, higher priority

  // Low priority background jobs
  'dynatrace-collection': PRIORITY_LEVELS.LOW,
  'cleanup-expired': PRIORITY_LEVELS.LOW,
  'maintenance': PRIORITY_LEVELS.LOW,

  // Delayed/retry jobs
  'delayed-retry': PRIORITY_LEVELS.DELAYED
} as const;

/**
 * Queue priority mapping
 * Aligns queue priorities with job priorities
 */
export const QUEUE_PRIORITIES: Record<string, PriorityLevel> = {
  'perfana-critical': PRIORITY_LEVELS.CRITICAL,
  'perfana-processing': PRIORITY_LEVELS.HIGH,
  'perfana-background': PRIORITY_LEVELS.LOW,
  'perfana-batch': PRIORITY_LEVELS.MEDIUM,
  'perfana-delayed': PRIORITY_LEVELS.DELAYED
} as const;

/**
 * Get priority for a specific job type
 */
export function getJobPriority(jobName: string): PriorityLevel {
  return JOB_PRIORITIES[jobName] || PRIORITY_LEVELS.MEDIUM;
}

/**
 * Get priority for a specific queue
 */
export function getQueuePriority(queueName: string): PriorityLevel {
  return QUEUE_PRIORITIES[queueName] || PRIORITY_LEVELS.MEDIUM;
}

/**
 * Validate priority consistency between job and its assigned queue
 */
export function validateJobQueuePriority(jobName: string, queueName: string): {
  isValid: boolean;
  jobPriority: PriorityLevel;
  queuePriority: PriorityLevel;
  recommendation?: string;
} {
  const jobPriority = getJobPriority(jobName);
  const queuePriority = getQueuePriority(queueName);

  // Job priority should be same or higher than queue priority
  const isValid = jobPriority <= queuePriority;

  return {
    isValid,
    jobPriority,
    queuePriority,
    recommendation: !isValid
      ? `Job ${jobName} (priority ${jobPriority}) should not be in queue ${queueName} (priority ${queuePriority})`
      : undefined
  };
}

/**
 * Priority-based configuration helpers
 */
export const PRIORITY_CONFIG = {
  /**
   * Get recommended concurrency based on priority level
   */
  getRecommendedConcurrency(priority: PriorityLevel): number {
    switch (priority) {
      case PRIORITY_LEVELS.CRITICAL: return 8;  // Increased from 3
      case PRIORITY_LEVELS.HIGH: return 5;
      case PRIORITY_LEVELS.MEDIUM: return 3;
      case PRIORITY_LEVELS.LOW: return 2;
      case PRIORITY_LEVELS.DELAYED: return 1;
      default: return 3;
    }
  },

  /**
   * Get recommended rate limit based on priority level
   */
  getRecommendedRateLimit(priority: PriorityLevel): { max: number; duration: number } {
    switch (priority) {
      case PRIORITY_LEVELS.CRITICAL:
        return { max: 100, duration: 60000 }; // 100 jobs/minute
      case PRIORITY_LEVELS.HIGH:
        return { max: 200, duration: 60000 }; // Increased from 50
      case PRIORITY_LEVELS.MEDIUM:
        return { max: 150, duration: 60000 };
      case PRIORITY_LEVELS.LOW:
        return { max: 50, duration: 60000 };
      case PRIORITY_LEVELS.DELAYED:
        return { max: 100, duration: 60000 };
      default:
        return { max: 100, duration: 60000 };
    }
  },

  /**
   * Get cleanup policy based on priority level
   */
  getCleanupPolicy(priority: PriorityLevel): { removeOnComplete: number; removeOnFail: number } {
    switch (priority) {
      case PRIORITY_LEVELS.CRITICAL:
        return { removeOnComplete: 50, removeOnFail: 20 };
      case PRIORITY_LEVELS.HIGH:
        return { removeOnComplete: 30, removeOnFail: 15 };
      case PRIORITY_LEVELS.MEDIUM:
        return { removeOnComplete: 25, removeOnFail: 10 };
      case PRIORITY_LEVELS.LOW:
        return { removeOnComplete: 15, removeOnFail: 5 };
      case PRIORITY_LEVELS.DELAYED:
        return { removeOnComplete: 10, removeOnFail: 5 };
      default:
        return { removeOnComplete: 25, removeOnFail: 10 };
    }
  }
} as const;