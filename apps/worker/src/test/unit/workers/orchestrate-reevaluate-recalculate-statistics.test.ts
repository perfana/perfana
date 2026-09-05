/**
 * Coverage for the third data-collection branch of the orchestrate-reevaluate-batch
 * worker: `recalculateStatistics`.
 *
 * The two pre-existing branches (`refreshMode === 'missing-data'` and `'force'`) both
 * FETCH first and then run StatisticsPipeline only when the fetch returned new rows.
 * Neither covers the case this branch exists for: the DATA is unchanged but the
 * ANALYSIS WINDOW moved, because a user edited test_runs.ramp_up / ramp_down (the
 * "apply to all test runs of this workload" checkbox). The offsets change nothing
 * anyone can see until StatisticsPipeline rebakes ds_metrics.ramp_up and rewrites
 * ds_metric_statistics, so without this branch the checks and ADAPT stages that follow
 * evaluate the PREVIOUS window and the edit silently does nothing.
 *
 * Three properties are load-bearing and asserted here:
 *   1. it enqueues statistics-calculation and waits for it,
 *   2. it is NOT gated on testRunsWithNewData the way the fetch branches are —
 *      nothing was fetched, and there is still work to do,
 *   3. it fires only in the absence of a refreshMode, so it can never double-run
 *      statistics alongside a fetch branch that already schedules it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

vi.mock('ioredis');
vi.mock('bullmq');

vi.mock('../../../config/environment.js', () => ({
  getConfig: vi.fn(() => ({
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: '',
    REDIS_DB: 0,
  })),
}));

vi.mock('../../../lib/utils/logger.js', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  })),
}));

const findOne = vi.fn();
vi.mock('../../../common/database-accessor.js', () => ({
  getDatabaseService: vi.fn(() => ({
    testRunRepo: { findOne },
  })),
}));

const releaseRedis = vi.fn();
vi.mock('../../../config/redis-pool.js', () => ({
  getRedisPool: vi.fn(() => ({
    acquire: vi.fn().mockResolvedValue({}),
    release: releaseRedis,
  })),
}));

const acquireLock = vi.fn().mockResolvedValue({ acquired: true });
vi.mock('../../../services/JobLockService.js', () => ({
  JobLockService: vi.fn(() => ({
    acquireLock,
    releaseLock: vi.fn().mockResolvedValue(undefined),
    startLockRenewal: vi.fn(() => vi.fn()),
  })),
}));

const startStage = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../services/ProgressReporter.js', () => ({
  ProgressReporter: vi.fn((_redis: unknown, _job: unknown, _info: unknown, _type: unknown, stages: string[]) => {
    declaredStages.push(...stages);
    return {
      startStage,
      completeStage: vi.fn().mockResolvedValue(undefined),
      updateStageProgress: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

// Never reached in these scenarios, but imported at module load.
vi.mock('../../../services/MetricCollectionGapService.js', () => ({
  MetricCollectionGapService: vi.fn(() => ({})),
}));
vi.mock('../../../pipelines/IncrementalMetricsPipeline.js', () => ({
  IncrementalMetricsPipeline: vi.fn(() => ({ execute: vi.fn() })),
}));
vi.mock('../../../pipelines/DynatracePipeline.js', () => ({
  DynatracePipeline: vi.fn(() => ({ execute: vi.fn() })),
}));
vi.mock('../../../pipelines/PanelsPipeline.js', () => ({
  PanelsPipeline: vi.fn(() => ({ execute: vi.fn() })),
}));
const sanityExecute = vi.fn().mockResolvedValue({ status: 'success' });
vi.mock('../../../pipelines/DataSanityCheckPipeline.js', () => ({
  DataSanityCheckPipeline: vi.fn(() => ({ execute: sanityExecute })),
}));

const declaredStages: string[] = [];

const { simpleOrchestrateReevaluateBatchWorker } = await import(
  '../../../workers/simple-orchestrate-reevaluate-batch.js'
);

/** Every job the orchestrator put on the analyze queue, in order. */
let enqueued: Array<{ name: string; data: unknown }>;

beforeEach(() => {
  vi.clearAllMocks();
  declaredStages.length = 0;
  enqueued = [];

  findOne.mockResolvedValue({
    testRunId: 'run-001',
    systemUnderTestId: 'sut-1',
    testEnvironment: 'acc',
    workload: 'loadTest',
  });
  acquireLock.mockResolvedValue({ acquired: true });
  sanityExecute.mockResolvedValue({ status: 'success' });

  let seq = 0;
  vi.mocked(Queue).mockImplementation(
    () =>
      ({
        add: vi.fn(async (name: string, data: unknown) => {
          seq += 1;
          enqueued.push({ name, data });
          return { id: `job-${seq}` };
        }),
        // waitForJobs resolves off the already-completed state check, so no event
        // plumbing is needed.
        getJob: vi.fn(async (id: string) => ({
          id,
          getState: vi.fn().mockResolvedValue('completed'),
        })),
        close: vi.fn().mockResolvedValue(undefined),
      }) as never
  );

  vi.mocked(QueueEvents).mockImplementation(
    () =>
      ({
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        off: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      }) as never
  );

  vi.mocked(IORedis).mockImplementation(() => ({ on: vi.fn(), quit: vi.fn() }) as never);
});

const run = (data: Record<string, unknown>) =>
  simpleOrchestrateReevaluateBatchWorker()({ data, id: 'bull-job-1' });

describe('orchestrate-reevaluate-batch — recalculateStatistics branch', () => {
  it('enqueues statistics-calculation for the batch when no data collection is requested', async () => {
    const result = await run({
      testRunIds: ['run-001', 'run-002'],
      batchId: 'reeval-1',
      checks: false,
      adapt: false,
      recalculateStatistics: true,
    });

    expect(result.status).toBe('success');

    const statsJobs = enqueued.filter((job) => job.name === 'statistics-calculation');
    expect(statsJobs).toHaveLength(1);
    // The pipeline takes the whole batch in one job, not one job per run.
    expect(statsJobs[0]!.data).toEqual({ testRunIds: ['run-001', 'run-002'] });

    // Nothing was fetched: no collection job may be scheduled alongside it.
    const collectionNames = enqueued.map((job) => job.name);
    expect(collectionNames).not.toContain('metrics-collection');
    expect(collectionNames).not.toContain('dynatrace-collection');
    expect(collectionNames).not.toContain('panels-processing');
  });

  it('declares statistics-recalculation as a progress stage and starts it', async () => {
    await run({
      testRunIds: ['run-001'],
      batchId: 'reeval-2',
      checks: false,
      adapt: false,
      recalculateStatistics: true,
    });

    // The stage list drives the UI's percentage; omitting it strands the progress bar.
    expect(declaredStages).toContain('statistics-recalculation');
    expect(startStage).toHaveBeenCalledWith('statistics-recalculation');
  });

  it('runs statistics before checks and ADAPT, so both see the new window', async () => {
    await run({
      testRunIds: ['run-001'],
      batchId: 'reeval-3',
      checks: true,
      adapt: true,
      recalculateStatistics: true,
    });

    const names = enqueued.map((job) => job.name);
    const statsIndex = names.indexOf('statistics-calculation');
    const checksIndex = names.indexOf('checks-evaluation');

    expect(statsIndex).toBeGreaterThanOrEqual(0);
    expect(checksIndex).toBeGreaterThan(statsIndex);
    // ADAPT is downstream of both and must be last of the three.
    expect(names.lastIndexOf('adapt-analysis')).toBeGreaterThan(checksIndex);
  });

  it('does not recalculate statistics on a plain re-evaluate', async () => {
    await run({
      testRunIds: ['run-001'],
      batchId: 'reeval-4',
      checks: false,
      adapt: false,
    });

    expect(enqueued.map((job) => job.name)).not.toContain('statistics-calculation');
    expect(declaredStages).not.toContain('statistics-recalculation');
  });

  it('does not double-schedule statistics when a refreshMode branch already owns it', async () => {
    // refreshMode wins the if/else chain. Were the branch an independent `if`, a
    // force refresh asking for recalculation would run StatisticsPipeline twice.
    await run({
      testRunIds: ['run-001'],
      batchId: 'reeval-5',
      checks: false,
      adapt: false,
      refreshMode: 'force',
      recalculateStatistics: true,
    });

    expect(declaredStages.filter((stage) => stage === 'statistics-recalculation')).toHaveLength(1);
  });

  it('fails the job when the statistics job fails, rather than evaluating the old window', async () => {
    vi.mocked(Queue).mockImplementation(
      () =>
        ({
          add: vi.fn(async (name: string, data: unknown) => {
            enqueued.push({ name, data });
            return { id: 'job-fail' };
          }),
          getJob: vi.fn(async (id: string) => ({
            id,
            getState: vi.fn().mockResolvedValue('failed'),
          })),
          close: vi.fn().mockResolvedValue(undefined),
        }) as never
    );

    const result = await run({
      testRunIds: ['run-001'],
      batchId: 'reeval-6',
      checks: false,
      adapt: false,
      recalculateStatistics: true,
    });

    expect(result.status).toBe('failed');
    // The data sanity check must not have run past a failed statistics stage.
    expect(sanityExecute).not.toHaveBeenCalled();
  });
});
