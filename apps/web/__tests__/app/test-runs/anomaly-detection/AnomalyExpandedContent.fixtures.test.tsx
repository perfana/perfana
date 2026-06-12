/**
 * Fixture-driven guardrail for the Current Test Run chart in AnomalyExpandedContent.
 *
 * Drives the component with REAL metric_name / panel_title / source_type tuples
 * pulled from `ds_adapt_results` (see fixtures/adapt-metric-names.ts) plus the
 * dotted aggregate-SLO format. The contract every row must satisfy:
 *
 *   1. a chart renders (never "Chart not available for this metric type"); and
 *   2. it takes the correct data path — ds-metrics fallback for per-transaction
 *      rows (aggregatedMetricSource undefined) vs. the aggregated endpoint for
 *      aggregate-SLO rows (aggregatedMetricSource resolved).
 *
 * This is the guardrail the #383 regression lacked: the earlier suite unit-tested
 * the parser and the hook in isolation with synthetic inputs, but never rendered
 * the component with the metric names production actually produces.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AnomalyExpandedContent } from '@/app/test-runs/[id]/components/anomaly-detection/components/table-components/AnomalyExpandedContent';
import { AnomalyData } from '@/app/test-runs/[id]/components/anomaly-detection/types';
import { ADAPT_METRIC_NAME_FIXTURES } from './fixtures/adapt-metric-names';

let lastChartProps: Record<string, unknown> | undefined;
jest.mock('@/app/test-runs/[id]/components/compare/CurrentTestRunChart', () => {
  return function MockCurrentTestRunChart(props: Record<string, unknown>) {
    lastChartProps = props;
    return <div data-testid="mock-current-test-run-chart" />;
  };
});

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

const noop = () => {};
const asyncNoop = async () => {};

function renderRow(row: AnomalyData) {
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

function toAnomalyRow(sourceType: string, panelTitle: string, metricName: string): AnomalyData {
  return {
    dashboard_label: 'Fixture Dashboard',
    source_type: sourceType,
    panel_title: panelTitle,
    metric_name: metricName,
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
}

describe('AnomalyExpandedContent — real ADAPT metric-name fixtures', () => {
  beforeEach(() => {
    lastChartProps = undefined;
  });

  describe.each(ADAPT_METRIC_NAME_FIXTURES)(
    '[$origin] $sourceType · $panelTitle · $metricName',
    ({ sourceType, panelTitle, metricName, chartPath, aggregatedMetricSource }) => {
      it('renders a chart (never "Chart not available")', () => {
        renderRow(toAnomalyRow(sourceType, panelTitle, metricName));

        expect(screen.getByTestId('mock-current-test-run-chart')).toBeInTheDocument();
        expect(screen.queryByText('Chart not available for this metric type')).not.toBeInTheDocument();
      });

      it(`routes to the ${chartPath} data path`, () => {
        renderRow(toAnomalyRow(sourceType, panelTitle, metricName));

        expect(lastChartProps).toBeDefined();
        expect(lastChartProps!.metricName).toBe(metricName);

        if (chartPath === 'aggregated') {
          expect(lastChartProps!.aggregatedMetricSource).toEqual(aggregatedMetricSource);
        } else {
          expect(lastChartProps!.aggregatedMetricSource).toBeUndefined();
        }
      });
    },
  );
});
