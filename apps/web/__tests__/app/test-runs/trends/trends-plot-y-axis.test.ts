/**
 * The Trends y axis follows the data, it is not pinned to zero.
 *
 * A trend is read for its shape: is this metric drifting up across releases. The shared
 * chart layout pins a non-negative axis to `[0, niceTop]` by default, which is right for a
 * single run's time series (a band near the top is MEANT to read as small next to zero) and
 * wrong here — a series that sits at 820-840ms becomes a flat line in the top tenth of a
 * 0-900 axis, and the 20ms climb the trend exists to show disappears.
 */
import { renderHook } from '@testing-library/react';
import { useTrendsPlot } from '@/app/test-runs/[id]/components/trends/hooks/useTrendsPlot';
import type { MetricStatistic, TrendsSeries } from '@/app/test-runs/[id]/components/trends/types';

jest.mock('@/lib/plotly', () => ({ getPlotly: () => null }));

const rt: TrendsSeries = {
  id: 'rt', dashboardId: 'd', dashboardLabel: 'JMeter', panelId: 101,
  panelTitle: 'Transaction RT Avg', metricName: 'T01', source: 'performance-metrics',
  yAxisFormat: 'ms',
};

const cpu: TrendsSeries = {
  id: 'cpu', dashboardId: 'd2', dashboardLabel: 'Docker', panelId: 7,
  panelTitle: 'CPU', metricName: 'usage', source: 'grafana',
  yAxisFormat: 'percentunit',
};

const row = (series: TrendsSeries, run: string, createdAt: string, value: number): MetricStatistic => ({
  test_run_id: run, series_id: series.id, panel_title: series.panelTitle,
  metric_name: series.metricName, value, created_at: createdAt,
});

const render = (metricsData: MetricStatistic[], addedSeries: TrendsSeries[] = [rt]) =>
  renderHook(() =>
    useTrendsPlot({
      metricsData,
      trendsExpanded: true,
      addedSeries,
      showToast: jest.fn(),
      cursorIndex: null,
    }),
  );

type Axis = { range?: number[]; autorange?: boolean; tickvals?: number[] };

// A high, narrow band: the shape this test exists for. Pinned to zero these three runs are
// one flat line; autoranged, the 20ms climb is the whole chart.
const BAND = [
  row(rt, 'WEBSHOP-acc-loadTest-00020', '2026-09-28T05:00:00Z', 820),
  row(rt, 'WEBSHOP-acc-loadTest-00021', '2026-09-29T05:00:00Z', 830),
  row(rt, 'WEBSHOP-acc-loadTest-00022', '2026-09-30T05:00:00Z', 840),
];

it('autoranges the y axis instead of pinning it to zero', () => {
  const { result } = render(BAND);
  const yaxis = result.current.plotLayout.yaxis as Axis;

  expect(yaxis.autorange).toBe(true);
  // An explicit range or tickvals would override the autorange — that is exactly the bug.
  expect(yaxis.range).toBeUndefined();
  expect(yaxis.tickvals).toBeUndefined();
});

it('autoranges the right axis too, when a second unit family is on the chart', () => {
  const { result } = render(
    [
      ...BAND,
      row(cpu, 'WEBSHOP-acc-loadTest-00020', '2026-09-28T05:00:00Z', 0.81),
      row(cpu, 'WEBSHOP-acc-loadTest-00021', '2026-09-29T05:00:00Z', 0.83),
      row(cpu, 'WEBSHOP-acc-loadTest-00022', '2026-09-30T05:00:00Z', 0.85),
    ],
    [rt, cpu],
  );

  const yaxis2 = result.current.plotLayout.yaxis2 as Axis | undefined;
  expect(yaxis2?.autorange).toBe(true);
  expect(yaxis2?.range).toBeUndefined();
});

it('autoranges every lane once a third unit family pushes the chart into lanes mode', () => {
  // Past two unit families `resolveAxes` stops overlaying and starts stacking, which is a
  // different layout builder. The flag is on the shared spec, so it must reach both.
  const count: TrendsSeries = {
    id: 'count', dashboardId: 'd3', dashboardLabel: 'JMeter', panelId: 9,
    panelTitle: 'Errors', metricName: 'total', source: 'performance-metrics',
    yAxisFormat: 'short',
  };
  const { result } = render(
    [
      ...BAND,
      row(cpu, 'WEBSHOP-acc-loadTest-00020', '2026-09-28T05:00:00Z', 0.81),
      row(cpu, 'WEBSHOP-acc-loadTest-00021', '2026-09-29T05:00:00Z', 0.83),
      row(count, 'WEBSHOP-acc-loadTest-00020', '2026-09-28T05:00:00Z', 42),
      row(count, 'WEBSHOP-acc-loadTest-00021', '2026-09-29T05:00:00Z', 47),
    ],
    [rt, cpu, count],
  );

  const layout = result.current.plotLayout as Record<string, unknown>;
  // One y axis per lane, each with its own domain — and each autoranged.
  const lanes = ['yaxis', 'yaxis2', 'yaxis3']
    .map((key) => layout[key] as (Axis & { domain?: number[] }) | undefined)
    .filter((axis): axis is Axis & { domain?: number[] } => axis !== undefined);
  expect(lanes).toHaveLength(3);
  for (const lane of lanes) {
    expect(lane.domain).toBeDefined();
    expect(lane.autorange).toBe(true);
    expect(lane.range).toBeUndefined();
  }
});

it('clamps a flat all-zero trend at zero rather than drawing it on a -1..1 axis', () => {
  // The case the clamp exists for, exercised through the hook rather than only against
  // `yAxis` directly: an error count that reports 0 on every run is a clean result, and
  // Plotly's plain autorange would frame it one unit either side of itself — a y axis with
  // ticks for impossible negative error counts.
  const errors: TrendsSeries = {
    id: 'err', dashboardId: 'd', dashboardLabel: 'JMeter', panelId: 301,
    panelTitle: 'Error Count', metricName: 'error_count', source: 'performance-metrics',
    yAxisFormat: 'short',
  };
  const flat = [
    row(errors, 'WEBSHOP-acc-loadTest-00020', '2026-09-28T05:00:00Z', 0),
    row(errors, 'WEBSHOP-acc-loadTest-00021', '2026-09-29T05:00:00Z', 0),
    row(errors, 'WEBSHOP-acc-loadTest-00022', '2026-09-30T05:00:00Z', 0),
  ];

  const { result } = render(flat, [errors]);
  const y = (result.current.plotLayout as unknown as { yaxis: Axis & { rangemode?: string } }).yaxis;

  expect(y.autorange).toBe(true);
  expect(y.rangemode).toBe('nonnegative');
});

it('keeps the changepoint marker paper-referenced, so it cannot stretch the autorange', () => {
  // Autorange includes DATA-referenced shapes in its range. Every shape this chart merges
  // must stay on the paper ref or a marker at y=0..1 would drag the axis down to zero and
  // undo the fix silently.
  const [first, ...rest] = BAND;
  const { result } = render([{ ...first, is_changepoint: true }, ...rest]);

  const shapes = (result.current.plotLayout.shapes ?? []) as Array<{ yref?: string }>;
  expect(shapes.length).toBeGreaterThan(0);
  for (const shape of shapes) expect(shape.yref).toBe('paper');
});
