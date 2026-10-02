'use client';

/**
 * Dashboards → panels → series pickers, shared by the report sections that scope
 * themselves to metric data (comparisons, trends).
 *
 * Each level is multi-select with a select-all, and a level left entirely empty means
 * "everything under the level above it" — so the common case, compare/trend these two
 * dashboards, stays one click. Pick anything at a level and only the picks count: a
 * dashboard with no panel picked, or a panel with no series picked, drops out. The
 * renderer reads the same rule (section-selections.ts), and `metricSelectionScopeNote`
 * below names whatever is dropping out, because silently reporting on it is the older bug.
 *
 * Presentation is the same three inline scrolling columns as the test-run cards' series
 * picker — `CascadeColumns`, shared by both. It replaced three MUI Autocompletes, which
 * hid the levels behind each other (you could not see which panels a dashboard had while
 * choosing the dashboard) and made "select these six" six trips through a popup. What is
 * NOT shared is everything below the chrome: this one loads per metrics source for a
 * system/environment rather than from a run, and stores labels rather than picks, because
 * a report config outlives the run it was written against.
 */

import { useEffect, useState } from 'react';
import { Typography, useTheme } from '@mui/material';
import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceDashboards, fetchDynatraceMetrics } from '@/lib/dynatrace';
import { isGrafana, isPerformanceTest } from '@/lib/metrics-source-utils';
import { ALL_AGGREGATED_OPTION, collapsePerfRtPanels, getAggregateSpec } from '@/lib/aggregated-perf-series';
import { buildUrlPanels, fetchUrlDistinctNames, isUrlPanel } from '@/lib/url-perf-panels';
import HostLabelChips from '@/components/HostLabelChips';
import { chartTheme } from '@/lib/charts';
import {
  CascadeColumn,
  CascadeFrame,
  CascadeGroup,
  CascadeRow,
  cascadeCountLabel,
  cascadeGroupBy,
  cascadeMatchesQuery,
} from '@/components/charts/CascadeColumns';

export type MetricSource = 'performance-metrics' | 'grafana' | 'dynatrace';

export interface SourceDashboardOption {
  label: string;
  /** application_dashboards.id — the key both the panel and the series endpoints take */
  appDashboardId?: string;
  /** Dynatrace host dashboards only: the labels given to the host. */
  hostLabels?: string[];
}

/** The three cascading lists as they are stored in a section config. */
export interface MetricSelectionValue {
  dashboardLabels?: string[];
  panels?: { id: number; title: string; dashboardLabel?: string }[];
  series?: { dashboardLabel: string; panelId: number; metricName: string }[];
  /** @deprecated single-dashboard key from before multi-select; read on load, never written */
  dashboardLabel?: string;
}

type PanelOption = { id: number; title: string; dashboardLabel: string; appDashboardId: string };
type SeriesOption = { metricName: string; panelId: number; panelTitle: string; dashboardLabel: string };

/**
 * The dashboards of one source for a system/environment. Callers need the list for
 * their own dropdowns too (the comparison section maps dashboard names across runs),
 * so it is a hook rather than private state inside the cascade.
 */
export function useSourceDashboards(
  source: MetricSource,
  systemUnderTestId?: string,
  environment?: string,
  workload?: string,
): SourceDashboardOption[] {
  const [dashboards, setDashboards] = useState<SourceDashboardOption[]>([]);

  useEffect(() => {
    if (!systemUnderTestId || !environment) {
      setDashboards([]);
      return;
    }
    let cancelled = false;
    if (source === 'grafana' || source === 'performance-metrics') {
      // Performance-test metrics live in their own artificial dashboards, listed by the same
      // endpoint and told apart by their source type.
      const belongs = source === 'grafana' ? isGrafana : isPerformanceTest;
      // hasData: a dashboard with no stored metrics has no panels to pick, so offering it is
      // an invitation to a dead end. The management view deliberately still lists them.
      const params = new URLSearchParams({ systemId: systemUnderTestId, environment, hasData: 'true' });
      authenticatedFetch(`/grafana/application-dashboards?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : undefined))
        .then((data: { id?: string; dashboard_label?: string; source_type?: string }[] | undefined) => {
          if (cancelled) return;
          if (!Array.isArray(data)) { setDashboards([]); return; }
          setDashboards(
            data.filter((d) => belongs(d) && d.dashboard_label)
              .map((d) => ({ label: d.dashboard_label as string, appDashboardId: d.id })),
          );
        })
        .catch(() => { if (!cancelled) setDashboards([]); });
    } else if (workload) {
      fetchDynatraceDashboards(systemUnderTestId, environment, workload)
        .then((data) => {
          if (!cancelled) setDashboards(data.map((d) => ({ label: d.dashboardLabel, hostLabels: d.hostLabels })));
        })
        .catch(() => { if (!cancelled) setDashboards([]); });
    }
    return () => { cancelled = true; };
  }, [source, systemUnderTestId, environment, workload]);

  return dashboards;
}

/** `JVM, Heap` → `JVM and Heap`; the Oxford-less join a sentence wants. */
function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export interface MetricSelectionScope {
  dashboards: string[];
  /** Dashboards with at least one panel picked, when any panel is picked at all. */
  droppedDashboards: string[];
  panelsPicked: number;
  /** Titles of picked panels with no series picked, when any series is picked at all. */
  droppedPanels: string[];
  seriesPicked: number;
}

/**
 * What the current selection actually covers, in a sentence.
 *
 * This is not decoration. "A level left empty means everything below it" is generous in
 * the direction that surprises people — a config that picks two dashboards and no panels
 * reports on every panel they have — and the older bug was reporting on a dashboard the
 * user thought they had excluded by picking panels only on its sibling. So the note
 * always says which way each empty level is being read, and names anything being
 * dropped.
 */
export function metricSelectionScopeNote(scope: MetricSelectionScope): string {
  if (scope.dashboards.length === 0) return 'Nothing in scope yet — pick a dashboard.';

  const parts: string[] = [];
  if (scope.droppedDashboards.length > 0) {
    const they = scope.droppedDashboards.length === 1 ? 'it is' : 'they are';
    parts.push(`No panel picked on ${andList(scope.droppedDashboards)}, so ${they} left out.`);
  }
  if (scope.droppedPanels.length > 0) {
    const they = scope.droppedPanels.length === 1 ? 'it is' : 'they are';
    parts.push(`No series picked on ${andList(scope.droppedPanels)}, so ${they} left out.`);
  }

  if (scope.panelsPicked === 0) {
    parts.push('Every panel and series of the picked dashboards is included.');
  } else if (scope.seriesPicked === 0) {
    parts.push('Every series of the picked panels is included.');
  } else {
    parts.push('Exactly the picked series is included.');
  }
  return parts.join(' ');
}

interface MetricSelectionCascadeProps {
  source: MetricSource;
  dashboards: SourceDashboardOption[];
  systemUnderTestId?: string;
  testEnvironment?: string;
  workload?: string;
  /** Anchor run — the URL panels list their series (the run's normalized URLs) from it. */
  testRunId?: string;
  /**
   * Whether to offer the virtual URL panels. The comparison section can compare them from
   * the sampler rollup; anything reading only ds_metric_statistics must leave them out or
   * it offers panels it cannot answer.
   */
  includeUrlPanels?: boolean;
  value: MetricSelectionValue;
  /** Called with only the three cascade keys — the caller merges them into its config. */
  onChange: (value: MetricSelectionValue) => void;
}

export function MetricSelectionCascade({
  source,
  dashboards,
  systemUnderTestId,
  testEnvironment,
  workload,
  testRunId,
  includeUrlPanels = false,
  value,
  onChange,
}: MetricSelectionCascadeProps) {
  const [panelOptions, setPanelOptions] = useState<PanelOption[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const [seriesOptions, setSeriesOptions] = useState<SeriesOption[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  // One query per column. Deliberately NOT reset when the selection changes: narrowing
  // dashboards to "docker" and then stepping through their panels is the flow this is for.
  const [dashboardQuery, setDashboardQuery] = useState('');
  const [panelQuery, setPanelQuery] = useState('');
  const [seriesQuery, setSeriesQuery] = useState('');
  const theme = chartTheme(useTheme().palette.mode === 'dark' ? 'dark' : 'light');

  // Configs saved before multi-select carried one dashboard; read it as a list of one.
  const selectedDashboards = value.dashboardLabels ?? (value.dashboardLabel ? [value.dashboardLabel] : []);
  const selectedPanels = value.panels ?? [];
  const selectedSeries = value.series ?? [];
  const panelDashboard = (p: { dashboardLabel?: string }) => p.dashboardLabel ?? selectedDashboards[0] ?? '';
  // Effects key off the selection contents, not the array identity onChange keeps recreating.
  const dashboardsKey = selectedDashboards.join('\u0000');
  const panelsKey = selectedPanels.map((p) => `${panelDashboard(p)}\u0000${p.id}`).join('|');

  // Load the panels of every selected dashboard. Both sources answer from the stored
  // statistics, so the list is exactly the panels that HAVE something to show.
  useEffect(() => {
    const labels = dashboardsKey ? dashboardsKey.split('\u0000') : [];
    if (labels.length === 0) {
      setPanelOptions([]);
      return;
    }
    let cancelled = false;
    setPanelsLoading(true);
    Promise.all(labels.map(async (label): Promise<PanelOption[]> => {
      if (source === 'dynatrace') {
        if (!systemUnderTestId || !testEnvironment) return [];
        const metrics = await fetchDynatraceMetrics(systemUnderTestId, testEnvironment, workload, label);
        return metrics.map((m) => ({
          id: m.panelId, title: m.panelTitle, dashboardLabel: label, appDashboardId: m.applicationDashboardId,
        }));
      }
      const appDashboardId = dashboards.find((d) => d.label === label)?.appDashboardId;
      if (!appDashboardId) return [];
      const res = await authenticatedFetch(
        `/metrics/ds-metrics/panels-by-dashboard?applicationDashboardId=${encodeURIComponent(appDashboardId)}`,
      );
      if (!res.ok) return [];
      const rows: { panel_id: number; panel_title: string }[] = await res.json();
      const panels = (Array.isArray(rows) ? rows : []).map((r) => ({
        id: r.panel_id, title: r.panel_title, dashboardLabel: label, appDashboardId,
      }));
      // Performance-test dashboards store one row per series with the whole distribution,
      // so "Transaction RT Avg/P90/P95/P99" are four names for the same data. The compare
      // card collapses them to a single "Transaction RT"; this list follows it, or the same
      // series would be offered four times over.
      if (source !== 'performance-metrics') return panels;
      const urlPanels = includeUrlPanels
        ? buildUrlPanels(appDashboardId).map((p) => ({
            id: p.id, title: p.title, dashboardLabel: label, appDashboardId,
          }))
        : [];
      return collapsePerfRtPanels([...panels, ...urlPanels]);
    }))
      .then((lists) => { if (!cancelled) setPanelOptions(lists.flat()); })
      .catch(() => { if (!cancelled) setPanelOptions([]); })
      .finally(() => { if (!cancelled) setPanelsLoading(false); });
    return () => { cancelled = true; };
  }, [source, dashboardsKey, dashboards, systemUnderTestId, testEnvironment, workload, includeUrlPanels]);

  // Load the series of every selected panel.
  useEffect(() => {
    if (!panelsKey) {
      setSeriesOptions([]);
      return;
    }
    let cancelled = false;
    setSeriesLoading(true);
    Promise.all(selectedPanels.map(async (panel): Promise<SeriesOption[]> => {
      const dashboardLabel = panelDashboard(panel);
      // A URL panel's series are the run's normalized URLs, which live outside the
      // dashboard's stored metrics.
      if (isUrlPanel(panel.id)) {
        if (!testRunId) return [];
        const urls = await fetchUrlDistinctNames(testRunId);
        return urls.map((metricName) => ({
          metricName, panelId: panel.id, panelTitle: panel.title, dashboardLabel,
        }));
      }
      const option = panelOptions.find((o) => o.id === panel.id && o.dashboardLabel === dashboardLabel);
      if (!option) return [];
      const params = new URLSearchParams({
        applicationDashboardId: option.appDashboardId,
        panelId: String(panel.id),
        // Same scoping the compare card needs: without a run this lists every series the
        // panel ever recorded, including names no run produces any more.
        ...(testRunId ? { testRunId } : {}),
      });
      const res = await authenticatedFetch(`/metrics/ds-metrics/distinct-names?${params.toString()}`);
      if (!res.ok) return [];
      const names: string[] = await res.json();
      // The run-wide aggregate is a series the panel has no row for — the report rolls the
      // whole run up for it. Offered on the response-time panels, which are the ones the
      // comparison can aggregate.
      const spec = getAggregateSpec(panel.id);
      const aggregatable = source === 'performance-metrics' && spec
        && (spec.metric === 'transaction_response_time' || spec.metric === 'request_response_time')
        // The all-aggregated dashboard already lists a real series under this name.
        && !names.includes(ALL_AGGREGATED_OPTION);
      const withAggregate = aggregatable ? [ALL_AGGREGATED_OPTION, ...names] : names;
      return (Array.isArray(withAggregate) ? withAggregate : []).map((metricName) => ({
        metricName, panelId: panel.id, panelTitle: panel.title, dashboardLabel,
      }));
    }))
      .then((lists) => { if (!cancelled) setSeriesOptions(lists.flat()); })
      .catch(() => { if (!cancelled) setSeriesOptions([]); })
      .finally(() => { if (!cancelled) setSeriesLoading(false); });
    return () => { cancelled = true; };
    // selectedPanels is read through panelsKey; panelOptions supplies the dashboard ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, panelsKey, panelOptions, testRunId]);

  // Named in the helper text: with picks at a level, the parents that got none are out of scope.
  const droppedDashboards = selectedPanels.length > 0
    ? selectedDashboards.filter((l) => !selectedPanels.some((p) => panelDashboard(p) === l))
    : [];
  const droppedPanels = selectedSeries.length > 0
    ? selectedPanels.filter((p) =>
        !selectedSeries.some((sr) => sr.dashboardLabel === panelDashboard(p) && sr.panelId === p.id))
    : [];

  // Dropping a dashboard has to drop the panels and series that hung off it, or the
  // report silently keeps using a dashboard the form no longer shows.
  const setDashboards = (labels: string[]) => {
    const kept = new Set(labels);
    onChange({
      dashboardLabels: labels,
      dashboardLabel: undefined,
      panels: selectedPanels.filter((p) => kept.has(panelDashboard(p))),
      series: selectedSeries.filter((sr) => kept.has(sr.dashboardLabel)),
    });
  };

  const setPanels = (panels: { id: number; title: string; dashboardLabel?: string }[]) => {
    const kept = new Set(panels.map((p) => `${panelDashboard(p)}\u0000${p.id}`));
    onChange({
      dashboardLabels: selectedDashboards,
      panels,
      series: selectedSeries.filter((sr) => kept.has(`${sr.dashboardLabel}\u0000${sr.panelId}`)),
    });
  };

  const setSeries = (series: { dashboardLabel: string; panelId: number; metricName: string }[]) => {
    onChange({ dashboardLabels: selectedDashboards, panels: selectedPanels, series });
  };

  // Visible = what the column's filter leaves. Select all / Clear operate on THIS set,
  // not the whole list: with 90 dashboards loaded, a "Select all" that ignored a query and
  // picked all 90 would be a trap rather than a shortcut.
  const visibleDashboards = dashboards.filter((d) => cascadeMatchesQuery(dashboardQuery, d.label));
  const visiblePanels = panelOptions.filter((o) => cascadeMatchesQuery(panelQuery, o.title, o.dashboardLabel));
  const visibleSeries = seriesOptions.filter((o) =>
    cascadeMatchesQuery(seriesQuery, o.metricName, o.panelTitle, o.dashboardLabel));

  const pickedDashboards = new Set(selectedDashboards);
  const panelKey = (p: { id: number; dashboardLabel?: string }) => `${panelDashboard(p)}\u0000${p.id}`;
  const pickedPanels = new Set(selectedPanels.map(panelKey));
  const seriesKey = (sr: { dashboardLabel: string; panelId: number; metricName: string }) =>
    `${sr.dashboardLabel}\u0000${sr.panelId}\u0000${sr.metricName}`;
  const pickedSeries = new Set(selectedSeries.map(seriesKey));

  const allVisibleDashboardsPicked =
    visibleDashboards.length > 0 && visibleDashboards.every((d) => pickedDashboards.has(d.label));
  const allVisiblePanelsPicked =
    visiblePanels.length > 0 && visiblePanels.every((o) => pickedPanels.has(panelKey(o)));
  const allVisibleSeriesPicked =
    visibleSeries.length > 0 && visibleSeries.every((o) => pickedSeries.has(seriesKey(o)));

  const asPanel = (o: PanelOption) => ({ id: o.id, title: o.title, dashboardLabel: o.dashboardLabel });
  const asSeries = (o: SeriesOption) =>
    ({ dashboardLabel: o.dashboardLabel, panelId: o.panelId, metricName: o.metricName });

  const panelGroups = cascadeGroupBy(visiblePanels, (o) => o.dashboardLabel);
  const seriesGroups = cascadeGroupBy(visibleSeries, (o) => `${o.dashboardLabel} / ${o.panelTitle}`);

  return (
    <CascadeFrame
      theme={theme}
      footer={
        <Typography sx={{ fontSize: 12, color: theme.muted }}>
          {metricSelectionScopeNote({
            dashboards: selectedDashboards,
            droppedDashboards,
            panelsPicked: selectedPanels.length,
            droppedPanels: droppedPanels.map((p) => p.title),
            seriesPicked: selectedSeries.length,
          })}
        </Typography>
      }
    >
      <CascadeColumn
        theme={theme}
        label="Dashboards"
        heading={cascadeCountLabel('Dashboards', visibleDashboards.length, dashboards.length)}
        caption={
          visibleDashboards.length === 0 && dashboardQuery.trim()
            ? `No dashboards match "${dashboardQuery.trim()}"`
            : `${dashboards.length} available`
        }
        allPicked={allVisibleDashboardsPicked}
        onToggleAll={() => setDashboards(
          allVisibleDashboardsPicked
            // Clear only what is on screen; a selection hidden by the query stays.
            ? selectedDashboards.filter((l) => !visibleDashboards.some((d) => d.label === l))
            : [...selectedDashboards, ...visibleDashboards.filter((d) => !pickedDashboards.has(d.label)).map((d) => d.label)],
        )}
        toggleDisabled={visibleDashboards.length === 0}
        query={dashboardQuery}
        onQueryChange={setDashboardQuery}
        queryPlaceholder="filter dashboards"
        divider
      >
        {visibleDashboards.map((d) => (
          <CascadeRow
            key={d.label}
            theme={theme}
            checked={pickedDashboards.has(d.label)}
            onToggle={() => setDashboards(
              pickedDashboards.has(d.label)
                ? selectedDashboards.filter((l) => l !== d.label)
                : [...selectedDashboards, d.label],
            )}
            label={d.label}
            trailing={<HostLabelChips labels={d.hostLabels} />}
          />
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
                : `${panelOptions.length} available`
        }
        allPicked={allVisiblePanelsPicked}
        onToggleAll={() => setPanels(
          allVisiblePanelsPicked
            ? selectedPanels.filter((p) => !visiblePanels.some((o) => panelKey(o) === panelKey(p)))
            : [...selectedPanels, ...visiblePanels.filter((o) => !pickedPanels.has(panelKey(o))).map(asPanel)],
        )}
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
            {panels.map((o) => (
              <CascadeRow
                key={panelKey(o)}
                theme={theme}
                checked={pickedPanels.has(panelKey(o))}
                onToggle={() => setPanels(
                  pickedPanels.has(panelKey(o))
                    ? selectedPanels.filter((p) => panelKey(p) !== panelKey(o))
                    : [...selectedPanels, asPanel(o)],
                )}
                label={o.title}
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
                : `${seriesOptions.length} available`
        }
        allPicked={allVisibleSeriesPicked}
        onToggleAll={() => setSeries(
          allVisibleSeriesPicked
            ? selectedSeries.filter((sr) => !visibleSeries.some((o) => seriesKey(o) === seriesKey(sr)))
            : [...selectedSeries, ...visibleSeries.filter((o) => !pickedSeries.has(seriesKey(o))).map(asSeries)],
        )}
        toggleDisabled={visibleSeries.length === 0}
        loading={seriesLoading}
        empty={selectedPanels.length === 0}
        query={seriesQuery}
        onQueryChange={setSeriesQuery}
        queryPlaceholder="filter series"
      >
        {seriesGroups.map(([group, options]) => (
          <CascadeGroup key={group} label={group} color={theme.faint}>
            {options.map((o) => (
              <CascadeRow
                key={seriesKey(o)}
                theme={theme}
                checked={pickedSeries.has(seriesKey(o))}
                onToggle={() => setSeries(
                  pickedSeries.has(seriesKey(o))
                    ? selectedSeries.filter((sr) => seriesKey(sr) !== seriesKey(o))
                    : [...selectedSeries, asSeries(o)],
                )}
                label={o.metricName}
              />
            ))}
          </CascadeGroup>
        ))}
      </CascadeColumn>
    </CascadeFrame>
  );
}
