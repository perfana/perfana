import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JOB_DEFAULTS, JOB_REDIS_CHANNELS, JOB_REDIS_KEYS } from '@perfana/shared/types';

vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
const find = vi.fn();
vi.mock('../../../common/database-accessor.js', () => ({ getDatabaseService: () => ({ testRunRepo: { find } }) }));

import { QueuedJobAnnouncer } from '../../../services/QueuedJobAnnouncer.js';

function job(id: string, name: string, testRunId?: unknown, timestamp = 1_700_000_000_000) {
  return { id, name, data: { testRunId }, timestamp };
}

describe('QueuedJobAnnouncer', () => {
  let redis: { eval: ReturnType<typeof vi.fn>; publish: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  let queue: { getWaiting: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    redis = { eval: vi.fn().mockResolvedValue(1), publish: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null) };
    queue = { getWaiting: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    find.mockResolvedValue([
      { testRunId: 'run-a', systemUnderTestId: 'sut', testEnvironment: 'env', workload: 'wl' },
    ]);
  });

  it('publishes one waiting record per analyze-test job whose run exists, with the API staleness TTL', async () => {
    queue.getWaiting.mockResolvedValue([
      job('j1', 'analyze-test', 'run-a'),
      job('j2', 'collect-metrics-incremental', 'run-a'), // not an analysis
      job('j3', 'analyze-test', 'run-gone'),             // no such run in the DB
      job('j4', 'analyze-test', 42),                     // malformed payload
    ]);
    const announcer = new QueuedJobAnnouncer(redis as never, queue as never);

    expect(await announcer.announce()).toBe(1);

    expect(redis.eval).toHaveBeenCalledTimes(1);
    const [, , key, ttl, payload] = redis.eval.mock.calls[0]!;
    expect(key).toBe(`${JOB_REDIS_KEYS.PROGRESS_PREFIX}j1`);
    expect(ttl).toBe(JOB_DEFAULTS.LOCK_TTL_SECONDS); // must match the API's eviction threshold
    const progress = JSON.parse(String(payload));
    expect(progress).toMatchObject({ jobId: 'j1', testRunId: 'run-a', systemUnderTestId: 'sut', status: 'waiting', jobType: 'analyze' });
    expect(progress.startedAt).toBe(new Date(1_700_000_000_000).toISOString()); // enqueue time, so elapsed = queue wait
    expect(redis.publish).toHaveBeenCalledWith(JOB_REDIS_CHANNELS.PROGRESS, expect.stringContaining('"type":"job:progress"'));
  });

  it('stays silent about a run whose scope is locked by another job, so the running job keeps its frame', async () => {
    queue.getWaiting.mockResolvedValue([job('j1', 'analyze-test', 'run-a')]);
    redis.get.mockResolvedValue(JSON.stringify({ locked: true, jobId: 'analyze-running' }));
    expect(await new QueuedJobAnnouncer(redis as never, queue as never).announce()).toBe(0);
    expect(redis.eval).not.toHaveBeenCalled();
    expect(redis.get).toHaveBeenCalledWith('job:lock:sut:env:wl');
  });

  it('does not clobber a live record: no publish when the guarded write declined', async () => {
    queue.getWaiting.mockResolvedValue([job('j1', 'analyze-test', 'run-a')]);
    redis.eval.mockResolvedValue(0);
    expect(await new QueuedJobAnnouncer(redis as never, queue as never).announce()).toBe(0);
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('skips the DB when nothing is waiting, swallows a failing scan, and never overlaps itself', async () => {
    queue.getWaiting.mockResolvedValue([]);
    const announcer = new QueuedJobAnnouncer(redis as never, queue as never);
    expect(await announcer.announce()).toBe(0);
    expect(find).not.toHaveBeenCalled();

    let unblock: (v: unknown[]) => void = () => {};
    queue.getWaiting.mockReturnValueOnce(new Promise((r) => { unblock = r; }));
    const inFlight = announcer.announce();
    expect(await announcer.announce()).toBe(0); // re-entrancy guard
    unblock([]);
    await inFlight;

    queue.getWaiting.mockRejectedValueOnce(new Error('redis gone'));
    await expect(announcer.announce()).resolves.toBe(0);
    queue.getWaiting.mockResolvedValue([]);
    await expect(announcer.announce()).resolves.toBe(0); // guard was reset in finally
  });

  it('stop() closes the queue handle it owns', async () => {
    const announcer = new QueuedJobAnnouncer(redis as never, queue as never);
    await announcer.stop();
    expect(queue.close).toHaveBeenCalledTimes(1);
  });
});
