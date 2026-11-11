/**
 * "Save as template" needs the run's organization to offer profiles and "All runs in <org>".
 * `GET /test-runs/:id` sends it camelCase (`organizationId`), other routes snake_case: reading
 * only `organization_id` left the dialog offering nothing but the install-wide scope.
 */
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AnomalyExpandedContent } from '@/app/test-runs/[id]/components/anomaly-detection/components/table-components/AnomalyExpandedContent';
import type { AnomalyData } from '@/app/test-runs/[id]/components/anomaly-detection/types';
import type { TestRun } from '@/types/test-runs';

const formProps: Array<Record<string, unknown>> = [];
jest.mock('@/app/test-runs/[id]/components/compare/CurrentTestRunChart', () => () => <div />);
jest.mock('next/dynamic', () => () => function MockPlot() { return <div />; });
jest.mock('@/app/test-runs/[id]/components/anomaly-detection/components/utils/trends-plot-utils', () => ({
  createTrendsPlot: () => ({ data: [], layout: {}, config: {} }),
}));
jest.mock('@/app/test-runs/[id]/components/configuration-comparison/MetricConfigForm', () => {
  return function MockMetricConfigForm(props: Record<string, unknown>) {
    formProps.push(props);
    return <div />;
  };
});
jest.mock('@/app/test-runs/[id]/components/anomaly-detection/components/table-components/StatisticalDrawerContent', () => ({
  StatisticalDrawerContent: () => <div />,
}));

const row = {
  dashboard_label: 'JVM',
  dashboard_uid: 'jvm-overview',
  panel_title: 'Heap used',
  metric_name: 'heap used',
  unit: null,
  classification: 'unclassified',
  conclusion_label: 'regression',
  test_value: '1',
  control_group_value: '1',
  difference: '0',
  application_dashboard_id: 'ad-1',
  panel_id: '7',
  is_stale: false,
} as AnomalyData;

function renderWith(testRun: Partial<TestRun>) {
  formProps.length = 0;
  const noop = () => {};
  render(
    <AnomalyExpandedContent
      row={row}
      rowKey="row-1"
      isExpanded
      isLast
      testRunId="run-1"
      testRun={testRun as TestRun}
      trendsData={[]}
      trendsLoading={false}
      chartKey={0}
      drawerOpen
      drawerData={null}
      drawerLoading={false}
      showConfigForm
      showToast={noop}
      onDrawerToggle={noop}
      onConfigFormToggle={noop}
      onConfigSave={async () => {}}
      onSelectTestRun={noop}
      onResetSelectedTestRun={noop}
    />,
  );
  return formProps.at(-1)?.configData as Record<string, unknown>;
}

describe('AnomalyExpandedContent — Save as template inputs', () => {
  it('reads the camelCase organizationId that GET /test-runs/:id sends', () => {
    const data = renderWith({ organizationId: 'org-a', tags: ['jvm'] });
    expect(data).toMatchObject({ organizationId: 'org-a', runTags: ['jvm'], dashboardUid: 'jvm-overview' });
  });

  it('falls back to the snake_case organization_id', () => {
    expect(renderWith({ organization_id: 'org-b' })).toMatchObject({ organizationId: 'org-b' });
  });
});
