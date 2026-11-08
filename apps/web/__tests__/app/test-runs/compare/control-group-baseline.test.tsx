/**
 * The Compare card's "Control group" baseline.
 *
 * The control group is the set of earlier runs anomaly detection judges a run against. It
 * rides in the same baseline list (and `selectedTestRun` state) as the runs under the
 * `CONTROL_GROUP_BASELINE` sentinel, which is not a run id — so every path that would treat
 * it as one (the statistics pairing, the graph fetch, the plot's baseline line, the captions)
 * is pinned here.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, renderHook, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/lib/url-perf-panels', () => ({
  ...jest.requireActual('@/lib/url-perf-panels'),
  fetchUrlMetricStatistics: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/lib/aggregated-perf-series', () => ({
  ...jest.requireActual('@/lib/aggregated-perf-series'),
  fetchAggregatedStatistics: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/lib/dynatrace', () => ({ fetchDynatraceDashboards: jest.fn().mockResolvedValue([]) }));

const plotProps: Array<Record<string, unknown>> = [];
jest.mock('@/components/ResponsivePlot', () => ({
  __esModule: true,
  default: function MockResponsivePlot(props: Record<string, unknown>) {
    plotProps.push(props);
    return <div data-testid="responsive-plot" />;
  },
}));
// The series cascade fetches on its own; it is not what these tests are about.
jest.mock('@/components/charts', () => ({
  ...jest.requireActual('@/components/charts'),
  SeriesCascadePanel: () => <div data-testid="series-cascade" />,
}));

import { authenticatedFetch } from '@/lib/api';
import { fetchUrlMetricStatistics } from '@/lib/url-perf-panels';
import { fetchAggregatedStatistics } from '@/lib/aggregated-perf-series';
import { CONTROL_GROUP_BASELINE, fetchControlGroupStatistics, type ControlGroup } from '@/lib/control-group-baseline';
import { useCompareData } from '@/app/test-runs/[id]/components/compare/hooks/useCompareData';
import { useCompareHandlers } from '@/app/test-runs/[id]/components/compare/hooks/useCompareHandlers';
import { CompareSelectionPanel } from '@/app/test-runs/[id]/components/compare/components/CompareSelectionPanel';
import ComparisonPlot from '@/app/test-runs/[id]/components/compare/components/ComparisonPlot';
import {
  baselineDisplayName,
  controlGroupOption,
  getTestRunDisplayText,
} from '@/app/test-runs/[id]/components/compare/utils/compare-utils';

const DASH = '3f8b1c7e-2a4d-4e6f-9b1a-7c2d5e8f0a13';

const group: ControlGroup = {
  control_group_id: 'run-7',
  test_runs: ['run-2', 'run-3', 'run-4'],
  n_test_runs: 3,
  first_datetime: '2026-11-01T10:00:00.000Z',
  last_datetime: '2026-11-04T10:00:00.000Z',
};

const testRun = {
  test_run_id: 'run-7',
  system_under_test_id: 'sut-1',
  test_environment: 'acc',
  workload: 'load',
  systems_under_test: { name: 'sut' },
} as never;

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

/** Routes the hook's requests by path, so the order they are issued in does not matter. */
function routeFetch(routes: { controlGroup?: ControlGroup | null; runStats?: unknown[]; controlStats?: unknown[] }) {
  (authenticatedFetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url.startsWith('/metrics/control-group/')) return ok(routes.controlGroup ?? null);
    if (url.startsWith('/metrics/control-group-statistics/')) return ok(routes.controlStats ?? []);
    if (url.startsWith('/metrics/ds-metric-statistics')) return ok(routes.runStats ?? []);
    if (url.includes('/related')) return ok([{ test_run_id: 'run-6', created_at: '2026-11-06T10:00:00Z', completed: true }]);
    return ok([]);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps implementations, so a case that set one would leak it into the next.
  (fetchAggregatedStatistics as jest.Mock).mockResolvedValue([]);
  (fetchUrlMetricStatistics as jest.Mock).mockResolvedValue([]);
  plotProps.length = 0;
});

describe('useCompareData — control group', () => {
  it('offers the run\'s control group first, then the runs', async () => {
    routeFetch({ controlGroup: group });

    const { result } = renderHook(() => useCompareData({ testRun, testRunId: 'run-7', compareExpanded: true }));

    await waitFor(() => expect(result.current.controlGroup).toEqual(group));
    await waitFor(() => expect(result.current.relatedTestRuns).toHaveLength(1));
    expect(result.current.baselineOptions.map((o) => o.test_run_id)).toEqual([CONTROL_GROUP_BASELINE, 'run-6']);
    expect(authenticatedFetch).toHaveBeenCalledWith('/metrics/control-group/run-7');
  });

  it('offers only the runs when the run has no control group', async () => {
    routeFetch({ controlGroup: null });

    const { result } = renderHook(() => useCompareData({ testRun, testRunId: 'run-7', compareExpanded: true }));

    await waitFor(() => expect(result.current.relatedTestRuns).toHaveLength(1));
    await waitFor(() =>
      expect((authenticatedFetch as jest.Mock).mock.calls.some(([u]) => u.startsWith('/metrics/control-group/'))).toBe(true));
    expect(result.current.controlGroup).toBeNull();
    expect(result.current.baselineOptions.map((o) => o.test_run_id)).toEqual(['run-6']);
  });

  it('compares the current run against the control group\'s pooled statistics', async () => {
    routeFetch({
      controlGroup: group,
      runStats: [
        { test_run_id: 'run-7', metric_name: 'api', panel_title: 'CPU', statistics: { avg: 75, q90: 90, q95: 95, q99: 99 } },
        // Another run of the workload, which the endpoint also returns: must not be the baseline.
        { test_run_id: 'run-6', metric_name: 'api', panel_title: 'CPU', statistics: { avg: 1, q90: 1, q95: 1, q99: 1 } },
      ],
      controlStats: [
        { control_group_id: 'run-7', application_dashboard_id: DASH, panel_id: 4, panel_title: 'CPU', metric_name: 'api',
          unit: 'percent', metrics_source_id: null, statistics: { avg: 50, q90: 60, q95: 70, q99: 80 } },
      ],
    });
    (fetchAggregatedStatistics as jest.Mock).mockResolvedValue([
      { testRunId: 'run-7', value: 100, values: { avg: 100, p90: 200, p95: 300, p99: 400 } },
    ]);

    const { result } = renderHook(() => useCompareData({ testRun, testRunId: 'run-7', compareExpanded: true }));
    await waitFor(() => expect(result.current.controlGroup).toEqual(group));

    await act(async () => {
      result.current.setSelectedTestRun(controlGroupOption(group));
      result.current.setAddedSeries([
        { id: 's1', dashboardId: DASH, dashboardLabel: 'Kubernetes', panelId: 4, panelTitle: 'CPU',
          metricName: 'api', source: 'grafana', yAxesFormat: 'percent' },
        { id: 's2', dashboardId: 'perf', dashboardLabel: 'Perf', panelId: 201, panelTitle: 'Request RT',
          metricName: 'All aggregated — Request RT', source: 'performance-metrics', isAggregated: true },
        { id: 's3', dashboardId: 'perf', dashboardLabel: 'Perf', panelId: 210, panelTitle: 'URL RT',
          metricName: '/api/login', source: 'performance-metrics' },
      ] as never);
    });
    await waitFor(() => expect(result.current.metricsLoading).toBe(false));
    await waitFor(() => expect(result.current.metricComparisons.length).toBeGreaterThan(0));

    const cpu = result.current.metricComparisons.filter((c) => c.metric_name === 'api');
    expect(cpu.map((c) => [c.evaluate_type, c.current_value, c.selected_value])).toEqual([
      ['avg', 75, 50], ['q90', 90, 60], ['q95', 95, 70], ['q99', 99, 80],
    ]);
    expect(cpu[0]!.percentage_difference).toBe(50);
    expect(authenticatedFetch).toHaveBeenCalledWith(
      `/metrics/control-group-statistics/run-7?panelId=4&applicationDashboardId=${DASH}`,
    );

    // Neither the aggregate nor the URL panels have pooled control rows: current only.
    expect((fetchAggregatedStatistics as jest.Mock).mock.calls[0]![1]).toEqual(['run-7']);
    expect((fetchUrlMetricStatistics as jest.Mock).mock.calls[0]![1]).toEqual(['run-7']);
    const agg = result.current.metricComparisons.filter((c) => c.metric_name.startsWith('All aggregated'));
    expect(agg.length).toBeGreaterThan(0);
    expect(agg.every((c) => c.selected_value === null && c.percentage_difference === null)).toBe(true);
  });

  const cpuSeries = [{ id: 's1', dashboardId: DASH, dashboardLabel: 'Kubernetes', panelId: 4, panelTitle: 'CPU',
    metricName: 'api', source: 'grafana', yAxesFormat: 'percent' }] as never;
  const run6 = { test_run_id: 'run-6', created_at: '2026-11-06T10:00:00Z', completed: true } as never;

  it('collapses an open graph when the baseline changes, rather than drawing it under the new one', async () => {
    routeFetch({ controlGroup: group });
    const { result } = renderHook(() => useCompareData({ testRun, testRunId: 'run-7', compareExpanded: true }));
    await waitFor(() => expect(result.current.controlGroup).toEqual(group));

    await act(async () => {
      result.current.setSelectedTestRun(controlGroupOption(group));
      result.current.setAddedSeries(cpuSeries);
    });
    await act(async () => {
      result.current.setShowGraphs({ g: true });
      result.current.setGraphData({ g: { currentMetrics: [], baselineMetrics: [], baselineTestRunId: null } as never });
    });
    expect(result.current.showGraphs).toEqual({ g: true });

    await act(async () => { result.current.setSelectedTestRun(run6); });

    expect(result.current.showGraphs).toEqual({});
    expect(result.current.graphData).toEqual({});
  });

  it('keeps the latest baseline when an earlier request answers last', async () => {
    let releaseControl!: (rows: unknown[]) => void;
    const heldControl = new Promise<unknown[]>((resolve) => { releaseControl = resolve; });
    (authenticatedFetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.startsWith('/metrics/control-group/')) return ok(group);
      if (url.startsWith('/metrics/control-group-statistics/')) return ok(await heldControl);
      if (url.startsWith('/metrics/ds-metric-statistics')) {
        return ok([
          { test_run_id: 'run-7', metric_name: 'api', panel_title: 'CPU', statistics: { avg: 75, q90: 90, q95: 95, q99: 99 } },
          { test_run_id: 'run-6', metric_name: 'api', panel_title: 'CPU', statistics: { avg: 60, q90: 60, q95: 60, q99: 60 } },
        ]);
      }
      return ok([]);
    });
    const { result } = renderHook(() => useCompareData({ testRun, testRunId: 'run-7', compareExpanded: true }));
    await waitFor(() => expect(result.current.controlGroup).toEqual(group));

    // The control-group request goes out and is held...
    await act(async () => {
      result.current.setSelectedTestRun(controlGroupOption(group));
      result.current.setAddedSeries(cpuSeries);
    });
    // ...the user picks run-6, whose request answers first...
    await act(async () => { result.current.setSelectedTestRun(run6); });
    await waitFor(() => expect(result.current.metricComparisons.find((c) => c.evaluate_type === 'avg')?.selected_value).toBe(60));
    // ...and the control group's late answer must not overwrite it.
    await act(async () => {
      releaseControl([{ control_group_id: 'run-7', application_dashboard_id: DASH, panel_id: 4, panel_title: 'CPU',
        metric_name: 'api', unit: 'percent', metrics_source_id: null, statistics: { avg: 50, q90: 50, q95: 50, q99: 50 } }]);
      await heldControl;
    });

    expect(result.current.metricComparisons.find((c) => c.evaluate_type === 'avg')?.selected_value).toBe(60);
    expect(result.current.metricsLoading).toBe(false);
  });

  /**
   * Value: protects=removing the last series empties the table and ends loading even with a request still out;
   * fails_when=the empty-selection arm stops bumping the request counter or clearing metricsLoading;
   * why_new=the stale-request case swaps baselines, it never takes the empty-selection arm; seam=none;
   * no_claim=what the table renders; this reads the hook's state only.
   */
  it('stays empty when the series are cleared while a control-group request is out', async () => {
    let releaseControl!: (rows: unknown[]) => void;
    const heldControl = new Promise<unknown[]>((resolve) => { releaseControl = resolve; });
    (authenticatedFetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.startsWith('/metrics/control-group/')) return ok(group);
      if (url.startsWith('/metrics/control-group-statistics/')) return ok(await heldControl);
      if (url.startsWith('/metrics/ds-metric-statistics')) {
        return ok([{ test_run_id: 'run-7', metric_name: 'api', panel_title: 'CPU', statistics: { avg: 75, q90: 90, q95: 95, q99: 99 } }]);
      }
      return ok([]);
    });
    const { result } = renderHook(() => useCompareData({ testRun, testRunId: 'run-7', compareExpanded: true }));
    await waitFor(() => expect(result.current.controlGroup).toEqual(group));

    await act(async () => {
      result.current.setSelectedTestRun(controlGroupOption(group));
      result.current.setAddedSeries(cpuSeries);
    });
    await waitFor(() => expect(result.current.metricsLoading).toBe(true));

    // The user removes the series while the group's statistics are still on their way...
    await act(async () => { result.current.setAddedSeries([]); });
    // ...and the late answer must not bring the removed series back.
    await act(async () => {
      releaseControl([{ control_group_id: 'run-7', application_dashboard_id: DASH, panel_id: 4, panel_title: 'CPU',
        metric_name: 'api', unit: 'percent', metrics_source_id: null, statistics: { avg: 50, q90: 50, q95: 50, q99: 50 } }]);
      await heldControl;
    });
    // Let the released request run to its end (its remaining awaits are microtasks) before
    // asserting, so a write it should not make has had every chance to land.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(result.current.metricComparisons).toEqual([]);
    expect(result.current.currentMetrics).toEqual([]);
    expect(result.current.metricsLoading).toBe(false);
  });
});

describe('useCompareHandlers — control group graph', () => {
  it('asks for the current run alone, since a control group has no series of its own', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue(ok({ currentMetrics: [], baselineMetrics: [], baselineTestRunId: null }));
    const setGraphData = jest.fn();
    const { result } = renderHook(() => useCompareHandlers({
      testRun,
      testRunId: 'run-7',
      showToast: jest.fn(),
      addedSeries: [],
      selectedTestRun: controlGroupOption(group),
      showGraphs: {},
      setAddedSeries: jest.fn(),
      setMetricComparisons: jest.fn(),
      setCurrentMetrics: jest.fn(),
      setSelectedMetrics: jest.fn(),
      setShowGraphs: jest.fn(),
      setGraphData,
      setGraphLoading: jest.fn(),
    }));

    await act(async () => { await result.current.fetchGraphData({ dashboardId: DASH, panelId: 4, metricName: 'api' }); });

    const url = (authenticatedFetch as jest.Mock).mock.calls[0]![0] as string;
    expect(url).toContain('/metrics/ds-metrics-comparison?');
    expect(url).toContain('currentTestRunId=run-7');
    expect(url).not.toContain('baselineTestRunId');
    expect(url).not.toContain(CONTROL_GROUP_BASELINE);
  });

  /**
   * Value: protects=a run baseline's graph still fetches that run's series beside the current run;
   * fails_when=the control-group branch drops baselineTestRunId for every baseline, so run-vs-run graphs lose their dashed line;
   * why_new=the case above only asserts the parameter's absence, which an always-omit regression also satisfies; seam=none;
   * no_claim=how ComparisonPlot draws the returned series.
   */
  it('still names a run baseline, whose graph has a series of its own', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue(ok({ currentMetrics: [], baselineMetrics: [], baselineTestRunId: 'run-6' }));
    const { result } = renderHook(() => useCompareHandlers({
      testRun,
      testRunId: 'run-7',
      showToast: jest.fn(),
      addedSeries: [],
      selectedTestRun: { test_run_id: 'run-6', created_at: '2026-11-06T10:00:00Z', completed: true },
      showGraphs: {},
      setAddedSeries: jest.fn(),
      setMetricComparisons: jest.fn(),
      setCurrentMetrics: jest.fn(),
      setSelectedMetrics: jest.fn(),
      setShowGraphs: jest.fn(),
      setGraphData: jest.fn(),
      setGraphLoading: jest.fn(),
    }));

    await act(async () => { await result.current.fetchGraphData({ dashboardId: DASH, panelId: 4, metricName: 'api' }); });

    const url = (authenticatedFetch as jest.Mock).mock.calls[0]![0] as string;
    expect(new URLSearchParams(url.split('?')[1]).get('baselineTestRunId')).toBe('run-6');
    expect(new URLSearchParams(url.split('?')[1]).get('currentTestRunId')).toBe('run-7');
  });

  // Value: protects=a graph answer that lands after the baseline changed neither writes its data nor reopens the row; fails_when=toggleGraph opens unconditionally after its await; why_new=the collapse case covers graphs already open, not one in flight; seam=none; no_claim=what the reopened plot would draw.
  it('drops a graph answer that lands after the baseline changed, instead of reopening the row', async () => {
    let release!: (v: unknown) => void;
    (authenticatedFetch as jest.Mock).mockReturnValue(new Promise((r) => { release = r; }));
    const setShowGraphs = jest.fn();
    const setGraphData = jest.fn();
    const props = (selectedTestRun: unknown) => ({
      testRun, testRunId: 'run-7', showToast: jest.fn(), addedSeries: [], selectedTestRun, showGraphs: {},
      setAddedSeries: jest.fn(), setMetricComparisons: jest.fn(), setCurrentMetrics: jest.fn(),
      setSelectedMetrics: jest.fn(), setShowGraphs, setGraphData, setGraphLoading: jest.fn(),
    }) as never;
    const { result, rerender } = renderHook((p) => useCompareHandlers(p), { initialProps: props(controlGroupOption(group)) });

    let opening!: Promise<void>;
    act(() => { opening = result.current.toggleGraph({ dashboardId: DASH, panelId: 4, metricName: 'api' }); });
    rerender(props({ test_run_id: 'run-6', created_at: '2026-11-06T10:00:00Z', completed: true }));
    await act(async () => { release(ok({ currentMetrics: [], baselineMetrics: [], baselineTestRunId: null })); await opening; });

    expect(setGraphData).not.toHaveBeenCalled();
    expect(setShowGraphs).not.toHaveBeenCalled();
  });
});

describe('CompareSelectionPanel — control group option', () => {
  const runs = [{ test_run_id: 'run-6', created_at: '2026-11-06T10:00:00Z', completed: true }];

  it('lists the control group first, explained, and captions the selection with its runs', () => {
    const onSelect = jest.fn();
    const { rerender } = render(
      <CompareSelectionPanel
        relatedTestRuns={runs}
        controlGroup={group}
        selectedTestRun={null}
        onTestRunSelect={onSelect}
        allDashboards={[]}
        dashboardsLoading={false}
        testRun={testRun}
        addedSeries={[]}
        onAddSeries={jest.fn()}
        onRemoveSeries={jest.fn()}
        onPrimaryChange={jest.fn()}
      />,
    );

    expect(screen.getByText('1 comparable run, or the control group')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByLabelText('Select Test Run for Comparison'));
    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options[0]).toHaveTextContent('Control group');
    expect(options[0]).toHaveTextContent('Pooled statistics of the 3 runs anomaly detection compares this run with');
    expect(options[0]).toHaveTextContent('Runs: run-2, run-3, run-4');
    expect(options[1]).toHaveTextContent('run-6');

    fireEvent.click(options[0]!);
    expect(onSelect.mock.calls[0]![0].test_run_id).toBe(CONTROL_GROUP_BASELINE);

    rerender(
      <CompareSelectionPanel
        relatedTestRuns={runs}
        controlGroup={group}
        selectedTestRun={controlGroupOption(group)}
        onTestRunSelect={onSelect}
        allDashboards={[]}
        dashboardsLoading={false}
        testRun={testRun}
        addedSeries={[]}
        onAddSeries={jest.fn()}
        onRemoveSeries={jest.fn()}
        onPrimaryChange={jest.fn()}
      />,
    );
    expect(screen.getByDisplayValue('Control group (3 runs)')).toBeInTheDocument();
    // The caption joins with doubled spaces, which the default matcher would collapse.
    expect(
      screen.getByText('Baseline: control group  ·  3 runs  ·  run-2, run-3, run-4', { normalizer: (t) => t }),
    ).toBeInTheDocument();
  });

  it('offers no control group option when the run has none', () => {
    render(
      <CompareSelectionPanel
        relatedTestRuns={runs}
        controlGroup={null}
        selectedTestRun={null}
        onTestRunSelect={jest.fn()}
        allDashboards={[]}
        dashboardsLoading={false}
        testRun={testRun}
        addedSeries={[]}
        onAddSeries={jest.fn()}
        onRemoveSeries={jest.fn()}
        onPrimaryChange={jest.fn()}
      />,
    );

    expect(screen.getByText('1 comparable run')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByLabelText('Select Test Run for Comparison'));
    expect(within(screen.getByRole('listbox')).queryByText('Control group')).not.toBeInTheDocument();
  });
});

describe('ComparisonPlot — control group baseline', () => {
  const current = [0, 1, 2].map((i) => ({ time: `2026-11-07T10:0${i}:00Z`, value: 70 + i }));

  it('draws the group\'s pooled mean as a flat dashed line across the current run', () => {
    render(
      <ComparisonPlot
        metricName="api"
        graphData={{ currentMetrics: current, baselineMetrics: [], currentTestRunId: 'run-7', baselineTestRunId: null } as never}
        graphLoading={false}
        selectedMetric={null}
        panelUnit="percent"
        testRun={null}
        relatedTestRuns={[]}
        showToast={jest.fn()}
        controlGroup={{ mean: 50, runCount: 3 }}
      />,
    );

    const traces = plotProps[plotProps.length - 1]!.data as Array<{ name: string; y: number[]; line: { dash?: string } }>;
    expect(traces.map((t) => t.name)).toEqual(['Control group mean (3 runs)', 'Current (run-7)']);
    expect(traces[0]!.y).toEqual([50, 50, 50]);
    expect(traces[0]!.line.dash).toBeDefined();
    expect(screen.getByText('Control group · mean of 3 runs')).toBeInTheDocument();
  });

  it('draws the current run alone when the group has no mean for the series', () => {
    render(
      <ComparisonPlot
        metricName="api"
        graphData={{ currentMetrics: current, baselineMetrics: [], currentTestRunId: 'run-7', baselineTestRunId: null } as never}
        graphLoading={false}
        selectedMetric={null}
        panelUnit="percent"
        testRun={null}
        relatedTestRuns={[]}
        showToast={jest.fn()}
        controlGroup={{ mean: null, runCount: 3 }}
      />,
    );

    const traces = plotProps[plotProps.length - 1]!.data as Array<{ y: number[] }>;
    expect(traces[0]!.y).toEqual([]);
  });
});

describe('fetchControlGroupStatistics — scope', () => {
  // Value: protects=the control rows are narrowed to the series' own dashboard as well as its source; fails_when=the source alone is sent again, mixing two dashboards that share one; why_new=the hook case sends a dashboard id only; seam=none; no_claim=the server's AND of the two filters (control-group-baseline.spec.ts).
  it('sends the dashboard with the source, and drops a dashboard id that is not a uuid', async () => {
    (authenticatedFetch as jest.Mock).mockResolvedValue(ok([]));

    await fetchControlGroupStatistics('run-7', { applicationDashboardId: DASH, metricsSourceId: 'src-1', panelId: 4 });
    await fetchControlGroupStatistics('run-7', { applicationDashboardId: 'dynatrace-0', metricsSourceId: 'src-1', panelId: 4 });

    const [both, synthetic] = (authenticatedFetch as jest.Mock).mock.calls.map(([u]) => new URL(u, 'http://x').searchParams);
    expect(both!.get('metricsSourceId')).toBe('src-1');
    expect(both!.get('applicationDashboardId')).toBe(DASH);
    expect(synthetic!.get('metricsSourceId')).toBe('src-1');
    expect(synthetic!.has('applicationDashboardId')).toBe(false);
  });
});

describe('compare-utils — control group option', () => {
  it('names the option and the baseline by what they are, never by the sentinel', () => {
    const option = controlGroupOption(group);
    expect(getTestRunDisplayText(option)).toBe('Control group (3 runs)');
    expect(baselineDisplayName(option)).toBe('control group (3 runs)');
    expect(baselineDisplayName({ test_run_id: 'run-6', created_at: '', completed: true })).toBe('run-6');
  });
});
