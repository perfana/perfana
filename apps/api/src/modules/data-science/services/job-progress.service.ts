import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  JobProgress,
  JobBlockedInfo,
  JobLockInfo,
  JOB_DEFAULTS,
  JOB_REDIS_CHANNELS,
  JOB_REDIS_KEYS,
  generateLockKey,
  JobProgressEvent,
  JobCompletedEvent,
  JobFailedEvent,
  JobStuckEvent,
} from '@perfana/shared/types';

/**
 * Service for managing job progress tracking and locks
 *
 * Responsibilities:
 * - Subscribe to Redis job events from the worker service
 * - Maintain in-memory cache of active job progress
 * - Check locks before allowing job submission
 * - Forward events to WebSocket gateway for real-time updates
 * - Clean up cache when jobs complete/fail
 *
 * Architecture:
 * - Worker publishes events to Redis channels
 * - This service subscribes and maintains state
 * - WebSocket gateway broadcasts to connected clients
 */
@Injectable()
export class JobProgressService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobProgressService.name);
  private subscriberRedis!: Redis;
  private queryRedis!: Redis;
  private isRedisAvailable = false;

  // In-memory cache of active jobs
  // Key: jobId -> JobProgress
  private activeJobs = new Map<string, JobProgress>();

  // Index for quick scope lookups
  // Key: scopeKey (systemUnderTestId:testEnvironment:workload) -> jobId
  private scopeToJobIndex = new Map<string, string>();

  // An in-memory active entry whose `lastProgressAt` is older than this is
  // treated as expired and evicted on read. Defaults to the worker's progress-key
  // TTL (LOCK_TTL_SECONDS) — past that window the worker is no longer refreshing
  // the key, so a still-"active" in-memory copy is a phantom (issue #387).
  // Override with JOB_PROGRESS_STALE_THRESHOLD_MS.
  private staleThresholdMs = JOB_DEFAULTS.LOCK_TTL_SECONDS * 1000;

  // Event handlers that can be registered by the gateway
  private progressHandlers: Array<(progress: JobProgress) => void> = [];
  private completedHandlers: Array<(event: JobCompletedEvent['payload']) => void> = [];
  private failedHandlers: Array<(event: JobFailedEvent['payload']) => void> = [];
  private stuckHandlers: Array<(event: JobStuckEvent['payload']) => void> = [];

  constructor(private readonly configService: ConfigService) {
    const configuredThreshold = this.configService.get<number>('JOB_PROGRESS_STALE_THRESHOLD_MS');
    if (typeof configuredThreshold === 'number' && configuredThreshold > 0) {
      this.staleThresholdMs = configuredThreshold;
    }
  }

  async onModuleInit() {
    this.logger.log('🚀 JobProgressService onModuleInit starting...');
    await this.initializeRedis();
    this.logger.log(`Redis available: ${this.isRedisAvailable}`);
    if (this.isRedisAvailable) {
      await this.setupRedisSubscriptions();
    } else {
      this.logger.warn('⚠️ Redis not available, skipping subscriptions');
    }
    this.logger.log('🚀 JobProgressService onModuleInit complete');
  }

  /**
   * Initialize Redis connections
   * Uses separate connections for subscribing and querying (Redis requirement)
   */
  private async initializeRedis() {
    try {
      const redisUrl = this.configService.get('REDIS_URL', 'redis://localhost:6379');
      const redisPassword = this.configService.get('REDIS_PASSWORD');

      this.logger.log(`Connecting to Redis for job progress tracking: ${redisUrl}`);

      // Connection for subscribing to pub/sub channels
      this.subscriberRedis = new Redis(redisUrl, {
        password: redisPassword,
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      // Connection for querying lock/progress data
      this.queryRedis = new Redis(redisUrl, {
        password: redisPassword,
        enableReadyCheck: false,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      });

      // Set up error handler for ongoing errors
      this.subscriberRedis.on('error', (error) => {
        this.logger.error(`Redis subscriber error: ${error.message}`);
        this.isRedisAvailable = false;
      });

      // Wait for connection before proceeding
      await new Promise<void>((resolve, reject) => {
        if (this.subscriberRedis.status === 'ready') {
          this.logger.log('Redis subscriber already connected');
          this.isRedisAvailable = true;
          resolve();
          return;
        }

        const onConnect = () => {
          this.logger.log('Redis subscriber connected for job progress');
          this.isRedisAvailable = true;
          cleanup();
          resolve();
        };

        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };

        const cleanup = () => {
          this.subscriberRedis.off('connect', onConnect);
          this.subscriberRedis.off('ready', onConnect);
          this.subscriberRedis.off('error', onError);
        };

        this.subscriberRedis.once('connect', onConnect);
        this.subscriberRedis.once('ready', onConnect);
        this.subscriberRedis.once('error', onError);

        // Timeout after 5 seconds
        setTimeout(() => {
          cleanup();
          reject(new Error('Redis connection timeout'));
        }, 5000);
      });

      this.queryRedis.on('error', (error) => {
        this.logger.warn(`Redis query client error: ${error.message}`);
      });

    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      const isDevelopment = this.configService.get('NODE_ENV') === 'development';

      if (isDevelopment) {
        this.logger.warn(`Failed to initialize Redis in development mode: ${errorMessage}`);
        this.logger.warn('Job progress tracking will be unavailable');
      } else {
        this.logger.error(`Failed to initialize Redis: ${errorMessage}`);
        throw error;
      }
    }
  }

  /**
   * Subscribe to Redis channels for job events
   */
  private async setupRedisSubscriptions() {
    try {
      // IMPORTANT: Set up message handler BEFORE subscribing (ioredis requirement)
      this.subscriberRedis.on('message', (channel, message) => {
        this.logger.log(`📨 Redis message received on ${channel}`);
        try {
          const event = JSON.parse(message);
          this.handleRedisEvent(channel, event);
        } catch (error) {
          const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
          this.logger.error(`Failed to process Redis message on ${channel}: ${errorMessage}`);
        }
      });

      // Subscribe to all job event channels
      const channelsToSubscribe = [
        JOB_REDIS_CHANNELS.PROGRESS,
        JOB_REDIS_CHANNELS.COMPLETED,
        JOB_REDIS_CHANNELS.FAILED,
        JOB_REDIS_CHANNELS.STUCK,
      ];

      this.logger.log(`Subscribing to Redis channels: ${channelsToSubscribe.join(', ')}`);

      await this.subscriberRedis.subscribe(...channelsToSubscribe);

      this.logger.log('✅ Successfully subscribed to job progress Redis channels');
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Failed to setup Redis subscriptions: ${errorMessage}`);
    }
  }

  /**
   * Handle incoming Redis events
   */
  private handleRedisEvent(channel: string, event: JobProgressEvent | JobCompletedEvent | JobFailedEvent | JobStuckEvent) {
    switch (channel) {
      case JOB_REDIS_CHANNELS.PROGRESS:
        this.handleProgressEvent(event as JobProgressEvent);
        break;
      case JOB_REDIS_CHANNELS.COMPLETED:
        this.handleCompletedEvent(event as JobCompletedEvent);
        break;
      case JOB_REDIS_CHANNELS.FAILED:
        this.handleFailedEvent(event as JobFailedEvent);
        break;
      case JOB_REDIS_CHANNELS.STUCK:
        this.handleStuckEvent(event as JobStuckEvent);
        break;
      default:
        this.logger.warn(`Unknown event channel: ${channel}`);
    }
  }

  /**
   * Handle progress update event
   */
  private handleProgressEvent(event: JobProgressEvent) {
    const progress = event.payload;

    // Update in-memory cache
    this.activeJobs.set(progress.jobId, progress);

    // Update scope index
    const scopeKey = this.getScopeKey(
      progress.systemUnderTestId,
      progress.testEnvironment,
      progress.workload
    );
    this.scopeToJobIndex.set(scopeKey, progress.jobId);

    // Notify registered handlers (WebSocket gateway)
    this.progressHandlers.forEach(handler => {
      try {
        handler(progress);
      } catch (error) {
        this.logger.error('Error in progress handler:', error);
      }
    });
  }

  /**
   * Handle job completion event
   */
  private handleCompletedEvent(event: JobCompletedEvent) {
    const { jobId, systemUnderTestId, testEnvironment, workload } = event.payload;

    // Remove from cache
    this.activeJobs.delete(jobId);

    // Remove from scope index
    const scopeKey = this.getScopeKey(systemUnderTestId, testEnvironment, workload);
    this.scopeToJobIndex.delete(scopeKey);

    this.logger.log(`Job ${jobId} completed and removed from cache`);

    // Notify registered handlers
    this.completedHandlers.forEach(handler => {
      try {
        handler(event.payload);
      } catch (error) {
        this.logger.error('Error in completed handler:', error);
      }
    });
  }

  /**
   * Handle job failure event
   */
  private handleFailedEvent(event: JobFailedEvent) {
    const { jobId, systemUnderTestId, testEnvironment, workload } = event.payload;

    // Remove from cache
    this.activeJobs.delete(jobId);

    // Remove from scope index
    const scopeKey = this.getScopeKey(systemUnderTestId, testEnvironment, workload);
    this.scopeToJobIndex.delete(scopeKey);

    this.logger.warn(`Job ${jobId} failed and removed from cache: ${event.payload.error}`);

    // Notify registered handlers
    this.failedHandlers.forEach(handler => {
      try {
        handler(event.payload);
      } catch (error) {
        this.logger.error('Error in failed handler:', error);
      }
    });
  }

  /**
   * Handle stuck job detection event
   */
  private handleStuckEvent(event: JobStuckEvent) {
    this.logger.warn(
      `Stuck job detected: ${event.payload.jobId} - ` +
      `Last progress at ${event.payload.lastProgressAt}, ` +
      `stuck for ${event.payload.stuckDuration}ms`
    );

    // Notify registered handlers
    this.stuckHandlers.forEach(handler => {
      try {
        handler(event.payload);
      } catch (error) {
        this.logger.error('Error in stuck handler:', error);
      }
    });
  }

  /**
   * Check if a job is blocked for a given scope
   * This should be called before submitting a new job
   */
  async isJobBlocked(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string
  ): Promise<JobBlockedInfo> {
    if (!this.isRedisAvailable) {
      return { blocked: false };
    }

    try {
      const lockKey = generateLockKey(systemUnderTestId, testEnvironment, workload);
      const lockData = await this.queryRedis.get(lockKey);

      if (!lockData) {
        return { blocked: false };
      }

      const lock: JobLockInfo = JSON.parse(lockData);

      if (!lock.locked || !lock.jobId) {
        return { blocked: false };
      }

      // Get current progress from cache or Redis
      const existingProgress = await this.getJobProgress(lock.jobId);

      return {
        blocked: true,
        reason: `Another job is already processing this scope (${lock.jobType})`,
        existingJobId: lock.jobId,
        existingJobProgress: existingProgress || undefined,
        scopeKey: lockKey,
      };
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Error checking job lock: ${errorMessage}`);
      // On error, allow job to proceed (fail open)
      return { blocked: false };
    }
  }

  /**
   * Get active job for a specific scope.
   *
   * An in-memory `activeJobs` entry is never trusted blindly — it is reconciled
   * against authoritative state (Redis progress key + staleness + lock owner) so
   * a finished job whose terminal `completed`/`failed` event was dropped clears
   * automatically instead of showing a phantom "in progress" forever (issue #387).
   */
  async getActiveJobForScope(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string
  ): Promise<JobProgress | null> {
    const scopeKey = this.getScopeKey(systemUnderTestId, testEnvironment, workload);
    const lockKey = generateLockKey(systemUnderTestId, testEnvironment, workload);

    // Candidate job from the in-memory index — reconcile before returning.
    const indexedJobId = this.scopeToJobIndex.get(scopeKey);
    if (indexedJobId) {
      return this.reconcileScopeJob(scopeKey, lockKey, indexedJobId);
    }

    // No in-memory entry — fall back to the Redis lock to discover a running job.
    if (!this.isRedisAvailable) {
      return null;
    }

    try {
      const lockData = await this.queryRedis.get(lockKey);
      if (!lockData) {
        return null;
      }

      const lock: JobLockInfo = JSON.parse(lockData);
      if (!lock.locked || !lock.jobId) {
        return null;
      }

      // Reconcile the lock's job against the authoritative progress key too, so we
      // never resurrect a finished job from a lock that outlived its terminal event.
      return this.reconcileScopeJob(scopeKey, lockKey, lock.jobId);
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Error checking Redis lock for scope: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Reconcile a candidate `jobId` for a scope against authoritative state and
   * return live progress, or evict the in-memory entry and return `null`.
   *
   * The authoritative source is the Redis progress key (`job:progress:{jobId}`),
   * which the worker refreshes on every progress event (`setex`, LOCK_TTL_SECONDS)
   * and stamps with a terminal status on complete/fail. The scope lock is NOT
   * auto-extended (worker `extendLock` is unused), so a *missing* lock is ambiguous
   * for long-running jobs and is only used here to detect a *different* current
   * owner — never as a standalone eviction signal.
   *
   * Eviction triggers (in order):
   *  1. `lastProgressAt` older than the staleness threshold (works even if Redis is down).
   *  2. Progress key gone from Redis (job finished/expired with no terminal event seen).
   *  3. Progress key present but not `active`/`waiting` (terminal event was missed).
   *  4. Scope lock held by a *different* job.
   */
  private async reconcileScopeJob(
    scopeKey: string,
    lockKey: string,
    jobId: string
  ): Promise<JobProgress | null> {
    const cached = this.activeJobs.get(jobId);

    // (1) Staleness guard — independent of Redis availability.
    if (cached && this.isStale(cached)) {
      this.logger.warn(
        `Evicting stale active-job entry ${jobId} (lastProgressAt ${cached.lastProgressAt})`
      );
      this.evictJob(jobId, scopeKey);
      return null;
    }

    if (!this.isRedisAvailable) {
      // Cannot reconcile further — trust the (non-stale) cached entry if any.
      return cached ?? null;
    }

    try {
      // (2) Authoritative Redis progress key.
      const progressKey = `${JOB_REDIS_KEYS.PROGRESS_PREFIX}${jobId}`;
      const progressData = await this.queryRedis.get(progressKey);

      if (!progressData) {
        if (cached) {
          this.logger.warn(`Evicting active-job entry ${jobId}: progress key gone from Redis`);
        }
        this.evictJob(jobId, scopeKey);
        return null;
      }

      const progress: JobProgress = JSON.parse(progressData);

      // (3) Terminal status present but the completed/failed event was missed.
      if (progress.status !== 'active' && progress.status !== 'waiting') {
        this.logger.warn(
          `Evicting active-job entry ${jobId}: Redis progress status is '${progress.status}'`
        );
        this.evictJob(jobId, scopeKey);
        return null;
      }

      // Re-check staleness against the freshest Redis copy.
      if (this.isStale(progress)) {
        this.logger.warn(
          `Evicting active-job entry ${jobId}: Redis progress lastProgressAt is stale (${progress.lastProgressAt})`
        );
        this.evictJob(jobId, scopeKey);
        return null;
      }

      // (4) Lock cross-check — only evict if the scope is owned by another job.
      const lockData = await this.queryRedis.get(lockKey);
      if (lockData) {
        const lock: JobLockInfo = JSON.parse(lockData);
        if (lock.locked && lock.jobId && lock.jobId !== jobId) {
          this.logger.warn(
            `Evicting active-job entry ${jobId}: scope lock now held by ${lock.jobId}`
          );
          this.evictJob(jobId, scopeKey);
          return null;
        }
      }

      // Confirmed running — refresh the in-memory copy from authoritative Redis state.
      this.activeJobs.set(jobId, progress);
      this.scopeToJobIndex.set(scopeKey, jobId);
      return progress;
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Error reconciling active job ${jobId}: ${errorMessage}`);
      // On reconciliation error, fall back to the (already non-stale) cached entry.
      return cached ?? null;
    }
  }

  /**
   * Whether a progress entry is older than the staleness threshold.
   * A non-parseable timestamp is treated as not-stale (we can't judge it).
   */
  private isStale(progress: JobProgress): boolean {
    const lastProgressMs = Date.parse(progress.lastProgressAt);
    if (!Number.isFinite(lastProgressMs)) {
      return false;
    }
    return Date.now() - lastProgressMs > this.staleThresholdMs;
  }

  /**
   * Remove a job from the in-memory caches. When `scopeKey` is omitted, every
   * scope-index entry pointing at the job is removed.
   */
  private evictJob(jobId: string, scopeKey?: string): void {
    this.activeJobs.delete(jobId);
    if (scopeKey) {
      if (this.scopeToJobIndex.get(scopeKey) === jobId) {
        this.scopeToJobIndex.delete(scopeKey);
      }
      return;
    }
    for (const [key, value] of this.scopeToJobIndex.entries()) {
      if (value === jobId) {
        this.scopeToJobIndex.delete(key);
      }
    }
  }

  /**
   * Get progress for a specific job
   * Checks in-memory cache first, then Redis if needed
   */
  async getJobProgress(jobId: string): Promise<JobProgress | null> {
    // Check in-memory cache first
    const cached = this.activeJobs.get(jobId);
    if (cached) {
      return cached;
    }

    // Fall back to Redis
    if (!this.isRedisAvailable) {
      return null;
    }

    try {
      const progressKey = `${JOB_REDIS_KEYS.PROGRESS_PREFIX}${jobId}`;
      const progressData = await this.queryRedis.get(progressKey);

      if (!progressData) {
        return null;
      }

      const progress: JobProgress = JSON.parse(progressData);

      // Update cache
      this.activeJobs.set(jobId, progress);

      return progress;
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Error fetching job progress from Redis: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Get all active jobs.
   *
   * Each entry is reconciled against authoritative state before being returned,
   * so finished/stale jobs are evicted rather than reported as active (issue #387).
   */
  async getAllActiveJobs(): Promise<JobProgress[]> {
    const result: JobProgress[] = [];

    // Snapshot keys up front — reconciliation may evict entries mid-iteration.
    const jobIds = Array.from(this.activeJobs.keys());
    for (const jobId of jobIds) {
      const entry = this.activeJobs.get(jobId);
      if (!entry) {
        continue;
      }
      const scopeKey = this.getScopeKey(entry.systemUnderTestId, entry.testEnvironment, entry.workload);
      const lockKey = generateLockKey(entry.systemUnderTestId, entry.testEnvironment, entry.workload);
      const live = await this.reconcileScopeJob(scopeKey, lockKey, jobId);
      if (live) {
        result.push(live);
      }
    }

    return result;
  }

  /**
   * Register event handlers (called by WebSocket gateway)
   */
  onProgress(handler: (progress: JobProgress) => void) {
    this.progressHandlers.push(handler);
  }

  onCompleted(handler: (event: JobCompletedEvent['payload']) => void) {
    this.completedHandlers.push(handler);
  }

  onFailed(handler: (event: JobFailedEvent['payload']) => void) {
    this.failedHandlers.push(handler);
  }

  onStuck(handler: (event: JobStuckEvent['payload']) => void) {
    this.stuckHandlers.push(handler);
  }

  /**
   * Helper to generate scope key
   */
  private getScopeKey(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string
  ): string {
    return `${systemUnderTestId}:${testEnvironment}:${workload}`;
  }

  /**
   * Get detailed lock information for a scope
   * Includes TTL (time remaining) and current progress if available
   */
  async getLockInfo(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string
  ): Promise<JobLockInfo> {
    if (!this.isRedisAvailable) {
      return { locked: false };
    }

    try {
      const lockKey = generateLockKey(systemUnderTestId, testEnvironment, workload);
      const lockData = await this.queryRedis.get(lockKey);

      if (!lockData) {
        return { locked: false };
      }

      const lock: JobLockInfo = JSON.parse(lockData);

      if (!lock.locked || !lock.jobId) {
        return { locked: false };
      }

      // Get TTL to calculate expiration time
      const ttl = await this.queryRedis.ttl(lockKey);
      const expiresAt = ttl > 0
        ? new Date(Date.now() + ttl * 1000).toISOString()
        : undefined;

      // Get current progress from cache or Redis
      const progress = lock.jobId ? await this.getJobProgress(lock.jobId) : undefined;

      return {
        locked: true,
        jobId: lock.jobId,
        testRunId: lock.testRunId,
        jobType: lock.jobType,
        acquiredAt: lock.acquiredAt,
        expiresAt,
        progress: progress || undefined,
      };
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Error getting lock info: ${errorMessage}`);
      return { locked: false };
    }
  }

  /**
   * Manually release a lock for a scope
   * This is an admin operation that bypasses ownership checks
   * Use with caution - only when a job is truly stuck
   */
  async releaseLock(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string
  ): Promise<{ released: boolean; lockKey: string; previousLock?: JobLockInfo }> {
    const lockKey = generateLockKey(systemUnderTestId, testEnvironment, workload);

    if (!this.isRedisAvailable) {
      this.logger.warn(`Cannot release lock ${lockKey}: Redis not available`);
      return { released: false, lockKey };
    }

    try {
      // Get current lock info before releasing
      const lockData = await this.queryRedis.get(lockKey);
      let previousLock: JobLockInfo | undefined;

      if (lockData) {
        previousLock = JSON.parse(lockData);
      }

      // Delete the lock
      const result = await this.queryRedis.del(lockKey);
      const released = result > 0;

      if (released) {
        this.logger.warn(
          `🔓 Lock manually released: ${lockKey} ` +
          `(was held by job ${previousLock?.jobId || 'unknown'})`
        );

        // Clean up in-memory cache
        const scopeKey = this.getScopeKey(systemUnderTestId, testEnvironment, workload);
        const cachedJobId = this.scopeToJobIndex.get(scopeKey);
        if (cachedJobId) {
          this.activeJobs.delete(cachedJobId);
          this.scopeToJobIndex.delete(scopeKey);
        }
      } else {
        this.logger.log(`Lock ${lockKey} was not held (nothing to release)`);
      }

      return { released, lockKey, previousLock };
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error';
      this.logger.error(`Error releasing lock ${lockKey}: ${errorMessage}`);
      return { released: false, lockKey };
    }
  }

  /**
   * Get service health status
   */
  getHealthStatus() {
    return {
      redisConnected: this.isRedisAvailable,
      activeJobs: this.activeJobs.size,
      trackedScopes: this.scopeToJobIndex.size,
    };
  }

  async onModuleDestroy() {
    this.logger.log('Cleaning up job progress service...');

    if (this.subscriberRedis) {
      await this.subscriberRedis.quit();
    }

    if (this.queryRedis) {
      await this.queryRedis.quit();
    }

    // Clear caches
    this.activeJobs.clear();
    this.scopeToJobIndex.clear();
    this.progressHandlers = [];
    this.completedHandlers = [];
    this.failedHandlers = [];
    this.stuckHandlers = [];
  }
}
