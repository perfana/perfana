/**
 * The "has this run any metrics?" probe must be answered PER RUN.
 *
 * `aggregateMetricStatistics` deletes before it rebuilds. The probe is the only thing
 * standing between that DELETE and a run whose raw `ds_metrics` have aged out — such a
 * run must keep the statistics it has, because they cannot be recomputed from data that
 * no longer exists.
 *
 * The probe used to be a single batch-wide EXISTS over `test_run_id IN (...)` while the
 * DELETE was also batch-wide. So ONE run with live metrics authorised deleting the
 * statistics of every run beside it, and the re-INSERT — which reads the same vanished
 * `ds_metrics` — refilled only the live ones. The aged-out runs were left with nothing,
 * unrecoverably, and ADAPT then had no baseline for them.
 *
 * It was unreachable in practice while re-evaluate batches were small and hand-picked.
 * A workload-wide re-evaluate — what an "apply the analysis window to all test runs"
 * edit enqueues — mixes live and aged-out runs in one job by construction, which is
 * what makes this a real data-loss path rather than a theoretical one.
 *
 * The fix probes each id and binds the DELETE, the aggregation INSERT and the
 * verification count to the probed subset. These tests assert that binding through the
 * query PARAMETERS, since that is what actually scopes the statements.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { StatisticsPipeline } from '../../../pipelines/StatisticsPipeline.js';
import { getLogger } from '../../../lib/utils/logger.js';
import * as databaseAccessor from '../../../common/database-accessor.js';

vi.mock('../../../lib/utils/logger.js');
vi.mock('../../../common/database-accessor.js');

describe('StatisticsPipeline per-run metrics probe', () => {
  let pipeline: StatisticsPipeline;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };

  /** Ids the pipeline probed, in order. */
  let probed: string[];
  /** Parameter arrays the DELETE / INSERT / count statements were issued with. */
  let deleteParams: string[][];
  let insertParams: string[][];
  let countParams: string[][];
  /** Which runs the fake database still holds raw ds_metrics for. */
  let runsWithMetrics: Set<string>;

  const warnLines = (): string => mockLogger.warn.mock.calls.map((c) => String(c[0])).join('\n');

  beforeEach(() => {
    vi.clearAllMocks();

    probed = [];
    deleteParams = [];
    insertParams = [];
    countParams = [];
    runsWithMetrics = new Set();

    mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    vi.mocked(getLogger).mockReturnValue(mockLogger as never);

    // Routed by SQL text, not by call order: the probe is now N calls rather than 1,
    // so an ordered mock would encode the very thing under test.
    const query = async (sql: unknown, params?: unknown[]): Promise<unknown> => {
      const text = String(sql);
      if (text.includes('SET LOCAL') || text.includes('set_config')) return undefined;
      if (text.includes('UPDATE ds_metrics')) return [[], 0];
      if (text.includes('SELECT EXISTS')) {
        const id = String((params as string[])[0]);
        probed.push(id);
        return [{ has_metrics: runsWithMetrics.has(id) }];
      }
      if (text.includes('DELETE FROM ds_metric_statistics')) {
        deleteParams.push(params as string[]);
        return [[], 7];
      }
      if (text.includes('INSERT INTO ds_metric_statistics')) {
        insertParams.push(params as string[]);
        return undefined;
      }
      if (text.includes('COUNT(*)::integer as count')) {
        countParams.push(params as string[]);
        return [{ count: 42 }];
      }
      return [];
    };

    const mockDb = {
      transaction: vi.fn((fn: (m: unknown) => unknown) => fn({ query } as never)),
      // The read-only ramp_up pre-check runs before the transaction; no stale runs.
      query: vi.fn((sql: string) =>
        typeof sql === 'string' && sql.includes('m.ramp_up IS DISTINCT FROM')
          ? Promise.resolve([])
          : Promise.resolve([undefined, 0])
      ),
      decompressChunksForRange: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(databaseAccessor.getDatabaseService).mockReturnValue(mockDb as never);
    pipeline = new StatisticsPipeline(mockLogger as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('probes every run in the batch individually', async () => {
    runsWithMetrics.add('run-live');

    await pipeline.execute({ testRunIds: ['run-live', 'run-aged-out'] });

    expect(probed).toEqual(['run-live', 'run-aged-out']);
  });

  test('deletes only the statistics of runs that still have raw metrics', async () => {
    // run-live has ds_metrics, run-aged-out does not. The batch-wide probe answered
    // "yes" for the pair and let run-aged-out's statistics be deleted and never refilled.
    runsWithMetrics.add('run-live');

    const result = await pipeline.execute({ testRunIds: ['run-live', 'run-aged-out'] });

    expect(result.success).toBe(true);
    expect(deleteParams).toEqual([['run-live']]);
  });

  test('aggregates only the runs that still have raw metrics', async () => {
    runsWithMetrics.add('run-live');

    await pipeline.execute({ testRunIds: ['run-live', 'run-aged-out'] });

    // The INSERT reading the full list would be harmless on its own; it is the pairing
    // with the DELETE that loses data. Assert it anyway — a DELETE and an INSERT scoped
    // differently is exactly the shape of the bug.
    expect(insertParams).toEqual([['run-live']]);
    expect(countParams).toEqual([['run-live']]);
  });

  test('keeps the whole batch when every run still has metrics', async () => {
    runsWithMetrics.add('run-a');
    runsWithMetrics.add('run-b');
    runsWithMetrics.add('run-c');

    await pipeline.execute({ testRunIds: ['run-a', 'run-b', 'run-c'] });

    expect(deleteParams).toEqual([['run-a', 'run-b', 'run-c']]);
    expect(insertParams).toEqual([['run-a', 'run-b', 'run-c']]);
  });

  test('preserves batch order in the surviving subset', async () => {
    runsWithMetrics.add('run-a');
    runsWithMetrics.add('run-c');

    await pipeline.execute({ testRunIds: ['run-a', 'run-b', 'run-c', 'run-d'] });

    expect(deleteParams).toEqual([['run-a', 'run-c']]);
  });

  test('deletes nothing at all when no run in the batch has metrics', async () => {
    const result = await pipeline.execute({ testRunIds: ['run-aged-1', 'run-aged-2'] });

    expect(result.success).toBe(true);
    expect(deleteParams).toEqual([]);
    expect(insertParams).toEqual([]);
    expect(countParams).toEqual([]);
  });

  test('names the runs it left alone, so the skip is not silent', async () => {
    runsWithMetrics.add('run-live');

    await pipeline.execute({ testRunIds: ['run-live', 'run-aged-out'] });

    // The operator reading this log has to be able to tell "statistics rebuilt for 1 of
    // 2 runs" from "statistics rebuilt for the batch".
    expect(warnLines()).toContain('run-aged-out');
    expect(warnLines()).not.toContain('run-live');
    expect(warnLines()).toContain('Their existing statistics are left untouched.');
  });
});
