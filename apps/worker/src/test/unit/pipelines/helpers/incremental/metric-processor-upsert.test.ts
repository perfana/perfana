import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import { MetricProcessor, type FlattenedMetricRecord } from '../../../../../pipelines/helpers/incremental/metric-processor.js';
import type { WorkerDatabaseService } from '../../../../../common/database.service.js';

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

  it('keeps rows that differ only by time or panel', async () => {
    const { processor, query } = setup();
    await processor.upsertMetricsToDatabase([
      record({}),
      record({ time: new Date('2026-01-01T00:01:00Z') }),
      record({ panel_id: 2 }),
    ]);
    expect(query.mock.calls[0]![1]).toHaveLength(3 * 19);
  });

  it('splits more than 200 unique rows into 200-row statements', async () => {
    const { processor, query } = setup();
    await processor.upsertMetricsToDatabase(
      Array.from({ length: 201 }, (_, i) => record({ metric_name: `m${i}` }))
    );
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]![1]).toHaveLength(19);
  });
});
