/**
 * The dashboards → panels → series cascade the Compare, Trends and Graphs cards share.
 *
 * Driven through its select-all/clear buttons and the add button; the option loaders are
 * mocked so the test is about the cascade's own state: what loads when, what clearing a
 * level drops below it, and what "Add" hands back.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  id: 'dash-1', dashboard_label: 'Perf', dashboard_name: 'Perf', dashboard_uid: 'perf-uid', source_type: 'performance_test',
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

const rtPanel = panelOf(perf, 101, 'Transaction RT Avg');
const heapPanel = panelOf(jvm, 5, 'Heap');

function setup(props: Partial<React.ComponentProps<typeof MetricSeriesCascade>> = {}) {
  const onAddSeries = jest.fn();
  const onPrimaryChange = jest.fn();
  const view = render(
    <MetricSeriesCascade
      card="graphs"
      allDashboards={[perf, jvm]}
      dashboardsLoading={false}
      testRun={testRun}
      addedSeries={[]}
      onAddSeries={onAddSeries}
      onPrimaryChange={onPrimaryChange}
      panelListOptions={{ collapseRtPanels: false, includeUrlPanels: false }}
      {...props}
    />,
  );
  return { onAddSeries, onPrimaryChange, view };
}

/** The Select all / Clear button beside a level's input: they share one flex Box. */
const levelButton = (level: 'Dashboards' | 'Panels' | 'Series') =>
  screen.getByLabelText(level).closest('.MuiBox-root')!.querySelector('button.MuiButton-outlined')!;

const selectAll = (level: 'Dashboards' | 'Panels' | 'Series') => {
  fireEvent.click(levelButton(level));
};

beforeEach(() => {
  jest.clearAllMocks();
  (fetchPanelsForDashboards as jest.Mock).mockImplementation(async (dashboards: ApplicationDashboard[]) =>
    dashboards.map((d) => (d.id === 'dash-1' ? [rtPanel] : [heapPanel])));
  (fetchSeriesForPanels as jest.Mock).mockImplementation(async (panels: PanelOption[]) =>
    panels.map((p) => (p.id === 101 ? seriesOf(p, 'T01', 'T02') : seriesOf(p, 'used'))));
});

it('loads the panels of every picked dashboard with the card\'s options, then the series of every picked panel', async () => {
  const { onPrimaryChange } = setup();

  selectAll('Dashboards');
  await waitFor(() => expect(fetchPanelsForDashboards).toHaveBeenCalledWith([perf, jvm], testRun, { collapseRtPanels: false, includeUrlPanels: false }));
  await screen.findByText('2 available across 2 dashboards');
  expect(onPrimaryChange).toHaveBeenLastCalledWith(perf, null);

  selectAll('Panels');
  await waitFor(() => expect(fetchSeriesForPanels).toHaveBeenCalledWith([rtPanel, heapPanel], testRun));
  await screen.findByText('3 available from 2 panels');
  expect(onPrimaryChange).toHaveBeenLastCalledWith(perf, rtPanel);
});

it('hands back one pick per selected series and empties the series picker after adding', async () => {
  const { onAddSeries } = setup();

  selectAll('Dashboards');
  await screen.findByText('2 available across 2 dashboards');
  selectAll('Panels');
  await screen.findByText('3 available from 2 panels');
  selectAll('Series');

  const add = await screen.findByRole('button', { name: 'Add 3 series' });
  fireEvent.click(add);

  expect(onAddSeries).toHaveBeenCalledWith([
    { dashboard: perf, panel: rtPanel, metricName: 'T01' },
    { dashboard: perf, panel: rtPanel, metricName: 'T02' },
    { dashboard: jvm, panel: heapPanel, metricName: 'used' },
  ]);
  // Selection cleared, options kept: the next add starts from an empty picker
  expect(screen.getByRole('button', { name: 'Add series' })).toBeDisabled();
  expect(screen.getByText('3 available from 2 panels')).toBeInTheDocument();
});

it('drops the panels and series of a dashboard that is cleared, and reports no primary pick', async () => {
  const { onPrimaryChange } = setup();

  selectAll('Dashboards');
  await screen.findByText('2 available across 2 dashboards');
  selectAll('Panels');
  await screen.findByText('3 available from 2 panels');
  selectAll('Series');
  await screen.findByRole('button', { name: 'Add 3 series' });

  // The dashboards button now reads "Clear"
  selectAll('Dashboards');

  await waitFor(() => expect(screen.getByText('Select a dashboard to see its panels')).toBeInTheDocument());
  expect(screen.getByText('Select a panel to see its series')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add series' })).toBeDisabled();
  expect(onPrimaryChange).toHaveBeenLastCalledWith(null, null);
});

it('disables every picker below a level with nothing picked, and the dashboard button with nothing to pick', () => {
  setup({ allDashboards: [] });

  expect(screen.getByText('0 available')).toBeInTheDocument();
  expect(screen.getByLabelText('Panels')).toBeDisabled();
  expect(screen.getByLabelText('Series')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add series' })).toBeDisabled();
  expect(levelButton('Dashboards')).toBeDisabled();
});

it('ignores a panel load that finishes after the dashboard was cleared', async () => {
  let resolvePanels!: (v: PanelOption[][]) => void;
  (fetchPanelsForDashboards as jest.Mock).mockImplementationOnce(() => new Promise((r) => { resolvePanels = r; }));
  setup();

  selectAll('Dashboards');
  await screen.findByText('Loading panels…');
  selectAll('Dashboards'); // clear while the request is still in flight
  resolvePanels([[rtPanel], [heapPanel]]);

  await waitFor(() => expect(screen.getByText('Select a dashboard to see its panels')).toBeInTheDocument());
  expect(screen.queryByText('2 available across 2 dashboards')).not.toBeInTheDocument();
});

it('does not reload the pickers when the page hands it a fresh run object of the same run', async () => {
  // The page replaces the run object on every refresh (a tag edit, a job completing); keyed on
  // the object, every picker reloaded and briefly emptied mid-selection.
  const { view } = setup();
  selectAll('Dashboards');
  await screen.findByText('2 available across 2 dashboards');
  expect(fetchPanelsForDashboards).toHaveBeenCalledTimes(1);

  view.rerender(
    <MetricSeriesCascade
      card="graphs"
      allDashboards={[perf, jvm]} dashboardsLoading={false} testRun={{ ...(testRun as object) } as never}
      addedSeries={[]} onAddSeries={jest.fn()} panelListOptions={{ collapseRtPanels: false, includeUrlPanels: false }}
    />,
  );

  expect(fetchPanelsForDashboards).toHaveBeenCalledTimes(1);
});

it('greys out the synthetic "All aggregated" option once it is on the chart under its composed name', async () => {
  (fetchSeriesForPanels as jest.Mock).mockImplementation(async (panels: PanelOption[]) =>
    panels.map((p) => seriesOf(p, 'All aggregated', 'T01')));
  setup({
    allDashboards: [perf],
    addedSeries: [{ dashboardId: 'dash-1', panelId: 101, metricName: 'All aggregated — Transaction RT Avg' }],
  });
  selectAll('Dashboards');
  await screen.findByText('1 available across 1 dashboard');
  selectAll('Panels');
  await screen.findByText('2 available from 1 panel');

  fireEvent.mouseDown(screen.getByLabelText('Series'));
  const option = await screen.findByText('All aggregated');
  expect(option.textContent).toContain('(already added)');
  expect(screen.getByText('T01').textContent).not.toContain('(already added)');
});
