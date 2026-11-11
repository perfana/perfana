'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceDashboards, DynatraceDashboard } from '@/lib/dynatrace';
import {
  ApplicationDashboard,
  Panel,
  MetricStatistic,
  MetricComparison,
  GraphData,
  CompareSeries,
  DataSource,
  RelatedTestRun,
  ComparisonStatus,
} from '../types';
import {
  calculatePercentageDifference,
  buildAggregatedComparisons,
  controlGroupOption,
  isControlGroupOption,
  DEFAULT_DISPLAY_CONFIG,
  DisplayConfig,
} from '../utils/compare-utils';
import {
  CONTROL_GROUP_BASELINE,
  fetchControlGroup,
  fetchControlGroupStatistics,
  type ControlGroup,
} from '@/lib/control-group-baseline';
import { TestRun } from '@/types/test-runs';
import { isGrafana, isPerformanceTest} from '@/lib/metrics-source-utils';
import { getAggregateSpec, fetchAggregatedStatistics } from '@/lib/aggregated-perf-series';
import {
  isUrlPanel,
  getUrlPanelMetric,
  fetchUrlMetricStatistics,
  fetchSamplerUrlMap,
  isRequestPanel,
} from '@/lib/url-perf-panels';

interface UseCompareDataProps {
  testRun: TestRun | null;
  testRunId: string;
  compareExpanded: boolean;
}

export function useCompareData({ testRun, testRunId, compareExpanded }: UseCompareDataProps) {
  // Related test runs state
  const [relatedTestRuns, setRelatedTestRuns] = useState<RelatedTestRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [comparisonStatus, setComparisonStatus] = useState<ComparisonStatus | null>(null);
  const [selectedTestRun, setSelectedTestRun] = useState<RelatedTestRun | null>(null);
  // The run's control group, offered as a baseline. `undefined` until asked for, `null` when
  // the run has none — kept apart so a run with no group is not re-asked on every render.
  const [controlGroup, setControlGroup] = useState<ControlGroup | null | undefined>(undefined);

  // Source and selection state
  const [selectedSource, setSelectedSource] = useState<DataSource>('grafana');
  const [availableSources, setAvailableSources] = useState<DataSource[]>([]);

  // Dashboard state
  const [dashboards, setDashboards] = useState<ApplicationDashboard[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [selectedDashboard, setSelectedDashboard] = useState<ApplicationDashboard | null>(null);

  // Panel state
  const [selectedMetric, setSelectedMetric] = useState<Panel | null>(null);

  // Dynatrace state
  const [dynatraceDashboards, setDynatraceDashboards] = useState<DynatraceDashboard[]>([]);
  const [dynatraceDashboardsLoading, setDynatraceDashboardsLoading] = useState(false);

  // Series selection state
  const [addedSeries, setAddedSeries] = useState<CompareSeries[]>([]);

  // Metrics comparison state
  const [currentMetrics, setCurrentMetrics] = useState<MetricStatistic[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<MetricStatistic[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricComparisons, setMetricComparisons] = useState<MetricComparison[]>([]);

  // Filter state
  const [seriesSearchText, setSeriesSearchText] = useState<string>('');
  const [showPercentiles, setShowPercentiles] = useState<boolean>(false);
  const [displayConfig, setDisplayConfig] = useState<DisplayConfig>(DEFAULT_DISPLAY_CONFIG);

  // Graph state
  const [showGraphs, setShowGraphs] = useState<{ [key: string]: boolean }>({});
  const [graphData, setGraphData] = useState<{ [key: string]: GraphData }>({});
  const [graphLoading, setGraphLoading] = useState<{ [key: string]: boolean }>({});

  // Load related test runs for comparison
  const fetchRelatedTestRuns = useCallback(async () => {
    if (!testRun) return;

    try {
      setLoading(true);
      const system = testRun.systems_under_test?.name;
      const environment = testRun.test_environment;
      const workload = testRun.workload;

      let url = `/test-runs/${testRunId}/related`;
      if (system && environment && workload) {
        const queryParams = new URLSearchParams({ system, environment, workload });
        url += `?${queryParams.toString()}`;
      }

      const response = await authenticatedFetch(url);
      if (response.ok) {
        const data = await response.json();
        setRelatedTestRuns(data || []);

        setComparisonStatus({
          hasBaseline: data.length > 0,
          totalComparisons: Math.min(data.length, 5),
          differences: 0,
          status: data.length > 0 ? 'success' : 'info'
        });
      } else {
        setRelatedTestRuns([]);
        setComparisonStatus({ hasBaseline: false, totalComparisons: 0, differences: 0, status: 'info' });
      }
    } catch (error) {
      console.error('Error fetching related test runs:', error);
      setRelatedTestRuns([]);
      setComparisonStatus({ hasBaseline: false, totalComparisons: 0, differences: 0, status: 'info' });
    } finally {
      setLoading(false);
    }
  }, [testRun, testRunId]);

  // Load Grafana dashboards
  const fetchApplicationDashboards = useCallback(async (): Promise<ApplicationDashboard[]> => {
    if (!testRun) return [];

    try {
      setDashboardsLoading(true);
      const url = `/grafana/application-dashboards?systemId=${encodeURIComponent(testRun.system_under_test_id || '')}&environment=${encodeURIComponent(testRun.test_environment)}&hasData=true`;

      const response = await authenticatedFetch(url, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const dashboardsData = await response.json();
        setDashboards(dashboardsData);
        return dashboardsData;
      } else {
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

  // Load Dynatrace dashboards
  const fetchDynatraceDashboardsList = useCallback(async () => {
    if (!testRun) return;

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

  // Only the latest comparison request may write state. Switching baseline while one is out
  // (control group <-> run, run <-> run) would otherwise let whichever answers last win, pairing
  // one baseline's numbers with the other's legend; the control-group call waits on an extra
  // request per panel, so it routinely answers last.
  const comparisonRequestRef = useRef(0);

  // Fetch metrics comparison
  const fetchMetricsComparison = useCallback(async () => {
    if (!selectedTestRun || !testRun || addedSeries.length === 0) return;
    const request = ++comparisonRequestRef.current;
    const isStale = () => request !== comparisonRequestRef.current;

    // Against the control group the baseline is not a run: its values come from the group's
    // pooled statistics, and the series ADAPT does not pool (URL panels, "All aggregated")
    // are shown with the current value only, never with a stand-in.
    const againstControlGroup = isControlGroupOption(selectedTestRun);
    const runsToRead = againstControlGroup
      ? [testRun.test_run_id]
      : [testRun.test_run_id, selectedTestRun.test_run_id];

    try {
      setMetricsLoading(true);

      // Group non-aggregated series by dashboard+panel to batch API calls.
      const seriesGroups = new Map<string, {
        dashboardId: string; panelId: number; metricsSourceId?: string;
        dashboardLabel: string; panelTitle: string; yAxesFormat?: string; metricNames: string[];
      }>();
      for (const series of addedSeries.filter(s => !s.isAggregated)) {
        const key = `${series.dashboardId}-${series.panelId}`;
        if (!seriesGroups.has(key)) {
          seriesGroups.set(key, {
            dashboardId: series.dashboardId, panelId: series.panelId,
            metricsSourceId: series.metricsSourceId, dashboardLabel: series.dashboardLabel,
            panelTitle: series.panelTitle, yAxesFormat: series.yAxesFormat, metricNames: [],
          });
        }
        seriesGroups.get(key)!.metricNames.push(series.metricName);
      }

      const allCurrentMetrics: MetricStatistic[] = [];
      const allSelectedMetrics: MetricStatistic[] = [];
      const allComparisons: MetricComparison[] = [];
      const evaluateTypes = ['avg', 'q90', 'q95', 'q99'];

      // Sampler -> normalized URL, fetched once and only if a Request RT panel
      // is in play, to label those rows with their URL (like perf-analysis).
      let samplerUrlMap: Record<string, string> | null = null;
      const getSamplerUrlMap = async (): Promise<Record<string, string>> => {
        if (samplerUrlMap === null) samplerUrlMap = await fetchSamplerUrlMap(testRun.test_run_id);
        return samplerUrlMap;
      };

      for (const [, group] of seriesGroups) {
        let allData: MetricStatistic[];
        let controlData: MetricStatistic[] = [];

        if (isUrlPanel(group.panelId)) {
          const metric = getUrlPanelMetric(group.panelId);
          if (!metric) continue;
          allData = await fetchUrlMetricStatistics(
            testRun.test_run_id,
            runsToRead,
            metric,
          );
        } else {
          const params = new URLSearchParams({
            applicationDashboardId: group.dashboardId,
            panelId: group.panelId.toString(),
            system: testRun.systems_under_test?.name || '',
            environment: testRun.test_environment || '',
            workload: testRun.workload || '',
          });
          if (group.metricsSourceId) params.set('metricsSourceId', group.metricsSourceId);
          const [response, control] = await Promise.all([
            authenticatedFetch(
              `/metrics/ds-metric-statistics?${params.toString()}`,
              { headers: { 'Content-Type': 'application/json' } },
            ),
            againstControlGroup
              ? fetchControlGroupStatistics(testRun.test_run_id, {
                  applicationDashboardId: group.dashboardId,
                  metricsSourceId: group.metricsSourceId,
                  panelId: group.panelId,
                })
              : Promise.resolve([]),
          ]);
          if (!response.ok) continue;
          allData = await response.json();
          // Shaped like a run's statistics row so the pairing below reads both sides alike.
          controlData = control.map((c) => ({
            test_run_id: CONTROL_GROUP_BASELINE,
            panel_title: c.panel_title,
            metric_name: c.metric_name,
            created_at: '',
            version: null,
            annotations: null,
            statistics: c.statistics,
          }));
        }

        const relevant = new Set(group.metricNames);
        const filtered = allData.filter(item => relevant.has(item.metric_name));
        const currentData = filtered.filter(item => item.test_run_id === testRun.test_run_id);
        const selectedData = againstControlGroup
          ? controlData.filter(item => relevant.has(item.metric_name))
          : filtered.filter(item => item.test_run_id === selectedTestRun.test_run_id);
        allCurrentMetrics.push(...currentData);
        allSelectedMetrics.push(...selectedData);

        for (const metricName of new Set(group.metricNames)) {
          const currentMetric = currentData.find(m => m.metric_name === metricName);
          const baselineMetric = selectedData.find(m => m.metric_name === metricName);
          const url = isRequestPanel(group.panelId)
            ? (await getSamplerUrlMap())[metricName]
            : undefined;
          for (const evaluateType of evaluateTypes) {
            const currentValue = currentMetric?.statistics[evaluateType as keyof typeof currentMetric.statistics] ?? null;
            const selectedValue = baselineMetric?.statistics[evaluateType as keyof typeof baselineMetric.statistics] ?? null;
            allComparisons.push({
              metric_name: metricName,
              evaluate_type: evaluateType,
              current_value: currentValue,
              selected_value: selectedValue,
              percentage_difference: calculatePercentageDifference(currentValue, selectedValue),
              dashboard_label: group.dashboardLabel,
              panel_title: group.panelTitle,
              dashboardId: group.dashboardId,
              panelId: group.panelId,
              yAxesFormat: group.yAxesFormat,
              url,
            });
          }
        }
      }

      // Aggregated series: one batch call per DISTINCT metric for [current, baseline].
      //
      // Deduped by metric, not by series: `stat` no longer changes the SQL — every
      // statistic comes off the merged sketch — so two series sharing a metric issue
      // byte-identical requests. Panels 105 and 205 (transaction and request error
      // rate) both map to `error_percentage`, so that is reachable today; a legacy
      // preset holding 101 and 102 duplicates too.
      //
      // And fetched with Promise.all rather than a serial await: the aggregate query
      // moved onto the rollups and is cheap now, so this loop is what the user waits
      // on, and it stacked on top of the already-serialized per-dashboard-group loop
      // above.
      //
      // `spec.stat` stays on the series side — buildAggregatedComparisons still needs
      // it for the value-only fallback path.
      const aggregatedSeries = addedSeries
        .map(series => ({ series, spec: getAggregateSpec(series.panelId) }))
        .filter((e): e is { series: typeof e.series; spec: NonNullable<typeof e.spec> } =>
          Boolean(e.series.isAggregated) && e.spec !== null,
        );

      const specByMetric = new Map(aggregatedSeries.map(e => [e.spec.metric, e.spec]));
      const fetched = await Promise.all(
        [...specByMetric.values()].map(async spec => {
          const values = await fetchAggregatedStatistics(
            testRun.test_run_id,
            runsToRead,
            spec,
          );
          return [spec.metric, new Map(values.map(v => [v.testRunId, v]))] as const;
        }),
      );
      const valuesByMetric = new Map(fetched);

      for (const { series, spec } of aggregatedSeries) {
        const byId = valuesByMetric.get(spec.metric);
        if (!byId) continue;
        const cells = buildAggregatedComparisons(
          series,
          byId.get(testRun.test_run_id),
          againstControlGroup ? undefined : byId.get(selectedTestRun.test_run_id),
          spec.stat,
        );
        for (const cell of cells) {
          allComparisons.push({
            ...cell,
            dashboard_label: series.dashboardLabel,
            panel_title: series.panelTitle,
            dashboardId: series.dashboardId,
            panelId: series.panelId,
            yAxesFormat: series.yAxesFormat,
          });
        }
      }

      if (isStale()) return;
      setCurrentMetrics(allCurrentMetrics);
      setSelectedMetrics(allSelectedMetrics);
      setMetricComparisons(allComparisons);
    } catch (error) {
      if (isStale()) return;
      console.error('Error fetching metrics comparison:', error);
      setCurrentMetrics([]);
      setSelectedMetrics([]);
      setMetricComparisons([]);
    } finally {
      if (!isStale()) setMetricsLoading(false);
    }
  }, [selectedTestRun, testRun, addedSeries]);

  // Get all dashboards merged for the grouped dropdown
  const getAllDashboardsMerged = useCallback((): ApplicationDashboard[] => {
    const grafanaOnly = dashboards.filter(d => isGrafana(d));
    const perfTestOnly = dashboards.filter(d => isPerformanceTest(d));
    const dynatraceAsDashboards: ApplicationDashboard[] = dynatraceDashboards.map((d, index) => ({
      id: `dynatrace-${index}`,
      dashboard_label: d.dashboardLabel,
      dashboard_name: d.dashboardLabel,
      dashboard_uid: `dynatrace-${d.dashboardLabel}`,
      source_type: 'dynatrace',
      hostLabels: d.hostLabels,
    } as ApplicationDashboard));
    return [...grafanaOnly, ...perfTestOnly, ...dynatraceAsDashboards];
  }, [dashboards, dynatraceDashboards]);

  // Get dashboards filtered by selected source (kept for backward compatibility)
  const getFilteredDashboards = useCallback((): ApplicationDashboard[] => {
    if (selectedSource === 'grafana') {
      return dashboards.filter(d => isGrafana(d));
    } else if (selectedSource === 'performance-metrics') {
      return dashboards.filter(d => isPerformanceTest(d));
    } else if (selectedSource === 'dynatrace') {
      return dynatraceDashboards.map((d, index) => ({
        id: `dynatrace-${index}`,
        dashboard_label: d.dashboardLabel,
        dashboard_name: d.dashboardLabel,
        dashboard_uid: `dynatrace-${d.dashboardLabel}`,
        source_type: 'dynatrace',
        hostLabels: d.hostLabels,
      } as ApplicationDashboard));
    }
    return dashboards;
  }, [selectedSource, dashboards, dynatraceDashboards]);

  // Compute available sources based on dashboards
  useEffect(() => {
    const sources: DataSource[] = [];

    const hasGrafana = dashboards.some(d => isGrafana(d));
    if (hasGrafana) sources.push('grafana');

    if (dynatraceDashboards.length > 0) sources.push('dynatrace');

    const hasPerformanceMetrics = dashboards.some(d => isPerformanceTest(d));
    if (hasPerformanceMetrics) sources.push('performance-metrics');

    setAvailableSources(sources);

    if (sources.length > 0 && !sources.includes(selectedSource)) {
      setSelectedSource(sources[0]);
    }
  }, [dashboards, dynatraceDashboards, selectedSource]);

  // Load data when expanded
  useEffect(() => {
    if (compareExpanded && relatedTestRuns.length === 0 && testRun) {
      fetchRelatedTestRuns();
    }
  }, [compareExpanded, testRun, relatedTestRuns.length, fetchRelatedTestRuns]);

  // The control group is asked for once per run, on first expand.
  const anchorRunId = testRun?.test_run_id;
  useEffect(() => {
    if (!compareExpanded || !anchorRunId || controlGroup !== undefined) return;
    let cancelled = false;
    fetchControlGroup(anchorRunId).then((group) => {
      if (!cancelled) setControlGroup(group);
    });
    return () => { cancelled = true; };
  }, [compareExpanded, anchorRunId, controlGroup]);

  // A different run has a different control group.
  useEffect(() => {
    setControlGroup(undefined);
  }, [anchorRunId]);

  /** What the baseline picker offers: the control group first, when the run has one, then the runs. */
  const baselineOptions = useMemo<RelatedTestRun[]>(
    () => (controlGroup ? [controlGroupOption(controlGroup), ...relatedTestRuns] : relatedTestRuns),
    [controlGroup, relatedTestRuns],
  );

  // Load dashboards when component mounts
  useEffect(() => {
    if (dashboards.length === 0 && testRun) {
      fetchApplicationDashboards();
    }
    if (dynatraceDashboards.length === 0 && testRun) {
      fetchDynatraceDashboardsList();
    }
  }, [testRun, dashboards.length, dynatraceDashboards.length, fetchApplicationDashboards, fetchDynatraceDashboardsList]);

  // Auto-trigger metrics comparison when test run or added series change
  useEffect(() => {
    if (selectedTestRun && addedSeries.length > 0) {
      fetchMetricsComparison();
    } else {
      comparisonRequestRef.current++; // a request still out must not repopulate the cleared table
      setMetricsLoading(false);
      setMetricComparisons([]);
      setCurrentMetrics([]);
      setSelectedMetrics([]);
      setShowGraphs({});
      setGraphData({});
      setGraphLoading({});
    }
  }, [selectedTestRun, addedSeries, fetchMetricsComparison]);

  // An open graph was fetched against the previous baseline. Collapse it rather than draw it
  // under the new one: leaving the control group for a run otherwise kept the group's graph
  // data and drew it as "Baseline (null)". Re-opening refetches (toggleGraph).
  const baselineId = selectedTestRun?.test_run_id;
  useEffect(() => {
    setShowGraphs({});
    setGraphData({});
    setGraphLoading({});
  }, [baselineId]);

  return {
    // State
    relatedTestRuns,
    controlGroup: controlGroup ?? null,
    baselineOptions,
    loading,
    comparisonStatus,
    selectedTestRun,
    selectedSource,
    availableSources,
    dashboards,
    dashboardsLoading,
    selectedDashboard,
    selectedMetric,
    dynatraceDashboards,
    dynatraceDashboardsLoading,
    addedSeries,
    currentMetrics,
    selectedMetrics,
    metricsLoading,
    metricComparisons,
    seriesSearchText,
    showPercentiles,
    displayConfig,
    showGraphs,
    graphData,
    graphLoading,

    // State setters
    setSelectedTestRun,
    setSelectedSource,
    setSelectedDashboard,
    setSelectedMetric,
    setAddedSeries,
    setMetricComparisons,
    setCurrentMetrics,
    setSelectedMetrics,
    setSeriesSearchText,
    setShowPercentiles,
    setDisplayConfig,
    setShowGraphs,
    setGraphData,
    setGraphLoading,

    // Fetch functions
    fetchRelatedTestRuns,
    fetchApplicationDashboards,
    fetchDynatraceDashboardsList,
    fetchMetricsComparison,
    getAllDashboardsMerged,
    getFilteredDashboards,
  };
}
