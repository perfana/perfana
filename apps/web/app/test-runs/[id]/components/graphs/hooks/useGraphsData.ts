'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceDashboards, DynatraceDashboard } from '@/lib/dynatrace';
import {
  ApplicationDashboard,
  ChartTimeRange,
  SeriesConfig,
  MetricDataPoint,
} from '../types';
import { generateChartName } from '../utils';
import {
  ALL_AGGREGATED_OPTION,
  isAllAggregatedDashboard,
  getAggregateSpec,
  buildAggregatedMetricName,
} from '@/lib/aggregated-perf-series';
import {
  aggregatedYAxisFormat,
  fetchAggregatedSeriesData,
} from '../utils/aggregated-series';
import { isGrafana, isPerformanceTest } from '@/lib/metrics-source-utils';
import { nextFreeSlot } from '@/lib/charts';
import type { AxisDisplayMode } from '@/components/charts';
import { TestRun } from '@/types/test-runs';
import { mapLimit, OPTION_FETCH_CONCURRENCY, type SeriesPick } from '../../shared/metric-options';

/**
 * One retry of a failed panel request, and only one.
 *
 * This request is shared by every series on the panel (see `fetchSeriesBatch`), which is
 * what collapses hundreds of identical fetches into one — but it also widens the blast
 * radius of a failure from one series to the whole group. A deterministic failure (404,
 * 403, a consistent 500) would have taken every series with it under the old per-series
 * fan-out too; a one-off blip would not have, because each series carried its own request.
 * A single retry buys back that robustness without buying back the N requests.
 */
const PANEL_FETCH_ATTEMPTS = 2;

/**
 * A synthetic run-wide aggregate, which has its own endpoint — NOT the identically named
 * stored series on the real `Performance test metrics all aggregated` dashboard, where the
 * name is an ordinary metric on every panel.
 */
function isSyntheticAggregated(series: SeriesConfig): boolean {
  return series.metricName.startsWith(ALL_AGGREGATED_OPTION)
    && !isAllAggregatedDashboard(series.dashboardLabel);
}

interface UseGraphsDataProps {
  testRun: TestRun | null;
  testRunId: string;
  graphsExpanded: boolean;
}

export function useGraphsData({ testRun, testRunId }: UseGraphsDataProps) {
  // Dashboard state — the cascade (MetricSeriesCascade) holds the panel/series selection.
  const [dashboards, setDashboards] = useState<ApplicationDashboard[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [dynatraceDashboards, setDynatraceDashboards] = useState<DynatraceDashboard[]>([]);
  const [dynatraceDashboardsLoading, setDynatraceDashboardsLoading] = useState(false);

  // Added series state
  const [addedSeries, setAddedSeries] = useState<SeriesConfig[]>([]);

  // Chart name state
  const [chartName, setChartName] = useState<string>('');

  // Overlay, or one lane per unit family. Saved with the preset.
  const [axisMode, setAxisMode] = useState<AxisDisplayMode>('overlay');

  // Series data state for chart visualization
  const [seriesData, setSeriesData] = useState<Map<string, MetricDataPoint[]>>(new Map());
  const [chartDataLoading, setChartDataLoading] = useState(false);

  // The window a chart zoom narrowed the fetches to, or null for the whole run. Held here
  // rather than in the chart so a series added while zoomed is fetched for the same window.
  const [zoomRange, setZoomRange] = useState<ChartTimeRange | null>(null);
  // Which zoom the in-flight refetch belongs to. A zoom is one gesture but N requests, and
  // a narrow window answers faster than a wide one — so without this a zoom-out issued
  // after a zoom-in can be overwritten by the zoom-in's later reply.
  const zoomRequestRef = useRef(0);

  /**
   * Fetch application dashboards for the test run's system and environment
   */
  const fetchApplicationDashboards = useCallback(async (): Promise<ApplicationDashboard[]> => {
    if (!testRun) {
      return [];
    }

    try {
      setDashboardsLoading(true);
      const systemId = testRun.system_under_test_id;
      const environment = testRun.test_environment;

      const url = `/grafana/application-dashboards?systemId=${encodeURIComponent(systemId || '')}&environment=${encodeURIComponent(environment)}`;

      const response = await authenticatedFetch(url, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const dashboardsData = await response.json();
        setDashboards(dashboardsData);
        return dashboardsData;
      } else {
        console.warn('Failed to fetch application dashboards:', response.statusText);
        setDashboards([]);
        return [];
      }
    } catch (error) {
      console.error('Error fetching application dashboards:', error);
      setDashboards([]);
      return [];
    } finally {
      setDashboardsLoading(false);
    }
  }, [testRun]);

  /**
   * Fetch Dynatrace dashboards for the test run
   */
  const fetchDynatraceDashboardsList = useCallback(async () => {
    if (!testRun) {
      return;
    }

    try {
      setDynatraceDashboardsLoading(true);
      const systemId = testRun.system_under_test_id;
      const environment = testRun.test_environment;
      const workload = testRun.workload;

      if (!systemId || !environment || !workload) {
        setDynatraceDashboards([]);
        return;
      }

      const dashboardsData = await fetchDynatraceDashboards(systemId, environment, workload);
      setDynatraceDashboards(dashboardsData);
    } catch (error) {
      console.error('Error fetching Dynatrace dashboards:', error);
      setDynatraceDashboards([]);
    } finally {
      setDynatraceDashboardsLoading(false);
    }
  }, [testRun]);

  /**
   * One panel's rows, every metric on it. The endpoint has no metric filter — it answers
   * with the whole panel and the caller picks its series out — so this is deliberately
   * NOT per series: `fetchSeriesBatch` below issues it once per panel and shares the
   * answer, which is what keeps a 586-series perf-test panel at one request per zoom.
   */
  const fetchPanelRows = useCallback(async (
    series: SeriesConfig,
    range: ChartTimeRange | null,
    attempt = 1,
  ): Promise<MetricDataPoint[]> => {
    const again = (): Promise<MetricDataPoint[]> =>
      attempt < PANEL_FETCH_ATTEMPTS
        ? fetchPanelRows(series, range, attempt + 1)
        : Promise.resolve([]);
    try {
      const params = new URLSearchParams({
        applicationDashboardId: series.dashboardId,
        panelId: series.panelId.toString()
      });
      if (series.metricsSourceId) {
        params.set('metricsSourceId', series.metricsSourceId);
      }
      if (range) {
        params.set('from', range.from);
        params.set('to', range.to);
      }

      const testRunIdForQuery = testRun?.test_run_id || testRunId;
      const response = await authenticatedFetch(
        `/metrics/ds-metrics/${testRunIdForQuery}/${series.panelId}?${params.toString()}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const body = await response.json();
        // Always an array out, whatever came back: the callers `.filter` this, and that
        // call now sits outside this try — a malformed body would throw there and take
        // every series on the panel's batch with it.
        return Array.isArray(body) ? body : [];
      }
      console.warn(`Failed to fetch data for panel ${series.panelId}:`, response.statusText);
      return again();
    } catch (error) {
      console.error(`Error fetching data for panel ${series.panelId}:`, error);
      return again();
    }
  }, [testRun, testRunId]);

  /**
   * Fetch metric data for a series from the backend
   */
  const fetchSeriesData = useCallback(async (
    series: SeriesConfig,
    rangeOverride?: ChartTimeRange | null,
  ): Promise<MetricDataPoint[]> => {
    // `undefined` means "whatever window the chart is on"; an explicit null means the whole
    // run, which is what a zoom reset passes before the state has caught up.
    const range = rangeOverride === undefined ? zoomRange : rangeOverride;
    if (isSyntheticAggregated(series)) {
      const points = await fetchAggregatedSeriesData(testRun?.test_run_id || testRunId, series);
      // The aggregated endpoint has no window parameter (it is fixed at 60s buckets), so
      // the window is applied here — otherwise this one series keeps the whole run's
      // timestamps and the chart's index axis spans the run again.
      if (!range) return points;
      // Parsed, not compared as strings: these two series' timestamps come from different
      // endpoints and only agree once they are instants.
      const fromMs = Date.parse(range.from);
      const toMs = Date.parse(range.to);
      return points.filter((p) => {
        const ms = Date.parse(p.time);
        return ms >= fromMs && ms <= toMs;
      });
    }
    const rows = await fetchPanelRows(series, range);
    return rows.filter((m) => m.metric_name === series.metricName);
  }, [testRun, testRunId, zoomRange, fetchPanelRows]);

  /**
   * Fetch a list of series, ONE request per panel rather than one per series.
   *
   * The panel endpoint returns every metric on the panel whatever the caller asked for, so
   * a per-series fan-out fetches the same payload once per line: a select-all over a
   * perf-test dashboard is one series per transaction (hundreds), and a zoom repeats the
   * whole fan-out on every drag. Grouping on (dashboard, panel, source) — the three fields
   * that decide the request — collapses that to one request per panel, and each series
   * picks its own metric out of the shared answer.
   *
   * The synthetic "All aggregated" series keep their own endpoint, which is per series.
   */
  const fetchSeriesBatch = useCallback(async (
    list: SeriesConfig[],
    range: ChartTimeRange | null,
  ): Promise<Array<readonly [string, MetricDataPoint[]]>> => {
    const panels = new Map<string, SeriesConfig[]>();
    const aggregated: SeriesConfig[] = [];
    for (const series of list) {
      if (isSyntheticAggregated(series)) {
        aggregated.push(series);
        continue;
      }
      const key = `${series.dashboardId}|${series.panelId}|${series.metricsSourceId ?? ''}`;
      const group = panels.get(key);
      if (group) group.push(series);
      else panels.set(key, [series]);
    }

    // One task list, so the two kinds of request share ONE concurrency budget: two
    // `mapLimit`s under a `Promise.all` would put 2 x OPTION_FETCH_CONCURRENCY in flight.
    const tasks: Array<() => Promise<Array<readonly [string, MetricDataPoint[]]>>> = [
      ...[...panels.values()].map((group) => async () => {
        // Every series in the group answers to the same request, so the first one's
        // dashboard/panel/source is the whole group's.
        const rows = await fetchPanelRows(group[0]!, range);
        return group.map(
          (series) =>
            [series.id, rows.filter((m) => m.metric_name === series.metricName)] as const,
        );
      }),
      ...aggregated.map((series) => async () => [
        [series.id, await fetchSeriesData(series, range)] as const,
      ]),
    ];

    const fetched = await mapLimit(tasks, OPTION_FETCH_CONCURRENCY, (task) => task());
    return fetched.flat();
  }, [fetchPanelRows, fetchSeriesData]);

  /**
   * Narrow every series to a zoom window, or widen back to the whole run with `null`.
   *
   * The point is resolution, not filtering: the API spends its 4000-point LTTB budget on
   * the range it is given, divided across the panel's series, so a window a tenth the
   * length of the run comes back with up to ten times the detail — down to the bucket size
   * the data was stored at, which no zoom can go below.
   */
  const applyZoomRange = useCallback(async (range: ChartTimeRange | null) => {
    setZoomRange(range);
    if (addedSeries.length === 0) return;

    const request = ++zoomRequestRef.current;
    setChartDataLoading(true);
    try {
      const fetched = await fetchSeriesBatch(addedSeries, range);
      // Replaced wholesale, not merged: a narrowed window is the new truth for every series,
      // so a leftover entry would draw outside it. Which is why the stale guard is needed.
      if (request === zoomRequestRef.current) setSeriesData(new Map(fetched));
    } catch (error) {
      console.error('Error refetching series data for the zoom range:', error);
    } finally {
      if (request === zoomRequestRef.current) setChartDataLoading(false);
    }
  }, [addedSeries, fetchSeriesBatch]);

  /**
   * Add the picked series and fetch their data. Each pick carries its own dashboard and
   * panel, so one click can add series from several panels across several dashboards.
   */
  const handleAddSeries = useCallback(async (picks: SeriesPick[], showToast: (message: string) => void) => {
    // Colour slots are handed out as the LOWEST free one, not by list position: a series
    // removed frees its slot for the next one added, and every line that stays keeps the
    // colour the reader has been following.
    const taken = addedSeries.map(s => s.colorSlot);
    const newSeriesList: SeriesConfig[] = picks.map(({ dashboard, panel, metricName }) => {
      const isAggregated = metricName === ALL_AGGREGATED_OPTION
        && !isAllAggregatedDashboard(dashboard.dashboard_label);
      const spec = isAggregated ? getAggregateSpec(panel.id) : null;
      const unit = isAggregated && spec ? aggregatedYAxisFormat(spec.metric) : panel.yAxesFormat;
      const slot = nextFreeSlot(taken);
      taken.push(slot);
      return {
        id: `${dashboard.id}-${panel.id}-${isAggregated ? 'aggregated' : metricName}-${Date.now()}-${Math.random()}`,
        dashboardId: panel.applicationDashboardId || dashboard.id,
        dashboardLabel: dashboard.dashboard_label,
        panelId: panel.id,
        panelTitle: panel.title,
        metricName: isAggregated ? buildAggregatedMetricName(panel.title) : metricName,
        source: panel.source,
        yAxisFormat: unit,
        // Kept alongside, so the series table can show that a changed unit is an
        // override of the panel's own and offer a reset.
        panelYAxisFormat: unit,
        metricsSourceId: panel.metricsSourceId || dashboard.metrics_source_id,
        colorSlot: slot,
      };
    });

    // Filter out duplicates
    const filteredNewSeries = newSeriesList.filter(newSeries =>
      !addedSeries.some(
        existing => existing.dashboardId === newSeries.dashboardId &&
          existing.panelId === newSeries.panelId &&
          existing.metricName === newSeries.metricName
      )
    );

    if (filteredNewSeries.length === 0) {
      showToast('All selected metrics are already added');
      return 0;
    }

    setAddedSeries(prev => [...prev, ...filteredNewSeries]);

    // Fetch data for new series. Bounded, and one request per PANEL rather than per
    // series — a select-all across dashboards is hundreds of series off a handful of
    // panels. Merged functionally so a second add landing while this one is in flight
    // cannot overwrite it from a stale copy of the map.
    setChartDataLoading(true);
    try {
      const fetched = await fetchSeriesBatch(filteredNewSeries, zoomRange);
      setSeriesData(prev => new Map([...prev, ...fetched]));
      showToast(`Added ${filteredNewSeries.length} metric(s) with data`);
      return filteredNewSeries.length;
    } catch (error) {
      console.error('Error fetching series data:', error);
      showToast('Added metrics but failed to load data');
      return filteredNewSeries.length;
    } finally {
      setChartDataLoading(false);
    }
  }, [addedSeries, fetchSeriesBatch, zoomRange]);

  /**
   * Remove a series from the list
   */
  const handleRemoveSeries = useCallback((seriesId: string, showToast: (message: string) => void) => {
    setAddedSeries(prev => prev.filter(s => s.id !== seriesId));

    // Also remove the series data
    setSeriesData(prev => {
      const newMap = new Map(prev);
      newMap.delete(seriesId);
      return newMap;
    });

    showToast('Series removed');
  }, []);

  /**
   * Empty the chart: both the series list and the fetched points behind it.
   *
   * Looping handleRemoveSeries would fire one toast and one render per series — 17 of
   * each on the chart this was asked for — so it is its own handler.
   *
   * axisMode is deliberately kept. chartName is NOT kept, and not by choice here: the
   * effect below regenerates it from `addedSeries` on every change, so clearing resets
   * it to ''. That effect also overwrites a title the user typed as soon as they add or
   * remove a series — pre-existing, and filed in TODOS.md rather than fixed inside a
   * clear-all handler.
   */
  const handleClearAllSeries = useCallback((showToast: (message: string) => void) => {
    // Read the count from this render, NOT from inside the setState updater: the updater
    // has not run by the time the toast fires, so that reported "0 series removed".
    const cleared = addedSeries.length;
    setAddedSeries([]);
    setSeriesData(new Map());
    showToast(cleared === 1 ? 'Series removed' : `${cleared} series removed`);
  }, [addedSeries.length]);

  /**
   * Handle updating the unit for a series
   */
  const handleUpdateSeriesUnit = useCallback((seriesId: string, newUnit: string | null) => {
    setAddedSeries(prev => prev.map(series =>
      series.id === seriesId
        ? { ...series, yAxisFormat: newUnit || undefined }
        : series
    ));
  }, []);

  /**
   * Hide or show a series. It stays in the list (and in the preset) either way — the
   * swatch is a toggle, not a delete.
   */
  const handleToggleSeriesVisibility = useCallback((seriesId: string) => {
    setAddedSeries(prev => prev.map(series =>
      series.id === seriesId ? { ...series, hidden: !series.hidden } : series
    ));
  }, []);

  /**
   * Load dashboards when component mounts (needed for collapsed view)
   */
  useEffect(() => {
    if (testRun) {
      if (dashboards.length === 0) {
        fetchApplicationDashboards();
      }
      if (dynatraceDashboards.length === 0) {
        fetchDynatraceDashboardsList();
      }
    }
  }, [testRun, dashboards.length, dynatraceDashboards.length, fetchApplicationDashboards, fetchDynatraceDashboardsList]);

  /**
   * Update chart name whenever series are added/removed
   */
  useEffect(() => {
    const generatedName = generateChartName(addedSeries);
    setChartName(generatedName);
  }, [addedSeries]);

  /**
   * Get all dashboards merged (grafana + performance-test + dynatrace) for the grouped dropdown
   */
  const getAllDashboardsMerged = useCallback((): ApplicationDashboard[] => {
    // Split regular dashboards by source type (they include artificial dynatrace/perf-test records)
    const grafanaOnly = dashboards.filter(d => isGrafana(d));
    const perfTestOnly = dashboards.filter(d => isPerformanceTest(d));

    // Dynatrace dashboards come from a separate API — convert to ApplicationDashboard shape
    const dynatraceAsDashboards: ApplicationDashboard[] = dynatraceDashboards.map((d, index) => ({
      id: `dynatrace-${index}`,
      dashboard_label: d.dashboardLabel,
      dashboard_name: d.dashboardLabel,
      dashboard_uid: `dynatrace-${d.dashboardLabel}`,
      source_type: 'dynatrace',
    } as ApplicationDashboard));

    return [...grafanaOnly, ...perfTestOnly, ...dynatraceAsDashboards];
  }, [dashboards, dynatraceDashboards]);

  return {
    // State
    dashboards,
    dashboardsLoading,
    dynatraceDashboards,
    dynatraceDashboardsLoading,
    addedSeries,
    chartName,
    seriesData,
    chartDataLoading,
    axisMode,
    zoomRange,

    // State setters
    setAddedSeries,
    setSeriesData,
    setChartName,
    setChartDataLoading,
    setAxisMode,

    // Fetch functions
    fetchApplicationDashboards,
    fetchSeriesData,

    // Handlers
    getAllDashboardsMerged,
    handleAddSeries,
    handleRemoveSeries,
    handleClearAllSeries,
    handleUpdateSeriesUnit,
    handleToggleSeriesVisibility,
    applyZoomRange,
  };
}
