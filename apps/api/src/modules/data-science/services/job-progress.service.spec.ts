import { ConfigService } from '@nestjs/config';
import {
  JobProgress,
  JobLockInfo,
  JOB_REDIS_KEYS,
  generateLockKey,
} from '@perfana/shared/types';
import { JobProgressService } from './job-progress.service';

/**
 * Reconciliation tests for issue #387 — phantom "job in progress".
 *
 * These exercise the read-path reconciliation that evicts in-memory active-job
 * entries when authoritative state (Redis progress key / staleness / lock owner)
 * says the job is no longer running. The Redis client and in-memory caches are
 * stubbed directly so the suite needs no live Redis.
 */
describe('JobProgressService — active-job reconciliation', () => {
  const SUT = 'sut-1';
  const ENV = 'production';
  const WORKLOAD = 'loadtest';
  const JOB_ID = '13';

  let service: JobProgressService;
  let redisStore: Map<string, string>;
  let getMock: jest.Mock;

  const scopeKey = `${SUT}:${ENV}:${WORKLOAD}`;
  const lockKey = generateLockKey(SUT, ENV, WORKLOAD);
  const progressKey = `${JOB_REDIS_KEYS.PROGRESS_PREFIX}${JOB_ID}`;

  const makeProgress = (overrides: Partial<JobProgress> = {}): JobProgress => ({
    jobId: JOB_ID,
    testRunId: 'tr-1',
    systemUnderTestId: SUT,
    testEnvironment: ENV,
    workload: WORKLOAD,
    jobType: 'reevaluate' as JobProgress['jobType'],
    stage: 'statistics-recalculation',
    stageName: 'Statistics recalculation',
    stageIndex: 2,
    totalStages: 6,
    stageProgress: 14,
    overallProgress: 14,
    message: 'statistics-recalculation - 14%',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    lastProgressAt: new Date().toISOString(),
    status: 'active',
    ...overrides,
  });

  const makeLock = (jobId: string): string =>
    JSON.stringify({ locked: true, jobId, jobType: 'reevaluate' } as JobLockInfo);

  /** Seed an in-memory active entry as a live progress event would. */
  const seed = (progress: JobProgress) => {
    (service as unknown as { activeJobs: Map<string, JobProgress> }).activeJobs.set(
      progress.jobId,
      progress,
    );
    (service as unknown as { scopeToJobIndex: Map<string, string> }).scopeToJobIndex.set(
      `${progress.systemUnderTestId}:${progress.testEnvironment}:${progress.workload}`,
      progress.jobId,
    );
  };

  const activeJobsMap = () =>
    (service as unknown as { activeJobs: Map<string, JobProgress> }).activeJobs;
  const scopeIndexMap = () =>
    (service as unknown as { scopeToJobIndex: Map<string, string> }).scopeToJobIndex;

  beforeEach(() => {
    const configService = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    service = new JobProgressService(configService);

    redisStore = new Map<string, string>();
    getMock = jest.fn((key: string) => Promise.resolve(redisStore.get(key) ?? null));
    (service as unknown as { queryRedis: { get: jest.Mock } }).queryRedis = { get: getMock };
    (service as unknown as { isRedisAvailable: boolean }).isRedisAvailable = true;
  });

  it('evicts a finished job whose terminal event was missed (status completed in Redis)', async () => {
    seed(makeProgress());
    // Redis progress key reflects the real terminal state; the completed event was dropped.
    redisStore.set(progressKey, JSON.stringify(makeProgress({ status: 'completed', overallProgress: 100 })));
    redisStore.set(lockKey, makeLock(JOB_ID));

    const result = await service.getActiveJobForScope(SUT, ENV, WORKLOAD);

    expect(result).toBeNull();
    expect(activeJobsMap().has(JOB_ID)).toBe(false);
    expect(scopeIndexMap().has(scopeKey)).toBe(false);
  });

  it('evicts an entry whose progress key has disappeared from Redis', async () => {
    seed(makeProgress());
    // No progress key set, lock still lingering.
    redisStore.set(lockKey, makeLock(JOB_ID));

    const result = await service.getActiveJobForScope(SUT, ENV, WORKLOAD);

    expect(result).toBeNull();
    expect(activeJobsMap().has(JOB_ID)).toBe(false);
  });

  it('evicts a stale entry (lastProgressAt older than threshold) without consulting Redis', async () => {
    const stale = makeProgress({
      lastProgressAt: new Date(Date.now() - 31 * 60_000).toISOString(), // 31 min ago
    });
    seed(stale);

    const result = await service.getActiveJobForScope(SUT, ENV, WORKLOAD);

    expect(result).toBeNull();
    expect(activeJobsMap().has(JOB_ID)).toBe(false);
    expect(getMock).not.toHaveBeenCalled();
  });

  it('evicts when the scope lock is now held by a different job', async () => {
    seed(makeProgress());
    redisStore.set(progressKey, JSON.stringify(makeProgress()));
    redisStore.set(lockKey, makeLock('99')); // someone else owns the scope now

    const result = await service.getActiveJobForScope(SUT, ENV, WORKLOAD);

    expect(result).toBeNull();
    expect(activeJobsMap().has(JOB_ID)).toBe(false);
  });

  it('returns the live job when Redis confirms it is active and owned', async () => {
    seed(makeProgress());
    const fresh = makeProgress({ overallProgress: 42, message: 'statistics-recalculation - 42%' });
    redisStore.set(progressKey, JSON.stringify(fresh));
    redisStore.set(lockKey, makeLock(JOB_ID));

    const result = await service.getActiveJobForScope(SUT, ENV, WORKLOAD);

    expect(result).not.toBeNull();
    expect(result?.overallProgress).toBe(42);
    expect(activeJobsMap().has(JOB_ID)).toBe(true);
  });

  it('does NOT evict a long-running job whose lock expired but progress is still fresh', async () => {
    // The worker never auto-extends the lock, so a >5min job legitimately has no
    // lock while still publishing progress. Progress key is authoritative.
    seed(makeProgress());
    redisStore.set(progressKey, JSON.stringify(makeProgress({ overallProgress: 55 })));
    // No lock key in Redis.

    const result = await service.getActiveJobForScope(SUT, ENV, WORKLOAD);

    expect(result).not.toBeNull();
    expect(result?.overallProgress).toBe(55);
    expect(activeJobsMap().has(JOB_ID)).toBe(true);
  });

  it('getAllActiveJobs() omits finished/stale jobs and keeps live ones', async () => {
    const liveJobId = '13';
    const doneJobId = '14';
    const live = makeProgress({ jobId: liveJobId });
    const done = makeProgress({
      jobId: doneJobId,
      workload: 'other',
    });
    seed(live);
    seed(done);

    redisStore.set(`${JOB_REDIS_KEYS.PROGRESS_PREFIX}${liveJobId}`, JSON.stringify(live));
    redisStore.set(generateLockKey(SUT, ENV, WORKLOAD), makeLock(liveJobId));
    // done job: terminal status in Redis
    redisStore.set(
      `${JOB_REDIS_KEYS.PROGRESS_PREFIX}${doneJobId}`,
      JSON.stringify(makeProgress({ jobId: doneJobId, workload: 'other', status: 'failed' })),
    );

    const all = await service.getAllActiveJobs();

    expect(all.map((j) => j.jobId)).toEqual([liveJobId]);
    expect(activeJobsMap().has(doneJobId)).toBe(false);
  });

  it('falls back to the non-stale cached entry when Redis is unavailable', async () => {
    (service as unknown as { isRedisAvailable: boolean }).isRedisAvailable = false;
    seed(makeProgress({ overallProgress: 30 }));

    const result = await service.getActiveJobForScope(SUT, ENV, WORKLOAD);

    expect(result?.overallProgress).toBe(30);
  });

  it('evicts a stale cached entry even when Redis is unavailable', async () => {
    (service as unknown as { isRedisAvailable: boolean }).isRedisAvailable = false;
    seed(makeProgress({ lastProgressAt: new Date(Date.now() - 31 * 60_000).toISOString() }));

    const result = await service.getActiveJobForScope(SUT, ENV, WORKLOAD);

    expect(result).toBeNull();
    expect(activeJobsMap().has(JOB_ID)).toBe(false);
  });
});
