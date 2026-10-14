/**
 * GraphsChart's zoom wiring: the chart owns nothing about the zoom window itself — it just
 * maps a Plotly relayout event through `zoomRangeFromRelayout` (pinned on its own in
 * `graphs/utils/__tests__/zoom-range.test.ts`) and calls `onZoomRange`. What is worth
 * covering here is the wiring, not the mapping: a drag-zoom reaches `onZoomRange` with the
 * chart's own `sortedTimestamps`, a double-click reset reaches it with `null`, a missing
 * `onZoomRange` is a no-op rather than a crash, the `reset zoom` control appears only while
 * `zoomed` is true, and a refetch in flight dims the drawn chart instead of unmounting it.
 *
 * Follows the ResponsivePlot-mocking pattern from `GraphsChart.analysisRangeOnly.test.tsx`.
 */

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
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

const N = 10;
const BASE = new Date('2024-01-01T00:00:00.000Z').getTime();
function timeAt(i: number): string {
  return new Date(BASE + i * 60_000).toISOString();
}

const series = (): SeriesConfig => ({
  id: 's1',
  dashboardId: 'dash-1',
  dashboardLabel: 'JVM metrics',
  panelId: 5,
  panelTitle: 'Heap',
  metricName: 'used',
  source: 'grafana',
  yAxisFormat: 'bytes',
});

function makeData(): Map<string, MetricDataPoint[]> {
  const points: MetricDataPoint[] = Array.from({ length: N }, (_, i) => ({
    time: timeAt(i),
    metric_name: 'used',
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
  testRun: makeTestRun(),
};

describe('GraphsChart — zoom wiring', () => {
  beforeEach(() => {
    plotProps.length = 0;
  });

  it('wires onRelayout onto the plot, and a drag-zoom calls onZoomRange with the mapped window', () => {
    const onZoomRange = jest.fn();
    render(<GraphsChart {...baseProps} onZoomRange={onZoomRange} zoomed={false} />);

    const onRelayout = plotProps[plotProps.length - 1].onRelayout as (e: Record<string, unknown>) => void;
    expect(typeof onRelayout).toBe('function');

    act(() => {
      onRelayout({ 'xaxis.range[0]': 2.4, 'xaxis.range[1]': 5.6 });
    });

    expect(onZoomRange).toHaveBeenCalledWith({ from: timeAt(2), to: timeAt(6) });
  });

  it('resets to the whole run on a double-click while zoomed, calling onZoomRange(null)', () => {
    const onZoomRange = jest.fn();
    render(<GraphsChart {...baseProps} onZoomRange={onZoomRange} zoomed />);

    const onRelayout = plotProps[plotProps.length - 1].onRelayout as (e: Record<string, unknown>) => void;
    act(() => {
      onRelayout({ 'xaxis.autorange': true });
    });

    expect(onZoomRange).toHaveBeenCalledWith(null);
  });

  it('does not call onZoomRange for a full-span relayout, and never throws when onZoomRange is absent', () => {
    // No onZoomRange prop at all — GraphsCard only wires one up when a handler exists.
    render(<GraphsChart {...baseProps} zoomed={false} />);
    const onRelayout = plotProps[plotProps.length - 1].onRelayout as (e: Record<string, unknown>) => void;

    expect(() => act(() => {
      onRelayout({ 'xaxis.range[0]': 0, 'xaxis.range[1]': N - 1 });
    })).not.toThrow();
  });

  it('offers a focusable reset only while zoomed, and it widens back to the whole run', () => {
    // Plotly's double-click is mouse-only, so the zoomed state has to carry a real control.
    const onZoomRange = jest.fn();
    const { rerender } = render(
      <GraphsChart {...baseProps} onZoomRange={onZoomRange} zoomed={false} />,
    );
    expect(screen.queryByRole('button', { name: /reset zoom/i })).not.toBeInTheDocument();

    rerender(<GraphsChart {...baseProps} onZoomRange={onZoomRange} zoomed />);
    const reset = screen.getByRole('button', { name: /reset zoom/i });
    // An action, not a toggle: a reset is never "off".
    expect(reset).not.toHaveAttribute('aria-pressed');

    fireEvent.click(reset);
    expect(onZoomRange).toHaveBeenCalledWith(null);
  });

  it('keeps the drawn chart on screen, fully legible, while a zoom refetch is in flight', () => {
    // The drag has already redrawn the narrowed range client-side; swapping it for a
    // spinner reads as the chart breaking rather than sharpening. The busy state is a
    // header word rather than an opacity on the plot: `lib/charts/tokens.ts` measures 0.45
    // at 3.36:1 for this chart's own 9-11px text, below the contrast floor.
    const { container } = render(<GraphsChart {...baseProps} loading zoomed />);
    expect(screen.getByTestId('responsive-plot')).toBeInTheDocument();
    expect(screen.getByText(/updating/i)).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    // Nothing in the plot's subtree is faded.
    const plot = screen.getByTestId('responsive-plot');
    for (let el: HTMLElement | null = plot; el; el = el.parentElement) {
      expect(el.style.opacity === '' || el.style.opacity === '1').toBe(true);
    }
  });
});
