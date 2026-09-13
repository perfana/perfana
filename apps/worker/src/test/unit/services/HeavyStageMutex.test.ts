import { describe, it, expect, vi } from 'vitest';
import { HeavyStageMutex, HEAVY_STAGE_LOCK_KEY, HEAVY_STAGES } from '../../../services/HeavyStageMutex.js';

vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

/** Just enough of ioredis for SET NX PX, GET and the two compare-and-* scripts. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: vi.fn(async (key: string, value: string, _px: string, _ttl: number, nx?: string) => {
      if (nx === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    eval: vi.fn(async (script: string, _n: number, key: string, holder: string) => {
      if (store.get(key) !== holder) return 0;
      if (script.includes("'del'")) store.delete(key);
      return 1;
    }),
  };
}

describe('HeavyStageMutex', () => {
  it('second holder waits, reports who holds it, and gets in once the first releases', async () => {
    const redis = fakeRedis();
    const a = new HeavyStageMutex(redis as never, 'job-a', { pollMs: 5 });
    const b = new HeavyStageMutex(redis as never, 'job-b', { pollMs: 5 });

    const releaseA = await a.acquire();
    const seen: string[] = [];
    const bAcquired = b.acquire(async (holder) => { seen.push(holder); });

    await new Promise((r) => setTimeout(r, 20));
    // Stored as <holder>|<nonce>; the readable holder is what waiters are told.
    expect(redis.store.get(HEAVY_STAGE_LOCK_KEY)).toMatch(/^job-a\|[0-9a-f-]{36}$/);
    expect(seen).toContain('job-a');

    await releaseA();
    const releaseB = await bAcquired;
    expect(redis.store.get(HEAVY_STAGE_LOCK_KEY)).toMatch(/^job-b\|/);
    await releaseB();
    expect(redis.store.has(HEAVY_STAGE_LOCK_KEY)).toBe(false);
  });

  it('a stale holder cannot delete the lock the next job took over', async () => {
    const redis = fakeRedis();
    const releaseA = await new HeavyStageMutex(redis as never, 'job-a').acquire();
    redis.store.set(HEAVY_STAGE_LOCK_KEY, 'job-b|nonce'); // TTL lapsed, job-b took it
    await releaseA();
    expect(redis.store.get(HEAVY_STAGE_LOCK_KEY)).toBe('job-b|nonce');
  });

  it('a re-dispatched job with the SAME id cannot delete or extend the new instance\'s lock', async () => {
    // BullMQ reuses the job id on a stalled-job re-dispatch and on retries, so the id alone
    // is not an ownership token; the per-acquire nonce is.
    const redis = fakeRedis();
    const stale = new HeavyStageMutex(redis as never, 'job-a');
    const releaseStale = await stale.acquire();
    redis.store.delete(HEAVY_STAGE_LOCK_KEY); // TTL lapsed
    const fresh = new HeavyStageMutex(redis as never, 'job-a');
    const releaseFresh = await fresh.acquire();
    const freshToken = redis.store.get(HEAVY_STAGE_LOCK_KEY);

    await releaseStale();
    expect(redis.store.get(HEAVY_STAGE_LOCK_KEY)).toBe(freshToken);
    await releaseFresh();
    expect(redis.store.has(HEAVY_STAGE_LOCK_KEY)).toBe(false);
  });

  it('heartbeats the lock it holds and survives a failing heartbeat or release', async () => {
    vi.useFakeTimers();
    try {
      const redis = fakeRedis();
      const release = await new HeavyStageMutex(redis as never, 'job-a').acquire();
      await vi.advanceTimersByTimeAsync(60_000);
      const pexpire = redis.eval.mock.calls.find((c) => String(c[0]).includes("'pexpire'"));
      expect(pexpire?.[3]).toBe(redis.store.get(HEAVY_STAGE_LOCK_KEY));

      redis.eval.mockRejectedValue(new Error('redis down'));
      await vi.advanceTimersByTimeAsync(60_000); // heartbeat failure is logged, not thrown
      await expect(release()).resolves.toBeUndefined(); // release failure is logged, not thrown
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up after maxWaitMs with the holder in the message', async () => {
    const redis = fakeRedis();
    await new HeavyStageMutex(redis as never, 'job-a').acquire();
    await expect(
      new HeavyStageMutex(redis as never, 'job-b', { pollMs: 5, maxWaitMs: 10 }).acquire(),
    ).rejects.toThrow(/held by job-a/);
  });
});

describe('HEAVY_STAGES', () => {
  it('guards performance-test-metrics — it aggregates the whole run like statistics-calculation', () => {
    expect(HEAVY_STAGES.has('performance-test-metrics')).toBe(true);
  });
});
