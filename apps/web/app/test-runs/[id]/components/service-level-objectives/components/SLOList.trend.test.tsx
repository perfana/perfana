/**
 * SLOList wires `defaultTrendTarget` into both the chart and the table below
 * it (see the `shownTarget` / `effectiveSelectedTarget` block added to the
 * row map). This pins that wiring: with nothing explicitly selected yet, a
 * trend SLO's chart opens on the default target and the table marks the same
 * row selected -- and once the user picks a target explicitly, that choice
 * wins over the default.
 *
 * SLOMetricsChart and MetricSeriesTable are mocked to capture the props they
 * receive rather than exercising their own rendering (both are covered by
 * their own test suites).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SLOList } from './SLOList';
import type { CheckResult } from '@/lib/types';

jest.mock('../SLOMetricsChart', () => ({
  __esModule: true,
  default: (props: { targetName?: string }) => (
    <div data-testid="metrics-chart" data-target-name={props.targetName ?? ''} />
  ),
}));

let lastOnSelectTarget: ((key: string, targetName: string | undefined) => void) | undefined;

jest.mock('./MetricSeriesTable', () => ({
  __esModule: true,
  default: (props: {
    resultKey: string;
    selectedTarget: Map<string, string>;
    onSelectTarget: (key: string, targetName: string | undefined) => void;
  }) => {
    lastOnSelectTarget = props.onSelectTarget;
    return (
      <div
        data-testid="metric-series-table"
        data-selected-target={props.selectedTarget.get(props.resultKey) ?? ''}
      />
    );
  },
}));

const TREND_RESULT = {
  id: 'cr-trend',
  system_under_test_id: 'sut-1',
  test_environment: 'acc',
  workload: 'load',
  test_run_id: 'run-1',
  source: 'grafana',
  benchmark_id: 'bm-1',
  status: 'ok',
  average_all: false,
  evaluate_type: 'trend',
  exclude_ramp_up_time: true,
  created_at: '2026-09-22T00:00:00Z',
  dashboard_label: 'dash',
  panel_title: 'RT Avg',
  metric_unit: '%/h',
  targets: [
    { target: 'passing', value: -3, meets_requirement: true },
    { target: 'failing', value: 8, meets_requirement: false },
  ],
} as unknown as CheckResult;

function baseProps(overrides: Partial<React.ComponentProps<typeof SLOList>> = {}) {
  return {
    testRun: null,
    testRunId: 'run-1',
    checkResults: [TREND_RESULT],
    benchmarks: [],
    expandedSloRows: new Set(['cr-trend']),
    sloFilter: 'all' as const,
    searchText: '',
    sortConfig: new Map(),
    selectedTarget: new Map<string, string>(),
    setSelectedTarget: jest.fn(),
    expandedTransactions: new Set<string>(),
    transactionSamples: {},
    loadingTransactionSamples: {},
    transactionSamplesError: {},
    toggleSloRow: jest.fn(),
    handleSort: jest.fn(),
    setSloFilter: jest.fn(),
    setIsFilterManuallySet: jest.fn(),
    setSearchText: jest.fn(),
    toggleTransactionExpanded: jest.fn(),
    handleOpenRequestActionMenu: jest.fn(),
    handleOpenApdexActionMenu: jest.fn(),
    handleEditSlo: jest.fn(),
    handleReEvaluate: jest.fn(),
    handleOpenApdexThresholdsDialog: jest.fn(),
    getCheckResultKey: (result: CheckResult) => result.id,
    ...overrides,
  };
}

describe('SLOList — trend default target wiring', () => {
  it('opens the chart on the default target and marks the same row selected when nothing was picked', () => {
    render(<SLOList {...baseProps()} />);

    // defaultTrendTarget prefers the failing series over the passing one.
    expect(screen.getByTestId('metrics-chart')).toHaveAttribute('data-target-name', 'failing');
    expect(screen.getByTestId('metric-series-table')).toHaveAttribute(
      'data-selected-target',
      'failing'
    );
  });

  it('honors an explicit selection over the default', () => {
    render(
      <SLOList
        {...baseProps({ selectedTarget: new Map([['cr-trend', 'passing']]) })}
      />
    );

    expect(screen.getByTestId('metrics-chart')).toHaveAttribute('data-target-name', 'passing');
    expect(screen.getByTestId('metric-series-table')).toHaveAttribute(
      'data-selected-target',
      'passing'
    );
  });

  it('leaves a non-trend SLO showing every series until one is clicked', () => {
    const meanResult = { ...TREND_RESULT, evaluate_type: 'mean' } as CheckResult;
    render(<SLOList {...baseProps({ checkResults: [meanResult] })} />);

    expect(screen.getByTestId('metrics-chart')).toHaveAttribute('data-target-name', '');
    expect(screen.getByTestId('metric-series-table')).toHaveAttribute(
      'data-selected-target',
      ''
    );
  });

  it('shows every series once the user clears the auto-picked default', () => {
    // The cleared state is recorded as '' rather than by deleting the key: a
    // deleted key reads as "never touched", and the default would come straight
    // back, so the toggle-off click would be a no-op.
    render(
      <SLOList
        {...baseProps({ selectedTarget: new Map([['cr-trend', '']]) })}
      />
    );

    expect(screen.getByTestId('metrics-chart')).toHaveAttribute('data-target-name', '');
    expect(screen.getByTestId('metric-series-table')).toHaveAttribute(
      'data-selected-target',
      ''
    );
  });

  it('records a clear as \'\' rather than deleting the key', () => {
    // The write side of the toggle. Deleting the key reads as "never touched",
    // so a trend row would snap back to its auto-picked default and the click
    // would be a no-op -- which is exactly what this branch fixed.
    const setSelectedTarget = jest.fn();
    render(<SLOList {...baseProps({ setSelectedTarget })} />);

    lastOnSelectTarget!('cr-trend', undefined);

    expect(setSelectedTarget).toHaveBeenCalledTimes(1);
    const updater = setSelectedTarget.mock.calls[0][0] as (
      prev: Map<string, string>
    ) => Map<string, string>;
    const next = updater(new Map());
    expect(next.has('cr-trend')).toBe(true);
    expect(next.get('cr-trend')).toBe('');
  });

  it('records an explicit pick as the target name', () => {
    const setSelectedTarget = jest.fn();
    render(<SLOList {...baseProps({ setSelectedTarget })} />);

    lastOnSelectTarget!('cr-trend', 'passing');

    const updater = setSelectedTarget.mock.calls[0][0] as (
      prev: Map<string, string>
    ) => Map<string, string>;
    expect(updater(new Map()).get('cr-trend')).toBe('passing');
  });
});
