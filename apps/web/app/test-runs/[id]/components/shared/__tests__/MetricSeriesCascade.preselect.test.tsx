/**
 * A row's "Open in …" link lands on the page with ?card=…&dashboard=…&panel=…&metric=…, and the
 * cascade of that card walks its three levels from those params: one step per level, as each
 * level's options arrive, then never again.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useSearchParams } from 'next/navigation';
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

const perf: ApplicationDashboard = {
  id: 'dash-1', dashboard_label: 'Performance test metrics S', dashboard_name: 'Perf', dashboard_uid: 'perf-uid', source_type: 'performance_test',
};
const jvm: ApplicationDashboard = {
  id: 'dash-2', dashboard_label: 'JVM', dashboard_name: 'JVM', dashboard_uid: 'jvm-uid', source_type: 'grafana',
};

const panelOf = (dashboard: ApplicationDashboard, id: number, title: string): PanelOption => ({
  id, title, type: 'timeseries', applicationDashboardId: dashboard.id,
  dashboard, dashboardLabel: dashboard.dashboard_label,
  source: dashboard.source_type === 'performance_test' ? 'performance-metrics' : 'grafana',
});
const seriesOf = (panel: PanelOption, ...names: string[]): SeriesOption[] => names.map((metricName) => ({ metricName, panel }));

const rtAvg = panelOf(perf, 101, 'Transaction RT');
const errPanel = panelOf(perf, 105, 'Transaction Error Rate');
const heapPanel = panelOf(jvm, 5, 'Heap');

const linkTo = (card: string, dashboard: string, panel: number, metric: string) => {
  (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams({ card, dashboard, panel: String(panel), metric }));
};

function setup(props: Partial<React.ComponentProps<typeof MetricSeriesCascade>> = {}) {
  const onAddSeries = jest.fn();
  render(
    <MetricSeriesCascade
      card="compare"
      allDashboards={[perf, jvm]}
      dashboardsLoading={false}
      testRun={testRun}
      addedSeries={[]}
      onAddSeries={onAddSeries}
      panelListOptions={{ collapseRtPanels: true, includeUrlPanels: false }}
      {...props}
    />,
  );
  return { onAddSeries };
}

/** The Select all / Clear button beside a level's input: they share one flex Box. */
const levelButton = (level: 'Dashboards' | 'Panels' | 'Series') =>
  screen.getByLabelText(level).closest('.MuiBox-root')!.querySelector('button.MuiButton-outlined')!;

beforeEach(() => {
  jest.clearAllMocks();
  (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
  // The Compare card collapses the percentile RT panels onto the Avg one, so 102-104 never appear.
  (fetchPanelsForDashboards as jest.Mock).mockImplementation(async (dashboards: ApplicationDashboard[]) =>
    dashboards.map((d) => (d.id === 'dash-1' ? [rtAvg, errPanel] : [heapPanel])));
  (fetchSeriesForPanels as jest.Mock).mockImplementation(async (panels: PanelOption[]) =>
    panels.map((p) => (p.dashboard.id === 'dash-1' ? seriesOf(p, 'T01', 'T02') : seriesOf(p, 'used'))));
});

it('walks dashboard → panel → series from the link, so the user only has to press Add', async () => {
  linkTo('compare', perf.dashboard_label, 101, 'T02');
  const { onAddSeries } = setup();

  await waitFor(() => expect(fetchPanelsForDashboards).toHaveBeenCalledWith([perf], testRun, expect.anything()));
  await waitFor(() => expect(fetchSeriesForPanels).toHaveBeenCalledWith([rtAvg], testRun));
  const add = await screen.findByRole('button', { name: 'Add 1 series' });

  fireEvent.click(add);
  expect(onAddSeries).toHaveBeenCalledWith([{ dashboard: perf, panel: rtAvg, metricName: 'T02' }]);
});

it('lands a link to a percentile RT panel on the Avg panel the card kept (the keeper fallback)', async () => {
  // An anomaly row on "Transaction RT P95" (103) links here; Compare only lists 101.
  linkTo('compare', perf.dashboard_label, 103, 'T01');
  setup();

  await waitFor(() => expect(fetchSeriesForPanels).toHaveBeenCalledWith([rtAvg], testRun));
  await screen.findByRole('button', { name: 'Add 1 series' });
});

it('gives up at the first level it cannot match, and touches nothing on a link for another card', async () => {
  // The link is for Graphs: this Compare cascade must not react to it.
  linkTo('graphs', perf.dashboard_label, 101, 'T01');
  const first = setup();
  await screen.findByText('2 available');
  expect(fetchPanelsForDashboards).not.toHaveBeenCalled();
  first.onAddSeries.mockClear();

  // Unknown panel on a known dashboard: the dashboard is picked, then the walk stops.
  linkTo('compare', perf.dashboard_label, 999, 'T01');
  setup();
  await waitFor(() => expect(fetchPanelsForDashboards).toHaveBeenCalledWith([perf], testRun, expect.anything()));
  await screen.findAllByText('2 available across 1 dashboard');
  expect(fetchSeriesForPanels).not.toHaveBeenCalled();
  expect(screen.getAllByRole('button', { name: 'Add series' }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
});

it('preselects once: clearing and re-picking after the link has been applied selects nothing by itself', async () => {
  // A link is consumed per page load (module state), so this one must differ from the first test's.
  linkTo('compare', perf.dashboard_label, 101, 'T01');
  setup({ allDashboards: [perf] });
  await screen.findByRole('button', { name: 'Add 1 series' });

  // Clear the dashboards (drops panels and series), then pick the dashboard again by hand.
  fireEvent.click(levelButton('Dashboards'));
  await screen.findByText('Select a dashboard to see its panels');
  fireEvent.click(levelButton('Dashboards'));
  await screen.findByText('2 available across 1 dashboard');

  // Were the link still armed, the panel effect would have picked RT Avg and loaded its series.
  expect(screen.getByText('Select a panel to see its series')).toBeInTheDocument();
  expect(fetchSeriesForPanels).toHaveBeenCalledTimes(1);
});
