import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JOB_DEFAULTS } from '@perfana/shared/types';
import { JobLockService } from '../../../services/JobLockService.js';

vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  })),
}));

interface RedisMock {
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  eval: ReturnType<typeof vi.fn>;
}

function createRedisMock(): RedisMock {
  return {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    eval: vi.fn(),
  };
}

describe('JobLockService key-based locks (issue #134)', () => {
  let redis: RedisMock;
  let service: JobLockService;

  beforeEach(() => {
    redis = createRedisMock();
    // The full ioredis surface area is irrelevant here — JobLockService only
    // touches set/get/del on the key-based path, and the constructor is
    // side-effect-free beyond an info log.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new JobLockService(redis as any);
  });

  describe('acquireKeyLock', () => {
    it('returns true and stores the owner token when the key is free', async () => {
      redis.set.mockResolvedValue('OK');

      const acquired = await service.acquireKeyLock(
        'job:lock:perf-test-metrics:tr-001',
        'job-123',
        900
      );

      expect(acquired).toBe(true);
      expect(redis.set).toHaveBeenCalledWith(
        'job:lock:perf-test-metrics:tr-001',
        'job-123',
        'EX',
        900,
        'NX'
      );
    });

    it('returns false when another caller already holds the lock', async () => {
      // Redis SET ... NX returns null when the key already exists
      redis.set.mockResolvedValue(null);

      const acquired = await service.acquireKeyLock(
        'job:lock:perf-test-metrics:tr-001',
        'job-456'
      );

      expect(acquired).toBe(false);
    });

    it('uses the default TTL when none is provided', async () => {
      redis.set.mockResolvedValue('OK');

      await service.acquireKeyLock('some:key', 'token');

      // Default LOCK_TTL_SECONDS comes from JOB_DEFAULTS — assert the *shape*
      // of the call (NX + a positive integer EX) rather than the exact value
      // so the test does not break if the constant is tuned.
      const args = redis.set.mock.calls[0];
      expect(args[0]).toBe('some:key');
      expect(args[1]).toBe('token');
      expect(args[2]).toBe('EX');
      expect(typeof args[3]).toBe('number');
      expect(args[3]).toBeGreaterThan(0);
      expect(args[4]).toBe('NX');
    });

    it('propagates Redis errors so the caller can decide to retry or fail', async () => {
      redis.set.mockRejectedValue(new Error('redis down'));

      await expect(
        service.acquireKeyLock('some:key', 'token')
      ).rejects.toThrow('redis down');
    });
  });

  describe('releaseKeyLock', () => {
    it('deletes the key when the stored owner token matches', async () => {
      redis.get.mockResolvedValue('job-123');
      redis.del.mockResolvedValue(1);

      const released = await service.releaseKeyLock(
        'job:lock:perf-test-metrics:tr-001',
        'job-123'
      );

      expect(released).toBe(true);
      expect(redis.get).toHaveBeenCalledWith('job:lock:perf-test-metrics:tr-001');
      expect(redis.del).toHaveBeenCalledWith('job:lock:perf-test-metrics:tr-001');
    });

    it('does NOT delete the key when the owner token does not match', async () => {
      redis.get.mockResolvedValue('different-job');

      const released = await service.releaseKeyLock(
        'job:lock:perf-test-metrics:tr-001',
        'job-123'
      );

      expect(released).toBe(false);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('returns false (not throw) when the key is missing', async () => {
      redis.get.mockResolvedValue(null);

      const released = await service.releaseKeyLock('missing:key', 'job-123');

      expect(released).toBe(false);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('logs and returns false when Redis errors during release', async () => {
      redis.get.mockRejectedValue(new Error('redis down'));

      const released = await service.releaseKeyLock('some:key', 'token');

      expect(released).toBe(false);
    });
  });
});

describe('startLockRenewal', () => {
  let redis: RedisMock;
  let service: JobLockService;

  const SCOPE = ['sut-1', 'acc', 'load', 'job-1', 'run-1', 'analyze'] as const;

  beforeEach(() => {
    vi.useFakeTimers();
    redis = createRedisMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new JobLockService(redis as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renews the lock while the job runs, well before the TTL expires', async () => {
    redis.eval.mockResolvedValue(1);

    const stop = service.startLockRenewal(...SCOPE);

    // The interval is a fraction of the TTL, so one TTL's worth of wall-clock must
    // produce more than one renewal — otherwise the lock can lapse mid-pipeline.
    await vi.advanceTimersByTimeAsync(JOB_DEFAULTS.LOCK_TTL_SECONDS * 1000);
    expect(redis.eval.mock.calls.length).toBeGreaterThan(1);

    // Every renewal is scoped to this job's lock key and job id.
    const [, keyCount, lockKey, jobId] = redis.eval.mock.calls[0]!;
    expect(keyCount).toBe(1);
    expect(lockKey).toBe('job:lock:sut-1:acc:load');
    expect(jobId).toBe('job-1');

    stop();
  });

  it('stops renewing once the returned function is called', async () => {
    redis.eval.mockResolvedValue(1);

    const stop = service.startLockRenewal(...SCOPE);
    await vi.advanceTimersByTimeAsync(JOB_DEFAULTS.LOCK_TTL_SECONDS * 1000);
    const callsBeforeStop = redis.eval.mock.calls.length;

    stop();
    await vi.advanceTimersByTimeAsync(JOB_DEFAULTS.LOCK_TTL_SECONDS * 10 * 1000);

    expect(redis.eval.mock.calls.length).toBe(callsBeforeStop);
  });

  it('re-acquires the lock when the key expired and nobody else took it', async () => {
    // The Lua returns 2 for "key was absent, so I SET it". Exclusion is restored:
    // an absent key means no other job holds the scope, because one would have grabbed it.
    redis.eval.mockResolvedValue(2);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const stop = service.startLockRenewal(...SCOPE);
    await vi.advanceTimersByTimeAsync(JOB_DEFAULTS.LOCK_TTL_SECONDS * 1000);

    // Still beating — a re-acquire is not a surrender.
    const calls = redis.eval.mock.calls.length;
    expect(calls).toBeGreaterThan(1);

    // The metadata it writes back must be this job's, or the successor check breaks.
    const metadata = JSON.parse(redis.eval.mock.calls[0]![5] as string);
    expect(metadata.jobId).toBe('job-1');
    expect(metadata.testRunId).toBe('run-1');

    stop();
    warn.mockRestore();
  });

  it('stops beating once another job legitimately owns the scope', async () => {
    // 0 = key present but held by someone else. Re-acquiring here would be lock
    // stealing, so the heartbeat must surrender instead of retrying forever.
    redis.eval.mockResolvedValue(0);

    const stop = service.startLockRenewal(...SCOPE);
    await vi.advanceTimersByTimeAsync(JOB_DEFAULTS.LOCK_TTL_SECONDS * 1000);
    const callsAfterLoss = redis.eval.mock.calls.length;

    await vi.advanceTimersByTimeAsync(JOB_DEFAULTS.LOCK_TTL_SECONDS * 10 * 1000);

    expect(callsAfterLoss).toBe(1);
    expect(redis.eval.mock.calls.length).toBe(1);
    stop();
  });

  it('never overwrites a lock held by another job', async () => {
    redis.eval.mockResolvedValue(0);
    const stop = service.startLockRenewal(...SCOPE);
    await vi.advanceTimersByTimeAsync(JOB_DEFAULTS.LOCK_TTL_SECONDS * 1000);

    // The write is inside the Lua, guarded by `if not lockData`. Assert the guard
    // exists rather than trusting the mock: a SET without it would be a lock steal.
    const script = redis.eval.mock.calls[0]![0] as string;
    expect(script).toMatch(/if not lockData then\s+redis\.call\('SET'/);
    expect(script).toContain("existing.jobId == jobId");
    stop();
  });

  it('keeps renewing after a failed renewal instead of dying on it', async () => {
    // Losing the lock once (or a Redis blip) must not silently stop the heartbeat —
    // the job may still hold the scope by the next tick.
    // A throw (Redis down) must not kill the heartbeat; a later beat can still succeed.
    redis.eval.mockRejectedValueOnce(new Error('redis down')).mockResolvedValue(1);

    const stop = service.startLockRenewal(...SCOPE);
    await vi.advanceTimersByTimeAsync(JOB_DEFAULTS.LOCK_TTL_SECONDS * 2 * 1000);

    expect(redis.eval.mock.calls.length).toBeGreaterThan(3);
    stop();
  });
});
