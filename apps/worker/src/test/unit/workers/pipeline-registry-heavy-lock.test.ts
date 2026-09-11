/**
 * The child-side half of the heavy-stage serialisation: a registry-run heavy job takes the
 * same lock the analyze orchestrator does, advertises `{ queuedBehind }` while parked (which
 * waitForJobs's parkedBehind() reads to stop its running clock), resets it once acquired, and
 * releases the lock and the pooled Redis connection on every path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
const poolRelease = vi.fn();
const redisConn = { tag: 'conn' };
vi.mock('../../../config/redis-pool.js', () => ({
  getRedisPool: () => ({ acquire: vi.fn().mockResolvedValue(redisConn), release: poolRelease }),
}));
const release = vi.fn().mockResolvedValue(undefined);
const acquire = vi.fn(async (onWaiting: (h: string) => Promise<void>) => { await onWaiting('analyze-x'); return release; });
const ctorArgs: unknown[][] = [];
vi.mock('../../../services/HeavyStageMutex.js', () => ({
  HEAVY_STAGES: new Set(['statistics-calculation']),
  HeavyStageMutex: vi.fn((...args: unknown[]) => { ctorArgs.push(args); return { acquire }; }),
}));

import { registerPipeline, createProcessorFromRegistry } from '../../../workers/pipeline-registry.js';

describe('withHeavyStageLock (pipeline registry)', () => {
  beforeEach(() => { vi.clearAllMocks(); ctorArgs.length = 0; });

  it('takes the lock for a heavy job keyed on the job id, marks it parked, resets, and releases on throw', async () => {
    registerPipeline({
      jobName: 'statistics-calculation',
      createPipeline: () => ({ execute: vi.fn().mockRejectedValue(new Error('boom')) }),
      successMessage: 'stats',
    });
    const job = { id: 'child-1', data: { testRunIds: ['r'] }, updateProgress: vi.fn().mockResolvedValue(undefined) };

    await expect(createProcessorFromRegistry()['statistics-calculation']!(job as never)).rejects.toThrow('boom');

    expect(ctorArgs[0]?.[0]).toBe(redisConn);
    expect(ctorArgs[0]?.[1]).toBe('child-1');
    expect(job.updateProgress).toHaveBeenNthCalledWith(1, { queuedBehind: 'analyze-x' });
    expect(job.updateProgress).toHaveBeenNthCalledWith(2, 0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(poolRelease).toHaveBeenCalledWith(redisConn);
  });

  it('does not touch Redis for a non-heavy job', async () => {
    registerPipeline({
      jobName: 'panels-processing',
      createPipeline: () => ({ execute: vi.fn().mockResolvedValue({ success: true }) }),
      successMessage: 'panels',
    });
    const job = { id: 'p-1', data: {}, updateProgress: vi.fn() };
    await expect(createProcessorFromRegistry()['panels-processing']!(job as never)).resolves.toMatchObject({ status: 'success' });
    expect(acquire).not.toHaveBeenCalled();
    expect(job.updateProgress).not.toHaveBeenCalled();
  });

  it('refuses to take the lock anonymously', async () => {
    const job = { id: undefined, data: {}, updateProgress: vi.fn() };
    await expect(createProcessorFromRegistry()['statistics-calculation']!(job as never)).rejects.toThrow(/no id/);
    expect(acquire).not.toHaveBeenCalled();
  });
});
