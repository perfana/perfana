'use client';

/**
 * Dashboards → panels → series pickers, shared by the report sections that scope
 * themselves to metric data (comparisons, trends).
 *
 * Each level is multi-select with a select-all, and a level left entirely empty means
 * "everything under the level above it" — so the common case, compare/trend these two
 * dashboards, stays one click. Pick anything at a level and only the picks count: a
 * dashboard with no panel picked, or a panel with no series picked, drops out. The
 * renderer reads the same rule (section-selections.ts), and the helper text below names
 * whatever is dropping out, because silently reporting on it is the older bug.
 */

import { useEffect, useState } from 'react';
import { Autocomplete, Box, Button, TextField } from '@mui/material';
import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceDashboards, fetchDynatraceMetrics } from '@/lib/dynatrace';
import { isGrafana, isPerformanceTest } from '@/lib/metrics-source-utils';
import { ALL_AGGREGATED_OPTION, collapsePerfRtPanels, getAggregateSpec } from '@/lib/aggregated-perf-series';
import { buildUrlPanels, fetchUrlDistinctNames, isUrlPanel } from '@/lib/url-perf-panels';

export type MetricSource = 'performance-metrics' | 'grafana' | 'dynatrace';

export interface SourceDashboardOption {
  label: string;
  /** application_dashboards.id — the key both the panel and the series endpoints take */
  appDashboardId?: string;
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
      const params = new URLSearchParams({ systemId: systemUnderTestId, environment });
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
        .then((data) => { if (!cancelled) setDashboards(data.map((d) => ({ label: d.dashboardLabel }))); })
        .catch(() => { if (!cancelled) setDashboards([]); });
    }
    return () => { cancelled = true; };
  }, [source, systemUnderTestId, environment, workload]);

  return dashboards;
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
      });
      const res = await authenticatedFetch(`/metrics/ds-metrics/distinct-names?${params.toString()}`);
      if (!res.ok) return [];
      const names: string[] = await res.json();
      // The run-wide aggregate is a series the panel has no row for — the report rolls the
      // whole run up for it. Offered on the response-time panels, which are the ones the
      // comparison can aggregate.
      const spec = getAggregateSpec(panel.id);
      const aggregatable = source === 'performance-metrics' && spec
        && (spec.metric === 'transaction_response_time' || spec.metric === 'request_response_time');
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

  return (
    <>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <Autocomplete
          multiple
          // Picking a dashboard/panel/series is almost never a single choice, and the popup
          // closing after each one made "select these six" six trips through the dropdown.
          disableCloseOnSelect
          limitTags={4}
          options={dashboards.map((d) => d.label)}
          value={selectedDashboards}
          onChange={(_, v) => setDashboards(v)}
          size="small"
          sx={{ flex: 1 }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Dashboards"
              variant="outlined"
              fullWidth
              helperText={`${dashboards.length} available`}
            />
          )}
        />
        <Button
          size="small"
          onClick={() => setDashboards(
            selectedDashboards.length === dashboards.length ? [] : dashboards.map((d) => d.label),
          )}
          disabled={dashboards.length === 0}
          sx={{ mt: 0.5, flexShrink: 0 }}
        >
          {selectedDashboards.length === dashboards.length && dashboards.length > 0 ? 'Clear' : 'Select all'}
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <Autocomplete
          multiple
          // Picking a dashboard/panel/series is almost never a single choice, and the popup
          // closing after each one made "select these six" six trips through the dropdown.
          disableCloseOnSelect
          limitTags={4}
          options={panelOptions}
          groupBy={(o) => o.dashboardLabel}
          getOptionLabel={(o) => o.title}
          isOptionEqualToValue={(o, v) => o.id === v.id && o.dashboardLabel === (v.dashboardLabel ?? o.dashboardLabel)}
          value={selectedPanels.map((p) =>
            panelOptions.find((o) => o.id === p.id && o.dashboardLabel === panelDashboard(p))
              ?? { id: p.id, title: p.title, dashboardLabel: panelDashboard(p), appDashboardId: '' },
          )}
          onChange={(_, v) => setPanels(v.map((o) => ({ id: o.id, title: o.title, dashboardLabel: o.dashboardLabel })))}
          disabled={selectedDashboards.length === 0}
          loading={panelsLoading}
          size="small"
          sx={{ flex: 1 }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Panels"
              variant="outlined"
              fullWidth
              helperText={
                selectedDashboards.length === 0
                  ? 'Select a dashboard to see its panels'
                  : panelsLoading
                    ? 'Loading panels…'
                    : droppedDashboards.length > 0
                      ? `${panelOptions.length} available — no panel picked on ${droppedDashboards.join(', ')}, so ${droppedDashboards.length === 1 ? 'it is' : 'they are'} left out`
                      : `${panelOptions.length} available — leave empty to include every panel`
              }
            />
          )}
        />
        <Button
          size="small"
          onClick={() => setPanels(
            selectedPanels.length === panelOptions.length
              ? []
              : panelOptions.map((o) => ({ id: o.id, title: o.title, dashboardLabel: o.dashboardLabel })),
          )}
          disabled={panelOptions.length === 0}
          sx={{ mt: 0.5, flexShrink: 0 }}
        >
          {selectedPanels.length === panelOptions.length && panelOptions.length > 0 ? 'Clear' : 'Select all'}
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <Autocomplete
          multiple
          // Picking a dashboard/panel/series is almost never a single choice, and the popup
          // closing after each one made "select these six" six trips through the dropdown.
          disableCloseOnSelect
          limitTags={6}
          options={seriesOptions}
          groupBy={(o) => `${o.dashboardLabel} / ${o.panelTitle}`}
          getOptionLabel={(o) => o.metricName}
          isOptionEqualToValue={(o, v) =>
            o.metricName === v.metricName && o.panelId === v.panelId && o.dashboardLabel === v.dashboardLabel}
          value={selectedSeries.map((sr) =>
            seriesOptions.find((o) =>
              o.metricName === sr.metricName && o.panelId === sr.panelId && o.dashboardLabel === sr.dashboardLabel,
            ) ?? { ...sr, panelTitle: '' },
          )}
          onChange={(_, v) => setSeries(
            v.map((o) => ({ dashboardLabel: o.dashboardLabel, panelId: o.panelId, metricName: o.metricName })),
          )}
          disabled={selectedPanels.length === 0}
          loading={seriesLoading}
          size="small"
          sx={{ flex: 1 }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Series"
              variant="outlined"
              fullWidth
              helperText={
                selectedPanels.length === 0
                  ? 'Select a panel to see its series'
                  : seriesLoading
                    ? 'Loading series…'
                    : droppedPanels.length > 0
                      ? `${seriesOptions.length} available — no series picked on ${droppedPanels.map((p) => p.title).join(', ')}, so ${droppedPanels.length === 1 ? 'it is' : 'they are'} left out`
                      : `${seriesOptions.length} available — leave empty to include every series`
              }
            />
          )}
        />
        <Button
          size="small"
          onClick={() => setSeries(
            selectedSeries.length === seriesOptions.length
              ? []
              : seriesOptions.map((o) => ({ dashboardLabel: o.dashboardLabel, panelId: o.panelId, metricName: o.metricName })),
          )}
          disabled={seriesOptions.length === 0}
          sx={{ mt: 0.5, flexShrink: 0 }}
        >
          {selectedSeries.length === seriesOptions.length && seriesOptions.length > 0 ? 'Clear' : 'Select all'}
        </Button>
      </Box>
    </>
  );
}
