import type Redis from 'ioredis';
import {
  JobProgress,
  JOB_REDIS_KEYS,
  JOB_REDIS_CHANNELS,
  JOB_DEFAULTS,
  generateLockKey as _generateLockKey,
} from '@perfana/shared/types';
import { getLogger } from '../lib/utils/logger.js';
import { JobLockService } from './JobLockService.js';

const logger = getLogger('stuck-job-scanner');

/**
 * StuckJobScanner Service
 *
 * Scheduled task that periodically scans for stuck jobs and takes corrective action:
 * - Scans all progress keys in Redis
 * - Checks lastProgressAt timestamp
 * - If no progress for 10+ minutes, marks job as stuck
 * - Releases the associated lock
 * - Publishes stuck event to Redis
 *
 * This prevents jobs from holding locks indefinitely if they crash
 * or get stuck without proper cleanup.
 */
export class StuckJobScanner {
  private scanInterval: NodeJS.Timeout | null = null;
  private isScanning: boolean = false;
  private lockService: JobLockService;

  constructor(
    private readonly redis: Redis,
    private readonly scanIntervalMs: number = JOB_DEFAULTS.STUCK_SCAN_INTERVAL_MS,
    private readonly stuckTimeoutMs: number = JOB_DEFAULTS.STUCK_TIMEOUT_MS
  ) {
    this.lockService = new JobLockService(redis);
    logger.info('🔍 StuckJobScanner initialized', {
      scanIntervalMs,
      stuckTimeoutMs,
    });
  }

  /**
   * Start the periodic scanning
   */
  start(): void {
    if (this.scanInterval) {
      logger.warn('StuckJobScanner already running');
      return;
    }

    logger.info('🚀 Starting StuckJobScanner', {
      scanInterval: `${this.scanIntervalMs / 1000}s`,
      stuckTimeout: `${this.stuckTimeoutMs / 1000}s`,
    });

    // Run immediately on start
    this.scan().catch((error) => {
      logger.error('Initial scan failed:', error);
    });

    // Then run periodically
    this.scanInterval = setInterval(() => {
      this.scan().catch((error) => {
        logger.error('Scheduled scan failed:', error);
      });
    }, this.scanIntervalMs);
  }

  /**
   * Stop the periodic scanning
   */
  stop(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
      logger.info('🛑 StuckJobScanner stopped');
    }
  }

  /**
   * Perform a single scan for stuck jobs
   */
  async scan(): Promise<void> {
    if (this.isScanning) {
      logger.debug('Scan already in progress, skipping');
      return;
    }

    this.isScanning = true;
    const scanStartTime = Date.now();

    try {
      logger.debug('🔍 Starting stuck job scan');

      // Scan for all progress keys
      const progressKeys = await this.getProgressKeys();

      if (progressKeys.length === 0) {
        logger.debug('No active jobs found');
        return;
      }

      logger.debug(`Found ${progressKeys.length} active jobs to check`);

      let stuckCount = 0;

      // Check each progress key
      for (const progressKey of progressKeys) {
        try {
          const isStuck = await this.checkAndHandleStuckJob(progressKey);
          if (isStuck) {
            stuckCount++;
          }
        } catch (error) {
          logger.error(`Failed to check job ${progressKey}:`, error);
        }
      }

      const scanDuration = Date.now() - scanStartTime;
      logger.info(`✅ Stuck job scan completed in ${scanDuration}ms`, {
        totalJobs: progressKeys.length,
        stuckJobs: stuckCount,
      });
    } catch (error) {
      logger.error('Stuck job scan failed:', error);
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Get all progress keys from Redis
   */
  private async getProgressKeys(): Promise<string[]> {
    const pattern = `${JOB_REDIS_KEYS.PROGRESS_PREFIX}*`;
    const keys: string[] = [];

    // Use SCAN to avoid blocking Redis
    let cursor = '0';
    do {
      const [nextCursor, foundKeys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );
      cursor = nextCursor;
      keys.push(...foundKeys);
    } while (cursor !== '0');

    return keys;
  }

  /**
   * Check if a job is stuck and handle it
   *
   * @returns true if job was stuck and handled
   */
  private async checkAndHandleStuckJob(progressKey: string): Promise<boolean> {
    try {
      // Get progress data
      const progressData = await this.redis.get(progressKey);
      if (!progressData) {
        // Progress key expired or was deleted
        return false;
      }

      const progress: JobProgress = JSON.parse(progressData);

      // Check if job is already marked as completed, failed, or stuck
      if (['completed', 'failed', 'stuck'].includes(progress.status)) {
        // Job is already in terminal state, skip
        return false;
      }

      // Calculate time since last progress
      const lastProgressTime = new Date(progress.lastProgressAt).getTime();
      const timeSinceProgress = Date.now() - lastProgressTime;

      if (timeSinceProgress < this.stuckTimeoutMs) {
        // Job is still making progress
        return false;
      }

      // Job is stuck!
      logger.warn(`🚨 Stuck job detected: ${progress.jobId}`, {
        testRunId: progress.testRunId,
        jobType: progress.jobType,
        lastStage: progress.stage,
        timeSinceProgress: `${Math.round(timeSinceProgress / 1000)}s`,
      });

      // Mark job as stuck
      await this.markJobAsStuck(progress, timeSinceProgress);

      // Release the lock
      await this.releaseLockForStuckJob(progress);

      // Publish stuck event
      await this.publishStuckEvent(progress, timeSinceProgress);

      return true;
    } catch (error) {
      logger.error(`Failed to check stuck job ${progressKey}:`, error);
      return false;
    }
  }

  /**
   * Mark job as stuck in Redis
   */
  private async markJobAsStuck(
    progress: JobProgress,
    stuckDuration: number
  ): Promise<void> {
    try {
      const updatedProgress: JobProgress = {
        ...progress,
        status: 'stuck',
        lastProgressAt: new Date().toISOString(),
        message: `Job stuck - no progress for ${Math.round(stuckDuration / 1000)}s`,
      };

      const progressKey = `${JOB_REDIS_KEYS.PROGRESS_PREFIX}${progress.jobId}`;

      // Update progress with longer TTL (keep for debugging)
      await this.redis.setex(
        progressKey,
        7200, // 2 hour TTL for stuck jobs
        JSON.stringify(updatedProgress)
      );

      logger.info(`Marked job as stuck: ${progress.jobId}`, {
        testRunId: progress.testRunId,
      });
    } catch (error) {
      logger.error(`Failed to mark job as stuck: ${progress.jobId}`, error);
    }
  }

  /**
   * Release lock held by stuck job
   */
  private async releaseLockForStuckJob(progress: JobProgress): Promise<void> {
    try {
      const released = await this.lockService.forceReleaseLock(
        progress.systemUnderTestId,
        progress.testEnvironment,
        progress.workload
      );

      if (released) {
        logger.info(`Released lock for stuck job: ${progress.jobId}`, {
          testRunId: progress.testRunId,
          scope: `${progress.systemUnderTestId}:${progress.testEnvironment}:${progress.workload}`,
        });
      } else {
        logger.warn(`No lock found for stuck job: ${progress.jobId}`, {
          testRunId: progress.testRunId,
        });
      }
    } catch (error) {
      logger.error(`Failed to release lock for stuck job: ${progress.jobId}`, error);
    }
  }

  /**
   * Publish stuck event to Redis channel
   */
  private async publishStuckEvent(
    progress: JobProgress,
    stuckDuration: number
  ): Promise<void> {
    try {
      await this.redis.publish(
        JOB_REDIS_CHANNELS.STUCK,
        JSON.stringify({
          type: 'job:stuck',
          payload: {
            jobId: progress.jobId,
            testRunId: progress.testRunId,
            systemUnderTestId: progress.systemUnderTestId,
            testEnvironment: progress.testEnvironment,
            workload: progress.workload,
            jobType: progress.jobType,
            lastProgressAt: progress.lastProgressAt,
            stuckDuration,
            lastKnownStage: progress.stage,
          },
        })
      );

      logger.debug(`Published stuck event for job: ${progress.jobId}`);
    } catch (error) {
      logger.error(`Failed to publish stuck event for job: ${progress.jobId}`, error);
    }
  }

  /**
   * Get current scanner status
   */
  getStatus(): {
    running: boolean;
    scanning: boolean;
    scanIntervalMs: number;
    stuckTimeoutMs: number;
  } {
    return {
      running: this.scanInterval !== null,
      scanning: this.isScanning,
      scanIntervalMs: this.scanIntervalMs,
      stuckTimeoutMs: this.stuckTimeoutMs,
    };
  }
}
