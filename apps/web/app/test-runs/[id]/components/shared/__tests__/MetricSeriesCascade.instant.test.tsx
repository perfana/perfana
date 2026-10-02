/**
 * Instant mode — what the Compare card uses.
 *
 * Passing `onRemoveSeries` makes a series checkbox the membership itself: checking adds,
 * unchecking removes, and the Add button is gone. The failure this guards against is the
 * batch behaviour leaking in: a series that is already added rendering greyed out and
 * disabled, which in instant mode means there is no way to take it back off.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MetricSeriesCascade, { type AddedSeriesKey } from '../MetricSeriesCascade';
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
  id: 'dash-2', dashboard_label: 'JVM', dashboard_name: 'JVM', dashboard_uid: 'jvm-uid',
  source_type: 'grafana',
};
const heapPanel: PanelOption = {
  id: 5, title: 'Heap', type: 'timeseries', applicationDashboardId: jvm.id,
  dashboard: jvm, dashboardLabel: jvm.dashboard_label, source: 'grafana',
};
const seriesOf = (panel: PanelOption, ...names: string[]): SeriesOption[] =>
  names.map((metricName) => ({ metricName, panel }));

const added = (metricName: string) => ({ dashboardId: jvm.id, panelId: 5, metricName });

function setup(addedSeries: Array<{ dashboardId: string; panelId: number; metricName: string }>) {
  const onAddSeries = jest.fn();
  const onRemoveSeries = jest.fn();
  render(
    <MetricSeriesCascade
      card="compare"
      allDashboards={[jvm]}
      dashboardsLoading={false}
      testRun={testRun}
      addedSeries={addedSeries}
      onAddSeries={onAddSeries}
      onRemoveSeries={onRemoveSeries}
      panelListOptions={{ collapseRtPanels: false, includeUrlPanels: false }}
    />,
  );
  return { onAddSeries, onRemoveSeries };
}

/** Walk down to the series column: the two levels above it are plain multi-selects. */
async function openSeriesColumn() {
  fireEvent.click(await screen.findByRole('checkbox', { name: 'JVM' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Heap' }));
  await screen.findByRole('checkbox', { name: 'used' });
}

beforeEach(() => {
  jest.clearAllMocks();
  (fetchPanelsForDashboards as jest.Mock).mockResolvedValue([[heapPanel]]);
  (fetchSeriesForPanels as jest.Mock).mockResolvedValue([seriesOf(heapPanel, 'used', 'committed')]);
});

it('adds on check and removes on uncheck, with no Add button to press', async () => {
  const { onAddSeries, onRemoveSeries } = setup([]);
  await openSeriesColumn();

  // Nothing to commit: the checkbox IS the commit.
  expect(screen.queryByRole('button', { name: /^Add/ })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('checkbox', { name: 'used' }));
  expect(onAddSeries).toHaveBeenCalledTimes(1);
  expect(onAddSeries.mock.calls[0][0]).toEqual([
    { dashboard: jvm, panel: heapPanel, metricName: 'used' },
  ]);
  expect(onRemoveSeries).not.toHaveBeenCalled();
});

it('shows an already-added series as checked and live, not greyed out', async () => {
  const { onAddSeries, onRemoveSeries } = setup([added('used')]);
  await openSeriesColumn();

  const box = screen.getByRole('checkbox', { name: 'used' }) as HTMLInputElement;
  expect(box).toBeChecked();
  // Batch mode disables an added series. Here that would strand it.
  expect(box).not.toBeDisabled();

  fireEvent.click(box);
  expect(onRemoveSeries).toHaveBeenCalledWith<[AddedSeriesKey]>({
    dashboardId: jvm.id, panelId: 5, metricName: 'used',
  });
  expect(onAddSeries).not.toHaveBeenCalled();
});

it('select-all adds only what is not already added, and clear removes every one', async () => {
  const { onAddSeries, onRemoveSeries } = setup([added('used')]);
  await openSeriesColumn();

  // By accessible name, not by MUI class: `.closest('.MuiBox-root')` picks whichever Box
  // happens to be nearest and `button.MuiButton-outlined` the first one inside it, so any
  // nesting change in CascadeColumns would silently retarget this instead of failing.
  const selectAll = () => screen.getByRole('button', { name: 'Select all series' });

  // One of two is added, so the button still offers Select all.
  expect(selectAll()).toBeInTheDocument();
  fireEvent.click(selectAll());
  expect(onAddSeries).toHaveBeenCalledWith([
    { dashboard: jvm, panel: heapPanel, metricName: 'committed' },
  ]);
  expect(onRemoveSeries).not.toHaveBeenCalled();
});

it('clears every visible series when all of them are added', async () => {
  const { onRemoveSeries } = setup([added('used'), added('committed')]);
  await openSeriesColumn();

  // The label carries the state, so finding it at all is the assertion that every
  // visible series is added.
  const clearAll = await waitFor(() => screen.getByRole('button', { name: 'Clear series' }));

  fireEvent.click(clearAll);
  // One call per series: the card's remover takes a key, not a list.
  expect(onRemoveSeries.mock.calls.map((c) => c[0].metricName)).toEqual(['used', 'committed']);
});

it('counts what is added in the footer, not what is staged', async () => {
  setup([added('used')]);
  await openSeriesColumn();
  expect(screen.getByText(/1 series added/)).toBeInTheDocument();
});
