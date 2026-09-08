/**
 * The three ResponsivePlot call sites must keep their half of the contract.
 *
 * ResponsivePlot fixes stale Plotly hover geometry by observing its own
 * container and calling Plotly.Plots.resize on its own graph div — react-plotly.js
 * 2.6.0's `useResizeHandler` is nothing but a window-resize listener, so a
 * container that resizes without the window never reaches it. That means the
 * fix is completely inert at any call site that imports react-plotly.js directly
 * (via `dynamic()`) instead of the wrapper: the container is then unobserved.
 * `useResizeHandler` is still asserted per call site because it remains the
 * path for a real window resize.
 *
 * Neither failure throws, logs, or changes a snapshot. It shows up only as a
 * hover label whose text and background box drift apart, on Windows, inside a
 * Collapse or behind an animating drawer. So it is asserted here, per call
 * site, in the same shape the components actually render.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Capture the props every ResponsivePlot in the tree is rendered with.
const plotProps: Array<Record<string, unknown>> = [];
const plotMounts: number[] = [];
jest.mock('@/components/ResponsivePlot', () => ({
  __esModule: true,
  default: function MockResponsivePlot(props: Record<string, unknown>) {
    plotProps.push(props);
    // Count mounts, not renders — the drawer test asserts a remount, and React
    // strips `key` from props so it cannot be observed directly.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useEffect(() => { plotMounts.push(1); }, []);
    return <div data-testid="responsive-plot" />;
  },
}));

// If any call site still reaches for `dynamic()` to load a plot, this mock
// renders a distinguishable node and the assertions below catch it.
jest.mock('next/dynamic', () => () => function MockDynamicPlot() {
  return <div data-testid="dynamic-plot" />;
});

// Heavy / browser-only children irrelevant to the wiring under test.
jest.mock(
  '@/app/test-runs/[id]/components/anomaly-detection/components/utils/trends-plot-utils',
  () => ({
    createTrendsPlot: () => ({
      plotData: [{ x: [1], y: [1] }],
      plotLayout: {},
      plotConfig: {},
    }),
  }),
);
jest.mock('@/app/test-runs/[id]/components/anomaly-detection/utils', () => ({
  createTrendsPlot: () => ({
    plotData: [{ x: [1], y: [1] }],
    plotLayout: {},
    plotConfig: {},
  }),
}));
jest.mock('@/app/test-runs/[id]/components/configuration-comparison/MetricConfigForm', () =>
  function MockMetricConfigForm() {
    return <div />;
  },
);
jest.mock(
  '@/app/test-runs/[id]/components/anomaly-detection/components/table-components/StatisticalDrawerContent',
  () => ({
    StatisticalDrawerContent: function MockStatisticalDrawerContent() {
      return <div />;
    },
  }),
);
jest.mock('@/app/test-runs/[id]/components/compare/current-test-run-chart/hooks', () => ({
  useCurrentTestRunChart: () => ({
    loading: false,
    error: null,
    hasData: true,
    plotData: [{ x: [1], y: [1] }],
    plotLayout: {},
    plotConfig: {},
    chartHeight: 400,
  }),
}));

import TrendChart from '@/app/test-runs/[id]/components/anomaly-detection/components/TrendChart';
import CurrentTestRunChart from '@/app/test-runs/[id]/components/compare/CurrentTestRunChart';
import { AnomalyExpandedContent } from '@/app/test-runs/[id]/components/anomaly-detection/components/table-components/AnomalyExpandedContent';
import { AnomalyData, MetricTrendData } from '@/app/test-runs/[id]/components/anomaly-detection/types';

const noop = () => {};
const asyncNoop = async () => {};

const trendData: MetricTrendData[] = [
  {
    test_run_id: 'tr-1',
    test_run_start: '2024-01-01T00:00:00Z',
    test_run_end: '2024-01-01T01:00:00Z',
    mean: 50,
    median: 48,
    q95: 75,
    conclusion_label: 'no difference',
    unit: 'ms',
    thresholds: { lower: { overall: 40 }, upper: { overall: 60 } },
  },
];

const baseRow: AnomalyData = {
  dashboard_label: 'Performance test metrics AV_BemiddelenVacatures',
  source_type: 'performance_test',
  panel_title: 'Transaction RT Avg',
  metric_name: 'AV_BVAC_03_Vacatures',
  unit: 'ms',
  classification: 'red_duration',
  conclusion_label: 'regression',
  test_value: '100',
  control_group_value: '50',
  difference: '50',
  application_dashboard_id: 'app-1',
  panel_id: '101',
  is_stale: false,
};

function renderExpanded(overrides: Partial<Record<string, unknown>> = {}) {
  return render(
    <AnomalyExpandedContent
      row={baseRow}
      rowKey="row-1"
      isExpanded
      isLast
      testRunId="BMS-acc-loadTest-00002"
      testRun={null}
      trendsData={trendData}
      trendsLoading={false}
      chartKey={0}
      drawerOpen={false}
      drawerData={undefined}
      drawerLoading={false}
      showConfigForm={false}
      onDrawerToggle={noop}
      onConfigFormToggle={noop}
      onConfigSave={asyncNoop}
      onSelectTestRun={noop}
      onResetSelectedTestRun={noop}
      {...(overrides as Record<string, never>)}
    />,
  );
}

beforeEach(() => {
  plotProps.length = 0;
  plotMounts.length = 0;
});

describe('TrendChart', () => {
  it('renders through ResponsivePlot with useResizeHandler enabled', async () => {
    render(
      <TrendChart
        data={trendData}
        rowKey="row-1"
        metricName="response_time"
        unit="ms"
        height={400}
        chartKey={0}
      />,
    );

    // TrendChart builds its plot in a useEffect, so it renders once empty and
    // again with data. Assert the settled render, and that both carry the flag.
    await waitFor(() =>
      expect((plotProps[plotProps.length - 1].data as unknown[]).length).toBeGreaterThan(0),
    );
    expect(screen.getByTestId('responsive-plot')).toBeInTheDocument();
    expect(screen.queryByTestId('dynamic-plot')).not.toBeInTheDocument();
    expect(plotProps.every((p) => p.useResizeHandler === true)).toBe(true);
    expect(plotProps[plotProps.length - 1].style).toEqual({ width: '100%', height: '100%' });
  });

  it('renders no plot at all in the loading, error and empty states', () => {
    const { rerender } = render(
      <TrendChart data={trendData} rowKey="r" metricName="m" loading />,
    );
    expect(plotProps).toHaveLength(0);

    rerender(<TrendChart data={trendData} rowKey="r" metricName="m" error="boom" />);
    expect(plotProps).toHaveLength(0);

    rerender(<TrendChart data={[]} rowKey="r" metricName="m" />);
    expect(plotProps).toHaveLength(0);
  });
});

describe('CurrentTestRunChart', () => {
  it('renders through ResponsivePlot with useResizeHandler enabled', () => {
    render(
      <CurrentTestRunChart
        testRunId="tr-1"
        applicationDashboardId="app-1"
        panelId="101"
        metricName="response_time"
        testRun={null}
        unit="ms"
      />,
    );

    expect(screen.getByTestId('responsive-plot')).toBeInTheDocument();
    expect(screen.queryByTestId('dynamic-plot')).not.toBeInTheDocument();
    expect(plotProps).toHaveLength(1);
    expect(plotProps[0].useResizeHandler).toBe(true);
  });

  it('remounts the plot when the drawer opens, so it redraws at the new width', () => {
    const { rerender } = render(
      <CurrentTestRunChart
        testRunId="tr-1"
        applicationDashboardId="app-1"
        panelId="101"
        metricName="response_time"
        testRun={null}
        isDrawerOpen={false}
      />,
    );
    expect(plotMounts).toHaveLength(1);

    rerender(
      <CurrentTestRunChart
        testRunId="tr-1"
        applicationDashboardId="app-1"
        panelId="101"
        metricName="response_time"
        testRun={null}
        isDrawerOpen
      />,
    );

    // The `key` carries isDrawerOpen, so React unmounts and remounts rather
    // than updating — that is what makes the chart redraw at the new width.
    expect(plotMounts).toHaveLength(2);
    expect(plotProps[plotProps.length - 1].useResizeHandler).toBe(true);
  });
});

describe('AnomalyExpandedContent', () => {
  it('renders the trends plot through ResponsivePlot with useResizeHandler enabled', () => {
    renderExpanded();

    expect(screen.queryByTestId('dynamic-plot')).not.toBeInTheDocument();
    expect(plotProps.length).toBeGreaterThan(0);
    const trendsPlot = plotProps[0];
    expect(trendsPlot.useResizeHandler).toBe(true);
    expect(trendsPlot.style).toEqual({ width: '100%', height: '100%' });
    // The click-to-select handler must survive the wrapper.
    expect(typeof trendsPlot.onInitialized).toBe('function');
  });

  it('still fires a window resize when the Collapse finishes opening', async () => {
    const onResize = jest.fn();
    window.addEventListener('resize', onResize);

    // Mounted collapsed, then expanded: MUI runs the enter transition and
    // calls onEntered, which is the pre-existing half of this fix (the
    // Collapse animates to full height *after* Plotly has already drawn).
    const { rerender } = render(
      <AnomalyExpandedContent
        row={baseRow}
        rowKey="row-1"
        isExpanded={false}
        isLast
        testRunId="tr-1"
        testRun={null}
        trendsData={trendData}
        trendsLoading={false}
        chartKey={0}
        drawerOpen={false}
        drawerData={undefined}
        drawerLoading={false}
        showConfigForm={false}
        onDrawerToggle={noop}
        onConfigFormToggle={noop}
        onConfigSave={asyncNoop}
        onSelectTestRun={noop}
        onResetSelectedTestRun={noop}
      />,
    );

    rerender(
      <AnomalyExpandedContent
        row={baseRow}
        rowKey="row-1"
        isExpanded
        isLast
        testRunId="tr-1"
        testRun={null}
        trendsData={trendData}
        trendsLoading={false}
        chartKey={0}
        drawerOpen={false}
        drawerData={undefined}
        drawerLoading={false}
        showConfigForm={false}
        onDrawerToggle={noop}
        onConfigFormToggle={noop}
        onConfigSave={asyncNoop}
        onSelectTestRun={noop}
        onResetSelectedTestRun={noop}
      />,
    );

    await waitFor(() => expect(onResize).toHaveBeenCalled(), { timeout: 3000 });
    window.removeEventListener('resize', onResize);
  });
});
