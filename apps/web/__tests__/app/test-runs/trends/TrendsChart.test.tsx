/**
 * Unit tests for TrendsChart.
 *
 * Focus: the chart/series-table layout contract. The regression this guards is the
 * empty-data branch — the series list used to be unmounted whenever the backend returned
 * no rows, which left the user unable to see or remove the series that produced no data.
 * Under the Analyst standard that list IS the legend, so it must survive every branch.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TrendsChart } from '@/app/test-runs/[id]/components/trends/components/TrendsChart';
import type { SeriesRow } from '@/components/charts';
import type { TrendsSeries } from '@/app/test-runs/[id]/components/trends/types';

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

const row = (id: string, name: string): SeriesRow => ({
  id,
  name,
  color: '#2563eb',
  unit: 'percent',
  displayUnit: '%',
  axis: 'L',
  stats: { min: 1, mean: 2, max: 3 },
  cursor: null,
});

const baseProps = {
  plotLayout: {},
  plotConfig: {},
  runIds: ['run-1'],
  traceIndexOf: new Map<string, number>([['s1', 0]]),
  cursorIndex: null,
  onCursorChange: jest.fn(),
  onRemoveSeries: jest.fn(),
  onClearAllSeries: jest.fn(),
  onUpdateSeriesUnit: jest.fn(),
  onToggleSeriesVisibility: jest.fn(),
};

describe('TrendsChart', () => {
  it('offers the add-series entry point before any series is added', () => {
    render(
      <TrendsChart
        {...baseProps}
        plotData={[]}
        rows={[]}
        addedSeries={[]}
        metricsLoading={false}
        cascade={() => <div data-testid="mock-cascade" />}
      />,
    );
    expect(screen.getByRole('button', { name: /add series/i })).toBeInTheDocument();
    expect(screen.getByText(/then add them to plot a trend/i)).toBeInTheDocument();
  });

  it('renders the plot and the series table once data arrives', () => {
    render(
      <TrendsChart
        {...baseProps}
        plotData={[{}]}
        rows={[row('s1', 'Usage')]}
        addedSeries={[series('s1', 'Usage')]}
        metricsLoading={false}
      />,
    );
    expect(screen.getByTestId('mock-plot')).toBeInTheDocument();
    expect(screen.getByText('Usage')).toBeInTheDocument();
    // The table is the legend: it carries the window stats, not just a name.
    expect(screen.getByText('mean')).toBeInTheDocument();
  });

  it('keeps the series table reachable when there is no data to plot', () => {
    // Regression: the no-data branch used to return only the message, which
    // unmounted the list and stranded the user with a series they could not remove.
    render(
      <TrendsChart
        {...baseProps}
        plotData={[]}
        rows={[row('s1', 'Usage')]}
        addedSeries={[series('s1', 'Usage')]}
        metricsLoading={false}
      />,
    );
    expect(screen.queryByTestId('mock-plot')).not.toBeInTheDocument();
    expect(screen.getByText(/No data for these series/i)).toBeInTheDocument();
    // the series and its remove control are still there
    expect(screen.getByText('Usage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove Usage/i })).toBeInTheDocument();
  });

  it('keeps the series table reachable while data is loading', () => {
    render(
      <TrendsChart
        {...baseProps}
        plotData={[]}
        rows={[row('s1', 'Usage')]}
        addedSeries={[series('s1', 'Usage')]}
        metricsLoading
      />,
    );
    expect(screen.queryByTestId('mock-plot')).not.toBeInTheDocument();
    expect(screen.getByText(/Loading trends data/i)).toBeInTheDocument();
    expect(screen.getByText('Usage')).toBeInTheDocument();
  });

  it('names the hovered run in the header, and nothing when the cursor is off the plot', () => {
    const { rerender } = render(
      <TrendsChart
        {...baseProps}
        plotData={[{}]}
        rows={[row('s1', 'Usage')]}
        addedSeries={[series('s1', 'Usage')]}
        metricsLoading={false}
      />,
    );
    expect(screen.queryByText('run-1')).not.toBeInTheDocument();

    rerender(
      <TrendsChart
        {...baseProps}
        cursorIndex={0}
        plotData={[{}]}
        rows={[row('s1', 'Usage')]}
        addedSeries={[series('s1', 'Usage')]}
        metricsLoading={false}
      />,
    );
    expect(screen.getByText('run-1')).toBeInTheDocument();
  });
});
