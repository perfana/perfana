import { describe, it, expect, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import type { Logger } from 'pino';
import {
  insertDsMetricsFromAggregate,
  upsertPerfTestStatistics,
} from '../../../pipelines/helpers/perf-metrics-writer.js';
import type { TestRunMetadata } from '../../../types/performance-metrics.js';

/**
 * Both writers report how many rows they wrote, and that number is NOT cosmetic: it
 * becomes `totalDataPoints` -> `testRunReceivedData` -> `testRunsWithNewData`, which
 * gates the statistics-recalculation stage in simple-orchestrate-reevaluate-batch.ts.
 *
 * Reading it as `result[1]` (TypeORM's `[rows, rowCount]`, true only for DELETE/UPDATE)
 * made a force-refetch that wrote 1,946,825 rows report 0 — which would skip rebuilding
 * ds_metric_statistics and land back on 'No metrics data collected' behind a green job.
 */

const testRun: TestRunMetadata = {
  test_run_id: 'tr-001',
  system_under_test_id: 'sut-1',
  test_environment: 'acc',
  workload: 'loadtest',
  start_time: new Date('2026-01-01T00:00:00Z'),
  ramp_up_time: 60,
  end_time: new Date('2026-01-01T01:00:00Z'),
  organization_id: '11111111-1111-1111-1111-111111111111',
  team_id: null,
};

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const fakeDataSource = (rows: unknown, lastPass: Date | null = null) => {
  // The writer statements run inside a transaction whose first statements are the
  // set_config budget calls; the INSERT is the one carrying `RETURNING 1`.
  const query = vi.fn().mockResolvedValue(rows);
  const transaction = vi.fn((fn: (em: { query: typeof query }) => Promise<unknown>) => fn({ query }));
  // upsertPerfTestStatistics reads its growth watermark OUTSIDE the transaction, so
  // the fake needs a top-level query too. Default null = no pass yet = always
  // recompute, which is the behaviour the row-count tests below assume.
  const watermarkQuery = vi.fn().mockResolvedValue([{ last_pass: lastPass }]);
  const insertSql = () => query.mock.calls.map((c) => String(c[0])).find((sql) => sql.includes('INSERT INTO'));
  return {
    ds: { transaction, query: watermarkQuery } as unknown as DataSource,
    query,
    watermarkQuery,
    insertSql,
  };
};

const insert = (ds: DataSource) =>
  insertDsMetricsFromAggregate({
    dataSource: ds,
    aggregateCte: 'bucketed AS (SELECT 1)',
    rowsSelect: 'SELECT $1::text AS scenario_name',
    params: ['s1'],
    dashboards: new Map([
      ['s1', { dashboardId: 'd-1', dashboardUid: 'uid-1', dashboardLabel: 'Scenario s1' }],
    ]),
    panelIds: [101],
    testRunId: 'tr-001',
    testRun,
    isIncremental: false,
  });

describe('perf-metrics-writer row counts', () => {
  it('counts ds_metrics rows from the SELECT count(*) the statement ends with', async () => {
    const { ds, insertSql } = fakeDataSource([{ n: 1946825 }]);
    await expect(insert(ds)).resolves.toBe(1946825);

    const sql = String(insertSql());
    expect(sql).toContain('RETURNING 1');
    expect(sql).toContain('SELECT count(*)::int AS n FROM ins');
  });

  it('applies the aggregation budget inside the transaction before the INSERT', async () => {
    // PT-P1: at the pool default work_mem the requests aggregate spilled 69 MB to disk
    // and ran with statement_timeout == query_timeout. The budget is set_config(...,
    // true), i.e. transaction-local, so it only counts if it precedes the INSERT in
    // the same transaction.
    const { ds, query } = fakeDataSource([{ n: 1 }]);
    await insert(ds);
    const sqls = query.mock.calls.map((c) => String(c[0]));
    const params = query.mock.calls.map((c) => c[1] as unknown[]);
    expect(sqls[0]).toContain('set_config');
    expect(params[0]?.[0]).toBe('statement_timeout');
    expect(sqls[1]).toContain('set_config');
    expect(params[1]?.[0]).toBe('work_mem');
    expect(sqls[2]).toContain('INSERT INTO ds_metrics');
  });

  it('upsertPerfTestStatistics applies the budget inside the transaction before its INSERT too', async () => {
    // This one runs on every incremental tick of a live run; the 143 MB spill was here.
    const { ds, query } = fakeDataSource([{ n: 1 }]);
    await upsertPerfTestStatistics(ds, 'tr-001', ['d-1'], testRun, logger);
    const sqls = query.mock.calls.map((c) => String(c[0]));
    const params = query.mock.calls.map((c) => c[1] as unknown[]);
    expect(params[0]?.[0]).toBe('statement_timeout');
    expect(params[1]?.[0]).toBe('work_mem');
    expect(sqls[2]).toContain('INSERT INTO ds_metric_statistics');
    expect((ds as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction).toHaveBeenCalledTimes(1);
  });

  it('counts ds_metric_statistics rows the same way', async () => {
    const { ds, insertSql } = fakeDataSource([{ n: 21123 }]);
    await expect(upsertPerfTestStatistics(ds, 'tr-001', ['d-1'], testRun, logger)).resolves.toBe(21123);

    const sql = String(insertSql());
    expect(sql).toContain('RETURNING 1');
    expect(sql).toContain('SELECT count(*)::int AS n FROM ins');
  });

  it('does NOT read the count out of result[1] (the DELETE/UPDATE shape)', async () => {
    // The regression itself: a driver handing back [rows, rowCount] must not be
    // mistaken for a count, and — more importantly — the real driver never does this
    // for INSERT ... SELECT, which is why the old code always returned 0.
    const { ds } = fakeDataSource([[], 1946825]);
    await expect(insert(ds)).resolves.toBe(0);
  });

  it('survives a driver that returns nothing usable', async () => {
    const { ds } = fakeDataSource([]);
    await expect(insert(ds)).resolves.toBe(0);
  });

  it('coerces a bigint-as-string count', async () => {
    // count(*) is cast to ::int so pg parses it as a number, but a driver that hands
    // back a string must not silently become 0 — that is the whole bug again.
    const { ds } = fakeDataSource([{ n: '21123' }]);
    await expect(upsertPerfTestStatistics(ds, 'tr-001', ['d-1'], testRun, logger)).resolves.toBe(21123);
  });
});

/**
 * upsertPerfTestStatistics aggregates the WHOLE run on every 60s tick, so its cost
 * grows with the run and the total across a run is quadratic in its length. On
 * production (pg_stat_statements, 2026-09-22) it was the largest consumer of I/O on
 * the deployment by 8x: 7055 calls, 5509 GB read, 18.5 hours of database time.
 *
 * The throttle runs it on a geometric cadence instead. What makes that safe is that
 * StatisticsPipeline deletes and rewrites every one of these rows at analyze time,
 * so a skipped tick can only ever stale the LIVE display.
 */
describe('perf-metrics-writer statistics growth throttle', () => {
  const runStart = new Date('2026-01-01T00:00:00Z');
  const at = (minutes: number) => new Date(runStart.getTime() + minutes * 60_000);

  const withNow = async <T,>(now: Date, fn: () => Promise<T>): Promise<T> => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      return await fn();
    } finally {
      vi.useRealTimers();
    }
  };

  it('recomputes on the first tick, when no pass has run yet', async () => {
    const { ds, insertSql } = fakeDataSource([{ n: 5 }], null);
    await expect(
      upsertPerfTestStatistics(ds, 'tr-001', ['d-1'], testRun, logger),
    ).resolves.toBe(5);
    expect(insertSql()).toBeDefined();
  });

  it('skips a tick that adds less than the growth fraction', async () => {
    // Last pass covered 100 minutes; one more minute is 1%, well under the 30% default.
    const { ds, insertSql } = fakeDataSource([{ n: 5 }], at(100));
    const written = await withNow(at(101), () =>
      upsertPerfTestStatistics(ds, 'tr-001', ['d-1'], testRun, logger),
    );
    expect(written).toBe(0);
    // The expensive statement must never have been issued.
    expect(insertSql()).toBeUndefined();
  });

  it('recomputes once the run has grown past the fraction', async () => {
    // Last pass covered 100 minutes; 31 more is 31%, past the 30% default.
    const { ds, insertSql } = fakeDataSource([{ n: 7 }], at(100));
    const written = await withNow(at(131), () =>
      upsertPerfTestStatistics(ds, 'tr-001', ['d-1'], testRun, logger),
    );
    expect(written).toBe(7);
    expect(insertSql()).toContain('INSERT INTO ds_metric_statistics');
  });

  it('fails OPEN when the watermark cannot be read', async () => {
    // A throttle that cannot read its own watermark must not be the reason a live
    // run never gets statistics at all.
    const { ds, insertSql } = fakeDataSource([{ n: 3 }], at(100));
    (ds.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const written = await withNow(at(101), () =>
      upsertPerfTestStatistics(ds, 'tr-001', ['d-1'], testRun, logger),
    );
    expect(written).toBe(3);
    expect(insertSql()).toBeDefined();
  });

  it('recomputes when the watermark predates the run start', async () => {
    // Clock skew or a restored run: a non-positive covered span is no baseline.
    const { ds, insertSql } = fakeDataSource([{ n: 2 }], new Date(runStart.getTime() - 60_000));
    const written = await withNow(at(1), () =>
      upsertPerfTestStatistics(ds, 'tr-001', ['d-1'], testRun, logger),
    );
    expect(written).toBe(2);
    expect(insertSql()).toBeDefined();
  });

  it('PERF_TEST_STATS_MIN_GROWTH=0 restores the recompute-every-tick behaviour', async () => {
    const prev = process.env.PERF_TEST_STATS_MIN_GROWTH;
    process.env.PERF_TEST_STATS_MIN_GROWTH = '0';
    try {
      const { ds, insertSql } = fakeDataSource([{ n: 4 }], at(100));
      const written = await withNow(at(100.01), () =>
        upsertPerfTestStatistics(ds, 'tr-001', ['d-1'], testRun, logger),
      );
      expect(written).toBe(4);
      expect(insertSql()).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env.PERF_TEST_STATS_MIN_GROWTH;
      else process.env.PERF_TEST_STATS_MIN_GROWTH = prev;
    }
  });
});
