'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceDashboards, fetchDynatraceMetrics, DynatraceDashboard, DynatraceMetric } from '@/lib/dynatrace';
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
  SUPPORTED_PANEL_TYPES,
} from '../types';
import { calculatePercentageDifference, buildAggregatedComparisons, DEFAULT_DISPLAY_CONFIG, DisplayConfig } from '../utils/compare-utils';
import { TestRun } from '@/types/test-runs';
import { isGrafana, isPerformanceTest} from '@/lib/metrics-source-utils';
import {
  ALL_AGGREGATED_OPTION,
  getAggregateSpec,
  shouldOfferAllAggregated,
  fetchAggregatedStatistics,
  collapsePerfRtPanels,
} from '@/lib/aggregated-perf-series';
import {
  isUrlPanel,
  getUrlPanelMetric,
  buildUrlPanels,
  fetchUrlDistinctNames,
  fetchUrlMetricStatistics,
  fetchSamplerUrlMap,
  REQUEST_RT_PANEL_ID,
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

  // Source and selection state
  const [selectedSource, setSelectedSource] = useState<DataSource>('grafana');
  const [availableSources, setAvailableSources] = useState<DataSource[]>([]);

  // Dashboard state
  const [dashboards, setDashboards] = useState<ApplicationDashboard[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [selectedDashboard, setSelectedDashboard] = useState<ApplicationDashboard | null>(null);

  // Panel state
  const [panels, setPanels] = useState<Panel[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<Panel | null>(null);

  // Dynatrace state
  const [dynatraceDashboards, setDynatraceDashboards] = useState<DynatraceDashboard[]>([]);
  const [dynatraceDashboardsLoading, setDynatraceDashboardsLoading] = useState(false);
  const [dynatraceMetrics, setDynatraceMetrics] = useState<DynatraceMetric[]>([]);
  const [dynatraceMetricsLoading, setDynatraceMetricsLoading] = useState(false);

  // Series selection state
  const [availableMetrics, setAvailableMetrics] = useState<string[]>([]);
  const [availableMetricsLoading, setAvailableMetricsLoading] = useState(false);
  const [selectedMetricNames, setSelectedMetricNames] = useState<string[]>([]);
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

  // Load Grafana panels when dashboard selected
  const fetchDashboardPanels = useCallback(async (
    dashboardUid: string,
    isPerfMetrics = false,
    applicationDashboardId = '',
  ): Promise<Panel[]> => {
    if (!dashboardUid) return [];

    try {
      setPanelsLoading(true);
      const response = await authenticatedFetch(
        `/grafana/dashboards?uid=${dashboardUid}`,
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (response.ok) {
        const dashboardData = await response.json();
        const dashboard = Array.isArray(dashboardData) ? dashboardData[0] : dashboardData;

        const filteredPanels: Panel[] = dashboard?.panels?.filter((panel: Panel) =>
          SUPPORTED_PANEL_TYPES.includes(panel.type)
        ) || [];

        // Inject virtual URL panels for performance-metrics dashboards only.
        // The `/grafana/dashboards` payload is raw Grafana JSON and never carries
        // an `applicationDashboardId` — the caller passes the DB row id explicitly.
        const withUrl = isPerfMetrics
          ? collapsePerfRtPanels([...filteredPanels, ...buildUrlPanels(applicationDashboardId)])
          : filteredPanels;

        setPanels(withUrl);
        return withUrl;
      } else {
        setPanels([]);
        return [];
      }
    } catch (error) {
      console.error('Error fetching dashboard panels:', error);
      setPanels([]);
      return [];
    } finally {
      setPanelsLoading(false);
    }
  }, []);

  // Load Dynatrace metrics when dashboard selected
  const fetchDynatraceMetricsList = useCallback(async (dashboardLabel: string) => {
    if (!dashboardLabel || !testRun) return;

    try {
      setDynatraceMetricsLoading(true);
      const systemId = testRun.system_under_test_id;
      const environment = testRun.test_environment;
      const workload = testRun.workload;

      if (!systemId || !environment || !workload) {
        setDynatraceMetrics([]);
        return;
      }

      const metricsData = await fetchDynatraceMetrics(systemId, environment, workload, dashboardLabel);
      setDynatraceMetrics(metricsData);
    } catch (error) {
      console.error('Error fetching Dynatrace metrics:', error);
      setDynatraceMetrics([]);
    } finally {
      setDynatraceMetricsLoading(false);
    }
  }, [testRun]);

  // Fetch available metric names for a selected panel
  const fetchPanelMetrics = useCallback(async (applicationDashboardId: string, panelId: number, metricsSourceId?: string): Promise<string[]> => {
    if (!applicationDashboardId || !panelId || !testRun) {
      setAvailableMetrics([]);
      return [];
    }

    if (isUrlPanel(panelId)) {
      setAvailableMetricsLoading(true);
      try {
        const names = await fetchUrlDistinctNames(testRun.test_run_id);
        setAvailableMetrics(names);
        return names;
      } finally {
        setAvailableMetricsLoading(false);
      }
    }

    try {
      setAvailableMetricsLoading(true);

      const params = new URLSearchParams({
        applicationDashboardId,
        panelId: panelId.toString(),
        system: testRun.systems_under_test?.name || '',
        environment: testRun.test_environment || '',
        workload: testRun.workload || ''
      });

      // Send metricsSourceId if available
      if (metricsSourceId) {
        params.set('metricsSourceId', metricsSourceId);
      }

      const response = await authenticatedFetch(
        `/metrics/ds-metrics/distinct-names?${params.toString()}`,
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (response.ok) {
        const metricNames: string[] = await response.json();
        const withAggregate = shouldOfferAllAggregated(selectedSource, panelId)
          ? [ALL_AGGREGATED_OPTION, ...metricNames]
          : metricNames;
        setAvailableMetrics(withAggregate);
        return withAggregate;
      } else {
        setAvailableMetrics([]);
        return [];
      }
    } catch (error) {
      console.error('Error fetching distinct metric names:', error);
      setAvailableMetrics([]);
      return [];
    } finally {
      setAvailableMetricsLoading(false);
    }
  }, [testRun, selectedSource]);

  // Fetch metrics comparison
  const fetchMetricsComparison = useCallback(async () => {
    if (!selectedTestRun || !testRun || addedSeries.length === 0) return;

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

        if (isUrlPanel(group.panelId)) {
          const metric = getUrlPanelMetric(group.panelId);
          if (!metric) continue;
          allData = await fetchUrlMetricStatistics(
            testRun.test_run_id,
            [testRun.test_run_id, selectedTestRun.test_run_id],
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
          const response = await authenticatedFetch(
            `/metrics/ds-metric-statistics?${params.toString()}`,
            { headers: { 'Content-Type': 'application/json' } },
          );
          if (!response.ok) continue;
          allData = await response.json();
        }

        const relevant = new Set(group.metricNames);
        const filtered = allData.filter(item => relevant.has(item.metric_name));
        const currentData = filtered.filter(item => item.test_run_id === testRun.test_run_id);
        const selectedData = filtered.filter(item => item.test_run_id === selectedTestRun.test_run_id);
        allCurrentMetrics.push(...currentData);
        allSelectedMetrics.push(...selectedData);

        for (const metricName of new Set(group.metricNames)) {
          const currentMetric = currentData.find(m => m.metric_name === metricName);
          const baselineMetric = selectedData.find(m => m.metric_name === metricName);
          const url = group.panelId === REQUEST_RT_PANEL_ID
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
            [testRun.test_run_id, selectedTestRun.test_run_id],
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
          byId.get(selectedTestRun.test_run_id),
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

      setCurrentMetrics(allCurrentMetrics);
      setSelectedMetrics(allSelectedMetrics);
      setMetricComparisons(allComparisons);
    } catch (error) {
      console.error('Error fetching metrics comparison:', error);
      setCurrentMetrics([]);
      setSelectedMetrics([]);
      setMetricComparisons([]);
    } finally {
      setMetricsLoading(false);
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
      setMetricComparisons([]);
      setCurrentMetrics([]);
      setSelectedMetrics([]);
      setShowGraphs({});
      setGraphData({});
      setGraphLoading({});
    }
  }, [selectedTestRun, addedSeries, fetchMetricsComparison]);

  return {
    // State
    relatedTestRuns,
    loading,
    comparisonStatus,
    selectedTestRun,
    selectedSource,
    availableSources,
    dashboards,
    dashboardsLoading,
    selectedDashboard,
    panels,
    panelsLoading,
    selectedMetric,
    dynatraceDashboards,
    dynatraceDashboardsLoading,
    dynatraceMetrics,
    dynatraceMetricsLoading,
    availableMetrics,
    availableMetricsLoading,
    selectedMetricNames,
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
    setPanels,
    setDynatraceMetrics,
    setAvailableMetrics,
    setSelectedMetricNames,
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
    fetchDashboardPanels,
    fetchDynatraceMetricsList,
    fetchPanelMetrics,
    fetchMetricsComparison,
    getAllDashboardsMerged,
    getFilteredDashboards,
  };
}
