import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import { MetricProcessor, type FlattenedMetricRecord } from '../../../../../pipelines/helpers/incremental/metric-processor.js';
import type { WorkerDatabaseService } from '../../../../../common/database.service.js';
import { maxRowsPerStatement, PG_MAX_BIND_PARAMS } from '../../../../../utils/bind-params.js';

/**
 * A multi-row INSERT ... ON CONFLICT DO UPDATE whose VALUES carry the same conflict
 * key twice is rejected by Postgres ("cannot affect row a second time", 21000). Two
 * Dynatrace queries on one panel with the same metric name and no group-by produce
 * exactly that pair, and the per-row loop the batched upsert replaced tolerated it.
 */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const record = (over: Partial<FlattenedMetricRecord>): FlattenedMetricRecord => ({
  test_run_id: 'tr-1',
  application_dashboard_id: 'ad-1',
  metrics_source_id: null,
  dashboard_uid: 'uid',
  panel_id: 1,
  panel_title: 'p',
  dashboard_label: 'd',
  benchmark_ids: null,
  errors: null,
  metric_name: 'm',
  time: new Date('2026-01-01T00:00:00Z'),
  timestep: 0,
  ramp_up: false,
  value: 1,
  unit: null,
  ...over,
});

// The logger mock is module-level, and apps/worker/src/test/setup.ts only restores in
// afterAll, so without this every warn call accumulates across the file and an assertion
// reading `.at(-1)` passes on ordering rather than on content.
beforeEach(() => {
  vi.clearAllMocks();
});

const warnings = () => (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(call => String(call[0]));

const setup = () => {
  const query = vi.fn().mockResolvedValue([]);
  const db = { transaction: vi.fn((fn: (em: unknown) => Promise<unknown>) => fn({ query })) } as unknown as WorkerDatabaseService;
  return { processor: new MetricProcessor(logger, db), query };
};

describe('MetricProcessor.upsertMetricsToDatabase', () => {
  it('collapses rows sharing a conflict key to one, last wins', async () => {
    const { processor, query } = setup();
    await processor.upsertMetricsToDatabase([
      record({ value: 1 }),
      record({ metric_name: 'other', value: 5 }),
      record({ value: 2 }),                                            // same key as the first
      record({ time: '2026-01-01T00:00:00.000Z', value: 3 }),          // same instant, string form
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;
    const columns = 19;
    expect(params).toHaveLength(2 * columns);
    expect(sql).toMatch(/VALUES \(\$1, .*\), \(\$20, [^(]*\)\s*ON CONFLICT/s);
    // Row order follows first appearance; the surviving value is the LAST write.
    expect(params[13]).toBe(3);
    expect(params[columns + 9]).toBe('other');
  });

  it('clamps over-long values to the column width, and collapses the names that collide', async () => {
    // A Prometheus series with no legendFormat is named by its whole label set. metric_name
    // is varchar(255) AND part of the primary key, so an unclamped name failed the statement
    // with 22001 and the source retried forever collecting nothing.
    const { processor, query } = setup();
    const long = 'base_cpu_processCpuTime{pod="wsi"'.padEnd(300, 'x');
    await processor.upsertMetricsToDatabase([
      record({ metric_name: long, value: 1 }),
      record({ metric_name: `${long}-different-suffix`, value: 2 }),
      record({ unit: 'u'.repeat(60), metric_name: 'short' }),
    ]);
    const params = query.mock.calls[0]![1] as unknown[];
    const columns = 19;
    // The two long names share their first 255 characters, so they are ONE row here —
    // emitting both would be rejected with "cannot affect row a second time".
    expect(params).toHaveLength(2 * columns);
    expect(params[9]).toBe(long.substring(0, 255));
    expect(params[13]).toBe(2);
    expect(params[columns + 14]).toBe('u'.repeat(50));

    // The merge above is silent data loss, so it has to name the panel to fix in Grafana.
    // Selected by content, not by position: see the beforeEach above.
    const warning = warnings().find(msg => msg.includes('Truncated over-long ds_metrics values'));
    expect(warning).toBeDefined();
    expect(warning).toContain('legendFormat');
    expect(warning).toContain('metric_name on panel 1 "p" of "d"');
    expect(warning).toContain('unit on panel 1');
  });

  it('says nothing when every value fits its column', async () => {
    // The callers' `if (warning)` guard: without it both writers emit `warn(null)` on every
    // batch and every 60s tick, which is what truncationWarning's null return exists to stop.
    const { processor } = setup();
    await processor.upsertMetricsToDatabase([record({}), record({ metric_name: 'b' })]);
    expect(warnings()).toEqual([]);
  });

  it('keeps rows that differ only by time or panel', async () => {
    const { processor, query } = setup();
    await processor.upsertMetricsToDatabase([
      record({}),
      record({ time: new Date('2026-01-01T00:01:00Z') }),
      record({ panel_id: 2 }),
    ]);
    expect(query.mock.calls[0]![1]).toHaveLength(3 * 19);
  });

  it('batches by the derived limit, not a hand-written constant', async () => {
    // Was pinned to a hard-coded 200 (3800 of Postgres' 65535 parameters). The batch is
    // now derived from the column list via maxRowsPerStatement, so 201 rows is one
    // statement and the number moves by itself if a column is added.
    // (worker pipeline review 2026-09-14, COL-P4.)
    const { processor, query } = setup();
    await processor.upsertMetricsToDatabase(
      Array.from({ length: 201 }, (_, i) => record({ metric_name: `m${i}` }))
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![1]).toHaveLength(201 * 19);
  });

  it('splits once past the derived batch size, losing no rows', async () => {
    const { processor, query } = setup();
    const batch = maxRowsPerStatement(19);
    await processor.upsertMetricsToDatabase(
      Array.from({ length: batch + 1 }, (_, i) => record({ metric_name: `m${i}` }))
    );
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]![1]).toHaveLength(batch * 19);
    expect(query.mock.calls[1]![1]).toHaveLength(19);
  });

  it('never binds more than Postgres will accept', async () => {
    // The property the constant was standing in for. 4000 rows is past the 3449-row
    // ceiling for a 19-column insert, so a single statement would be rejected outright.
    const { processor, query } = setup();
    await processor.upsertMetricsToDatabase(
      Array.from({ length: 4000 }, (_, i) => record({ metric_name: `m${i}` }))
    );
    const written = query.mock.calls.reduce((n, c) => n + (c[1] as unknown[]).length, 0);
    expect(written).toBe(4000 * 19);
    for (const call of query.mock.calls) {
      expect((call[1] as unknown[]).length).toBeLessThanOrEqual(PG_MAX_BIND_PARAMS);
    }
  });
});
