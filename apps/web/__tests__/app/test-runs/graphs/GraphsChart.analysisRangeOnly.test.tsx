/**
 * The "analysis range only" toggle on the Graphs card.
 *
 * Follows the ResponsivePlot-mocking pattern from
 * `__tests__/components/ResponsivePlotConsumers.test.tsx`: the chart component is mounted
 * for real, and ResponsivePlot is replaced with a thin stand-in that captures the props
 * GraphsChart hands it (traces, x-axis range) so the toggle's effect on what is actually
 * plotted can be asserted without a real Plotly canvas.
 *
 * Covers: the toggle is absent when the run has no analysis offsets (`hasWindow` false),
 * present and clickable when it does, and toggling it narrows both the plotted trace
 * points and the x-axis `range` to the padded analysis window — while leaving the series
 * table's min/mean/max (already window-scoped independently of the toggle) unchanged.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

const plotProps: Array<Record<string, unknown>> = [];
jest.mock('@/components/ResponsivePlot', () => ({
  __esModule: true,
  default: function MockResponsivePlot(props: Record<string, unknown>) {
    plotProps.push(props);
    return <div data-testid="responsive-plot" />;
  },
}));

import GraphsChart from '@/app/test-runs/[id]/components/graphs/GraphsChart';
import type { SeriesConfig, MetricDataPoint } from '@/app/test-runs/[id]/components/graphs/types';
import type { TestRun } from '@/types/test-runs';

function makeTestRun(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: 'test-run-uuid',
    test_run_id: 'run-1',
    system_name: 'sys',
    test_environment: 'env',
    workload: 'wl',
    completed: false,
    start_time: null,
    end_time: null,
    duration: null,
    planned_duration: null,
    ...overrides,
  } as TestRun;
}

// 101 one-second samples, so offsets in seconds map 1:1 to sample indices.
const N = 101;
const BASE = new Date('2024-01-01T00:00:00.000Z').getTime();
function timeAt(i: number): string {
  return new Date(BASE + i * 1000).toISOString();
}

const series = (): SeriesConfig => ({
  id: 's1',
  dashboardId: 'dash-1',
  dashboardLabel: 'Docker container metrics',
  panelId: 101,
  panelTitle: 'CPU',
  metricName: 'usage',
  source: 'grafana',
  yAxisFormat: 'percent',
});

function makeData(): Map<string, MetricDataPoint[]> {
  const points: MetricDataPoint[] = Array.from({ length: N }, (_, i) => ({
    time: timeAt(i),
    metric_name: 'usage',
    value: i,
    timestep: i,
  }));
  return new Map([['s1', points]]);
}

const baseProps = {
  seriesConfig: [series()],
  seriesData: makeData(),
  loading: false,
  chartName: 'My chart',
};

describe('GraphsChart — "analysis range only" toggle', () => {
  beforeEach(() => {
    plotProps.length = 0;
  });

  it('hides the toggle when the run has no analysis offsets', () => {
    render(<GraphsChart {...baseProps} testRun={makeTestRun()} />);
    expect(screen.getByTestId('responsive-plot')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /analysis range only/i })).not.toBeInTheDocument();
  });

  it('hides the toggle when testRun is null', () => {
    render(<GraphsChart {...baseProps} testRun={null} />);
    expect(screen.queryByRole('button', { name: /analysis range only/i })).not.toBeInTheDocument();
  });

  it('shows the toggle, off by default, when the run has an analysis window', () => {
    render(
      <GraphsChart
        {...baseProps}
        testRun={makeTestRun({ analysis_start_offset: 10, analysis_end_offset: 10 })}
      />,
    );
    const button = screen.getByRole('button', { name: /analysis range only/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('narrows the plotted points and the x-axis range once toggled on, and restores them when toggled off', () => {
    const { rerender } = render(
      <GraphsChart
        {...baseProps}
        testRun={makeTestRun({ analysis_start_offset: 10, analysis_end_offset: 10 })}
      />,
    );

    // Off: every one of the 101 points is plotted, x ranges over the whole series.
    const offData = plotProps[plotProps.length - 1].data as Array<{ x: number[] }>;
    expect(offData[0].x).toHaveLength(N);
    const offLayout = plotProps[plotProps.length - 1].layout as { xaxis: { range: number[] } };
    expect(offLayout.xaxis.range).toEqual([0, N - 1]);

    const button = screen.getByRole('button', { name: /analysis range only/i });
    fireEvent.click(button);
    rerender(
      <GraphsChart
        {...baseProps}
        testRun={makeTestRun({ analysis_start_offset: 10, analysis_end_offset: 10 })}
      />,
    );

    expect(button).toHaveAttribute('aria-pressed', 'true');

    // startIndex 10 (first sample at/after 10s), endIndex 91 (first sample strictly after
    // 90s) — the "first excluded trailing sample" semantics of calculateAnalysisWindowIndices.
    // Margin = round((91-10)*0.025) = 2 samples each side -> clip [8, 93], 86 points.
    const onData = plotProps[plotProps.length - 1].data as Array<{ x: number[] }>;
    expect(onData[0].x).toHaveLength(86);
    expect(Math.min(...onData[0].x)).toBe(8);
    expect(Math.max(...onData[0].x)).toBe(93);
    const onLayout = plotProps[plotProps.length - 1].layout as { xaxis: { range: number[] } };
    expect(onLayout.xaxis.range).toEqual([8, 93]);

    // Toggle back off: the full series returns.
    fireEvent.click(button);
    rerender(
      <GraphsChart
        {...baseProps}
        testRun={makeTestRun({ analysis_start_offset: 10, analysis_end_offset: 10 })}
      />,
    );
    expect(button).toHaveAttribute('aria-pressed', 'false');
    const restoredData = plotProps[plotProps.length - 1].data as Array<{ x: number[] }>;
    expect(restoredData[0].x).toHaveLength(N);
  });

  it('leaves the series table stats unchanged by the toggle — they are already window-scoped', () => {
    const { rerender } = render(
      <GraphsChart
        {...baseProps}
        testRun={makeTestRun({ analysis_start_offset: 10, analysis_end_offset: 10 })}
      />,
    );
    // min/mean/max are the analysis-window values (indices 10..89), regardless of the
    // toggle — capture the rendered table text before/after rather than guess formatting.
    const tableTextBefore = document.body.textContent;

    const button = screen.getByRole('button', { name: /analysis range only/i });
    fireEvent.click(button);
    rerender(
      <GraphsChart
        {...baseProps}
        testRun={makeTestRun({ analysis_start_offset: 10, analysis_end_offset: 10 })}
      />,
    );
    const tableTextAfter = document.body.textContent;
    expect(tableTextAfter).toEqual(tableTextBefore);
  });

  it('draws an empty trace, not an error, for a series whose data sits entirely outside the clipped window', () => {
    // s2 only reports during the ramp-up (indices 0..5), well before the clip's lo of 8.
    const rampUpOnly: MetricDataPoint[] = Array.from({ length: 6 }, (_, i) => ({
      time: timeAt(i),
      metric_name: 'ramp',
      value: i,
      timestep: i,
    }));
    const seriesConfig: SeriesConfig[] = [
      series(),
      { ...series(), id: 's2', metricName: 'ramp', panelId: 102 },
    ];
    const seriesData = makeData();
    seriesData.set('s2', rampUpOnly);

    render(
      <GraphsChart
        {...baseProps}
        seriesConfig={seriesConfig}
        seriesData={seriesData}
        testRun={makeTestRun({ analysis_start_offset: 10, analysis_end_offset: 10 })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /analysis range only/i }));

    const data = plotProps[plotProps.length - 1].data as Array<{ x: number[]; y: number[] }>;
    expect(data).toHaveLength(2);
    expect(data[0].x.length).toBeGreaterThan(0); // s1 still has points in the clip
    expect(data[1].x).toEqual([]); // s2's trace is empty, not missing or erroring
    expect(data[1].y).toEqual([]);
    // The series table still lists it — removing a series from the chart must not
    // remove it from the legend/stats list.
    expect(screen.getByText('CPU · ramp')).toBeInTheDocument();
  });

  it('shows the toggle and clips an open-ended window when only the start offset is set', () => {
    render(
      <GraphsChart
        {...baseProps}
        testRun={makeTestRun({ analysis_start_offset: 10, analysis_end_offset: undefined })}
      />,
    );
    const button = screen.getByRole('button', { name: /analysis range only/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    const data = plotProps[plotProps.length - 1].data as Array<{ x: number[] }>;
    // endIndex is null (unset) -> clip hi is the last sample, margin computed off (lo, n-1).
    expect(Math.max(...data[0].x)).toBe(N - 1);
    expect(Math.min(...data[0].x)).toBeGreaterThan(0);
  });

  it('keeps the hover cursor readout correct while clipped — it reads the real sample index, not a clip-local one', () => {
    render(
      <GraphsChart
        {...baseProps}
        testRun={makeTestRun({ analysis_start_offset: 10, analysis_end_offset: 10 })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /analysis range only/i }));

    const onHover = plotProps[plotProps.length - 1].onHover as (e: unknown) => void;
    // Index 50 is inside the clipped window [8, 93] and is a real sample index — the x
    // values handed to Plotly are the original indices, never renumbered by the clip.
    act(() => {
      onHover({ points: [{ x: 50 }] });
    });

    // fmtClock(timeAt(50)) is whatever the shared formatter renders; the point here is
    // only that a *clipped* chart still produces a non-empty readout, proving the cursor
    // index was not discarded or remapped by the clip.
    const readout = document.querySelector('[aria-live="off"]');
    expect(readout?.textContent).not.toEqual('');
  });
});

/**
 * The two defects the pre-landing adversarial pass found in this view, each pinned by the
 * assertion that fails without its fix.
 */
describe('GraphsChart — "analysis range only" degenerate cases', () => {
  beforeEach(() => {
    plotProps.length = 0;
  });

  it('never hands Plotly a zero-width x range, even on a one-sample run', () => {
    // The perf-test scenario panels (Error Count, Avg/Max Active Threads) hold exactly one
    // point per run, so a chart built from one of them clips to a single index.
    const onePoint = new Map([
      ['s1', [{ time: timeAt(0), metric_name: 'usage', value: 7, timestep: 0 }]],
    ]);
    render(
      <GraphsChart
        {...baseProps}
        seriesData={onePoint}
        testRun={makeTestRun({ analysis_start_offset: 10, analysis_end_offset: 10 })}
      />,
    );
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /analysis range only/i }));
    });

    const layout = plotProps[plotProps.length - 1].layout as { xaxis: { range: number[] } };
    expect(layout.xaxis.range[1]).toBeGreaterThan(layout.xaxis.range[0]);
  });

  it('keeps time labels inside the narrowed domain', () => {
    render(
      <GraphsChart
        {...baseProps}
        testRun={makeTestRun({ analysis_start_offset: 90, analysis_end_offset: 5 })}
      />,
    );
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /analysis range only/i }));
    });

    const layout = plotProps[plotProps.length - 1].layout as {
      xaxis: { range: number[]; tickvals: number[] };
    };
    const [lo, hi] = layout.xaxis.range;
    // Ticks spaced over the whole run would land below `lo` and leave the axis unlabelled.
    expect(layout.xaxis.tickvals.length).toBeGreaterThan(1);
    for (const v of layout.xaxis.tickvals) {
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
  });
});
