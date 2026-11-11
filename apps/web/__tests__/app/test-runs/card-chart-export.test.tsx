/**
 * What a Compare or Trends chart copies to the clipboard.
 *
 * Both draw the Analyst layout, whose title and legend are HTML around the plot, so neither
 * is on the canvas Plotly rasterises. Exporting the graph div itself gives an unlabelled
 * chart with unnamed lines. They now export through ChartActions, which puts both back for
 * the image, and the modebar is hidden because its buttons export the bare graph div.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const plotProps: Array<Record<string, unknown>> = [];
jest.mock('@/components/ResponsivePlot', () => ({
  __esModule: true,
  default: function MockResponsivePlot(props: Record<string, unknown>) {
    plotProps.push(props);
    React.useEffect(() => {
      const gd = { data: props.data, layout: props.layout, _fullLayout: { width: 1000, height: 300 } };
      (props.onInitialized as (figure: unknown, gd: unknown) => void)?.({}, gd);
      return () => (props.onPurge as (figure: unknown, gd: unknown) => void)?.({}, gd);
      // Once per mount, as the real onInitialized and onPurge fire.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="responsive-plot" />;
  },
}));

const plotlyPngBlob = jest.fn((..._args: unknown[]) => Promise.resolve(new Blob()));
jest.mock('@/lib/plotly', () => ({
  ...jest.requireActual('@/lib/plotly'),
  copyPlotToClipboard: (renderPng: () => Promise<Blob>) => renderPng(),
  plotlyPngBlob: (...args: unknown[]) => plotlyPngBlob(...args),
}));

import ComparisonPlot from '@/app/test-runs/[id]/components/compare/components/ComparisonPlot';
import { TrendsChart } from '@/app/test-runs/[id]/components/trends/components/TrendsChart';
import GraphsChart from '@/app/test-runs/[id]/components/graphs/GraphsChart';

type Figure = {
  data: Array<{ name: string }>;
  layout: { showlegend: boolean; title: { text: string } };
};

const copiedFigure = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Copy chart to clipboard' }));
  await waitFor(() => expect(plotlyPngBlob).toHaveBeenCalled());
  return plotlyPngBlob.mock.calls[0]![0] as Figure;
};

const lastConfig = () => plotProps[plotProps.length - 1]!.config as { displayModeBar?: boolean };

beforeEach(() => {
  plotProps.length = 0;
  plotlyPngBlob.mockClear();
});

it('copies a Compare chart with its metric as the title and both runs in the legend', async () => {
  const samples = [{ time: '2026-11-07T10:00:00Z', value: 1 }, { time: '2026-11-07T10:01:00Z', value: 2 }];
  render(
    <ComparisonPlot
      metricName="CPU usage"
      graphData={{
        baselineMetrics: samples, currentMetrics: samples,
        baselineTestRunId: 'run-1', currentTestRunId: 'run-2',
      } as never}
      graphLoading={false}
      selectedMetric={null}
      panelUnit="percent"
      testRun={null}
      relatedTestRuns={[]}
      showToast={jest.fn()}
    />,
  );

  const figure = await copiedFigure();

  expect(figure.layout.title.text).toBe('CPU usage');
  expect(figure.layout.showlegend).toBe(true);
  expect(figure.data.map((trace) => trace.name)).toEqual(['Baseline (run-1)', 'Current (run-2)']);
  expect(lastConfig().displayModeBar).toBe(false);
});

const trendsProps = {
  title: 'Trends (avg)',
  addedSeries: [{ id: 's1' }] as never,
  metricsLoading: false,
  plotData: [{ name: 'Checkout · T01', x: [0], y: [1] }],
  plotLayout: { height: 300 },
  plotConfig: { displayModeBar: false },
  rows: [],
  runIds: ['run-1'],
  traceIndexOf: new Map(),
  cursorIndex: null,
  onCursorChange: jest.fn(),
  onRemoveSeries: jest.fn(),
  onClearAllSeries: jest.fn(),
  onUpdateSeriesUnit: jest.fn(),
  onToggleSeriesVisibility: jest.fn(),
};

it('copies a Trends chart with the card title and its series in the legend', async () => {
  render(<TrendsChart {...trendsProps} />);

  const figure = await copiedFigure();

  expect(figure.layout.title.text).toBe('Trends (avg)');
  expect(figure.layout.showlegend).toBe(true);
  expect(figure.data.map((trace) => trace.name)).toEqual(['Checkout · T01']);
});

// The plot unmounts while the card stays, and a purged div exports a blank titled image.
describe('once the plot has gone', () => {
  const copyButton = () => screen.getByRole('button', { name: 'Copy chart to clipboard' });

  it('disables the Trends export', async () => {
    const { rerender } = render(<TrendsChart {...trendsProps} />);
    await waitFor(() => expect(copyButton()).toBeEnabled());

    rerender(<TrendsChart {...trendsProps} metricsLoading />);

    expect(copyButton()).toBeDisabled();
  });

  it('disables the Graphs export', async () => {
    const seriesConfig = [{
      id: 's1', dashboardId: 'd', dashboardLabel: 'JVM', panelId: 5, panelTitle: 'Heap',
      metricName: 'used', source: 'grafana', yAxisFormat: 'bytes',
    }] as never;
    const seriesData = new Map([['s1', [{ time: '2026-11-07T10:00:00Z', metric_name: 'used', value: 1 }]]]) as never;
    const props = { seriesData, loading: false, chartName: 'My chart', testRun: null };

    const { rerender } = render(<GraphsChart {...props} seriesConfig={seriesConfig} />);
    await waitFor(() => expect(copyButton()).toBeEnabled());

    rerender(<GraphsChart {...props} seriesConfig={[]} />);

    expect(copyButton()).toBeDisabled();
  });
});
