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

const cascade = (
  onAddSeries: jest.Mock,
  props: Partial<React.ComponentProps<typeof MetricSeriesCascade>>,
) => (
  <MetricSeriesCascade
    card="compare"
    allDashboards={[perf, jvm]}
    dashboardsLoading={false}
    testRun={testRun}
    addedSeries={[]}
    onAddSeries={onAddSeries}
    panelListOptions={{ collapseRtPanels: true, includeUrlPanels: false }}
    {...props}
  />
);

function setup(props: Partial<React.ComponentProps<typeof MetricSeriesCascade>> = {}) {
  const onAddSeries = jest.fn();
  const view = render(
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
  return { onAddSeries, view };
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

it('walks dashboard → panel → series from the link and adds the series outright', async () => {
  // Not a draft on a checkbox: Graphs and Trends open their picker from `+ add series`, so a
  // link that only ticked a box would leave the chart empty with nothing on screen to press.
  linkTo('compare', perf.dashboard_label, 101, 'T02');
  const { onAddSeries } = setup();

  await waitFor(() => expect(fetchPanelsForDashboards).toHaveBeenCalledWith([perf], testRun, expect.anything(), expect.anything()));
  await waitFor(() => expect(fetchSeriesForPanels).toHaveBeenCalledWith([rtAvg], testRun));
  await waitFor(() => expect(onAddSeries).toHaveBeenCalledWith([{ dashboard: perf, panel: rtAvg, metricName: 'T02' }]));
});

it('lands a link to a percentile RT panel on the Avg panel the card kept (the keeper fallback)', async () => {
  // An anomaly row on "Transaction RT P95" (103) links here; Compare only lists 101.
  linkTo('compare', perf.dashboard_label, 103, 'T01');
  const { onAddSeries } = setup();

  await waitFor(() => expect(fetchSeriesForPanels).toHaveBeenCalledWith([rtAvg], testRun));
  await waitFor(() => expect(onAddSeries).toHaveBeenCalledWith([{ dashboard: perf, panel: rtAvg, metricName: 'T01' }]));
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
  await waitFor(() => expect(fetchPanelsForDashboards).toHaveBeenCalledWith([perf], testRun, expect.anything(), expect.anything()));
  await screen.findAllByText('2 available across 1 dashboard');
  expect(fetchSeriesForPanels).not.toHaveBeenCalled();
  expect(screen.getAllByRole('button', { name: 'Add series' }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
});

it('preselects once: clearing and re-picking after the link has been applied selects nothing by itself', async () => {
  // A link is consumed per page load (module state), so this one must differ from the first test's.
  linkTo('compare', perf.dashboard_label, 101, 'T01');
  const { onAddSeries } = setup({ allDashboards: [perf] });
  await waitFor(() => expect(onAddSeries).toHaveBeenCalled());

  // Clear the dashboards (drops panels and series), then pick the dashboard again by hand.
  fireEvent.click(levelButton('Dashboards'));
  await screen.findByText('Select a dashboard to see its panels');
  fireEvent.click(levelButton('Dashboards'));
  await screen.findByText('2 available across 1 dashboard');

  // Were the link still armed, the panel effect would have picked RT Avg and loaded its series.
  expect(screen.getByText('Select a panel to see its series')).toBeInTheDocument();
  expect(fetchSeriesForPanels).toHaveBeenCalledTimes(1);
});

it('takes every panel and every series when the link names only a dashboard (a Dynatrace host)', async () => {
  (useSearchParams as jest.Mock).mockReturnValue(
    new URLSearchParams({ card: 'compare', dashboard: perf.dashboard_label }),
  );
  const { onAddSeries } = setup();

  await waitFor(() => expect(fetchPanelsForDashboards).toHaveBeenCalledWith([perf], testRun, expect.anything(), expect.anything()));
  await waitFor(() => expect(fetchSeriesForPanels).toHaveBeenCalledWith([rtAvg, errPanel], testRun));
  await waitFor(() => expect(onAddSeries).toHaveBeenCalledWith(expect.arrayContaining([
    { dashboard: perf, panel: rtAvg, metricName: 'T01' },
    { dashboard: perf, panel: errPanel, metricName: 'T02' },
  ])));
  expect((onAddSeries.mock.calls[0]![0] as unknown[]).length).toBe(4);
});

it('adds outright in instant mode too, which is the config the Compare card passes', async () => {
  // `onRemoveSeries` is what puts the cascade in instant mode. The link path is the same in
  // both modes now; before, instant was the only mode that added, which is the regression.
  linkTo('compare', perf.dashboard_label, 105, 'T01');
  const onAddSeries = jest.fn();
  render(cascade(onAddSeries, { onRemoveSeries: jest.fn() }));

  await waitFor(() => expect(onAddSeries).toHaveBeenCalledWith([
    { dashboard: perf, panel: errPanel, metricName: 'T01' },
  ]));
});

it('adds nothing when the link names a series the card already holds', async () => {
  // Re-opening a link the chart already answered must not double the series: the pick is
  // keyed on dashboard/panel/metric, and a duplicate row would plot twice and sit in the
  // table twice with no way to tell the copies apart.
  linkTo('compare', perf.dashboard_label, 105, 'T02');
  const { onAddSeries } = setup({
    addedSeries: [{ dashboardId: perf.id, panelId: 105, metricName: 'T02' }],
  });

  await waitFor(() => expect(fetchSeriesForPanels).toHaveBeenCalledWith([errPanel], testRun));
  // The walk ran all three levels and then declined to add.
  await waitFor(() => expect(screen.getByText('2 available from 1 panel')).toBeInTheDocument());
  expect(onAddSeries).not.toHaveBeenCalled();
});

it('adds only what is missing when a dashboard-only link overlaps what is already added', async () => {
  (useSearchParams as jest.Mock).mockReturnValue(
    new URLSearchParams({ card: 'compare', dashboard: jvm.dashboard_label }),
  );
  (fetchSeriesForPanels as jest.Mock).mockImplementation(async (panels: PanelOption[]) =>
    panels.map((p) => seriesOf(p, 'used', 'committed')));
  const { onAddSeries } = setup({
    addedSeries: [{ dashboardId: jvm.id, panelId: 5, metricName: 'used' }],
  });

  await waitFor(() => expect(onAddSeries).toHaveBeenCalledWith([
    { dashboard: jvm, panel: heapPanel, metricName: 'committed' },
  ]));
});

it('adds nothing when the link names a metric the panel does not have', async () => {
  // A link survives a run whose series set has changed — an SLO renamed, a transaction gone.
  linkTo('compare', perf.dashboard_label, 101, 'T99');
  const { onAddSeries } = setup();

  await waitFor(() => expect(fetchSeriesForPanels).toHaveBeenCalledWith([rtAvg], testRun));
  await waitFor(() => expect(screen.getByText('2 available from 1 panel')).toBeInTheDocument());
  expect(onAddSeries).not.toHaveBeenCalled();
});

it('waits for the dashboard list instead of giving up on the empty first render', async () => {
  // The page loads its dashboards async, so EVERY link lands on a render with an empty list.
  // Disarming there — or on the gap after loading flips false but before the list arrives —
  // would make the walk a race it loses most of the time.
  linkTo('compare', jvm.dashboard_label, 5, 'used');
  const onAddSeries = jest.fn();
  const { rerender } = render(cascade(onAddSeries, { allDashboards: [], dashboardsLoading: true }));
  rerender(cascade(onAddSeries, { allDashboards: [], dashboardsLoading: false }));
  expect(fetchPanelsForDashboards).not.toHaveBeenCalled();

  rerender(cascade(onAddSeries, { allDashboards: [jvm], dashboardsLoading: false }));
  await waitFor(() => expect(onAddSeries).toHaveBeenCalledWith([
    { dashboard: jvm, panel: heapPanel, metricName: 'used' },
  ]));
});

it('disarms on a dashboard label the run does not have, rather than waiting forever', async () => {
  linkTo('compare', 'Dashboard that was deleted', 101, 'T01');
  const { onAddSeries } = setup();

  await screen.findByText('2 available');
  expect(fetchPanelsForDashboards).not.toHaveBeenCalled();
  expect(onAddSeries).not.toHaveBeenCalled();
});

it('does not land a percentile RT link on a Grafana panel that happens to share the keeper id', async () => {
  // rtKeeperPanelId(103) is 101, a perf-test rule. A Grafana dashboard with a panel numbered
  // 101 must not absorb the link — it would plot an unrelated metric under the row's name.
  const grafana101 = panelOf(jvm, 101, 'Heap committed');
  (fetchPanelsForDashboards as jest.Mock).mockImplementation(async () => [[grafana101]]);
  linkTo('compare', jvm.dashboard_label, 103, 'used');
  const { onAddSeries } = setup();

  await waitFor(() => expect(fetchPanelsForDashboards).toHaveBeenCalledWith([jvm], testRun, expect.anything(), expect.anything()));
  await screen.findByText('1 available across 1 dashboard');
  expect(fetchSeriesForPanels).not.toHaveBeenCalled();
  expect(onAddSeries).not.toHaveBeenCalled();
});

it('disarms a dashboard-only link whose dashboard turns out to have no panels', async () => {
  const bare: ApplicationDashboard = {
    id: 'dash-3', dashboard_label: 'Bare', dashboard_name: 'Bare', dashboard_uid: 'bare-uid', source_type: 'grafana',
  };
  (fetchPanelsForDashboards as jest.Mock).mockResolvedValue([[]]);
  (useSearchParams as jest.Mock).mockReturnValue(
    new URLSearchParams({ card: 'compare', dashboard: bare.dashboard_label }),
  );
  const { onAddSeries } = setup({ allDashboards: [bare] });

  await waitFor(() => expect(fetchPanelsForDashboards).toHaveBeenCalledWith([bare], testRun, expect.anything(), expect.anything()));
  await screen.findByText('0 available across 0 dashboards');
  expect(fetchSeriesForPanels).not.toHaveBeenCalled();
  expect(onAddSeries).not.toHaveBeenCalled();
});

// Each of these gets its OWN dashboard label: a link is consumed once per module load, keyed
// on the query string, so reusing another test's label here would silently no-op.
const wideDash: ApplicationDashboard = {
  id: 'dash-wide', dashboard_label: 'Wide', dashboard_name: 'Wide', dashboard_uid: 'wide-uid', source_type: 'grafana',
};
const narrowDash: ApplicationDashboard = {
  id: 'dash-narrow', dashboard_label: 'Narrow', dashboard_name: 'Narrow', dashboard_uid: 'narrow-uid', source_type: 'grafana',
};

it('caps a dashboard-only link at 50 series and says so, instead of adding all 150', async () => {
  // The wildcard shape is emitted only for a Dynatrace host (19-35 series). A hand-typed
  // label naming a perf-test dashboard is one series per transaction, and useGraphsData
  // issues a ds_metrics fetch per series — so the ceiling is what a pasted link hits.
  const widePanel = panelOf(wideDash, 7, 'Wide panel');
  (fetchPanelsForDashboards as jest.Mock).mockResolvedValue([[widePanel]]);
  (fetchSeriesForPanels as jest.Mock).mockResolvedValue([
    seriesOf(widePanel, ...Array.from({ length: 150 }, (_, i) => `T${i}`)),
  ]);
  (useSearchParams as jest.Mock).mockReturnValue(
    new URLSearchParams({ card: 'compare', dashboard: wideDash.dashboard_label }),
  );
  const showToast = jest.fn();
  const { onAddSeries } = setup({ allDashboards: [wideDash], showToast });

  await waitFor(() => expect(onAddSeries).toHaveBeenCalled());
  expect((onAddSeries.mock.calls[0]![0] as unknown[]).length).toBe(50);
  expect(showToast).toHaveBeenCalledWith(expect.stringContaining('first 50 of 150'));
});

it('leaves a wildcard link under the ceiling untouched, and stays quiet', async () => {
  // A Dynatrace-host-sized link: every series lands and the user is told nothing.
  const narrowPanel = panelOf(narrowDash, 8, 'Narrow panel');
  (fetchPanelsForDashboards as jest.Mock).mockResolvedValue([[narrowPanel]]);
  (fetchSeriesForPanels as jest.Mock).mockResolvedValue([
    seriesOf(narrowPanel, ...Array.from({ length: 50 }, (_, i) => `M${i}`)),
  ]);
  (useSearchParams as jest.Mock).mockReturnValue(
    new URLSearchParams({ card: 'compare', dashboard: narrowDash.dashboard_label }),
  );
  const showToast = jest.fn();
  const { onAddSeries } = setup({ allDashboards: [narrowDash], showToast });

  // Exactly at the ceiling is not over it.
  await waitFor(() => expect(onAddSeries).toHaveBeenCalled());
  expect((onAddSeries.mock.calls[0]![0] as unknown[]).length).toBe(50);
  expect(showToast).not.toHaveBeenCalled();
});
