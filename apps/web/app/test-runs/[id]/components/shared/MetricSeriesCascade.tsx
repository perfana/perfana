'use client';

/**
 * Dashboards → panels → series cascade shared by the Compare, Trends and Graphs cards:
 * every level multi-select with a select-all, panels grouped by their dashboard and
 * series by dashboard/panel.
 *
 * One dashboard and one panel at a time was six trips through the dropdowns to plot
 * six panels, and each trip had to be finished with "Add series" before the next.
 *
 * Presentation is the Analyst standard's `SeriesCascadePanel`: three inline scrolling
 * columns instead of three Autocomplete popups. The popups hid the levels behind each
 * other — you could not see which panels a dashboard had while choosing the dashboard —
 * and each one closed over the chart it was feeding. Every behaviour below is unchanged:
 * the fetches, the card-link preselect and its once-per-page-load consumption, dropping
 * child selections when a parent is unpicked, the already-added greying, and the counts.
 *
 * Its LAYOUT is the chart standard's; its TYPE is the app's. The two are not the same
 * thing and this is a picker, not a chart: it shipped in `MONO` at 9-11px with 22px rows,
 * which is right for an axis tick or a legend number and wrong for forty dashboard names.
 * So no `fontFamily` is set anywhere below — every `Typography` inherits
 * `theme.typography.fontFamily`, which is what the rest of the app reads in — sizes are
 * 11/12/13px, rows are 32px, and the three buttons are MUI `Button`s rather than styled
 * `Box`es. `chartTheme(mode)` stays for the colours only: its `paper`, `plotBg`,
 * `divider` and `hover` are already the app palette's exact values (`#1e293b`, `#f8fafc`,
 * 12% and 4/6%), so routing them through `useTheme()` would be churn with nothing to see.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Typography, Button, useTheme } from '@mui/material';
import { TestRun } from '@/types/test-runs';
import { getSourceDisplayInfo } from '@/lib/metrics-source-utils';
import { chartTheme, unitText, type ChartMode } from '@/lib/charts';
import {
  CASCADE_BUTTON,
  CascadeColumn,
  CascadeFrame,
  CascadeGroup,
  CascadeHint,
  CascadeRow,
  cascadeCountLabel,
  cascadeGroupBy,
  cascadeMatchesQuery,
} from '@/components/charts/CascadeColumns';
import { ALL_AGGREGATED_OPTION, buildAggregatedMetricName, isAllAggregatedDashboard, rtKeeperPanelId } from '@/lib/aggregated-perf-series';
import HostLabelChips from '@/components/HostLabelChips';
import {
  ApplicationDashboard,
  PERFORMANCE_METRICS_PANEL_UNITS,
  PanelListOptions,
  PanelOption,
  SeriesOption,
  SeriesPick,
  fetchPanelsForDashboards,
  fetchSeriesForPanels,
  panelKey,
  seriesKey,
} from './metric-options';
import { LinkableCard, readCardLinkPreselect } from './metric-card-links';

/** The identity every card's added-series list carries, used to grey out picked series. */
export interface AddedSeriesKey {
  dashboardId: string;
  panelId: number;
  metricName: string;
}

interface MetricSeriesCascadeProps {
  allDashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;
  /** Anchor run — the panel and series lists are what it recorded. */
  testRun: TestRun | null;
  addedSeries: AddedSeriesKey[];
  onAddSeries: (picks: SeriesPick[]) => void;
  /**
   * The first picked dashboard/panel, mirrored up for preset saving — a preset stores one
   * application_dashboard_id/panel_id and names itself after them.
   */
  onPrimaryChange?: (dashboard: ApplicationDashboard | null, panel: PanelOption | null) => void;
  /** Which per-card extras the panel list gets; see PanelListOptions. */
  panelListOptions?: PanelListOptions;
  /** Which card this is, so a `?card=…&dashboard=…&panel=…&metric=…` link preselects it. */
  card: LinkableCard;
  /** Only used to report a capped wildcard link; the cards own every other message. */
  showToast?: (message: string) => void;
  /** Closes the panel without adding. Omitted where the cascade is always on screen. */
  onCancel?: () => void;
  /**
   * Present = INSTANT mode: a series checkbox *is* its membership, so checking adds and
   * unchecking removes, and the footer has no Add button. Compare works this way because
   * its cascade is always on screen (it passes no `onCancel`), so the checkboxes are the
   * only picture of what is compared. Graphs and Trends open theirs from `+ add series`
   * and close it on Add, so there the checkboxes are a draft and Add is the commit.
   */
  onRemoveSeries?: (key: AddedSeriesKey) => void;
}

// ponytail: a link is applied once per page load, not once per mount. The card unmounts on
// every tab switch and collapse while the URL keeps its params, so without this the picks
// the user cleared come back on re-expand. Module state resets on reload, which re-applies.
const consumedLinks = new Set<string>();

/**
 * Ceiling on what a DASHBOARD-ONLY link (`?dashboard=…` with no panel and no metric) may add
 * by itself. That shape is a wildcard — every panel, every series — and only
 * `dynatraceHostSeriesRef` emits it, which is 19-35 series. A hand-typed label naming a
 * perf-test dashboard is one series per transaction instead: 586 on a small demo run, each
 * one its own `ds_metrics` fetch in `useGraphsData`. The link is shareable and the label is
 * guessable, so the ceiling is what keeps a pasted URL from locking the tab.
 */
const LINK_WILDCARD_MAX_SERIES = 50;

const plural = (n: number, word: string) => `${word}${n === 1 ? '' : 's'}`;

export function MetricSeriesCascade({
  allDashboards,
  dashboardsLoading,
  testRun,
  addedSeries,
  onAddSeries,
  onPrimaryChange,
  panelListOptions,
  card,
  showToast,
  onCancel,
  onRemoveSeries,
}: MetricSeriesCascadeProps) {
  const instant = Boolean(onRemoveSeries);
  // Read off the app theme, NOT taken as a prop. As a `mode = 'light'` prop, two of the
  // three call sites never passed one, so in dark mode the Trends and Compare pickers drew
  // a white panel with black text and invisible borders inside a dark card. A new caller
  // must not have to know. `MetricSelectionCascade` and `TrendsChart` already do this.
  const mode: ChartMode = useTheme().palette.mode === 'dark' ? 'dark' : 'light';
  const theme = chartTheme(mode);
  const [selectedDashboards, setSelectedDashboards] = useState<ApplicationDashboard[]>([]);
  const [panelOptions, setPanelOptions] = useState<PanelOption[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const [selectedPanels, setSelectedPanels] = useState<PanelOption[]>([]);
  const [seriesOptions, setSeriesOptions] = useState<SeriesOption[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [selectedSeries, setSelectedSeries] = useState<SeriesOption[]>([]);

  // One query per column. Deliberately NOT reset when the selection changes: narrowing
  // dashboards to "docker" and then stepping through their panels is the flow this is for.
  const [dashboardQuery, setDashboardQuery] = useState('');
  const [panelQuery, setPanelQuery] = useState('');
  const [seriesQuery, setSeriesQuery] = useState('');

  // Effects key off the selection contents, not the array identity React keeps recreating —
  // and off the run's identity, not the run object, which the page replaces on every
  // refresh (a tag edit, a job completing) and would otherwise reload every picker.
  const dashboardsKey = selectedDashboards.map((d) => d.id).join('|');
  const panelsKey = selectedPanels.map(panelKey).join('|');
  const runKey = testRun ? `${testRun.test_run_id}|${testRun.system_under_test_id}|${testRun.test_environment}|${testRun.workload}` : '';
  // Which selection the current option lists belong to: an empty list for a selection that
  // has not loaded yet is not an empty result.
  const panelsFor = useRef('');
  const seriesFor = useRef('');

  // Load the panels of every selected dashboard.
  useEffect(() => {
    const picked = selectedDashboards;
    if (picked.length === 0) {
      setPanelOptions([]);
      return;
    }
    let cancelled = false;
    setPanelsLoading(true);
    fetchPanelsForDashboards(picked, testRun, panelListOptions)
      .then((lists) => { if (!cancelled) { panelsFor.current = dashboardsKey; setPanelOptions(lists.flat()); } })
      .finally(() => { if (!cancelled) setPanelsLoading(false); });
    return () => { cancelled = true; };
    // selectedDashboards is read through dashboardsKey, testRun through runKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardsKey, runKey]);

  // Load the series of every selected panel.
  useEffect(() => {
    const picked = selectedPanels;
    if (picked.length === 0) {
      setSeriesOptions([]);
      return;
    }
    let cancelled = false;
    setSeriesLoading(true);
    fetchSeriesForPanels(picked, testRun)
      .then((lists) => { if (!cancelled) { seriesFor.current = panelsKey; setSeriesOptions(lists.flat()); } })
      .finally(() => { if (!cancelled) setSeriesLoading(false); });
    return () => { cancelled = true; };
    // selectedPanels is read through panelsKey, testRun through runKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelsKey, runKey]);

  // Dropping a dashboard drops the panels and series that hung off it, or a series would be
  // added for a dashboard the form no longer shows.
  const pickDashboards = (dashboards: ApplicationDashboard[]) => {
    const kept = new Set(dashboards.map((d) => d.id));
    setSelectedDashboards(dashboards);
    const panels = selectedPanels.filter((p) => kept.has(p.dashboard.id));
    setSelectedPanels(panels);
    setSelectedSeries(selectedSeries.filter((s) => kept.has(s.panel.dashboard.id)));
    onPrimaryChange?.(dashboards[0] ?? null, panels[0] ?? null);
  };

  const pickPanels = (panels: PanelOption[]) => {
    const kept = new Set(panels.map(panelKey));
    setSelectedPanels(panels);
    setSelectedSeries(selectedSeries.filter((s) => kept.has(panelKey(s.panel))));
    onPrimaryChange?.(selectedDashboards[0] ?? null, panels[0] ?? null);
  };

  // The cards store the synthetic run-wide aggregate under its composed name; compare
  // against that, or the option never greys out once added.
  const storedName = (s: SeriesOption) =>
    s.metricName === ALL_AGGREGATED_OPTION && !isAllAggregatedDashboard(s.panel.dashboardLabel)
      ? buildAggregatedMetricName(s.panel.title)
      : s.metricName;
  /** How a card stores this series. Both `isAdded` and the instant remove key off it. */
  const addedKeyOf = (s: SeriesOption): AddedSeriesKey => ({
    dashboardId: s.panel.applicationDashboardId || s.panel.dashboard.id,
    panelId: s.panel.id,
    metricName: storedName(s),
  });
  // A Set, not a scan: this runs per rendered series row, and a wide dashboard puts
  // hundreds of rows against a card that can hold tens of added series.
  const addedKeys = useMemo(
    () => new Set(addedSeries.map((a) => `${a.dashboardId}\u0000${a.panelId}\u0000${a.metricName}`)),
    [addedSeries],
  );
  const isAdded = (s: SeriesOption) => {
    const key = addedKeyOf(s);
    return addedKeys.has(`${key.dashboardId}\u0000${key.panelId}\u0000${key.metricName}`);
  };
  // The pick carries the RAW metric name; the card composes the stored one.
  const pickOf = (s: SeriesOption): SeriesPick => ({
    dashboard: s.panel.dashboard,
    panel: s.panel,
    metricName: s.metricName,
  });

  const addPicked = () => {
    onAddSeries(selectedSeries.map(pickOf));
    setSelectedSeries([]);
    onCancel?.();
  };

  // Preselect from a row's "Open in …" link: one step per level, each as its options land,
  // then never again — the user can clear what the link picked. The ref is disarmed the
  // moment a level cannot be satisfied (option missing, or the list loaded empty), or the
  // user picks by hand; an armed ref would otherwise hijack the next manual pick.
  const searchParams = useSearchParams();
  const linkKey = `${card}?${searchParams.toString()}`;
  const preselect = useRef(consumedLinks.has(linkKey) ? null : readCardLinkPreselect(searchParams, card));
  const disarm = () => { preselect.current = null; consumedLinks.add(linkKey); };
  useEffect(() => {
    const want = preselect.current;
    if (!want || selectedDashboards.length > 0 || dashboardsLoading) return;
    const dashboard = allDashboards.find((d) => d.dashboard_label === want.dashboardLabel);
    if (dashboard) pickDashboards([dashboard]);
    else if (allDashboards.length > 0) disarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDashboards, dashboardsLoading]);
  useEffect(() => {
    const want = preselect.current;
    if (!want || selectedPanels.length > 0 || selectedDashboards.length === 0 || panelsFor.current !== dashboardsKey) return;
    // A dashboard-only link (a Dynatrace host) names no panel: take them all.
    if (want.panelId === undefined) {
      if (panelOptions.length > 0) pickPanels([...panelOptions]);
      else disarm();
      return;
    }
    // Compare folds the percentile RT panels onto the Avg one (collapsePerfRtPanels) —
    // a perf-test rule, so a Grafana panel that happens to be numbered 101 must not match.
    const keeper = rtKeeperPanelId(want.panelId);
    const panel = panelOptions.find((p) => p.id === want.panelId)
      ?? panelOptions.find((p) => p.id === keeper && p.source === 'performance-metrics');
    if (panel) pickPanels([panel]);
    else disarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOptions]);
  useEffect(() => {
    const want = preselect.current;
    if (!want || selectedPanels.length === 0 || seriesFor.current !== panelsKey) return;
    // A link is an instruction, not a draft: it adds outright in both modes. Ticking the
    // checkbox and waiting for Add worked only while the picker was on screen; Graphs and
    // Trends open theirs from `+ add series`, so there the chart would just stay empty.
    //
    // Single-shot by construction: `disarm()` below runs synchronously in this same tick, so
    // the effect can never fire a second time while armed. That is what lets it read
    // `isAdded` without listing it as a dependency — a second armed run would dedupe against
    // a stale snapshot. Anything that makes this re-enter has to revisit the deps.
    const picks = want.metricName === undefined
      ? seriesOptions.filter((s) => !isAdded(s)).map(pickOf)
      : seriesOptions.filter((s) => s.metricName === want.metricName && !isAdded(s)).map(pickOf);
    if (want.metricName === undefined && picks.length > LINK_WILDCARD_MAX_SERIES) {
      onAddSeries(picks.slice(0, LINK_WILDCARD_MAX_SERIES));
      showToast?.(
        `That link named a whole dashboard: added the first ${LINK_WILDCARD_MAX_SERIES} of ${picks.length} series. Add the rest from the picker.`,
      );
    } else if (picks.length > 0) {
      // Guarded, because an empty list is not an add: the fetch writes a fresh `[]` for a
      // dashboard whose panels recorded nothing, which lands here with the link still armed,
      // and the cards answer a zero-length add with a toast ("All selected metrics are
      // already added") that the user did nothing to earn.
      onAddSeries(picks);
    }
    disarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesOptions]);


  const dashboardCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of panelOptions) counts.set(p.dashboardLabel, (counts.get(p.dashboardLabel) ?? 0) + 1);
    return counts;
  }, [panelOptions]);

  const pickedDashboardIds = new Set(selectedDashboards.map((d) => d.id));
  const pickedPanelKeys = new Set(selectedPanels.map(panelKey));
  const pickedSeriesKeys = new Set(selectedSeries.map(seriesKey));

  const toggleDashboard = (dashboard: ApplicationDashboard) => {
    disarm();
    pickDashboards(
      pickedDashboardIds.has(dashboard.id)
        ? selectedDashboards.filter((d) => d.id !== dashboard.id)
        : [...selectedDashboards, dashboard],
    );
  };
  const togglePanel = (panel: PanelOption) => {
    disarm();
    pickPanels(
      pickedPanelKeys.has(panelKey(panel))
        ? selectedPanels.filter((p) => panelKey(p) !== panelKey(panel))
        : [...selectedPanels, panel],
    );
  };
  /**
   * What a series row's checkbox shows: membership in instant mode, a draft OR an existing
   * membership otherwise. An added series is ticked-and-greyed rather than empty-and-greyed:
   * a card link adds its series outright, so with an empty box the picker claimed nothing was
   * selected while the chart was already drawing it.
   */
  const seriesChecked = (s: SeriesOption) =>
    instant ? isAdded(s) : pickedSeriesKeys.has(seriesKey(s)) || isAdded(s);

  const toggleSeries = (series: SeriesOption) => {
    disarm();
    if (instant) {
      if (isAdded(series)) onRemoveSeries!(addedKeyOf(series));
      else onAddSeries([pickOf(series)]);
      return;
    }
    setSelectedSeries(
      pickedSeriesKeys.has(seriesKey(series))
        ? selectedSeries.filter((s) => seriesKey(s) !== seriesKey(series))
        : [...selectedSeries, series],
    );
  };

  // Visible = what the column's filter leaves. Select all / Clear operate on THIS set,
  // not the whole list: with 90 dashboards loaded, a "Select all" that ignored a query
  // and picked all 90 would be a trap rather than a shortcut.
  const visibleDashboards = allDashboards.filter((d) =>
    cascadeMatchesQuery(dashboardQuery, d.dashboard_label, getSourceDisplayInfo(d).groupLabel),
  );
  const visiblePanels = panelOptions.filter((p) =>
    cascadeMatchesQuery(panelQuery, p.title, p.dashboardLabel),
  );
  const visibleSeries = seriesOptions.filter((o) =>
    cascadeMatchesQuery(seriesQuery, o.metricName, o.panel.title, o.panel.dashboardLabel),
  );

  const visibleDashboardIds = new Set(visibleDashboards.map((d) => d.id));
  const visiblePanelKeys = new Set(visiblePanels.map(panelKey));
  const visibleSeriesKeys = new Set(visibleSeries.map(seriesKey));
  const allVisibleDashboardsPicked =
    visibleDashboards.length > 0 && visibleDashboards.every((d) => pickedDashboardIds.has(d.id));
  const allVisiblePanelsPicked =
    visiblePanels.length > 0 && visiblePanels.every((p) => pickedPanelKeys.has(panelKey(p)));
  // What Select all / Clear operates on. In draft mode an added row is checked but disabled,
  // so folding it into this made the button read "Clear" with an empty draft behind it — live,
  // and a no-op — on the very next render after Add, and after any card link. The button
  // follows the DRAFT; instant mode is unchanged, there the checkbox is the membership.
  const selectableSeries = instant ? visibleSeries : visibleSeries.filter((o) => !isAdded(o));
  const allVisibleSeriesPicked = selectableSeries.length > 0 && selectableSeries.every(seriesChecked);

  // Dashboards by source (Grafana / Dynatrace / Performance test), panels by dashboard,
  // series by dashboard/panel — the same grouping the Autocompletes used.
  const dashboardGroups = cascadeGroupBy(visibleDashboards, (d) => getSourceDisplayInfo(d).groupLabel);
  const panelGroups = cascadeGroupBy(visiblePanels, (p) => p.dashboardLabel);
  const seriesGroups = cascadeGroupBy(visibleSeries, (s) => `${s.panel.dashboardLabel} / ${s.panel.title}`);

  const panelUnitOf = (panel: PanelOption) =>
    unitText(
      panel.yAxesFormat
      ?? (panel.source === 'performance-metrics' ? PERFORMANCE_METRICS_PANEL_UNITS[panel.id] : undefined),
    );

  return (
    <CascadeFrame
      theme={theme}
      footer={
        <>
          <Typography sx={{ flex: 1, fontSize: 13, color: theme.muted }} noWrap>
            {selectedDashboards.length} {plural(selectedDashboards.length, 'dashboard')} ·{' '}
            {selectedPanels.length} {plural(selectedPanels.length, 'panel')} ·{' '}
            {instant
              // Draft mode counts BOTH, because the two are different states on screen: an
              // added row is ticked-and-greyed, a drafted one is ticked and live. Counting
              // only the draft put "0 series selected" under two ticked rows after a card
              // link — the same contradiction the ticks were added to remove.
              ? `${addedSeries.length} series added`
              : `${addedSeries.length} on chart · ${selectedSeries.length} selected`}
          </Typography>
          {onCancel && (
            // Drops the draft as well as closing. The panel stays mounted while closed (the
            // card-link walk needs it), so without this a cancelled selection would still be
            // ticked — with an armed "Add 3 series" — the next time the picker is opened.
            <Button
              size="small"
              variant="text"
              color="inherit"
              onClick={() => { setSelectedSeries([]); onCancel(); }}
              sx={CASCADE_BUTTON}
            >
              Cancel
            </Button>
          )}
          {!instant && (
            <Button
              size="small"
              variant="contained"
              onClick={addPicked}
              disabled={selectedSeries.length === 0}
              sx={CASCADE_BUTTON}
            >
              Add {selectedSeries.length > 0 ? `${selectedSeries.length} ` : ''}series
            </Button>
          )}
        </>
      }
    >
        <CascadeColumn
          theme={theme}
          label="Dashboards"
          heading={cascadeCountLabel('Dashboards', visibleDashboards.length, allDashboards.length)}
          caption={
            dashboardsLoading
              ? 'Loading dashboards…'
              : visibleDashboards.length === 0 && dashboardQuery.trim()
                ? `No dashboards match "${dashboardQuery.trim()}"`
                : `${allDashboards.length} available`
          }
          allPicked={allVisibleDashboardsPicked}
          onToggleAll={() => {
            disarm();
            pickDashboards(
              allVisibleDashboardsPicked
                // Clear only what is on screen; a selection hidden by the query stays.
                ? selectedDashboards.filter((d) => !visibleDashboardIds.has(d.id))
                : [...selectedDashboards, ...visibleDashboards.filter((d) => !pickedDashboardIds.has(d.id))],
            );
          }}
          toggleDisabled={visibleDashboards.length === 0}
          query={dashboardQuery}
          onQueryChange={setDashboardQuery}
          queryPlaceholder="filter dashboards"
          divider
        >
          {dashboardGroups.map(([group, dashboards]) => (
            <CascadeGroup key={group} label={group} color={getSourceDisplayInfo(dashboards[0]).color}>
              {dashboards.map((dashboard) => (
                <CascadeRow
                  key={dashboard.id}
                  theme={theme}
                  checked={pickedDashboardIds.has(dashboard.id)}
                  onToggle={() => toggleDashboard(dashboard)}
                  label={dashboard.dashboard_label}
                  trailing={
                    <>
                      <HostLabelChips labels={dashboard.hostLabels} />
                      {dashboardCounts.has(dashboard.dashboard_label) && (
                        <CascadeHint theme={theme}>{dashboardCounts.get(dashboard.dashboard_label)}</CascadeHint>
                      )}
                    </>
                  }
                />
              ))}
            </CascadeGroup>
          ))}
        </CascadeColumn>

        <CascadeColumn
          theme={theme}
          label="Panels"
          heading={cascadeCountLabel('Panels', visiblePanels.length, panelOptions.length)}
          caption={
            selectedDashboards.length === 0
              ? 'Select a dashboard to see its panels'
              : panelsLoading
                ? 'Loading panels…'
                : visiblePanels.length === 0 && panelQuery.trim()
                  ? `No panels match "${panelQuery.trim()}"`
                  : `${panelOptions.length} available across ${dashboardCounts.size} ${plural(dashboardCounts.size, 'dashboard')}`
          }
          allPicked={allVisiblePanelsPicked}
          onToggleAll={() => {
            disarm();
            pickPanels(
              allVisiblePanelsPicked
                ? selectedPanels.filter((p) => !visiblePanelKeys.has(panelKey(p)))
                : [...selectedPanels, ...visiblePanels.filter((p) => !pickedPanelKeys.has(panelKey(p)))],
            );
          }}
          toggleDisabled={visiblePanels.length === 0}
          loading={panelsLoading}
          empty={selectedDashboards.length === 0}
          query={panelQuery}
          onQueryChange={setPanelQuery}
          queryPlaceholder="filter panels"
          divider
        >
          {panelGroups.map(([group, panels]) => (
            <CascadeGroup key={group} label={group} color={theme.faint}>
              {panels.map((panel) => (
                <CascadeRow
                  key={panelKey(panel)}
                  theme={theme}
                  checked={pickedPanelKeys.has(panelKey(panel))}
                  onToggle={() => togglePanel(panel)}
                  label={panel.title}
                  trailing={panelUnitOf(panel) ? <CascadeHint theme={theme}>{panelUnitOf(panel)}</CascadeHint> : null}
                />
              ))}
            </CascadeGroup>
          ))}
        </CascadeColumn>

        <CascadeColumn
          theme={theme}
          label="Series"
          heading={cascadeCountLabel('Series', visibleSeries.length, seriesOptions.length)}
          caption={
            selectedPanels.length === 0
              ? 'Select a panel to see its series'
              : seriesLoading
                ? 'Loading series…'
                : visibleSeries.length === 0 && seriesQuery.trim()
                  ? `No series match "${seriesQuery.trim()}"`
                  : `${seriesOptions.length} available from ${selectedPanels.length} ${plural(selectedPanels.length, 'panel')}`
          }
          allPicked={allVisibleSeriesPicked}
          onToggleAll={() => {
            disarm();
            if (instant) {
              // One call per removal: the card's remover takes a key, and its setState is
              // a functional update, so N of them in one handler compose.
              if (allVisibleSeriesPicked) visibleSeries.forEach((o) => onRemoveSeries!(addedKeyOf(o)));
              else onAddSeries(visibleSeries.filter((o) => !isAdded(o)).map(pickOf));
              return;
            }
            setSelectedSeries(
              allVisibleSeriesPicked
                ? selectedSeries.filter((o) => !visibleSeriesKeys.has(seriesKey(o)))
                // Skip the already-added: their rows are disabled, so a draft entry for one
                // can only be cleared by unpicking the panel, and Add answers it with
                // "already added".
                : [...selectedSeries, ...visibleSeries.filter((o) => !pickedSeriesKeys.has(seriesKey(o)) && !isAdded(o))],
            );
          }}
          toggleDisabled={selectableSeries.length === 0}
          loading={seriesLoading}
          empty={selectedPanels.length === 0}
          query={seriesQuery}
          onQueryChange={setSeriesQuery}
          queryPlaceholder="filter series"
        >
          {seriesGroups.map(([group, options]) => (
            <CascadeGroup key={group} label={group} color={theme.faint}>
              {options.map((option) => {
                // Greying an added series out is right only where the checkbox is a draft.
                // In instant mode the checkbox IS the membership, so it has to stay live or
                // there is no way to take a series back off.
                const already = !instant && isAdded(option);
                return (
                  <CascadeRow
                    key={seriesKey(option)}
                    theme={theme}
                    checked={seriesChecked(option)}
                    onToggle={() => toggleSeries(option)}
                    disabled={already}
                    label={option.metricName}
                    trailing={already ? <CascadeHint theme={theme}>added</CascadeHint> : null}
                  />
                );
              })}
            </CascadeGroup>
          ))}
        </CascadeColumn>
    </CascadeFrame>
  );
}

export const SeriesCascadePanel = MetricSeriesCascade;

export default MetricSeriesCascade;
