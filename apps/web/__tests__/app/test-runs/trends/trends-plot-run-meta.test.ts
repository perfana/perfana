/**
 * The cursor readout's per-run metadata.
 *
 * The Analyst standard draws no Plotly tooltip (`hoverinfo: 'none'`), so the card header's
 * cursor readout is the ONLY place a hover can answer "which run, which release, what was
 * different about it". `useTrendsPlot` folds the `version`/`annotations` that
 * `/metrics/ds-metric-statistics` repeats on every row of a run into one entry per run.
 *
 * The two shapes that matter: a run that carries neither must be ABSENT from the map (so
 * the readout falls back to the bare id rather than printing separators around nothing),
 * and the first row of a run can be a bare one — the scan has to keep looking.
 */
import { renderHook } from '@testing-library/react';
import { useTrendsPlot } from '@/app/test-runs/[id]/components/trends/hooks/useTrendsPlot';
import { buildAggregatedTrendsStatistics } from '@/app/test-runs/[id]/components/trends/utils/trends-utils';
import type { MetricStatistic, TrendsSeries } from '@/app/test-runs/[id]/components/trends/types';

jest.mock('@/lib/plotly', () => ({ getPlotly: () => null }));

const rt: TrendsSeries = {
  id: 'rt', dashboardId: 'd', dashboardLabel: 'JMeter', panelId: 101,
  panelTitle: 'Transaction RT Avg', metricName: 'T01', source: 'performance-metrics',
  yAxisFormat: 'ms',
};
const cpu: TrendsSeries = { ...rt, id: 'cpu', panelId: 102, panelTitle: 'CPU', metricName: 'usage' };

const row = (
  series: TrendsSeries,
  run: string,
  createdAt: string,
  meta: Partial<Pick<MetricStatistic, 'version' | 'annotations'>> = {},
): MetricStatistic => ({
  test_run_id: run, series_id: series.id, panel_title: series.panelTitle,
  metric_name: series.metricName, value: 280, created_at: createdAt, ...meta,
});

const plot = (metricsData: MetricStatistic[], addedSeries: TrendsSeries[] = [rt], trendsExpanded = true) =>
  renderHook(() =>
    useTrendsPlot({ metricsData, trendsExpanded, addedSeries, showToast: jest.fn(), cursorIndex: null }),
  ).result.current.runMeta;

it('keeps the release and the annotations of every run that carries them', () => {
  const runMeta = plot([
    row(rt, 'run-1', '2026-09-28T05:00:00Z', { version: '1.2.3', annotations: 'cache disabled' }),
    row(rt, 'run-2', '2026-09-29T05:00:00Z', { version: '1.2.4', annotations: 'warm cache' }),
  ]);

  expect(runMeta.get('run-1')).toEqual({ version: '1.2.3', annotations: 'cache disabled' });
  expect(runMeta.get('run-2')).toEqual({ version: '1.2.4', annotations: 'warm cache' });
});

it('leaves a run with neither out of the map entirely', () => {
  // Not an entry of empty strings: the readout joins on ' · ' and an entry whose fields are
  // both falsy would read the same, but `runMeta.has` is what tells the two apart.
  const runMeta = plot([
    row(rt, 'bare', '2026-09-28T05:00:00Z'),
    row(rt, 'tagged', '2026-09-29T05:00:00Z', { version: '1.2.3' }),
  ]);

  expect(runMeta.has('bare')).toBe(false);
  expect(runMeta.size).toBe(1);
});

it('keeps a run that carries only one of the two', () => {
  const runMeta = plot([
    row(rt, 'ver-only', '2026-09-28T05:00:00Z', { version: '1.2.3' }),
    row(rt, 'note-only', '2026-09-29T05:00:00Z', { annotations: 'rerun after a failed deploy' }),
  ]);

  expect(runMeta.get('ver-only')).toEqual({ version: '1.2.3', annotations: undefined });
  expect(runMeta.get('note-only')).toEqual({ version: undefined, annotations: 'rerun after a failed deploy' });
});

it('treats an explicit null the same as an absent field', () => {
  // The endpoint sends null, not undefined, for a run with no release — a row of two nulls
  // must not register the run.
  const runMeta = plot([
    row(rt, 'nulls', '2026-09-28T05:00:00Z', { version: null, annotations: null }),
    row(rt, 'half-null', '2026-09-29T05:00:00Z', { version: null, annotations: 'db restored' }),
  ]);

  expect(runMeta.has('nulls')).toBe(false);
  expect(runMeta.get('half-null')).toEqual({ version: null, annotations: 'db restored' });
});

it('keeps looking past a bare first row of the same run', () => {
  // The rows of one run arrive one per series, and only some series' rows are enriched.
  // Taking the first row of a run unconditionally would record the bare one and then
  // refuse the enriched one that follows.
  const runMeta = plot(
    [
      row(cpu, 'run-1', '2026-09-28T05:00:00Z'),
      row(rt, 'run-1', '2026-09-28T05:00:00Z', { version: '1.2.3', annotations: 'cache disabled' }),
    ],
    [rt, cpu],
  );

  expect(runMeta.get('run-1')).toEqual({ version: '1.2.3', annotations: 'cache disabled' });
});

it('keeps the FIRST carrier, so a second enriched row of the same run cannot overwrite it', () => {
  const runMeta = plot(
    [
      row(rt, 'run-1', '2026-09-28T05:00:00Z', { version: '1.2.3' }),
      row(cpu, 'run-1', '2026-09-28T05:00:00Z', { version: '9.9.9', annotations: 'should not win' }),
    ],
    [rt, cpu],
  );

  expect(runMeta.get('run-1')).toEqual({ version: '1.2.3', annotations: undefined });
});

it('returns an empty map when the card is collapsed, and when there is no data', () => {
  const data = [row(rt, 'run-1', '2026-09-28T05:00:00Z', { version: '1.2.3' })];
  // The early-out returns its own `empty`, which has to carry a map rather than undefined —
  // `TrendsChart` calls `.get` on it.
  expect(plot(data, [rt], false).size).toBe(0);
  expect(plot([]).size).toBe(0);
});

it('carries the release of an aggregated series, which has no annotations to carry', () => {
  // `buildAggregatedTrendsStatistics` enriches from the related-run list, which holds
  // `version` but not `annotations`. The readout must still show the release.
  const aggregated = { ...rt, id: 'agg', isAggregated: true };
  const rows = buildAggregatedTrendsStatistics(
    aggregated,
    [{ testRunId: 'run-1', value: 280 }, { testRunId: 'run-2', value: 300 }],
    [
      { test_run_id: 'run-1', created_at: '2026-09-28T05:00:00Z', version: '1.2.3' },
      { test_run_id: 'run-2', created_at: '2026-09-29T05:00:00Z', version: null },
    ],
  );

  const runMeta = plot(rows, [aggregated]);
  expect(runMeta.get('run-1')).toEqual({ version: '1.2.3', annotations: undefined });
  // A run whose release is null carries nothing at all on this path.
  expect(runMeta.has('run-2')).toBe(false);
});
