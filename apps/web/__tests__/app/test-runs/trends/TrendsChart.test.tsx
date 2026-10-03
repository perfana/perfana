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

// The handlers the chart hands Plotly, so a test can fire a click payload Plotly would
// produce but a DOM click cannot — an x off the end of the run list, or no point at all.
const mockPlotHandlers: { onClick?: (event: unknown) => void } = {};

// Mock the dynamically imported Plotly chart
jest.mock('next/dynamic', () => () => {
  const DynamicComponent = ({ data, onClick }: any) => {
    mockPlotHandlers.onClick = onClick;
    return (
      <div
        data-testid="mock-plot"
        data-traces={data?.length || 0}
        onClick={() => onClick?.({ points: [{ x: 0 }] })}
      >
        Plotly Chart
      </div>
    );
  };
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

  it('adds the release and annotations of the hovered run when it has them', () => {
    render(
      <TrendsChart
        {...baseProps}
        cursorIndex={0}
        runMeta={new Map([['run-1', { version: '1.2.3', annotations: 'cache disabled' }]])}
        plotData={[{}]}
        rows={[row('s1', 'Usage')]}
        addedSeries={[series('s1', 'Usage')]}
        metricsLoading={false}
      />,
    );
    expect(screen.getByText('run-1 · 1.2.3 · cache disabled')).toBeInTheDocument();
  });

  it('opens the clicked run in a new tab', () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <TrendsChart
        {...baseProps}
        plotData={[{}]}
        rows={[row('s1', 'Usage')]}
        addedSeries={[series('s1', 'Usage')]}
        metricsLoading={false}
      />,
    );
    screen.getByTestId('mock-plot').click();
    expect(open).toHaveBeenCalledWith('/test-runs/run-1', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  /**
   * The cursor readout. The Analyst standard sets `hoverinfo: 'none'`, so this string is
   * the whole hover affordance — every shape the metadata can arrive in has to render,
   * and a run with nothing extra must read as the bare id with no stray separator.
   */
  describe('the cursor readout', () => {
    const hoveringWith = (runMeta?: Map<string, { version?: string | null; annotations?: string | null }>,
                          cursorIndex: number | null = 0) =>
      render(
        <TrendsChart
          {...baseProps}
          cursorIndex={cursorIndex}
          runMeta={runMeta}
          plotData={[{}]}
          rows={[row('s1', 'Usage')]}
          addedSeries={[series('s1', 'Usage')]}
          metricsLoading={false}
        />,
      );

    it('adds the release alone when the run has no annotations', () => {
      hoveringWith(new Map([['run-1', { version: '1.2.3' }]]));
      expect(screen.getByText('run-1 · 1.2.3')).toBeInTheDocument();
    });

    it('adds the annotations alone when the run has no release', () => {
      hoveringWith(new Map([['run-1', { annotations: 'cache disabled' }]]));
      expect(screen.getByText('run-1 · cache disabled')).toBeInTheDocument();
    });

    it('shows the bare run id when both fields are null, with no dangling separator', () => {
      hoveringWith(new Map([['run-1', { version: null, annotations: null }]]));
      expect(screen.getByText('run-1')).toBeInTheDocument();
      expect(screen.queryByText(/·/)).not.toBeInTheDocument();
    });

    it('shows the bare run id for a run the map does not hold', () => {
      // `useTrendsPlot` omits a run with neither field, so this is the common case, not an
      // error one.
      hoveringWith(new Map([['some-other-run', { version: '1.2.3' }]]));
      expect(screen.getByText('run-1')).toBeInTheDocument();
    });

    it('shows nothing when the cursor is past the end of the run list', () => {
      // Plotly can report an x outside the data on a lane chart; an undefined run id must
      // not be looked up in the map or printed.
      hoveringWith(new Map([['run-1', { version: '1.2.3' }]]), 7);
      expect(screen.queryByText(/run-1/)).not.toBeInTheDocument();
      expect(screen.queryByText(/1\.2\.3/)).not.toBeInTheDocument();
    });

    it('shows nothing for a NaN cursor, which onHover produces for a point with no x', () => {
      // `onHover` does `Number(e.points?.[0]?.x ?? NaN)`, and NaN is not null — so the
      // readout has to survive `runIds[NaN]`.
      hoveringWith(new Map([['run-1', { version: '1.2.3' }]]), NaN);
      expect(screen.queryByText(/run-1/)).not.toBeInTheDocument();
    });
  });

  describe('clicking through to the run', () => {
    const clickWith = (event: unknown) => {
      const open = jest.spyOn(window, 'open').mockImplementation(() => null);
      render(
        <TrendsChart
          {...baseProps}
          plotData={[{}]}
          rows={[row('s1', 'Usage')]}
          addedSeries={[series('s1', 'Usage')]}
          metricsLoading={false}
        />,
      );
      mockPlotHandlers.onClick?.(event);
      return open;
    };

    it('does nothing when the clicked x is past the end of the run list', () => {
      const open = clickWith({ points: [{ x: 9 }] });
      expect(open).not.toHaveBeenCalled();
      open.mockRestore();
    });

    it('does nothing when the click carries no point at all', () => {
      // `Number(undefined ?? NaN)` is NaN, and `runIds[NaN]` is undefined — the guard is
      // what keeps this from opening `/test-runs/undefined`.
      const open = clickWith({ points: [] });
      expect(open).not.toHaveBeenCalled();
      open.mockRestore();
    });

    it('does nothing when the clicked x is not a number', () => {
      const open = clickWith({ points: [{ x: 'nightly' }] });
      expect(open).not.toHaveBeenCalled();
      open.mockRestore();
    });

    it('url-encodes a run id, so one with a slash or a space still resolves', () => {
      const open = jest.spyOn(window, 'open').mockImplementation(() => null);
      render(
        <TrendsChart
          {...baseProps}
          runIds={['acc/load test#1']}
          plotData={[{}]}
          rows={[row('s1', 'Usage')]}
          addedSeries={[series('s1', 'Usage')]}
          metricsLoading={false}
        />,
      );
      mockPlotHandlers.onClick?.({ points: [{ x: 0 }] });
      expect(open).toHaveBeenCalledWith(
        '/test-runs/acc%2Fload%20test%231',
        '_blank',
        'noopener,noreferrer',
      );
      open.mockRestore();
    });

    it('opens the run in a tab that cannot reach back into this one', () => {
      // `noopener` matters: the new tab is same-origin, and without it it would hold a
      // live `window.opener` handle on the page that spawned it.
      const open = clickWith({ points: [{ x: 0 }] });
      expect(open).toHaveBeenCalledWith(expect.any(String), '_blank', 'noopener,noreferrer');
      open.mockRestore();
    });
  });
});
