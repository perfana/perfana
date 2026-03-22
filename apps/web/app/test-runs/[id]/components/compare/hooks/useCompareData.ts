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
import { calculatePercentageDifference } from '../utils/compare-utils';
import { TestRun } from '@/types/test-runs';
import { isGrafana, isPerformanceTest, getSourceType } from '@/lib/metrics-source-utils';

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

        const mockStatus: ComparisonStatus = {
          hasBaseline: data.length > 0,
          totalComparisons: Math.min(data.length, 5),
          differences: Math.floor(Math.random() * 3),
          status: data.length > 0 ? (Math.random() > 0.7 ? 'warning' : 'success') : 'info'
        };
        setComparisonStatus(mockStatus);
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
      const url = `/grafana/application-dashboards?systemId=${encodeURIComponent(testRun.system_under_test_id || '')}&environment=${encodeURIComponent(testRun.test_environment)}`;

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
  const fetchDashboardPanels = useCallback(async (dashboardUid: string): Promise<Panel[]> => {
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

        const filteredPanels = dashboard?.panels?.filter((panel: Panel) =>
          SUPPORTED_PANEL_TYPES.includes(panel.type)
        ) || [];

        setPanels(filteredPanels);
        return filteredPanels;
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
        setAvailableMetrics(metricNames);
        return metricNames;
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
  }, [testRun]);

  // Fetch metrics comparison
  const fetchMetricsComparison = useCallback(async () => {
    if (!selectedTestRun || !testRun || addedSeries.length === 0) return;

    try {
      setMetricsLoading(true);

      // Group series by dashboard+panel to batch API calls
      const seriesGroups = new Map<string, { dashboardId: string; panelId: number; metricsSourceId?: string; metricNames: string[] }>();

      for (const series of addedSeries) {
        const key = `${series.dashboardId}-${series.panelId}`;
        if (!seriesGroups.has(key)) {
          seriesGroups.set(key, { dashboardId: series.dashboardId, panelId: series.panelId, metricsSourceId: series.metricsSourceId, metricNames: [] });
        }
        seriesGroups.get(key)!.metricNames.push(series.metricName);
      }

      const allCurrentMetrics: MetricStatistic[] = [];
      const allSelectedMetrics: MetricStatistic[] = [];

      for (const [, group] of seriesGroups) {
        const params = new URLSearchParams({
          applicationDashboardId: group.dashboardId,
          panelId: group.panelId.toString(),
          system: testRun.systems_under_test?.name || '',
          environment: testRun.test_environment || '',
          workload: testRun.workload || ''
        });

        // Send metricsSourceId if available
        if (group.metricsSourceId) {
          params.set('metricsSourceId', group.metricsSourceId);
        }

        const response = await authenticatedFetch(
          `/metrics/ds-metric-statistics?${params.toString()}`,
          { headers: { 'Content-Type': 'application/json' } }
        );

        if (response.ok) {
          const allData: MetricStatistic[] = await response.json();
          const relevantMetricNames = new Set(group.metricNames);
          const filteredData = allData.filter(item => relevantMetricNames.has(item.metric_name));

          const currentData = filteredData.filter(item => item.test_run_id === testRun.test_run_id);
          const selectedData = filteredData.filter(item => item.test_run_id === selectedTestRun.test_run_id);

          allCurrentMetrics.push(...currentData);
          allSelectedMetrics.push(...selectedData);
        }
      }

      // Create comparisons for all evaluate types
      const allComparisons: MetricComparison[] = [];
      const evaluateTypes = ['avg', 'max', 'min', 'last', 'count', 'q50', 'q90', 'q95', 'q99'];
      const addedMetricNames = new Set(addedSeries.map(s => s.metricName));

      for (const metricName of addedMetricNames) {
        const currentMetric = allCurrentMetrics.find(m => m.metric_name === metricName);
        const baselineMetric = allSelectedMetrics.find(m => m.metric_name === metricName);

        for (const evaluateType of evaluateTypes) {
          const currentValue = currentMetric?.statistics[evaluateType as keyof typeof currentMetric.statistics] ?? null;
          const selectedValue = baselineMetric?.statistics[evaluateType as keyof typeof baselineMetric.statistics] ?? null;

          allComparisons.push({
            metric_name: metricName,
            evaluate_type: evaluateType,
            current_value: currentValue,
            selected_value: selectedValue,
            percentage_difference: calculatePercentageDifference(currentValue, selectedValue)
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
    const dynatraceAsDashboards: ApplicationDashboard[] = dynatraceDashboards.map((d, index) => ({
      id: `dynatrace-${index}`,
      dashboard_label: d.dashboardLabel,
      dashboard_name: d.dashboardLabel,
      dashboard_uid: `dynatrace-${d.dashboardLabel}`,
      source_type: 'dynatrace',
    } as ApplicationDashboard));
    return [...dashboards, ...dynatraceAsDashboards];
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
