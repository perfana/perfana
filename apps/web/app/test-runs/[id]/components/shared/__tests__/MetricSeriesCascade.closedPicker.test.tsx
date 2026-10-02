/**
 * The regression this guards, end to end: the two pieces composed as Graphs and Trends
 * compose them — an `AnalystChartCard` whose picker starts CLOSED, with the real cascade
 * in its add-series slot — and a link in the URL.
 *
 * Neither half catches it alone. The card's own suite proves the slot stays mounted but
 * stubs the panel; the cascade's suite renders it on screen, which is the one state the
 * cards it ships in are never in on arrival. `{addSeries?.open && …}` passed both.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useSearchParams } from 'next/navigation';
import AnalystChartCard from '@/components/charts/AnalystChartCard';
import MetricSeriesCascade from '../MetricSeriesCascade';
import type { ApplicationDashboard, PanelOption, SeriesOption } from '../metric-options';

jest.mock('../metric-options', () => ({
  ...jest.requireActual('../metric-options'),
  fetchPanelsForDashboards: jest.fn(),
  fetchSeriesForPanels: jest.fn(),
}));
jest.mock('@/components/HostLabelChips', () => () => null);

import { fetchPanelsForDashboards, fetchSeriesForPanels } from '../metric-options';

const testRun = { test_run_id: 'run-1' } as never;

const jvm: ApplicationDashboard = {
  id: 'dash-9', dashboard_label: 'JVM', dashboard_name: 'JVM', dashboard_uid: 'jvm-uid', source_type: 'grafana',
};
const heapPanel: PanelOption = {
  id: 5, title: 'Heap', type: 'timeseries', applicationDashboardId: jvm.id,
  dashboard: jvm, dashboardLabel: jvm.dashboard_label, source: 'grafana',
};
const seriesOf = (panel: PanelOption, ...names: string[]): SeriesOption[] =>
  names.map((metricName) => ({ metricName, panel }));

/** Graphs and Trends both render this shape: picker closed, cascade in the slot. */
function setup(card: 'graphs' | 'trends', open = false) {
  const onAddSeries = jest.fn();
  render(
    <AnalystChartCard
      title={card}
      mode="light"
      addSeries={{
        open,
        onToggle: () => {},
        panel: (
          <MetricSeriesCascade
            card={card}
            allDashboards={[jvm]}
            dashboardsLoading={false}
            testRun={testRun}
            addedSeries={[]}
            onAddSeries={onAddSeries}
            panelListOptions={{ collapseRtPanels: false, includeUrlPanels: false }}
            onCancel={() => {}}
          />
        ),
      }}
    >
      <div data-testid="plot" />
    </AnalystChartCard>,
  );
  return { onAddSeries };
}

beforeEach(() => {
  jest.clearAllMocks();
  (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
  (fetchPanelsForDashboards as jest.Mock).mockResolvedValue([[heapPanel]]);
  (fetchSeriesForPanels as jest.Mock).mockResolvedValue([seriesOf(heapPanel, 'used', 'committed')]);
});

it('walks a Graphs link and adds the series with the picker still closed', async () => {
  (useSearchParams as jest.Mock).mockReturnValue(
    new URLSearchParams({ card: 'graphs', dashboard: 'JVM', panel: '5', metric: 'used' }),
  );
  const { onAddSeries } = setup('graphs');

  // Still closed: nothing was opened to make the walk happen.
  expect(screen.getByRole('button', { name: '+ add series' })).toHaveAttribute('aria-expanded', 'false');
  // toBeVisible walks the ancestors itself, so this reads the card's `display: none`
  // without reaching through a MUI class name.
  expect(screen.getByLabelText('Dashboards')).not.toBeVisible();

  await waitFor(() => expect(onAddSeries).toHaveBeenCalledWith([
    { dashboard: jvm, panel: heapPanel, metricName: 'used' },
  ]));
});

it('walks a Trends link the same way', async () => {
  (useSearchParams as jest.Mock).mockReturnValue(
    new URLSearchParams({ card: 'trends', dashboard: 'JVM', panel: '5', metric: 'committed' }),
  );
  const { onAddSeries } = setup('trends');

  await waitFor(() => expect(onAddSeries).toHaveBeenCalledWith([
    { dashboard: jvm, panel: heapPanel, metricName: 'committed' },
  ]));
});

it('fetches nothing for a card the link is not for, closed picker or not', async () => {
  // The cost of keeping the panel mounted: this card renders the dashboard column on every
  // page load. It must stop there — a panel or series fetch per card would be the real bill.
  (useSearchParams as jest.Mock).mockReturnValue(
    new URLSearchParams({ card: 'compare', dashboard: 'JVM', panel: '5', metric: 'used' }),
  );
  const { onAddSeries } = setup('graphs');

  await screen.findByText('1 available');
  expect(fetchPanelsForDashboards).not.toHaveBeenCalled();
  expect(fetchSeriesForPanels).not.toHaveBeenCalled();
  expect(onAddSeries).not.toHaveBeenCalled();
});

it('fetches nothing when there is no link at all', async () => {
  const { onAddSeries } = setup('graphs');

  await screen.findByText('1 available');
  expect(fetchPanelsForDashboards).not.toHaveBeenCalled();
  expect(onAddSeries).not.toHaveBeenCalled();
});
