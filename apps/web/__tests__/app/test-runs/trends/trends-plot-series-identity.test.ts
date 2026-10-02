/**
 * Two panels of the "all aggregated" dashboard both carry a series named
 * "All aggregated". Keyed on metric_name the plot merged them into one zigzag
 * trace on one axis; keyed on the series id they are two traces, each on its
 * own unit's axis, with legend names that tell them apart.
 */
import { renderHook } from '@testing-library/react';
import { useTrendsPlot } from '@/app/test-runs/[id]/components/trends/hooks/useTrendsPlot';
import type { MetricStatistic, TrendsSeries } from '@/app/test-runs/[id]/components/trends/types';

jest.mock('@/lib/plotly', () => ({ getPlotly: () => null }));

const rt: TrendsSeries = {
  id: 'rt', dashboardId: 'd', dashboardLabel: 'Performance test metrics all aggregated',
  panelId: 101, panelTitle: 'Transaction RT Avg', metricName: 'All aggregated',
  source: 'performance-metrics', yAxisFormat: 'ms',
};
const err: TrendsSeries = {
  ...rt, id: 'err', panelId: 105, panelTitle: 'Transaction Error Rate', yAxisFormat: 'percentunit',
};
const row = (series: TrendsSeries, run: string, value: number): MetricStatistic => ({
  test_run_id: run, series_id: series.id, panel_title: series.panelTitle,
  metric_name: series.metricName, value, created_at: `2026-09-${run}T05:00:00Z`,
});

it('draws one trace per series, not per metric name', () => {
  // Stable references: the hook's effect keys on these, and fresh ones per render loop it.
  const props = {
    metricsData: [row(rt, '10', 280), row(err, '10', 0), row(rt, '12', 300), row(err, '12', 0.01)],
    trendsExpanded: true,
    addedSeries: [rt, err],
    showToast: jest.fn(),
    cursorIndex: null,
  };
  const { result } = renderHook(() => useTrendsPlot(props));

  const traces = result.current.plotData as Array<{ name: string; y: number[]; yaxis: string }>;
  // percentunit is drawn as 0-100, so 0.01 plots as 1 on its own (right) axis.
  expect(traces.map((t) => ({ name: t.name, y: t.y, yaxis: t.yaxis }))).toEqual([
    { name: 'All aggregated — Transaction RT Avg', y: [280, 300], yaxis: 'y' },
    { name: 'All aggregated — Transaction Error Rate', y: [0, 1], yaxis: 'y2' },
  ]);
});

it('names a series in its trace and in its table row, so the two cannot disagree', () => {
  const props = {
    metricsData: [row(err, '10', 0)],
    trendsExpanded: true,
    addedSeries: [rt, err],
    showToast: jest.fn(),
    cursorIndex: null,
  };
  const { result } = renderHook(() => useTrendsPlot(props));

  const traces = result.current.plotData as Array<{ name: string }>;
  expect(traces.map((t) => t.name)).toEqual(['All aggregated — Transaction Error Rate']);
  // A row per ADDED series, including the one with no data in range: the swatch and the
  // remove button are how it gets dealt with.
  expect(result.current.rows.map((r) => r.name)).toEqual([
    'All aggregated — Transaction RT Avg',
    'All aggregated — Transaction Error Rate',
  ]);
  // The title moved to the card header, so the layout carries no title of its own.
  expect(result.current.plotLayout).not.toHaveProperty('title');
});

it('clears the plot when the card is collapsed or has no data', () => {
  const props = {
    metricsData: [row(rt, '10', 280)],
    trendsExpanded: false,
    addedSeries: [rt],
    showToast: jest.fn(),
    cursorIndex: null,
  };
  const { result } = renderHook(() => useTrendsPlot(props));
  expect(result.current.plotData).toEqual([]);
  expect(result.current.plotLayout).toEqual({});
});
