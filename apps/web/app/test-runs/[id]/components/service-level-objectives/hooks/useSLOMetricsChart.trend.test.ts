/**
 * The hook decides three things this test file pins, none of which show up in
 * the existing SLOMetricsChart.test.tsx (that suite only asserts the mocked
 * Plot div renders, never what trace shapes were built):
 *
 * 1. A single-point series is drawn as a bar UNLESS some other series on the
 *    same chart is a real time series -- otherwise Plotly's x-axis flips to
 *    CATEGORY mode and every timestamp on the other series becomes its own
 *    tick label (the unreadable-chart bug this branch fixes).
 * 2. A trend SLO is colored from the worker's per-target verdict (not from
 *    comparing values against the requirement, which is in a different unit
 *    for a trend), gets a dashed fitted-line trace per series, and never gets
 *    the requirement line (its threshold is %/h, this axis is the panel's).
 * 3. The legend is turned on for a trend chart so the fitted line's label is
 *    visible, and left off otherwise.
 */

import { renderHook, act } from '@testing-library/react';
import { createTheme } from '@mui/material/styles';
import { useSLOMetricsChart } from './useSLOMetricsChart';
import type { CheckResult } from '@/lib/types';
import type { TestRunInfo } from '../types';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));

import { authenticatedFetch } from '@/lib/api';
const mockFetch = authenticatedFetch as jest.MockedFunction<typeof authenticatedFetch>;

const THEME = createTheme();

const BASE_CHECK_RESULT = {
  id: 'cr-1',
  system_under_test_id: 'sut-1',
  test_environment: 'acc',
  workload: 'load',
  test_run_id: 'run-1',
  source: 'grafana',
  benchmark_id: 'bm-1',
  status: 'ok',
  average_all: false,
  exclude_ramp_up_time: true,
  created_at: '2026-09-22T00:00:00Z',
  panel_id: 1,
  metric_unit: '',
} as unknown as CheckResult;

const TEST_RUN: TestRunInfo = {
  start_time: '2026-09-22T05:00:00.000Z',
  end_time: '2026-09-22T06:00:00.000Z',
  analysis_start_offset: 0,
  analysis_end_offset: 0,
};

function mockMetricsData(points: Array<{ metric_name: string; time: string; value: number }>) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      test_run_id: 'run-1',
      panel_id: 1,
      panel_title: 'p',
      dashboard_label: 'd',
      data: points.map(p => ({ ...p, timestep: 0, ramp_up: false })),
    }),
  } as Response);
}

async function renderChart(checkResult: CheckResult, testRun: TestRunInfo = TEST_RUN) {
  const hook = renderHook(() =>
    useSLOMetricsChart({ testRunId: 'run-1', checkResult, testRun })
  );
  await act(async () => {});
  return hook;
}

describe('useSLOMetricsChart — bar vs line decision', () => {
  beforeEach(() => jest.clearAllMocks());

  it('draws every series as a bar when none of them is a time series', async () => {
    mockMetricsData([
      { metric_name: 'a', time: '2026-09-22T05:30:00.000Z', value: 5 },
      { metric_name: 'b', time: '2026-09-22T05:30:00.000Z', value: 7 },
    ]);

    const { result } = await renderChart({
      ...BASE_CHECK_RESULT,
      evaluate_type: 'mean',
    } as CheckResult);

    const traces = result.current.plotData as Record<string, unknown>[];
    expect(traces).toHaveLength(2);
    expect(traces.every(t => t.type === 'bar')).toBe(true);
  });

  it('draws a single-point series as a line once another series is a real time series', async () => {
    mockMetricsData([
      { metric_name: 'single', time: '2026-09-22T05:30:00.000Z', value: 5 },
      { metric_name: 'multi', time: '2026-09-22T05:00:00.000Z', value: 10 },
      { metric_name: 'multi', time: '2026-09-22T05:30:00.000Z', value: 12 },
      { metric_name: 'multi', time: '2026-09-22T06:00:00.000Z', value: 14 },
    ]);

    const { result } = await renderChart({
      ...BASE_CHECK_RESULT,
      evaluate_type: 'mean',
    } as CheckResult);

    const traces = result.current.plotData as Record<string, unknown>[];
    const singleTrace = traces.find(t => t.name === 'single');
    expect(singleTrace).toBeDefined();
    expect(singleTrace!.type).not.toBe('bar');
    expect(singleTrace!.type).toBe('scatter');
  });
});

describe('useSLOMetricsChart — trend SLO', () => {
  beforeEach(() => jest.clearAllMocks());

  it('colors a series from the worker verdict, adds a dashed fit line, and drops the requirement line', async () => {
    mockMetricsData([
      { metric_name: 'm1', time: '2026-09-22T05:00:00.000Z', value: 100 },
      { metric_name: 'm1', time: '2026-09-22T05:30:00.000Z', value: 120 },
      { metric_name: 'm1', time: '2026-09-22T06:00:00.000Z', value: 140 },
    ]);

    const checkResult = {
      ...BASE_CHECK_RESULT,
      evaluate_type: 'trend',
      requirement: { value: 10 },
      targets: [{ target: 'm1', value: 12.5, meets_requirement: false }],
    } as CheckResult;

    const { result } = await renderChart(checkResult);

    const traces = result.current.plotData as Record<string, unknown>[];
    // No SLO requirement line: a trend's threshold is %/h, a different unit
    // from this axis.
    expect(traces.some(t => String(t.name).startsWith('SLO:'))).toBe(false);

    const lineTrace = traces.find(t => t.name === 'm1')!;
    expect((lineTrace.line as { color: string }).color).toBe(THEME.palette.error.main);

    // The fit line names its series: the chart title is the panel, and the
    // data line carries showlegend:false.
    const fitTrace = traces.find(t => String(t.name).includes('%/h'));
    expect(fitTrace).toBeDefined();
    expect(fitTrace!.name).toBe('m1 · +12.5 %/h');
    expect((fitTrace!.line as { dash: string }).dash).toBe('dash');

    expect((result.current.plotLayout as { showlegend: boolean }).showlegend).toBe(true);
  });

  it('uses the metric color, not the error color, when the target passed', async () => {
    mockMetricsData([
      { metric_name: 'm1', time: '2026-09-22T05:00:00.000Z', value: 100 },
      { metric_name: 'm1', time: '2026-09-22T05:30:00.000Z', value: 105 },
    ]);

    const checkResult = {
      ...BASE_CHECK_RESULT,
      evaluate_type: 'trend',
      targets: [{ target: 'm1', value: 1.2, meets_requirement: true }],
    } as CheckResult;

    const { result } = await renderChart(checkResult);
    const traces = result.current.plotData as Record<string, unknown>[];
    const lineTrace = traces.find(t => t.name === 'm1')!;
    expect((lineTrace.line as { color: string }).color).not.toBe(THEME.palette.error.main);
  });

  it('adds no fit line when the series has no matching target', async () => {
    mockMetricsData([
      { metric_name: 'orphan', time: '2026-09-22T05:00:00.000Z', value: 100 },
      { metric_name: 'orphan', time: '2026-09-22T05:30:00.000Z', value: 105 },
    ]);

    const checkResult = {
      ...BASE_CHECK_RESULT,
      evaluate_type: 'trend',
      targets: [{ target: 'other-metric', value: 5, meets_requirement: true }],
    } as CheckResult;

    const { result } = await renderChart(checkResult);
    const traces = result.current.plotData as Record<string, unknown>[];
    expect(traces).toHaveLength(1);
    expect(traces.some(t => String(t.name).includes('%/h'))).toBe(false);
  });

  it('turns the legend off for a non-trend chart', async () => {
    mockMetricsData([
      { metric_name: 'm1', time: '2026-09-22T05:00:00.000Z', value: 100 },
      { metric_name: 'm1', time: '2026-09-22T05:30:00.000Z', value: 105 },
    ]);

    const checkResult = {
      ...BASE_CHECK_RESULT,
      evaluate_type: 'mean',
      requirement: { value: 200 },
    } as CheckResult;

    const { result } = await renderChart(checkResult);
    expect((result.current.plotLayout as { showlegend: boolean }).showlegend).toBe(false);
    const traces = result.current.plotData as Record<string, unknown>[];
    expect(traces.some(t => String(t.name).startsWith('SLO:'))).toBe(true);
  });
});

describe('useSLOMetricsChart — selected target that matches no series', () => {
  beforeEach(() => jest.clearAllMocks());

  it('falls back to every series rather than rendering a blank chart', async () => {
    // The artificial validate_with_default_if_no_data target is judged but no
    // dashboard produced it, so it matches zero ds_metrics points. hasData is
    // computed from the raw fetch, so without the fallback the component
    // renders a title over an empty box instead of the empty state.
    mockMetricsData([
      { metric_name: 'real-a', time: '2026-09-22T05:00:00.000Z', value: 10 },
      { metric_name: 'real-a', time: '2026-09-22T05:30:00.000Z', value: 12 },
      { metric_name: 'real-b', time: '2026-09-22T05:00:00.000Z', value: 20 },
      { metric_name: 'real-b', time: '2026-09-22T05:30:00.000Z', value: 22 },
    ]);

    const hook = renderHook(() =>
      useSLOMetricsChart({
        testRunId: 'run-1',
        checkResult: { ...BASE_CHECK_RESULT, evaluate_type: 'mean' } as CheckResult,
        testRun: TEST_RUN,
        targetName: 'a-series-that-does-not-exist',
      })
    );
    await act(async () => {});

    expect(hook.result.current.hasData).toBe(true);
    const traces = hook.result.current.plotData as Record<string, unknown>[];
    expect(traces.length).toBeGreaterThan(0);
    expect(traces.map(t => t.name)).toEqual(expect.arrayContaining(['real-a', 'real-b']));
  });

  it('still honours a target that does match', async () => {
    mockMetricsData([
      { metric_name: 'real-a', time: '2026-09-22T05:00:00.000Z', value: 10 },
      { metric_name: 'real-a', time: '2026-09-22T05:30:00.000Z', value: 12 },
      { metric_name: 'real-b', time: '2026-09-22T05:00:00.000Z', value: 20 },
      { metric_name: 'real-b', time: '2026-09-22T05:30:00.000Z', value: 22 },
    ]);

    const hook = renderHook(() =>
      useSLOMetricsChart({
        testRunId: 'run-1',
        checkResult: { ...BASE_CHECK_RESULT, evaluate_type: 'mean' } as CheckResult,
        testRun: TEST_RUN,
        targetName: 'real-b',
      })
    );
    await act(async () => {});

    const traces = hook.result.current.plotData as Record<string, unknown>[];
    expect(traces.map(t => t.name)).toContain('real-b');
    expect(traces.map(t => t.name)).not.toContain('real-a');
  });
});
