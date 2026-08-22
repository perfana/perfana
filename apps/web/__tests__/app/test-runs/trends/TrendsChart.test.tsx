/**
 * Unit tests for TrendsChart.
 *
 * Focus: the chart/series-list layout contract introduced when the card was
 * reordered so the chart sits above its series list. The regression this guards
 * is the empty-data branch — the series list used to be unmounted whenever the
 * backend returned no rows, which left the user unable to see or remove the
 * series that produced no data.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TrendsChart } from '@/app/test-runs/[id]/components/trends/components/TrendsChart';
import type { TrendsSeries, MetricStatistic } from '@/app/test-runs/[id]/components/trends/types';

// Mock the dynamically imported Plotly chart
jest.mock('next/dynamic', () => () => {
  const DynamicComponent = ({ data }: any) => (
    <div data-testid="mock-plot" data-traces={data?.length || 0}>
      Plotly Chart
    </div>
  );
  DynamicComponent.displayName = 'Plot';
  return DynamicComponent;
});

const series = (id: string, metricName: string): TrendsSeries =>
  ({
    id,
    metricName,
    dashboardLabel: 'Docker container metrics',
    panelTitle: 'CPU',
  } as unknown as TrendsSeries);

const stat = (metricName: string): MetricStatistic =>
  ({
    test_run_id: 'run-1',
    panel_title: 'CPU',
    metric_name: metricName,
    value: 42,
    created_at: '2026-08-20T10:00:00Z',
  } as unknown as MetricStatistic);

const baseProps = {
  plotData: [{}],
  plotLayout: {},
  plotConfig: {},
  onRemoveSeries: jest.fn(),
  onClearAllSeries: jest.fn(),
  onUpdateSeriesUnit: jest.fn(),
};

describe('TrendsChart', () => {
  it('renders nothing until a series is added', () => {
    const { container } = render(
      <TrendsChart {...baseProps} addedSeries={[]} metricsData={[]} metricsLoading={false} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the plot and the series list once data arrives', () => {
    render(
      <TrendsChart
        {...baseProps}
        addedSeries={[series('s1', 'Usage')]}
        metricsData={[stat('Usage')]}
        metricsLoading={false}
      />
    );
    expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    expect(screen.getByText('Usage')).toBeInTheDocument();
    expect(screen.getByText('Series (1)')).toBeInTheDocument();
  });

  it('keeps the series list reachable when there is no data to plot', () => {
    // Regression: the no-data branch used to return only the message, which
    // unmounted the list and stranded the user with a series they could not remove.
    render(
      <TrendsChart
        {...baseProps}
        addedSeries={[series('s1', 'Usage')]}
        metricsData={[]}
        metricsLoading={false}
      />
    );
    expect(screen.queryByTestId('mock-plot')).not.toBeInTheDocument();
    expect(screen.getByText(/No data for these series/i)).toBeInTheDocument();
    // the series and its remove control are still there
    expect(screen.getByText('Usage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove Usage/i })).toBeInTheDocument();
  });

  it('keeps the series list reachable while data is loading', () => {
    render(
      <TrendsChart
        {...baseProps}
        addedSeries={[series('s1', 'Usage')]}
        metricsData={[]}
        metricsLoading={true}
      />
    );
    expect(screen.queryByTestId('mock-plot')).not.toBeInTheDocument();
    expect(screen.getByText(/Loading trends data/i)).toBeInTheDocument();
    expect(screen.getByText('Usage')).toBeInTheDocument();
  });
});
