/**
 * The Trends x axis is labelled with each run's DATE, not its id.
 *
 * Positions stay a linear axis over run INDEX — runs are discrete events and must stay
 * evenly spaced whatever the gaps between them — so only the tick text changes. The two
 * cases that matter: nightly runs want the bare date, and a workload run several times in
 * one day would label two positions identically unless the clock goes on.
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

const row = (run: string, createdAt: string, value: number): MetricStatistic => ({
  test_run_id: run, series_id: rt.id, panel_title: rt.panelTitle,
  metric_name: rt.metricName, value, created_at: createdAt,
});

const render = (metricsData: MetricStatistic[]) =>
  renderHook(() =>
    useTrendsPlot({
      metricsData,
      trendsExpanded: true,
      addedSeries: [rt],
      showToast: jest.fn(),
      cursorIndex: null,
    }),
  );

const ticks = (result: { current: { plotLayout: Record<string, unknown> } }) =>
  (result.current.plotLayout.xaxis as { ticktext: string[]; tickvals: number[] });

// Asserting the SHAPE rather than exact strings: the label is rendered in the viewer's
// timezone, so an exact `05 Oct 07:00` would pass only where the suite happens to run.
// `Sept` as well as `Sep`: en-GB's short month is four letters for September.
const DATE_ONLY = /^\d{2} [A-Z][a-z]{2,3}$/;
const DATE_AND_CLOCK = /^\d{2} [A-Z][a-z]{2,3} \d{2}:\d{2}$/;

it('labels one-run-a-day with the bare date, never the run id', () => {
  const { result } = render([
    row('WEBSHOP-acc-loadTest-00020', '2026-09-28T05:00:00Z', 280),
    row('WEBSHOP-acc-loadTest-00021', '2026-09-29T05:00:00Z', 300),
    row('WEBSHOP-acc-loadTest-00022', '2026-09-30T05:00:00Z', 290),
  ]);

  const { ticktext, tickvals } = ticks(result);
  expect(tickvals).toEqual([0, 1, 2]);
  for (const label of ticktext) expect(label).toMatch(DATE_ONLY);
  // The whole point: a run id is not a date.
  expect(ticktext.join(' ')).not.toContain('WEBSHOP');
});

it('puts the clock on every tick once two runs share a day, so no two read alike', () => {
  const { result } = render([
    row('WEBSHOP-acc-loadTest-00020', '2026-09-28T05:00:00Z', 280),
    row('WEBSHOP-acc-loadTest-00021', '2026-09-28T11:00:00Z', 300),
    row('WEBSHOP-acc-loadTest-00022', '2026-09-29T05:00:00Z', 290),
  ]);

  const { ticktext } = ticks(result);
  // All of them, not just the colliding pair — a mixed axis is harder to read than a
  // uniformly longer one.
  for (const label of ticktext) expect(label).toMatch(DATE_AND_CLOCK);
  expect(new Set(ticktext).size).toBe(ticktext.length);
});

it('keeps the x positions a run index, so an irregular cadence stays evenly spaced', () => {
  const { result } = render([
    row('a', '2026-09-01T05:00:00Z', 1),
    // A three week gap: on a date axis this point would sit far to the right.
    row('b', '2026-09-22T05:00:00Z', 2),
    row('c', '2026-09-23T05:00:00Z', 3),
  ]);

  const trace = (result.current.plotData as Array<{ x: number[] }>)[0];
  expect(trace.x).toEqual([0, 1, 2]);
});

/**
 * Subsampling. A 40-run trend cannot carry 40 labels — they overlap into a solid band —
 * so the axis labels every nth position. `04 Oct` is about a sixth the width of a run id,
 * which is why the budget went from 8 ticks to 12 when the labels became dates.
 */
it('labels at most every nth run once there are more than twelve', () => {
  const { result } = render(
    Array.from({ length: 26 }, (_, i) =>
      row(`run-${i}`, new Date(Date.UTC(2026, 8, 1 + i, 5)).toISOString(), 100 + i)),
  );

  const { tickvals, ticktext } = ticks(result);
  // ceil(26/12) = 3, so positions 0, 3, 6 … — every label still readable.
  expect(tickvals).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24]);
  expect(ticktext).toHaveLength(tickvals.length);
  // The positions themselves are untouched: every run keeps its own x.
  expect((result.current.plotData as Array<{ x: number[] }>)[0]!.x).toHaveLength(26);
});

it('labels every run while they fit, so a short trend loses nothing', () => {
  const { result } = render(
    Array.from({ length: 12 }, (_, i) =>
      row(`run-${i}`, new Date(Date.UTC(2026, 8, 1 + i, 5)).toISOString(), 100 + i)),
  );
  expect(ticks(result).tickvals).toEqual([...Array(12).keys()]);
});

it('returns an empty chart, rather than an axis to label, when there are no runs', () => {
  // The early-out short-circuits before any axis is built: a card with nothing added
  // renders no trace and no tick, instead of an axis over a zero-length run list.
  const { result } = render([]);
  expect(result.current.plotData).toEqual([]);
  expect(result.current.plotLayout.xaxis).toBeUndefined();
  expect(result.current.runIds).toEqual([]);
});
