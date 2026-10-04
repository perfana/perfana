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

it('prompts for each level with nothing picked, and disables every control with nothing to pick', () => {
  setup({ allDashboards: [] });

  expect(screen.getByText('0 available')).toBeInTheDocument();
  // The columns are inline now rather than popups, so a level with no parent shows its
  // prompt instead of a disabled input.
  expect(screen.getByText('Select a dashboard to see its panels')).toBeInTheDocument();
  expect(screen.getByText('Select a panel to see its series')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add series' })).toBeDisabled();
  expect(levelButton('Dashboards')).toBeDisabled();
  expect(levelButton('Panels')).toBeDisabled();
  expect(levelButton('Series')).toBeDisabled();
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

  // The series column is always on screen; its rows need no popup to be opened.
  const added = (name: string) =>
    screen.getByRole('checkbox', { name }).closest('.MuiBox-root')!.textContent;
  expect(added('All aggregated')).toContain('added');
  expect(added('T01')).not.toContain('added');
  expect(screen.getByRole('checkbox', { name: 'All aggregated' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: 'T01' })).not.toBeDisabled();
  // Ticked as well as greyed: a card link adds its series outright, so an empty box said
  // nothing was selected while the chart was already drawing it.
  expect(screen.getByRole('checkbox', { name: 'All aggregated' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'T01' })).not.toBeChecked();
  // And the footer agrees with the ticks: a ticked row with "0 selected" under it was the
  // same contradiction in a different widget.
  expect(screen.getByText(/1 on chart · 0 selected/)).toBeInTheDocument();
});

it('select-all in the series column skips an already-added row, so Add never re-adds it', async () => {
  // Before this fix, Select all staged every visible row into the draft regardless of
  // `isAdded`, so pressing Add re-sent an already-charted series to the card.
  (fetchSeriesForPanels as jest.Mock).mockImplementation(async (panels: PanelOption[]) =>
    panels.map((p) => seriesOf(p, 'All aggregated', 'T01')));
  const { onAddSeries } = setup({
    allDashboards: [perf],
    addedSeries: [{ dashboardId: 'dash-1', panelId: 101, metricName: 'All aggregated — Transaction RT Avg' }],
  });
  selectAll('Dashboards');
  await screen.findByText('1 available across 1 dashboard');
  selectAll('Panels');
  await screen.findByText('2 available from 1 panel');

  selectAll('Series');

  // Only the un-added row is staged, and the footer says both halves: one already on the
  // chart, one drafted. The Add button counts the draft alone.
  expect(screen.getByText(/1 on chart · 1 selected/)).toBeInTheDocument();
  const add = await screen.findByRole('button', { name: 'Add 1 series' });
  fireEvent.click(add);

  expect(onAddSeries).toHaveBeenCalledWith([
    { dashboard: perf, panel: rtPanel, metricName: 'T01' },
  ]);
});

it('disables the series toggle once every visible row is already on the chart', async () => {
  // The toggle follows the DRAFT, not the checkboxes. Keyed on the checkboxes it read
  // "Clear" with an empty draft behind it — a live-looking button that did nothing — which
  // is the state every card link and every press of Add lands in.
  (fetchSeriesForPanels as jest.Mock).mockImplementation(async (panels: PanelOption[]) =>
    panels.map((p) => seriesOf(p, 'T01')));
  setup({
    allDashboards: [perf],
    addedSeries: [{ dashboardId: 'dash-1', panelId: 101, metricName: 'T01' }],
  });
  selectAll('Dashboards');
  await screen.findByText('1 available across 1 dashboard');
  selectAll('Panels');
  await screen.findByText('1 available from 1 panel');

  const toggle = screen.getByLabelText('Series').closest('.MuiBox-root')!
    .querySelector('button.MuiButton-outlined') as HTMLButtonElement;
  expect(toggle).toBeDisabled();
  expect(toggle.textContent).toBe('Select all');
});

/**
 * The column filters. 90 dashboards is the real case, and two behaviours are not
 * obvious from the UI: filtering must never change the selection, and Select all
 * must mean "all of what I can see" rather than "all 90".
 */
describe('column filters', () => {
  const filterFor = (level: 'Dashboards' | 'Panels' | 'Series') =>
    screen.getByLabelText(`Filter ${level.toLowerCase()}`);

  it('narrows a column to matching rows and counts them against the total', () => {
    setup();

    expect(screen.getByText('Dashboards 2')).toBeInTheDocument();
    fireEvent.change(filterFor('Dashboards'), { target: { value: 'jvm' } });

    expect(screen.getByText('Dashboards 1 / 2')).toBeInTheDocument();
    expect(screen.getByText('JVM')).toBeInTheDocument();
    expect(screen.queryByText('Perf')).not.toBeInTheDocument();
  });

  it('matches the group heading too, so a source name finds its dashboards', () => {
    setup();

    // `perf` is a performance_test dashboard; its group heading is what matches here.
    fireEvent.change(filterFor('Dashboards'), { target: { value: 'grafana' } });

    expect(screen.getByText('JVM')).toBeInTheDocument();
    expect(screen.queryByText('Perf')).not.toBeInTheDocument();
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    setup();
    fireEvent.change(filterFor('Dashboards'), { target: { value: '  JvM  ' } });
    expect(screen.getByText('JVM')).toBeInTheDocument();
  });

  it('says so rather than showing an empty column when nothing matches', () => {
    setup();
    fireEvent.change(filterFor('Dashboards'), { target: { value: 'zzz' } });
    expect(screen.getByText('No dashboards match "zzz"')).toBeInTheDocument();
  });

  // The important one: a filter is a view, not a selection.
  it('keeps a selection that the filter hides, and restores it on clear', async () => {
    setup();

    selectAll('Dashboards');
    await waitFor(() => expect(fetchPanelsForDashboards).toHaveBeenCalled());
    expect(screen.getByLabelText('Perf')).toBeChecked();

    fireEvent.change(filterFor('Dashboards'), { target: { value: 'jvm' } });
    expect(screen.queryByLabelText('Perf')).not.toBeInTheDocument();

    // Clearing the query brings it back still picked — the filter never touched it.
    fireEvent.click(screen.getByLabelText('Clear dashboards filter'));
    expect(screen.getByLabelText('Perf')).toBeChecked();
  });

  // Select all while filtered must not reach past the filter.
  it('selects only the visible rows, leaving the filtered-out ones alone', async () => {
    setup();

    fireEvent.change(filterFor('Dashboards'), { target: { value: 'jvm' } });
    selectAll('Dashboards');

    await waitFor(() => expect(fetchPanelsForDashboards).toHaveBeenCalledWith([jvm], testRun, expect.anything()));

    fireEvent.click(screen.getByLabelText('Clear dashboards filter'));
    expect(screen.getByLabelText('JVM')).toBeChecked();
    expect(screen.getByLabelText('Perf')).not.toBeChecked();
  });

  // ...and Clear while filtered must not clear the hidden ones either.
  it('clears only the visible rows', async () => {
    setup();

    selectAll('Dashboards');
    await waitFor(() => expect(fetchPanelsForDashboards).toHaveBeenCalled());

    fireEvent.change(filterFor('Dashboards'), { target: { value: 'jvm' } });
    selectAll('Dashboards'); // reads "Clear" now — only JVM is visible

    fireEvent.click(screen.getByLabelText('Clear dashboards filter'));
    expect(screen.getByLabelText('JVM')).not.toBeChecked();
    expect(screen.getByLabelText('Perf')).toBeChecked();
  });
});

it('drops the staged selection on Cancel, not just the panel it was staged in', async () => {
  // The panel stays MOUNTED while the picker is closed — the card-link walk needs it — so a
  // Cancel that only closed would leave the abandoned ticks and an armed "Add 3 series"
  // waiting behind `+ add series`, and the next open would commit a selection from last time.
  const onCancel = jest.fn();
  setup({ onCancel });

  selectAll('Dashboards');
  await screen.findByText('2 available across 2 dashboards');
  selectAll('Panels');
  await screen.findByText('3 available from 2 panels');
  selectAll('Series');
  await screen.findByRole('button', { name: 'Add 3 series' });

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Add series' })).toBeDisabled();
  // The option lists are kept: re-opening lands back where the user was, minus the draft.
  expect(screen.getByText('3 available from 2 panels')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'T01' })).not.toBeChecked();
});

it('has no Cancel where the cascade is always on screen', () => {
  // Compare passes no `onCancel` — there is nothing to close, so a Cancel there would read
  // as "undo my comparison".
  setup();
  expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
});
