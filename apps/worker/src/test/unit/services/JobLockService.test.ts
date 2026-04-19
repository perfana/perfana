import { describe, it, expect, beforeEach, vi } from 'vitest';
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
}

function createRedisMock(): RedisMock {
  return {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
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
