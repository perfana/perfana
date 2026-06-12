/**
 * Regression tests for AnomalyExpandedContent — Current Test Run chart guard.
 *
 * Guards against the regression introduced in #383 (v0.2.61.0), where a guard
 * (`row.source_type !== 'performance_test' || aggregatedMetricSource`) hid the
 * Current Test Run chart for every performance-test ADAPT row whose metric_name
 * does not parse into the dotted aggregate format
 * (transactions.<name>.response_time.<stat>).
 *
 * In practice that is ALL per-transaction rows: their metric_name is the plain
 * transaction name (e.g. "AV_BVAC_03_Vacatures") and the type/stat live in
 * panel_title ("Transaction RT Avg"). Those rows have ds_metrics data keyed by
 * panel_id + metric_name and must still render the chart (via the ds-metrics
 * fallback) rather than "Chart not available for this metric type".
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AnomalyExpandedContent } from '@/app/test-runs/[id]/components/anomaly-detection/components/table-components/AnomalyExpandedContent';
import { AnomalyData } from '@/app/test-runs/[id]/components/anomaly-detection/types';

// Capture the props CurrentTestRunChart is rendered with so we can assert which
// data path (aggregated vs ds-metrics fallback) each row takes.
const chartProps: Array<Record<string, unknown>> = [];
jest.mock('@/app/test-runs/[id]/components/compare/CurrentTestRunChart', () => {
  return function MockCurrentTestRunChart(props: Record<string, unknown>) {
    chartProps.push(props);
    return <div data-testid="mock-current-test-run-chart" />;
  };
});

// Heavy / browser-only children that are irrelevant to the guard under test.
jest.mock('next/dynamic', () => () => function MockPlot() {
  return <div data-testid="mock-plot" />;
});
jest.mock('@/app/test-runs/[id]/components/anomaly-detection/components/utils/trends-plot-utils', () => ({
  createTrendsPlot: () => ({ plotData: [], plotLayout: {}, plotConfig: {} }),
}));
jest.mock('@/app/test-runs/[id]/components/configuration-comparison/MetricConfigForm', () => {
  return function MockMetricConfigForm() { return <div />; };
});
jest.mock('@/app/test-runs/[id]/components/anomaly-detection/components/table-components/StatisticalDrawerContent', () => ({
  StatisticalDrawerContent: function MockStatisticalDrawerContent() { return <div />; },
}));

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

const noop = () => {};
const asyncNoop = async () => {};

function renderExpanded(row: AnomalyData) {
  return render(
    <AnomalyExpandedContent
      row={row}
      rowKey="row-1"
      isExpanded
      isLast
      testRunId="BMS-acc-loadTest-00002"
      testRun={null}
      trendsData={[]}
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
}

describe('AnomalyExpandedContent — Current Test Run chart', () => {
  beforeEach(() => {
    chartProps.length = 0;
  });

  it('renders the chart for a per-transaction performance_test row (plain metric_name)', () => {
    renderExpanded(baseRow);

    expect(screen.getByTestId('mock-current-test-run-chart')).toBeInTheDocument();
    expect(screen.queryByText('Chart not available for this metric type')).not.toBeInTheDocument();
  });

  it('uses the ds-metrics fallback (no aggregatedMetricSource) for a plain metric_name', () => {
    renderExpanded(baseRow);

    expect(chartProps).toHaveLength(1);
    expect(chartProps[0].aggregatedMetricSource).toBeUndefined();
    expect(chartProps[0].panelId).toBe('101');
    expect(chartProps[0].metricName).toBe('AV_BVAC_03_Vacatures');
  });

  it('uses the aggregated endpoint for a dotted aggregate-SLO metric_name', () => {
    renderExpanded({
      ...baseRow,
      metric_name: 'transactions.login.response_time.p95',
    });

    expect(screen.getByTestId('mock-current-test-run-chart')).toBeInTheDocument();
    expect(chartProps).toHaveLength(1);
    expect(chartProps[0].aggregatedMetricSource).toEqual({
      metric: 'transaction_response_time',
      stat: 'p95',
    });
  });

  it('renders the chart for a non-performance_test (grafana) row', () => {
    renderExpanded({ ...baseRow, source_type: 'grafana', metric_name: 'response_time' });

    expect(screen.getByTestId('mock-current-test-run-chart')).toBeInTheDocument();
    expect(chartProps[0].aggregatedMetricSource).toBeUndefined();
  });
});
