import type { Job } from 'bullmq';
import type Redis from 'ioredis';
import {
  JobProgress,
  JobType,
  JobStatus,
  JOB_REDIS_CHANNELS,
  JOB_REDIS_KEYS,
  JOB_DEFAULTS,
  getStageName,
  calculateOverallProgress,
  formatProgressMessage,
} from '@perfana/shared/types';
import { getLogger } from '../lib/utils/logger.js';

const logger = getLogger('progress-reporter');

/**
 * ProgressReporter Service
 *
 * Wraps BullMQ job.updateProgress() with:
 * - Debouncing (500ms) to avoid Redis overload
 * - Redis channel publishing for real-time updates
 * - Redis key storage for progress persistence with TTL
 * - Auto-calculation of overall progress from stage info
 *
 * This service is instantiated per job and tracks progress through
 * the entire pipeline execution.
 */
export class ProgressReporter {
  private currentStageIndex: number = 0;
  private currentStageProgress: number = 0;
  private currentStage: string = '';
  private startedAt: string;
  private lastProgressAt: string;
  private status: JobStatus = 'active';
  /**
   * The run the current stage is working on. Cleared by startStage so a
   * batch-wide stage never inherits the previous stage's run.
   */
  private currentTestRun: { testRunId: string; index: number; total: number } | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingUpdate: boolean = false;

  constructor(
    private readonly redis: Redis,
    private readonly job: Job,
    private readonly testRunInfo: {
      testRunId: string;
      systemUnderTestId: string;
      testEnvironment: string;
      workload: string;
    },
    private readonly jobType: JobType,
    private readonly stages: string[]
  ) {
    this.startedAt = new Date().toISOString();
    this.lastProgressAt = this.startedAt;

    logger.info(`📊 ProgressReporter initialized for job ${job.id}`, {
      testRunId: testRunInfo.testRunId,
      jobType,
      stages: stages.length,
    });
  }

  /**
   * Start a new stage in the pipeline
   */
  async startStage(stageName: string): Promise<void> {
    const stageIndex = this.stages.indexOf(stageName);
    if (stageIndex === -1) {
      logger.warn(`Stage ${stageName} not found in pipeline stages`, {
        jobId: this.job.id,
        knownStages: this.stages,
      });
      return;
    }

    this.currentStage = stageName;
    this.currentStageIndex = stageIndex + 1; // 1-based for display
    this.currentStageProgress = 0;
    this.currentTestRun = null;

    logger.info(`🔷 Stage started: ${stageName} (${this.currentStageIndex}/${this.stages.length})`, {
      jobId: this.job.id,
      testRunId: this.testRunInfo.testRunId,
    });

    await this.publishProgress();
  }

  /**
   * Update progress within the current stage (0-100).
   *
   * `currentTestRun` is for the stages that walk the batch one run at a time. The
   * percentage alone tells a user how far along the stage is but not which run is
   * being worked on, and the reporter's own testRunId is the batch anchor
   * (testRunIds[0]) for every stage — so without this the UI names one run for the
   * whole batch. Omit it for a stage that processes the batch in one go.
   */
  async updateStageProgress(
    percent: number,
    currentTestRun?: { testRunId: string; index: number; total: number }
  ): Promise<void> {
    this.currentStageProgress = Math.min(100, Math.max(0, percent));
    if (currentTestRun) {this.currentTestRun = currentTestRun;}
    await this.debouncedPublish();
  }

  /**
   * Mark the current stage as complete (100%)
   */
  async completeStage(): Promise<void> {
    this.currentStageProgress = 100;

    logger.info(`✅ Stage completed: ${this.currentStage}`, {
      jobId: this.job.id,
      testRunId: this.testRunInfo.testRunId,
      stage: `${this.currentStageIndex}/${this.stages.length}`,
    });

    await this.publishProgress();
  }

  /**
   * Mark the entire job as complete
   */
  async complete(): Promise<void> {
    this.status = 'completed';
    this.currentStageProgress = 100;

    logger.info(`🎉 Job completed: ${this.job.id}`, {
      testRunId: this.testRunInfo.testRunId,
      jobType: this.jobType,
      duration: Date.now() - new Date(this.startedAt).getTime(),
    });

    // Flush any pending updates
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    await this.publishProgress();

    // Publish completion event
    await this.publishCompletionEvent();

    // Clean up progress key (will be deleted by TTL anyway, but good practice).
    // Best-effort: a Redis hiccup here must not throw out of the worker callback —
    // unhandled rejection would shut the process down (issue #294).
    try {
      const progressKey = `${JOB_REDIS_KEYS.PROGRESS_PREFIX}${this.job.id}`;
      await this.redis.expire(progressKey, 3600); // 1 hour TTL for completed jobs
    } catch (error) {
      logger.error(`Failed to set TTL on progress key for job ${this.job.id}:`, error);
    }
  }

  /**
   * Mark the job as failed
   */
  async fail(error: string): Promise<void> {
    this.status = 'failed';

    logger.error(`❌ Job failed: ${this.job.id}`, {
      testRunId: this.testRunInfo.testRunId,
      jobType: this.jobType,
      error,
    });

    // Flush any pending updates
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    await this.publishProgress();

    // Publish failure event
    await this.publishFailureEvent(error);

    // Clean up progress key. Best-effort — see complete() above.
    try {
      const progressKey = `${JOB_REDIS_KEYS.PROGRESS_PREFIX}${this.job.id}`;
      await this.redis.expire(progressKey, 7200); // 2 hour TTL for failed jobs (keep longer for debugging)
    } catch (err) {
      logger.error(`Failed to set TTL on progress key for failed job ${this.job.id}:`, err);
    }
  }

  /**
   * Debounced publish to avoid Redis overload
   * Only publishes once every 500ms
   */
  private async debouncedPublish(): Promise<void> {
    this.pendingUpdate = true;

    if (this.debounceTimer) {
      return; // Already scheduled
    }

    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null;
      if (this.pendingUpdate) {
        this.pendingUpdate = false;
        await this.publishProgress();
      }
    }, JOB_DEFAULTS.PROGRESS_DEBOUNCE_MS);
  }

  /**
   * Publish progress to Redis channel and store in Redis key
   */
  private async publishProgress(): Promise<void> {
    this.lastProgressAt = new Date().toISOString();

    const progress = this.buildProgressObject();

    try {
      // Update BullMQ job progress
      await this.job.updateProgress(progress.overallProgress);

      // Store in Redis with TTL
      const progressKey = `${JOB_REDIS_KEYS.PROGRESS_PREFIX}${this.job.id}`;
      await this.redis.setex(
        progressKey,
        JOB_DEFAULTS.LOCK_TTL_SECONDS, // 5 minutes TTL
        JSON.stringify(progress)
      );

      // Publish to Redis channel for real-time updates
      await this.redis.publish(
        JOB_REDIS_CHANNELS.PROGRESS,
        JSON.stringify({
          type: 'job:progress',
          payload: progress,
        })
      );

      logger.debug(`📡 Progress published: ${progress.message}`, {
        jobId: this.job.id,
        overallProgress: progress.overallProgress,
      });
    } catch (error) {
      logger.error(`Failed to publish progress for job ${this.job.id}:`, error);
    }
  }

  /**
   * Build the JobProgress object
   */
  private buildProgressObject(): JobProgress {
    const overallProgress = calculateOverallProgress(
      this.currentStageIndex,
      this.stages.length,
      this.currentStageProgress
    );

    const stageName = getStageName(this.currentStage);
    const message = formatProgressMessage(stageName, overallProgress);

    return {
      jobId: this.job.id!,
      testRunId: this.testRunInfo.testRunId,
      systemUnderTestId: this.testRunInfo.systemUnderTestId,
      testEnvironment: this.testRunInfo.testEnvironment,
      workload: this.testRunInfo.workload,
      jobType: this.jobType,
      stage: this.currentStage,
      stageName,
      stageIndex: this.currentStageIndex,
      totalStages: this.stages.length,
      stageProgress: this.currentStageProgress,
      overallProgress,
      message,
      startedAt: this.startedAt,
      lastProgressAt: this.lastProgressAt,
      status: this.status,
      currentTestRunId: this.currentTestRun?.testRunId,
      currentTestRunIndex: this.currentTestRun?.index,
      totalTestRuns: this.currentTestRun?.total,
    };
  }

  /**
   * Publish job completion event
   */
  private async publishCompletionEvent(): Promise<void> {
    try {
      await this.redis.publish(
        JOB_REDIS_CHANNELS.COMPLETED,
        JSON.stringify({
          type: 'job:completed',
          payload: {
            jobId: this.job.id,
            testRunId: this.testRunInfo.testRunId,
            systemUnderTestId: this.testRunInfo.systemUnderTestId,
            testEnvironment: this.testRunInfo.testEnvironment,
            workload: this.testRunInfo.workload,
            jobType: this.jobType,
            duration: Date.now() - new Date(this.startedAt).getTime(),
          },
        })
      );
    } catch (error) {
      logger.error(`Failed to publish completion event for job ${this.job.id}:`, error);
    }
  }

  /**
   * Publish job failure event
   */
  private async publishFailureEvent(error: string): Promise<void> {
    try {
      await this.redis.publish(
        JOB_REDIS_CHANNELS.FAILED,
        JSON.stringify({
          type: 'job:failed',
          payload: {
            jobId: this.job.id,
            testRunId: this.testRunInfo.testRunId,
            systemUnderTestId: this.testRunInfo.systemUnderTestId,
            testEnvironment: this.testRunInfo.testEnvironment,
            workload: this.testRunInfo.workload,
            jobType: this.jobType,
            error,
          },
        })
      );
    } catch (err) {
      logger.error(`Failed to publish failure event for job ${this.job.id}:`, err);
    }
  }

  /**
   * Clean up resources when done
   */
  async cleanup(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
