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

const fakeDataSource = (rows: unknown) => {
  const query = vi.fn().mockResolvedValue(rows);
  return { ds: { query } as unknown as DataSource, query };
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
    const { ds, query } = fakeDataSource([{ n: 1946825 }]);
    await expect(insert(ds)).resolves.toBe(1946825);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('RETURNING 1');
    expect(sql).toContain('SELECT count(*)::int AS n FROM ins');
  });

  it('counts ds_metric_statistics rows the same way', async () => {
    const { ds, query } = fakeDataSource([{ n: 21123 }]);
    await expect(upsertPerfTestStatistics(ds, 'tr-001', ['d-1'], testRun, logger)).resolves.toBe(21123);

    const sql = String(query.mock.calls[0]?.[0]);
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
