/**
 * A row's "Open in …" link lands on the page with ?card=…&dashboard=…&panel=…&metric=…, and the
 * cascade of that card walks its three levels from those params: one step per level, as each
 * level's options arrive, then never again.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { useSearchParams } from 'next/navigation';
import MetricSeriesCascade from '../MetricSeriesCascade';
import { CardLinkRequestContext, type CardLinkRequest } from '../metric-card-links';
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
  // Outside a page provider the consumed set is the context default, shared by every test in this
  // file, so this link must differ from the first test's.
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

it('keys a URL link by run, so the same link on another run walks again', async () => {
  // Value: protects=a URL link's consumed key carries the run id; fails_when=the url key drops the run id; why_new=without a page provider the default consumed set is shared, so the run in the key is all that separates runs; seam=none; no_claim=prev/next itself (the page remounts with a fresh set)
  const again: ApplicationDashboard = {
    id: 'dash-again', dashboard_label: 'Performance test metrics Again', dashboard_name: 'Again', dashboard_uid: 'again-uid', source_type: 'performance_test',
  };
  const rt = panelOf(again, 101, 'Transaction RT');
  (fetchPanelsForDashboards as jest.Mock).mockResolvedValue([[rt]]);
  (fetchSeriesForPanels as jest.Mock).mockResolvedValue([seriesOf(rt, 'T01')]);
  linkTo('graphs', again.dashboard_label, 101, 'T01');
  const pick = [{ dashboard: again, panel: rt, metricName: 'T01' }];

  const onRun1 = jest.fn();
  const run1 = render(cascade(onRun1, { card: 'graphs', allDashboards: [again], testRun: { test_run_id: 'run-1' } as never }));
  await waitFor(() => expect(onRun1).toHaveBeenCalledWith(pick));
  run1.unmount();

  const onRun2 = jest.fn();
  render(cascade(onRun2, { card: 'graphs', allDashboards: [again], testRun: { test_run_id: 'run-2' } as never }));
  await waitFor(() => expect(onRun2).toHaveBeenCalledWith(pick));
});

it('walks a URL link that arrives while mounted', async () => {
  // A client navigation to new search params changes the URL under a picker that is already up.
  const onAddSeries = jest.fn();
  const { rerender } = render(cascade(onAddSeries, { card: 'graphs' }));
  await screen.findByText('2 available');
  expect(fetchPanelsForDashboards).not.toHaveBeenCalled();

  linkTo('graphs', perf.dashboard_label, 101, 'T02');
  rerender(cascade(onAddSeries, { card: 'graphs' }));
  await waitFor(() => expect(onAddSeries).toHaveBeenCalledWith([{ dashboard: perf, panel: rtAvg, metricName: 'T02' }]));
});

// Lets a walk's chained fetches settle, so a re-walk that should NOT happen would have landed.
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

it('keeps its picker when a link for another card replaces its own', async () => {
  // Value: protects=a link into another card does not remount this card's picker; fails_when=the wrapper keys on the current link alone (null for another card); why_new=found by maintainability+testing review; seam=none; no_claim=what the other card does
  const run = { test_run_id: 'run-keep' } as never;
  linkTo('compare', perf.dashboard_label, 101, 'T02');
  const onAddSeries = jest.fn();
  const { rerender } = render(cascade(onAddSeries, { card: 'compare', testRun: run }));
  await waitFor(() => expect(onAddSeries).toHaveBeenCalledTimes(1));

  // The URL's link moves to another card. A remount would show an empty picker.
  linkTo('graphs', jvm.dashboard_label, 5, 'used');
  rerender(cascade(onAddSeries, { card: 'compare', testRun: run }));
  await flush();
  expect(screen.getAllByText('2 available across 1 dashboard').length).toBeGreaterThan(0);
  expect(onAddSeries).toHaveBeenCalledTimes(1);
});

it('walks every in-page "Open in …" request once: A, then B, then A again after its removal', async () => {
  // Value: protects=each explicit click adds its series (A->B->A, re-open after removal) while a re-render or another card's request does not; fails_when=the wrapper stops keying on the request id or the page-scoped consumed set is lost; why_new=testing review cycle 2: the URL re-arm missed A->B->A; seam=none; no_claim=the page minting the ids (integration test covers the click)
  const consumed = new Set<string>();
  const onAddSeries = jest.fn();
  const at = (request: CardLinkRequest | null) => (
    <CardLinkRequestContext.Provider value={{ request, consumed }}>
      {cascade(onAddSeries, { card: 'graphs', testRun: { test_run_id: 'run-requests' } as never })}
    </CardLinkRequestContext.Provider>
  );
  const A = { dashboardLabel: perf.dashboard_label, panelId: 101, metricName: 'T01' };
  const B = { dashboardLabel: perf.dashboard_label, panelId: 101, metricName: 'T02' };

  const { rerender } = render(at({ card: 'graphs', ref: A, id: 1 }));
  await waitFor(() => expect(onAddSeries).toHaveBeenCalledTimes(1));
  rerender(at({ card: 'graphs', ref: A, id: 1 }));
  await flush();
  expect(onAddSeries).toHaveBeenCalledTimes(1);

  // A request for another card leaves this picker (and its walk) alone.
  rerender(at({ card: 'compare', ref: B, id: 2 }));
  await flush();
  expect(onAddSeries).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText('2 available across 1 dashboard').length).toBeGreaterThan(0);

  rerender(at({ card: 'graphs', ref: B, id: 3 }));
  await waitFor(() => expect(onAddSeries).toHaveBeenCalledTimes(2));
  rerender(at({ card: 'graphs', ref: A, id: 4 }));
  await waitFor(() => expect(onAddSeries).toHaveBeenCalledTimes(3));
  expect(onAddSeries.mock.calls.map((c) => c[0][0].metricName)).toEqual(['T01', 'T02', 'T01']);
});

it('never walks a link twice on one page: a collapse and re-expand (remount) skips it, a fresh page walks it', async () => {
  // Value: protects=the page-scoped consumed set stops a remount re-adding a series the user removed, on both arms; fails_when=disarm stops recording the key or the preselect ref stops checking it; why_new=testing review cycle 3: no test remounted under a walked key; seam=none; no_claim=the page creating one set per page instance
  const run = { test_run_id: 'run-remount' } as never;
  const request: CardLinkRequest = { card: 'graphs', ref: { dashboardLabel: perf.dashboard_label, panelId: 101, metricName: 'T01' }, id: 1 };
  const onAddSeries = jest.fn();
  const tree = (value: { request: CardLinkRequest | null; consumed: Set<string> }) => (
    <CardLinkRequestContext.Provider value={value}>{cascade(onAddSeries, { card: 'graphs', testRun: run })}</CardLinkRequestContext.Provider>
  );

  // Request arm.
  const page = { request, consumed: new Set<string>() };
  const first = render(tree(page));
  await waitFor(() => expect(onAddSeries).toHaveBeenCalledTimes(1));
  first.unmount();
  const second = render(tree(page));
  await flush();
  expect(onAddSeries).toHaveBeenCalledTimes(1);
  second.unmount();
  render(tree({ request, consumed: new Set() }));
  await waitFor(() => expect(onAddSeries).toHaveBeenCalledTimes(2));
  cleanup();

  // URL arm (a landing ?card= link, before any in-page click).
  linkTo('graphs', perf.dashboard_label, 101, 'T02');
  const landing = { request: null, consumed: new Set<string>() };
  const third = render(tree(landing));
  await waitFor(() => expect(onAddSeries).toHaveBeenCalledTimes(3));
  third.unmount();
  render(tree(landing));
  await flush();
  expect(onAddSeries).toHaveBeenCalledTimes(3);
});

it('lets the first in-page click win over the landing URL link, and keeps the picker for other cards\' clicks', async () => {
  // Value: protects=a landing ?card= link counts only until the first in-page request; fails_when=the URL arm is preferred over a request (later clicks would be ignored); why_new=testing review cycle 3: no test combined the two; seam=none; no_claim=none beyond protects
  const run = { test_run_id: 'run-precedence' } as never;
  const consumed = new Set<string>();
  const onAddSeries = jest.fn();
  const tree = (request: CardLinkRequest | null) => (
    <CardLinkRequestContext.Provider value={{ request, consumed }}>{cascade(onAddSeries, { card: 'graphs', testRun: run })}</CardLinkRequestContext.Provider>
  );
  linkTo('graphs', perf.dashboard_label, 101, 'T01');
  const { rerender } = render(tree(null));
  await waitFor(() => expect(onAddSeries).toHaveBeenCalledTimes(1));

  rerender(tree({ card: 'graphs', ref: { dashboardLabel: perf.dashboard_label, panelId: 101, metricName: 'T02' }, id: 7 }));
  await waitFor(() => expect(onAddSeries).toHaveBeenCalledTimes(2));
  expect(onAddSeries).toHaveBeenLastCalledWith([{ dashboard: perf, panel: rtAvg, metricName: 'T02' }]);

  rerender(tree({ card: 'compare', ref: { dashboardLabel: perf.dashboard_label, panelId: 101, metricName: 'T01' }, id: 8 }));
  await flush();
  expect(onAddSeries).toHaveBeenCalledTimes(2);
  expect(screen.getAllByText('2 available across 1 dashboard').length).toBeGreaterThan(0);
});
