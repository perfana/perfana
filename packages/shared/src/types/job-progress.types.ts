/**
 * Type definitions for Job Progress tracking
 *
 * These types provide proper TypeScript typing for job progress tracking,
 * job blocking, and stuck job detection throughout the system.
 */

/**
 * Job type classification
 */
export type JobType = 'analyze' | 'refresh' | 'reevaluate';

/**
 * Job status values
 */
export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'stuck' | 'blocked';

/**
 * Progress information for a running job
 * Tracks stage-level and overall progress with timing information
 */
export interface JobProgress {
  /** BullMQ job ID */
  jobId: string;

  /** Test run ID being processed */
  testRunId: string;

  /** System under test ID for scope identification */
  systemUnderTestId: string;

  /** Test environment for scope identification */
  testEnvironment: string;

  /** Workload name for scope identification */
  workload: string;

  /** Type of job being executed */
  jobType: JobType;

  /** Current stage name (e.g., 'statistics-calculation') */
  stage: string;

  /** Human-readable stage name (e.g., 'Statistics calculation') */
  stageName: string;

  /** Current stage index (1-based) */
  stageIndex: number;

  /** Total number of stages in the pipeline */
  totalStages: number;

  /** Progress within current stage (0-100) */
  stageProgress: number;

  /** Overall progress across all stages (0-100) */
  overallProgress: number;

  /** Human-readable progress message (e.g., 'Statistics calculation - 43%') */
  message: string;

  /** ISO timestamp when job started */
  startedAt: string;

  /** ISO timestamp of last progress update */
  lastProgressAt: string;

  /** Current job status */
  status: JobStatus;
}

/**
 * Information about why a job is blocked
 */
export interface JobBlockedInfo {
  /** Whether a job is blocked */
  blocked: boolean;

  /** Human-readable reason for blocking */
  reason?: string;

  /** ID of the existing job that's blocking */
  existingJobId?: string;

  /** Progress info of the blocking job */
  existingJobProgress?: JobProgress;

  /** Scope key that's locked */
  scopeKey?: string;
}

/**
 * Lock information for a system/environment/workload scope
 */
export interface JobLockInfo {
  /** Whether the scope is currently locked */
  locked: boolean;

  /** Job ID holding the lock */
  jobId?: string;

  /** Test run ID being processed */
  testRunId?: string;

  /** Job type */
  jobType?: JobType;

  /** ISO timestamp when lock was acquired */
  acquiredAt?: string;

  /** ISO timestamp when lock expires (TTL) */
  expiresAt?: string;

  /** Current progress if available */
  progress?: JobProgress;
}

/**
 * Result of attempting to acquire a job lock
 */
export interface JobLockResult {
  /** Whether lock was successfully acquired */
  acquired: boolean;

  /** Lock key that was used */
  lockKey: string;

  /** If not acquired, info about the blocking job */
  blockingInfo?: JobBlockedInfo;
}

/**
 * Configuration for stuck job detection
 */
export interface StuckJobConfig {
  /** Interval between stuck job scans in milliseconds */
  scanIntervalMs: number;

  /** Time without progress before job is considered stuck (ms) */
  progressTimeoutMs: number;

  /** Whether to automatically fail stuck jobs */
  autoFailStuckJobs: boolean;

  /** Channels to alert when stuck job detected */
  alertChannels: string[];
}

/**
 * Event emitted when job progress updates
 */
export interface JobProgressEvent {
  type: 'job:progress';
  payload: JobProgress;
}

/**
 * Event emitted when job completes successfully
 */
export interface JobCompletedEvent {
  type: 'job:completed';
  payload: {
    jobId: string;
    testRunId: string;
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    jobType: JobType;
    duration: number;
    result?: unknown;
  };
}

/**
 * Event emitted when job fails
 */
export interface JobFailedEvent {
  type: 'job:failed';
  payload: {
    jobId: string;
    testRunId: string;
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    jobType: JobType;
    error: string;
    errorCode?: string;
  };
}

/**
 * Event emitted when job is blocked
 */
export interface JobBlockedEvent {
  type: 'job:blocked';
  payload: JobBlockedInfo & {
    requestedTestRunId: string;
    requestedJobType: JobType;
  };
}

/**
 * Event emitted when job is detected as stuck
 */
export interface JobStuckEvent {
  type: 'job:stuck';
  payload: {
    jobId: string;
    testRunId: string;
    systemUnderTestId: string;
    testEnvironment: string;
    workload: string;
    jobType: JobType;
    lastProgressAt: string;
    stuckDuration: number;
    lastKnownStage: string;
  };
}

/**
 * Union type for all job-related events
 */
export type JobEvent =
  | JobProgressEvent
  | JobCompletedEvent
  | JobFailedEvent
  | JobBlockedEvent
  | JobStuckEvent;

/**
 * Redis channel names for job events
 */
export const JOB_REDIS_CHANNELS = {
  PROGRESS: 'job:progress',
  COMPLETED: 'job:completed',
  FAILED: 'job:failed',
  BLOCKED: 'job:blocked',
  STUCK: 'job:stuck',
} as const;

/**
 * Redis key prefixes for job-related data
 */
export const JOB_REDIS_KEYS = {
  /** Lock key prefix: job:lock:{systemUnderTestId}:{testEnvironment}:{workload} */
  LOCK_PREFIX: 'job:lock:',
  /** Progress key prefix: job:progress:{jobId} */
  PROGRESS_PREFIX: 'job:progress:',
  /** Active jobs set key */
  ACTIVE_JOBS: 'job:active',
} as const;

/**
 * Default configuration values
 */
export const JOB_DEFAULTS = {
  /** Default lock TTL in seconds (5 minutes) */
  LOCK_TTL_SECONDS: 300,
  /** Default progress debounce in milliseconds */
  PROGRESS_DEBOUNCE_MS: 500,
  /** Default stuck job timeout in milliseconds (10 minutes) */
  STUCK_TIMEOUT_MS: 600000,
  /** Default stuck job scan interval in milliseconds (2 minutes) */
  STUCK_SCAN_INTERVAL_MS: 120000,
} as const;

/**
 * Pipeline stage definitions for progress tracking
 */
export const PIPELINE_STAGES = [
  { id: 'dynatrace-collection', name: 'Dynatrace collection' },
  { id: 'panels-processing', name: 'Panels processing' },
  { id: 'performance-test-metrics', name: 'Performance test metrics' },
  { id: 'metrics-collection', name: 'Metrics collection' },
  { id: 'statistics-calculation', name: 'Statistics calculation' },
  { id: 'checks-evaluation', name: 'Checks evaluation' },
  { id: 'control-groups-creation', name: 'Control groups creation' },
  { id: 'control-group-statistics', name: 'Control group statistics' },
  { id: 'adapt-analysis', name: 'ADAPT analysis' },
] as const;

/**
 * Get human-readable stage name from stage ID
 */
export function getStageName(stageId: string): string {
  const stage = PIPELINE_STAGES.find((s) => s.id === stageId);
  return stage?.name ?? stageId;
}

/**
 * Calculate overall progress from stage info
 */
export function calculateOverallProgress(
  stageIndex: number,
  totalStages: number,
  stageProgress: number
): number {
  if (totalStages === 0) return 0;
  const completedStagesProgress = ((stageIndex - 1) / totalStages) * 100;
  const currentStageContribution = (stageProgress / totalStages);
  return Math.min(100, Math.round(completedStagesProgress + currentStageContribution));
}

/**
 * Format progress message
 */
export function formatProgressMessage(
  stageName: string,
  overallProgress: number
): string {
  return `${stageName} - ${overallProgress}%`;
}

/**
 * Generate lock key from scope
 */
export function generateLockKey(
  systemUnderTestId: string,
  testEnvironment: string,
  workload: string
): string {
  return `${JOB_REDIS_KEYS.LOCK_PREFIX}${systemUnderTestId}:${testEnvironment}:${workload}`;
}
