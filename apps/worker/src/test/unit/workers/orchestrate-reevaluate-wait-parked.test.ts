/**
 * waitForJobs runs two clocks: the running one (JOB_WAIT_TIMEOUT_MS) and the parked one.
 * A child still in BullMQ's waiting list, or active but queued behind the
 * HeavyStageMutex, must not burn the running budget — that is what turned a busy
 * database into a failed re-evaluate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('ioredis');
vi.mock('bullmq');
vi.mock('../../../config/environment.js', () => ({ getConfig: vi.fn(() => ({})) }));
vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() })),
}));
vi.mock('../../../common/database-accessor.js', () => ({ getDatabaseService: vi.fn() }));
vi.mock('../../../config/redis-pool.js', () => ({ getRedisPool: vi.fn() }));

import { waitForJobs } from '../../../workers/simple-orchestrate-reevaluate-batch.js';

const POLL = 10_000;
const TIMEOUT = 60_000;

function childQueue(child: { state: string; progress?: unknown }) {
  const remove = vi.fn();
  return {
    remove,
    queue: {
      getJob: vi.fn(async () => ({
        getState: vi.fn(async () => child.state),
        progress: child.progress,
        remove,
      })),
    },
  };
}

function events() {
  return { waitUntilReady: vi.fn(), on: vi.fn(), off: vi.fn() };
}

describe('waitForJobs parked clock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not time out a child that is still queued, and reports it as waiting', async () => {
    const child = { state: 'waiting' as string, progress: undefined as unknown };
    const { queue, remove } = childQueue(child);
    const reporter = { setWaiting: vi.fn().mockResolvedValue(undefined) };

    const wait = waitForJobs(events() as never, ['c1'], TIMEOUT, queue as never, reporter as never);
    let settled: string | null = null;
    wait.then(() => (settled = 'ok'), (e: Error) => (settled = e.message));

    // Parked for three running-budgets: still waiting, nothing removed.
    await vi.advanceTimersByTimeAsync(TIMEOUT * 3);
    expect(settled).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    expect(reporter.setWaiting).toHaveBeenCalledWith(expect.stringContaining('waiting for a free analysis worker'));

    // Now parked behind the mutex instead — same treatment; the holder id stays in the
    // worker log (it names another organisation's run), the user-facing message is neutral.
    child.state = 'active';
    child.progress = { queuedBehind: 'analyze-x' };
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(settled).toBeNull();
    expect(reporter.setWaiting).toHaveBeenCalledWith(expect.stringContaining('another analysis to finish its database-heavy stage'));
    expect(reporter.setWaiting).not.toHaveBeenCalledWith(expect.stringContaining('analyze-x'));

    // Running at last: the running clock starts from zero here, so it takes a full
    // TIMEOUT of running time before the wait gives up and removes the child.
    child.progress = 0;
    await vi.advanceTimersByTimeAsync(TIMEOUT - POLL);
    expect(settled).toBeNull();
    expect(reporter.setWaiting).toHaveBeenLastCalledWith(null);
    await vi.advanceTimersByTimeAsync(POLL * 2);
    expect(settled).toMatch(/ran for/);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('charges the running clock when only SOME children are parked, or the state read fails', async () => {
    const states: Record<string, string> = { c1: 'waiting', c2: 'active' };
    const queue = {
      getJob: vi.fn(async (id: string) => ({ getState: async () => states[id], progress: 0, remove: vi.fn() })),
    };
    let settled: string | null = null;
    waitForJobs(events() as never, ['c1', 'c2'], TIMEOUT, queue as never).then(() => (settled = 'ok'), (e: Error) => (settled = e.message));
    await vi.advanceTimersByTimeAsync(TIMEOUT + POLL);
    expect(settled).toMatch(/ran for/);

    const broken = { getJob: vi.fn().mockRejectedValue(new Error('redis gone')) };
    let settled2: string | null = null;
    waitForJobs(events() as never, ['c1'], TIMEOUT, broken as never).then(() => (settled2 = 'ok'), (e: Error) => (settled2 = e.message));
    await vi.advanceTimersByTimeAsync(TIMEOUT + POLL);
    expect(settled2).toMatch(/ran for/);
  });

  it('clears the Queued record when the child completes while parked, and never publishes it after that', async () => {
    let onCompleted: (e: { jobId: string }) => void = () => {};
    const ev = { waitUntilReady: vi.fn(), on: vi.fn((name: string, fn: never) => { if (name === 'completed') {onCompleted = fn;} }), off: vi.fn() };
    let releaseState: () => void = () => {};
    let armed = false;
    const queue = {
      getJob: vi.fn(async () => ({
        // The second poll's getState hangs until the test completes the child mid-tick.
        getState: () => (armed ? new Promise<string>((r) => { releaseState = () => r('waiting'); }) : Promise.resolve('waiting')),
        progress: undefined,
        remove: vi.fn(),
      })),
    };
    const reporter = { setWaiting: vi.fn().mockResolvedValue(undefined) };
    const wait = waitForJobs(ev as never, ['c1'], TIMEOUT, queue as never, reporter as never);
    await vi.advanceTimersByTimeAsync(POLL); // first tick: parked
    expect(reporter.setWaiting).toHaveBeenLastCalledWith(expect.stringContaining('Queued'));
    armed = true;
    await vi.advanceTimersByTimeAsync(POLL); // second tick in flight, awaiting getState
    onCompleted({ jobId: 'c1' });
    releaseState();
    await wait;
    expect(reporter.setWaiting).toHaveBeenLastCalledWith(null);
    expect(ev.off).toHaveBeenCalledTimes(2);
  });

  it('settles a child whose completion event was missed, instead of charging it to the running clock', async () => {
    const { queue } = childQueue({ state: 'completed' });
    let settled: string | null = null;
    waitForJobs(events() as never, ['c1'], TIMEOUT, queue as never).then(() => (settled = 'ok'), (e: Error) => (settled = e.message));
    await vi.advanceTimersByTimeAsync(POLL);
    expect(settled).toBe('ok');

    const failedQ = childQueue({ state: 'failed' }).queue;
    let settled2: string | null = null;
    waitForJobs(events() as never, ['c1'], TIMEOUT, failedQ as never).then(() => (settled2 = 'ok'), (e: Error) => (settled2 = e.message));
    await vi.advanceTimersByTimeAsync(POLL);
    expect(settled2).toMatch(/1 jobs failed/);
  });

  it('labels a child in retry backoff as such rather than as waiting for a worker', async () => {
    const { queue } = childQueue({ state: 'delayed' });
    const reporter = { setWaiting: vi.fn().mockResolvedValue(undefined) };
    waitForJobs(events() as never, ['c1'], TIMEOUT, queue as never, reporter as never).catch(() => {});
    await vi.advanceTimersByTimeAsync(POLL);
    expect(reporter.setWaiting).toHaveBeenLastCalledWith(expect.stringContaining('waiting for its retry'));
  });

  it('gives up on a child parked for over an hour', async () => {
    const { queue } = childQueue({ state: 'waiting' });
    const wait = waitForJobs(events() as never, ['c1'], TIMEOUT, queue as never);
    let settled: string | null = null;
    wait.then(() => (settled = 'ok'), (e: Error) => (settled = e.message));

    await vi.advanceTimersByTimeAsync(61 * 60_000);
    expect(settled).toMatch(/stayed queued behind a free analysis worker/);
  });
});
