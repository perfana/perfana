/**
 * `filterRunsWithMetrics` — the ONE set of runs everything downstream operates on.
 *
 * The pipeline does four things to a batch, in order: it reads which runs have stale
 * `ds_metrics.ramp_up` flags, decompresses the chunks holding those rows, UPDATEs the
 * flags, and then deletes-and-rebuilds `ds_metric_statistics`. All four must cover the
 * SAME runs. They did not.
 *
 * The probe used to live INSIDE the aggregation, inside the transaction, and asked
 * `ramp_up = false AND value IS NOT NULL`. Two things were wrong with that:
 *
 *  1. `ramp_up` is precisely the column `refreshRampUpFlags` rewrites moments earlier in
 *     the same transaction, so the probe answered against flags that were one statement
 *     from being stale — and its answer decided whether the run got new flags at all.
 *  2. The decompression and the flag refresh ran over the FULL caller list while only
 *     the aggregation ran over the probed subset. A run the probe dropped still got new
 *     `ds_metrics.ramp_up` flags committed while keeping the PREVIOUS window's
 *     `ds_metric_statistics`. Nothing surfaces that: ADAPT pools such a run into a
 *     control group as if it were current.
 *
 * Now one `filterRunsWithMetrics` call runs once at the top of `execute()`, outside the
 * transaction, on the pooled connection, and its result feeds all four steps. These
 * tests assert the four sets never drift apart again — plus the two properties the probe
 * itself has to keep: per run rather than batch-wide (a batch-wide answer let one live
 * run authorise deleting an aged-out run's statistics, unrecoverably, since the
 * re-INSERT reads the same vanished `ds_metrics`), and existence-only.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { StatisticsPipeline } from '../../../pipelines/StatisticsPipeline.js';
import { getLogger } from '../../../lib/utils/logger.js';
import * as databaseAccessor from '../../../common/database-accessor.js';

vi.mock('../../../lib/utils/logger.js');
vi.mock('../../../common/database-accessor.js');

const stripSqlComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

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
  /** SQL text of every probe issued. */
  let probeSql: string[];
  /** Parameter arrays the stale-flag pre-check was issued with. */
  let preCheckParams: string[][];
  /** `[table, from, to]` of every decompression request. */
  let decompressCalls: unknown[][];
  /** Parameter arrays of the in-transaction ramp_up UPDATE, one per stale run. */
  let updateParams: unknown[][];
  /** Parameter arrays the DELETE / INSERT / count statements were issued with. */
  let deleteParams: string[][];
  let insertParams: string[][];
  let countParams: string[][];
  /** How many times a transaction was opened. */
  let transactions: number;

  /** Which runs the fake database still holds raw ds_metrics for. */
  let runsWithMetrics: Set<string>;
  /**
   * Which runs have flags disagreeing with their current offsets, and over what span.
   *
   * The fake answers the pre-check only for ids it was actually ASKED about. That is
   * what makes this suite able to see the bug: a fake that volunteered rows for runs the
   * pipeline never named would decompress and UPDATE them regardless of the filter.
   */
  let staleBounds: Map<string, { from: Date; to: Date }>;

  const warnLines = (): string => mockLogger.warn.mock.calls.map((c) => String(c[0])).join('\n');

  let mockDb: {
    transaction: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    decompressChunksForRange: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    probed = [];
    probeSql = [];
    preCheckParams = [];
    decompressCalls = [];
    updateParams = [];
    deleteParams = [];
    insertParams = [];
    countParams = [];
    transactions = 0;
    runsWithMetrics = new Set();
    staleBounds = new Map();

    mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    vi.mocked(getLogger).mockReturnValue(mockLogger as never);

    // Routed by SQL text, not by call order: the probe is N calls rather than 1, so an
    // ordered mock would encode the very thing under test.
    const managerQuery = async (sql: unknown, params?: unknown[]): Promise<unknown> => {
      const text = String(sql);
      if (text.includes('SET LOCAL') || text.includes('set_config')) return undefined;
      if (text.includes('UPDATE ds_metrics')) {
        updateParams.push(params as unknown[]);
        return [[], 0];
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

    mockDb = {
      transaction: vi.fn((fn: (m: unknown) => unknown) => {
        transactions += 1;
        return fn({ query: managerQuery } as never);
      }),
      query: vi.fn(async (sql: unknown, params?: unknown[]): Promise<unknown> => {
        const text = String(sql);
        if (text.includes('has_metrics')) {
          const id = String((params as string[])[0]);
          probed.push(id);
          probeSql.push(text);
          return [{ has_metrics: runsWithMetrics.has(id) }];
        }
        if (text.includes('m.ramp_up IS DISTINCT FROM')) {
          const asked = (params ?? []).map(String);
          preCheckParams.push(asked);
          return asked
            .filter((id) => staleBounds.has(id))
            .map((id) => ({
              test_run_id: id,
              from_time: staleBounds.get(id)!.from,
              to_time: staleBounds.get(id)!.to,
            }));
        }
        // The stale-application-dashboard cleanup.
        return [undefined, 0];
      }),
      decompressChunksForRange: vi.fn(async (...args: unknown[]) => {
        decompressCalls.push(args);
      }),
    };

    vi.mocked(databaseAccessor.getDatabaseService).mockReturnValue(mockDb as never);
    pipeline = new StatisticsPipeline(mockLogger as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('the probe itself', () => {
    test('probes every run in the batch individually', async () => {
      runsWithMetrics.add('run-live');

      await pipeline.execute({ testRunIds: ['run-live', 'run-aged-out'] });

      // One call per id, in batch order — not one `IN (...)` for the batch.
      expect(probed).toEqual(['run-live', 'run-aged-out']);
      expect(probeSql).toHaveLength(2);
      expect(probeSql[0]).toContain('test_run_id = $1');
      expect(probeSql[0]).not.toContain('$2');
    });

    test('asks only whether rows exist, never about the flag it is about to rewrite', async () => {
      runsWithMetrics.add('run-live');

      await pipeline.execute({ testRunIds: ['run-live'] });

      const sql = stripSqlComments(probeSql[0]!);

      // A `ramp_up = false` predicate would answer against flags refreshRampUpFlags is
      // about to overwrite, and the probe's answer is what decides whether the run gets
      // those new flags at all. "The new window excludes every sample" is also a REAL
      // and correct outcome that must produce empty statistics — not a skipped run left
      // holding new flags beside the previous window's statistics.
      expect(sql).not.toMatch(/ramp_up/i);
      expect(sql).not.toMatch(/value/i);
      // Existence only, so the index descent stops at the first row.
      expect(sql).toContain('SELECT EXISTS');
      expect(sql).toContain('FROM ds_metrics');
    });

    test('runs before the transaction is opened, on the pooled connection', async () => {
      runsWithMetrics.add('run-live');

      await pipeline.execute({ testRunIds: ['run-live'] });

      const probeOrder = mockDb.query.mock.invocationCallOrder.at(-1)!;
      const transactionOrder = mockDb.transaction.mock.invocationCallOrder[0]!;
      expect(probeOrder).toBeLessThan(transactionOrder);
    });
  });

  describe('the filtered set gates every downstream step', () => {
    test('a run with no ds_metrics reaches none of the four steps', async () => {
      // This is the whole point of the restructure. Before it, run-aged-out was dropped
      // by the aggregation but still had its flags rewritten — leaving new flags beside
      // the previous window's statistics, which ADAPT then pools as current.
      runsWithMetrics.add('run-live');
      const live = { from: new Date('2026-01-01T10:00:00Z'), to: new Date('2026-01-01T10:05:00Z') };
      const aged = { from: new Date('2026-03-01T10:00:00Z'), to: new Date('2026-03-01T10:05:00Z') };
      staleBounds.set('run-live', live);
      staleBounds.set('run-aged-out', aged);

      const result = await pipeline.execute({ testRunIds: ['run-live', 'run-aged-out'] });

      expect(result.success).toBe(true);

      // 1. the stale-flag pre-check is asked only about the surviving run
      expect(preCheckParams).toEqual([['run-live']]);
      // 2. only its chunks are decompressed — decompress_chunk is chunk-granular, so
      //    widening the range converts other runs' data to row store too
      expect(decompressCalls).toEqual([['ds_metrics', live.from, live.to]]);
      // 3. only its flags are rewritten
      expect(updateParams).toEqual([['run-live', live.from, live.to]]);
      // 4. and only its statistics are rebuilt
      expect(deleteParams).toEqual([['run-live']]);
      expect(insertParams).toEqual([['run-live']]);
      expect(countParams).toEqual([['run-live']]);
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

      expect(preCheckParams).toEqual([['run-a', 'run-b', 'run-c']]);
      expect(deleteParams).toEqual([['run-a', 'run-b', 'run-c']]);
      expect(insertParams).toEqual([['run-a', 'run-b', 'run-c']]);
    });

    test('preserves batch order in the surviving subset', async () => {
      runsWithMetrics.add('run-a');
      runsWithMetrics.add('run-c');

      await pipeline.execute({ testRunIds: ['run-a', 'run-b', 'run-c', 'run-d'] });

      expect(preCheckParams).toEqual([['run-a', 'run-c']]);
      expect(deleteParams).toEqual([['run-a', 'run-c']]);
      expect(insertParams).toEqual([['run-a', 'run-c']]);
    });
  });

  describe('when no run in the batch has metrics', () => {
    test('opens no transaction, decompresses nothing, and writes nothing', async () => {
      const result = await pipeline.execute({ testRunIds: ['run-aged-1', 'run-aged-2'] });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ processedRecords: 0, testRunIds: 2 });

      // Returning BEFORE the transaction matters: opening one to discover there is
      // nothing to do still takes an analytics-pool connection and a statement budget.
      expect(transactions).toBe(0);
      expect(preCheckParams).toEqual([]);
      expect(decompressCalls).toEqual([]);
      expect(updateParams).toEqual([]);
      expect(deleteParams).toEqual([]);
      expect(insertParams).toEqual([]);
      expect(countParams).toEqual([]);
    });
  });

  test('names the runs it left alone, so the skip is not silent', async () => {
    runsWithMetrics.add('run-live');

    await pipeline.execute({ testRunIds: ['run-live', 'run-aged-out'] });

    // The operator reading this log has to be able to tell "statistics rebuilt for 1 of
    // 2 runs" from "statistics rebuilt for the batch".
    expect(warnLines()).toContain('run-aged-out');
    expect(warnLines()).not.toContain('run-live');
    // ...and why nothing was retried: the statistics that survive are the only ones
    // there will ever be, because nothing can rebuild them from data that is gone.
    expect(warnLines()).toContain('nothing could rebuild them');
  });
});
