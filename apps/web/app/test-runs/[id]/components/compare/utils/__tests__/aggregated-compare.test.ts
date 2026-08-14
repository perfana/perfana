import { buildAggregatedComparisons } from '../compare-utils';
import type { CompareSeries } from '../../types';

const series = {
  id: 's1', dashboardId: 'd1', dashboardLabel: 'Perf', panelId: 201,
  panelTitle: 'Request RT', metricName: 'All aggregated — Request RT',
  source: 'performance-metrics', isAggregated: true,
} as CompareSeries;

describe('buildAggregatedComparisons', () => {
  it('emits one cell per stat the API returned, mapped to table columns', () => {
    const rows = buildAggregatedComparisons(
      series,
      { value: 100, values: { avg: 100, p90: 200, p95: 300, p99: 400, max: 900 } },
      { value: 80, values: { avg: 80, p90: 160, p95: 240, p99: 320, max: 800 } },
      'avg',
    );
    expect(rows.map(r => r.evaluate_type)).toEqual(['avg', 'q90', 'q95', 'q99']); // max has no column
    expect(rows.every(r => r.metric_name === 'All aggregated — Request RT')).toBe(true);
    expect(rows.find(r => r.evaluate_type === 'q95')).toMatchObject({ current_value: 300, selected_value: 240 });
    expect(rows[0]?.percentage_difference).toBeCloseTo(25); // (100-80)/80*100
  });

  it('falls back to the panel stat when the API only sent value', () => {
    const rows = buildAggregatedComparisons(series, { value: 2000 }, { value: 1600 }, 'p90');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.evaluate_type).toBe('q90');
    expect(rows[0]?.current_value).toBe(2000);
    expect(rows[0]?.percentage_difference).toBeCloseTo(25);
  });

  it('still emits the panel stat row when there is no data at all', () => {
    const rows = buildAggregatedComparisons(series, undefined, undefined, 'avg');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ evaluate_type: 'avg', current_value: null, selected_value: null, percentage_difference: null });
  });

  it('keeps a stat present on only one side', () => {
    const rows = buildAggregatedComparisons(
      series, { value: 100, values: { avg: 100 } }, { value: null, values: {} }, 'avg',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ current_value: 100, selected_value: null, percentage_difference: null });
  });

  it('drops the stats the table has no column for', () => {
    // The real payload always carries p50 and max, but getMetricColumns only
    // ever renders avg/q90/q95/q99 — emitting more would be dead cells.
    const full = { avg: 100, p50: 90, p90: 200, p95: 300, p99: 400, max: 900 };
    const rows = buildAggregatedComparisons(series, { value: 100, values: full }, { value: 80, values: full }, 'avg');
    expect(rows.map(r => r.evaluate_type)).toEqual(['avg', 'q90', 'q95', 'q99']);
    expect(rows.some(r => r.evaluate_type === 'q50' || r.evaluate_type === 'max')).toBe(false);
  });

  it('emits only the panel stat when every returned stat is null', () => {
    const allNull = { avg: null, p50: null, p90: null, p95: null, p99: null, max: null };
    const rows = buildAggregatedComparisons(series, { value: null, values: allNull }, { value: null, values: allNull }, 'p95');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ evaluate_type: 'q95', current_value: null, selected_value: null, percentage_difference: null });
  });

  it('falls back to the raw stat key for a stat with no table column', () => {
    const rows = buildAggregatedComparisons(series, { value: 500 }, { value: 400 }, 'max');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ evaluate_type: 'max', current_value: 500, selected_value: 400 });
  });

  it('computes percentage_difference per stat independently, null on a zero baseline', () => {
    const rows = buildAggregatedComparisons(
      series,
      { value: 100, values: { avg: 100, p90: 150, p95: 5 } },
      { value: 80, values: { avg: 80, p90: 300, p95: 0 } },
      'avg',
    );
    const byType = Object.fromEntries(rows.map(r => [r.evaluate_type, r.percentage_difference]));
    expect(byType.avg).toBeCloseTo(25);
    expect(byType.q90).toBeCloseTo(-50);
    expect(byType.q95).toBeNull(); // zero baseline is not a -100% regression
  });
});
