import type Redis from 'ioredis';
import {
  JobLockInfo,
  JobLockResult,
  JobBlockedInfo,
  JobType,
  JobProgress,
  JOB_REDIS_KEYS,
  JOB_REDIS_CHANNELS,
  JOB_DEFAULTS,
  generateLockKey,
} from '@perfana/shared/types';
import { getLogger } from '../lib/utils/logger.js';

const logger = getLogger('job-lock-service');

/**
 * Lock metadata stored in Redis
 */
interface LockMetadata {
  jobId: string;
  testRunId: string;
  jobType: JobType;
  acquiredAt: string;
  systemUnderTestId: string;
  testEnvironment: string;
  workload: string;
}

/**
 * JobLockService
 *
 * Redis-based distributed lock service to prevent concurrent jobs
 * from processing the same system/environment/workload scope.
 *
 * Lock Pattern:
 * - Lock key: job:lock:{systemUnderTestId}:{testEnvironment}:{workload}
 * - Lock TTL: `JOB_DEFAULTS.LOCK_TTL_SECONDS` (5 minutes) — far shorter than a
 *   pipeline runs, deliberately: a worker that dies holds the scope for at most
 *   that long. Long jobs keep the lock alive with `startLockRenewal`.
 * - Stores metadata (jobId, testRunId, jobType, acquiredAt)
 *
 * This prevents race conditions and ensures only one analysis job
 * runs per scope at a time.
 */
export class JobLockService {
  constructor(private readonly redis: Redis) {
    logger.info('🔒 JobLockService initialized');
  }

  /**
   * Acquire a lock for a specific scope
   *
   * @returns JobLockResult with acquired status and blocking info if failed
   */
  async acquireLock(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    jobId: string,
    testRunId: string,
    jobType: JobType
  ): Promise<JobLockResult> {
    const lockKey = generateLockKey(systemUnderTestId, testEnvironment, workload);

    const metadata: LockMetadata = {
      jobId,
      testRunId,
      jobType,
      acquiredAt: new Date().toISOString(),
      systemUnderTestId,
      testEnvironment,
      workload,
    };

    try {
      // Try to set lock with NX (only if not exists) and EX (expiration)
      // ioredis supports SET key value EX seconds NX
      const result = await this.redis.set(
        lockKey,
        JSON.stringify(metadata),
        'EX',
        JOB_DEFAULTS.LOCK_TTL_SECONDS,
        'NX'
      );

      if (result === 'OK') {
        logger.info(`🔒 Lock acquired: ${lockKey}`, {
          jobId,
          testRunId,
          jobType,
          scope: { systemUnderTestId, testEnvironment, workload },
        });

        return {
          acquired: true,
          lockKey,
        };
      }

      // Lock acquisition failed - another job is running
      const existingLock = await this.getLockInfo(systemUnderTestId, testEnvironment, workload);

      if (!existingLock || !existingLock.locked) {
        // Race condition - lock was just released, retry
        logger.warn(`Lock released during acquisition, retrying: ${lockKey}`);
        return this.acquireLock(
          systemUnderTestId,
          testEnvironment,
          workload,
          jobId,
          testRunId,
          jobType
        );
      }

      // Build blocking info
      const blockingInfo = await this.buildBlockingInfo(
        existingLock,
        systemUnderTestId,
        testEnvironment,
        workload
      );

      logger.warn(`🚫 Lock acquisition blocked: ${lockKey}`, {
        requestedJobId: jobId,
        blockingJobId: existingLock.jobId,
        blockingTestRunId: existingLock.testRunId,
      });

      // Publish blocked event
      await this.publishBlockedEvent(testRunId, jobType, blockingInfo);

      return {
        acquired: false,
        lockKey,
        blockingInfo,
      };
    } catch (error) {
      logger.error(`Failed to acquire lock: ${lockKey}`, error);
      throw error;
    }
  }

  /**
   * Release a lock (called when job completes or fails)
   *
   * @returns true if lock was released, false if lock didn't exist or was held by another job
   */
  async releaseLock(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    jobId: string
  ): Promise<boolean> {
    const lockKey = generateLockKey(systemUnderTestId, testEnvironment, workload);

    try {
      // Get current lock to verify ownership
      const lockData = await this.redis.get(lockKey);
      if (!lockData) {
        logger.debug(`No lock to release: ${lockKey}`);
        return false;
      }

      const metadata: LockMetadata = JSON.parse(lockData);

      // Verify ownership before deleting
      if (metadata.jobId !== jobId) {
        logger.warn(`Cannot release lock held by another job: ${lockKey}`, {
          requestingJobId: jobId,
          owningJobId: metadata.jobId,
        });
        return false;
      }

      // Use Lua script to ensure atomic check and delete
      const luaScript = `
        local lockKey = KEYS[1]
        local jobId = ARGV[1]
        local lockData = redis.call('GET', lockKey)

        if not lockData then
          return 0
        end

        local metadata = cjson.decode(lockData)
        if metadata.jobId == jobId then
          redis.call('DEL', lockKey)
          return 1
        end

        return 0
      `;

      const result = await this.redis.eval(luaScript, 1, lockKey, jobId);

      if (result === 1) {
        logger.info(`🔓 Lock released: ${lockKey}`, {
          jobId,
          testRunId: metadata.testRunId,
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Failed to release lock: ${lockKey}`, error);
      return false;
    }
  }

  /**
   * Get information about the current lock holder
   *
   * @returns JobLockInfo or null if no lock exists
   */
  async getLockInfo(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string
  ): Promise<JobLockInfo | null> {
    const lockKey = generateLockKey(systemUnderTestId, testEnvironment, workload);

    try {
      const lockData = await this.redis.get(lockKey);
      if (!lockData) {
        return { locked: false };
      }

      const metadata: LockMetadata = JSON.parse(lockData);

      // Get TTL to calculate expiration
      const ttl = await this.redis.ttl(lockKey);
      const expiresAt =
        ttl > 0 ? new Date(Date.now() + ttl * 1000).toISOString() : undefined;

      // Try to get current progress
      const progressKey = `${JOB_REDIS_KEYS.PROGRESS_PREFIX}${metadata.jobId}`;
      const progressData = await this.redis.get(progressKey);
      const progress: JobProgress | undefined = progressData
        ? JSON.parse(progressData)
        : undefined;

      return {
        locked: true,
        jobId: metadata.jobId,
        testRunId: metadata.testRunId,
        jobType: metadata.jobType,
        acquiredAt: metadata.acquiredAt,
        expiresAt,
        progress,
      };
    } catch (error) {
      logger.error(`Failed to get lock info: ${lockKey}`, error);
      return null;
    }
  }

  /**
   * Keep a lock alive for as long as the job holds it, and return a stop function.
   *
   * The TTL is 5 minutes while one analyze pipeline races a 600s timeout per stage
   * across ten stages, so without this a slow run silently drops its lock partway
   * through and a second job for the same system/environment/workload starts
   * writing `ds_*` rows for the same test run. Renewing beats raising the TTL past
   * the worst case: a TTL long enough to cover a 10-stage pipeline would also be
   * how long a crashed worker blocks the scope.
   *
   * Renews at a third of the TTL so two consecutive failed renewals still leave
   * margin. If the key expired anyway (a Redis blip or a GC pause spanning two
   * intervals), the heartbeat RE-ACQUIRES it rather than beating uselessly for the
   * remaining hours of the run: an absent key means no other job holds the scope,
   * because a queued one would have taken it. Re-acquisition uses `SET NX`, so it
   * can never steal a lock a successor legitimately owns — if the NX loses, that
   * successor is real, and only then do we give up.
   *
   * Giving up is logged at ERROR but does NOT abort the job — the pipeline has no
   * cancellation path, and killing a run mid-write would be worse than the overlap
   * this is preventing.
   *
   * Call the returned function in a `finally`, before `releaseLock`.
   */
  startLockRenewal(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    jobId: string,
    testRunId: string,
    jobType: JobType
  ): () => void {
    const lockKey = generateLockKey(systemUnderTestId, testEnvironment, workload);
    const intervalMs = Math.floor((JOB_DEFAULTS.LOCK_TTL_SECONDS * 1000) / 3);
    // Once a successor legitimately owns the scope, stop trying — otherwise every
    // tick for the rest of the run logs the same ERROR.
    let surrendered = false;

    const renew = async (): Promise<void> => {
      if (surrendered) {
        return;
      }

      const outcome = await this.extendLockOrReacquire(
        systemUnderTestId,
        testEnvironment,
        workload,
        jobId,
        testRunId,
        jobType
      );

      if (outcome === 'extended') {
        return;
      }

      if (outcome === 'reacquired') {
        // The key had expired. Nothing else held the scope, so exclusion is restored —
        // but the gap was real, so say so loudly enough to correlate with any overlap.
        logger.warn(
          `🔒 Lock had expired and was re-acquired — scope was unprotected for up to ` +
            `${Math.round(intervalMs / 1000)}s: ${lockKey}`,
          { jobId, testRunId }
        );
        return;
      }

      surrendered = true;
      logger.error(
        `🔓 Lost lock to another job; this run continues UNPROTECTED and a second ` +
          `job may now write the same scope: ${lockKey}`,
        { jobId, testRunId }
      );
    };

    const timer = setInterval(() => {
      // Not awaited — this runs on a timer, not in the job's call stack.
      renew().catch((error) => {
        logger.error(`Lock renewal threw for ${lockKey}`, error);
      });
    }, intervalMs);

    // Never hold the process open on the heartbeat alone.
    timer.unref?.();

    return () => clearInterval(timer);
  }

  /**
   * One heartbeat beat: extend our lock, or re-take it if it expired.
   *
   * Separates the two cases `extendLock` collapses into `false`. The Lua is a single
   * round-trip so the check and the write cannot interleave with another worker:
   *   - key present and ours  -> EXPIRE, 'extended'
   *   - key absent            -> SET with our metadata + TTL, 'reacquired'
   *   - key present, not ours -> 'lost' (never overwrite; the successor is real)
   */
  private async extendLockOrReacquire(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    jobId: string,
    testRunId: string,
    jobType: JobType
  ): Promise<'extended' | 'reacquired' | 'lost'> {
    const lockKey = generateLockKey(systemUnderTestId, testEnvironment, workload);

    const luaScript = `
      local lockKey = KEYS[1]
      local jobId = ARGV[1]
      local ttl = tonumber(ARGV[2])
      local metadata = ARGV[3]
      local lockData = redis.call('GET', lockKey)

      if not lockData then
        redis.call('SET', lockKey, metadata, 'EX', ttl)
        return 2
      end

      local existing = cjson.decode(lockData)
      if existing.jobId == jobId then
        redis.call('EXPIRE', lockKey, ttl)
        return 1
      end

      return 0
    `;

    const metadata: LockMetadata = {
      jobId,
      testRunId,
      jobType,
      // The scope was unheld a moment ago, so this genuinely is a fresh acquisition.
      acquiredAt: new Date().toISOString(),
      systemUnderTestId,
      testEnvironment,
      workload,
    };

    const result = await this.redis.eval(
      luaScript,
      1,
      lockKey,
      jobId,
      JOB_DEFAULTS.LOCK_TTL_SECONDS.toString(),
      JSON.stringify(metadata)
    );

    if (result === 1) {
      logger.debug(`🔄 Lock extended: ${lockKey}`, { jobId });
      return 'extended';
    }
    if (result === 2) {
      return 'reacquired';
    }
    return 'lost';
  }

  /**
   * Extend lock TTL while job is still running
   * This should be called periodically to prevent lock expiration
   *
   * @returns true if lock was extended, false if lock doesn't exist or is held by another job
   */
  async extendLock(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    jobId: string
  ): Promise<boolean> {
    const lockKey = generateLockKey(systemUnderTestId, testEnvironment, workload);

    try {
      // Use Lua script to verify ownership and extend atomically
      const luaScript = `
        local lockKey = KEYS[1]
        local jobId = ARGV[1]
        local ttl = tonumber(ARGV[2])
        local lockData = redis.call('GET', lockKey)

        if not lockData then
          return 0
        end

        local metadata = cjson.decode(lockData)
        if metadata.jobId == jobId then
          redis.call('EXPIRE', lockKey, ttl)
          return 1
        end

        return 0
      `;

      const result = await this.redis.eval(
        luaScript,
        1,
        lockKey,
        jobId,
        JOB_DEFAULTS.LOCK_TTL_SECONDS.toString()
      );

      if (result === 1) {
        logger.debug(`🔄 Lock extended: ${lockKey}`, { jobId });
        return true;
      }

      logger.warn(`Cannot extend lock: ${lockKey}`, { jobId });
      return false;
    } catch (error) {
      logger.error(`Failed to extend lock: ${lockKey}`, error);
      return false;
    }
  }

  /**
   * Try to acquire a generic key-based lock.
   *
   * Unlike `acquireLock`, this does NOT use the SUT/env/workload tuple — it locks
   * an arbitrary key (e.g. `job:lock:perf-test-metrics:<test_run_id>`). Used by
   * incremental collection to prevent overlapping ticks for the same test run
   * (issue #134). Returns `true` only when the caller now owns the lock.
   *
   * The caller passes an `ownerToken` (the BullMQ job id is a good choice). The
   * matching `releaseKeyLock` will only delete the key if the value still matches,
   * so a slow caller cannot accidentally release a successor's lock.
   */
  async acquireKeyLock(
    lockKey: string,
    ownerToken: string,
    ttlSeconds: number = JOB_DEFAULTS.LOCK_TTL_SECONDS
  ): Promise<boolean> {
    try {
      const result = await this.redis.set(lockKey, ownerToken, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      logger.error(`Failed to acquire key lock: ${lockKey}`, error);
      throw error;
    }
  }

  /**
   * Release a generic key-based lock previously acquired with `acquireKeyLock`.
   *
   * GET-then-DEL with an ownership check. There is a narrow race between the
   * GET and the DEL, but it is bounded by a single Redis round-trip while the
   * default lock TTL is `JOB_DEFAULTS.LOCK_TTL_SECONDS` (5 min — this comment
   * said 30 min, which was never what the constant held), so a successor lock
   * being deleted out from under its owner is unlikely in practice. A racy release is
   * also benign: the successor's work still runs to completion; the only cost
   * is that the next scheduler tick will be able to start instead of waiting.
   */
  async releaseKeyLock(lockKey: string, ownerToken: string): Promise<boolean> {
    try {
      const current = await this.redis.get(lockKey);
      if (current !== ownerToken) {
        return false;
      }
      const deleted = await this.redis.del(lockKey);
      return deleted === 1;
    } catch (error) {
      logger.error(`Failed to release key lock: ${lockKey}`, error);
      return false;
    }
  }

  /**
   * Force release a lock (used by stuck job scanner)
   * WARNING: This bypasses ownership checks and should only be used for cleanup
   *
   * @returns true if lock was released
   */
  async forceReleaseLock(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string
  ): Promise<boolean> {
    const lockKey = generateLockKey(systemUnderTestId, testEnvironment, workload);

    try {
      const result = await this.redis.del(lockKey);
      if (result > 0) {
        logger.warn(`⚠️ Force released lock: ${lockKey}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Failed to force release lock: ${lockKey}`, error);
      return false;
    }
  }

  /**
   * Build blocking info from existing lock
   */
  private async buildBlockingInfo(
    existingLock: JobLockInfo,
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string
  ): Promise<JobBlockedInfo> {
    const scopeKey = generateLockKey(systemUnderTestId, testEnvironment, workload);

    return {
      blocked: true,
      reason: `Another ${existingLock.jobType} job is currently processing this scope`,
      existingJobId: existingLock.jobId,
      existingJobProgress: existingLock.progress,
      scopeKey,
    };
  }

  /**
   * Publish blocked event to Redis
   */
  private async publishBlockedEvent(
    testRunId: string,
    jobType: JobType,
    blockingInfo: JobBlockedInfo
  ): Promise<void> {
    try {
      await this.redis.publish(
        JOB_REDIS_CHANNELS.BLOCKED,
        JSON.stringify({
          type: 'job:blocked',
          payload: {
            ...blockingInfo,
            requestedTestRunId: testRunId,
            requestedJobType: jobType,
          },
        })
      );
    } catch (error) {
      logger.error('Failed to publish blocked event:', error);
    }
  }
}
