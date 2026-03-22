'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceDashboards, fetchDynatraceMetrics, DynatraceDashboard, DynatraceMetric } from '@/lib/dynatrace';
import {
  ApplicationDashboard,
  Panel,
  TimeRange,
  MetricStatistic,
  TrendsSeries,
  DataSource,
  SUPPORTED_PANEL_TYPES,
  TIME_RANGE_OPTIONS,
} from '../types';
import { TestRun } from '@/types/test-runs';

interface UseTrendsDataProps {
  testRun: TestRun | null;
  testRunId: string;
  trendsExpanded: boolean;
}

export function useTrendsData({ testRun, testRunId, trendsExpanded }: UseTrendsDataProps) {
  // Source and selection state
  const [selectedSource, setSelectedSource] = useState<DataSource>('grafana');
  const [availableSources, setAvailableSources] = useState<DataSource[]>([]);
  const [selectedDashboard, setSelectedDashboard] = useState<ApplicationDashboard | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<Panel | null>(null);

  // Time range state
  const [timeRange, setTimeRange] = useState<typeof TIME_RANGE_OPTIONS[number]>(TIME_RANGE_OPTIONS[3]); // Default to "Last week"
  const [customTimeRange, setCustomTimeRange] = useState<TimeRange>({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    to: new Date()
  });
  const [evaluateType, setEvaluateType] = useState<string>('avg');

  // Grafana data state
  const [dashboards, setDashboards] = useState<ApplicationDashboard[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);

  // Dynatrace data state
  const [dynatraceDashboards, setDynatraceDashboards] = useState<DynatraceDashboard[]>([]);
  const [dynatraceDashboardsLoading, setDynatraceDashboardsLoading] = useState(false);
  const [dynatraceMetrics, setDynatraceMetrics] = useState<DynatraceMetric[]>([]);
  const [dynatraceMetricsLoading, setDynatraceMetricsLoading] = useState(false);

  // Panel metrics state
  const [availableMetrics, setAvailableMetrics] = useState<string[]>([]);
  const [availableMetricsLoading, setAvailableMetricsLoading] = useState(false);
  const [selectedMetricNames, setSelectedMetricNames] = useState<string[]>([]);

  // Series and chart data state
  const [addedSeries, setAddedSeries] = useState<TrendsSeries[]>([]);
  const [metricsData, setMetricsData] = useState<MetricStatistic[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [selectedSeriesNames, setSelectedSeriesNames] = useState<Set<string>>(new Set());

  // Oldest test run date state
  const [oldestTestRunDate, setOldestTestRunDate] = useState<string | null>(null);
  const [oldestTestRunLoading, setOldestTestRunLoading] = useState(false);

  // Load oldest test run date from related test runs
  const fetchOldestTestRunDate = useCallback(async () => {
    if (!testRun) return;

    try {
      setOldestTestRunLoading(true);

      const system = testRun.systems_under_test?.name;
      const environment = testRun.test_environment;
      const workload = testRun.workload;

      let url = `/test-runs/${testRunId}/related`;
      if (system && environment && workload) {
        const queryParams = new URLSearchParams({ system, environment, workload });
        url += `?${queryParams.toString()}`;
      }

      const response = await authenticatedFetch(url, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const relatedTestRuns = await response.json();
        if (relatedTestRuns.length > 0) {
          const allTestRuns = [testRun, ...relatedTestRuns];
          const oldestTestRun = allTestRuns.reduce((oldest, current) => {
            return new Date(current.created_at) < new Date(oldest.created_at) ? current : oldest;
          });
          setOldestTestRunDate(oldestTestRun.created_at);
        } else {
          setOldestTestRunDate(testRun.created_at);
        }
      } else {
        console.warn('Failed to fetch related test runs:', response.statusText);
        setOldestTestRunDate(testRun.created_at);
      }
    } catch (error) {
      console.error('Error fetching related test runs:', error);
      setOldestTestRunDate(testRun.created_at);
    } finally {
      setOldestTestRunLoading(false);
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

        const filteredPanels = dashboard?.panels?.filter((panel: any) =>
          SUPPORTED_PANEL_TYPES.includes(panel.type)
        ) || [];

        setPanels(filteredPanels);
        return filteredPanels;
      } else {
        console.warn('Failed to fetch dashboard panels:', response.statusText);
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
  const fetchPanelMetrics = useCallback(async (applicationDashboardId: string, panelId: number, metricsSourceId?: string) => {
    try {
      setAvailableMetricsLoading(true);
      setAvailableMetrics([]);
      setSelectedMetricNames([]);

      const params = new URLSearchParams({
        applicationDashboardId,
        panelId: panelId.toString()
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
        const metricNames = await response.json();
        setAvailableMetrics(metricNames);
      } else {
        console.warn('Failed to fetch panel metrics:', response.statusText);
        setAvailableMetrics([]);
      }
    } catch (error) {
      console.error('Error fetching panel metrics:', error);
      setAvailableMetrics([]);
    } finally {
      setAvailableMetricsLoading(false);
    }
  }, []);

  // Load metrics data for all added series
  const fetchMetricsData = useCallback(async () => {
    if (addedSeries.length === 0) {
      setMetricsData([]);
      return;
    }

    try {
      setMetricsLoading(true);

      // Calculate time range
      let fromDate: Date;
      let toDate: Date;

      if (timeRange.value === 'custom') {
        fromDate = customTimeRange.from;
        toDate = customTimeRange.to;
      } else {
        toDate = new Date();

        if (timeRange.type === 'months') {
          fromDate = new Date(toDate);
          fromDate.setMonth(fromDate.getMonth() - (timeRange.value as number));
        } else {
          const days = timeRange.value as number;
          fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        }
      }

      // Group series by dashboard/panel to minimize API calls
      const seriesByDashboardPanel = addedSeries.reduce((acc, series) => {
        const key = `${series.dashboardId}-${series.panelId}`;
        if (!acc[key]) {
          acc[key] = {
            dashboardId: series.dashboardId,
            panelId: series.panelId,
            metricsSourceId: series.metricsSourceId,
            metricNames: new Set<string>()
          };
        }
        acc[key].metricNames.add(series.metricName);
        return acc;
      }, {} as Record<string, { dashboardId: string; panelId: number; metricsSourceId?: string; metricNames: Set<string> }>);

      // Fetch data for each dashboard/panel combination
      const allData: MetricStatistic[] = [];

      for (const { dashboardId, panelId, metricsSourceId, metricNames } of Object.values(seriesByDashboardPanel)) {
        if (panelId == null || dashboardId == null) {
          console.warn('Skipping series group with missing dashboardId or panelId:', { dashboardId, panelId });
          continue;
        }
        const queryParams = new URLSearchParams({
          applicationDashboardId: dashboardId,
          panelId: panelId.toString(),
          evaluateType,
          from: fromDate.toISOString(),
          to: toDate.toISOString()
        });

        // Send metricsSourceId if available
        if (metricsSourceId) {
          queryParams.set('metricsSourceId', metricsSourceId);
        }

        if (testRun?.systems_under_test?.name) {
          queryParams.set('system', testRun.systems_under_test.name);
        }
        if (testRun?.test_environment) {
          queryParams.set('environment', testRun.test_environment);
        }
        if (testRun?.workload) {
          queryParams.set('workload', testRun.workload);
        }

        const response = await authenticatedFetch(
          `/metrics/ds-metric-statistics?${queryParams.toString()}`,
          { headers: { 'Content-Type': 'application/json' } }
        );

        if (response.ok) {
          const data = await response.json();
          const filteredData = data.filter((item: MetricStatistic) =>
            metricNames.has(item.metric_name)
          );
          allData.push(...filteredData);
        } else {
          console.warn('Failed to fetch metrics data for panel:', panelId, response.statusText);
        }
      }

      setMetricsData(allData);

      // Update selectedSeriesNames to match addedSeries
      const seriesNames = addedSeries.map(s => s.metricName);
      setSelectedSeriesNames(new Set(seriesNames));

    } catch (error) {
      console.error('Error fetching metrics data:', error);
      setMetricsData([]);
      setSelectedSeriesNames(new Set());
    } finally {
      setMetricsLoading(false);
    }
  }, [addedSeries, evaluateType, timeRange, customTimeRange, testRun]);

  // Compute available sources based on loaded dashboards
  useEffect(() => {
    const sources: DataSource[] = [];

    // Check for real Grafana dashboards (not artificial)
    // TODO Phase 3.7: replace with source_type from MetricsSource
    const grafanaDashboards = dashboards.filter(d =>
      !d.dashboard_uid?.startsWith('performance-test-metrics-') &&
      !d.dashboard_uid?.startsWith('dynatrace-')
    );
    if (grafanaDashboards.length > 0) {
      sources.push('grafana');
    }

    // Check for Dynatrace dashboards
    if (dynatraceDashboards.length > 0) {
      sources.push('dynatrace');
    }

    // Check for performance-test-metrics dashboards
    // TODO Phase 3.7: replace with source_type from MetricsSource
    const perfMetricsDashboards = dashboards.filter(d =>
      d.dashboard_uid?.startsWith('performance-test-metrics-')
    );
    if (perfMetricsDashboards.length > 0) {
      sources.push('performance-metrics');
    }

    setAvailableSources(sources);

    // Auto-select first available source if current selection is not available
    if (sources.length > 0 && !sources.includes(selectedSource)) {
      setSelectedSource(sources[0]);
    }
  }, [dashboards, dynatraceDashboards, selectedSource]);

  // Load dashboards when expanded and no data is available
  useEffect(() => {
    if (trendsExpanded && testRun) {
      if (dashboards.length === 0) {
        fetchApplicationDashboards();
      }
      if (dynatraceDashboards.length === 0) {
        fetchDynatraceDashboardsList();
      }
    }
  }, [trendsExpanded, testRun, dashboards.length, dynatraceDashboards.length, fetchApplicationDashboards, fetchDynatraceDashboardsList]);

  // Fetch metrics data when addedSeries, evaluateType, or timeRange changes
  useEffect(() => {
    if (addedSeries.length > 0) {
      fetchMetricsData();
    }
  }, [addedSeries, evaluateType, timeRange, customTimeRange, fetchMetricsData]);

  // Load oldest test run date when component mounts
  useEffect(() => {
    if (testRun && !oldestTestRunDate && !oldestTestRunLoading) {
      fetchOldestTestRunDate();
    }
  }, [testRun, oldestTestRunDate, oldestTestRunLoading, fetchOldestTestRunDate]);

  // Filter dashboards by source type
  // TODO Phase 3.7: replace with source_type from MetricsSource
  const getFilteredDashboards = useCallback((): ApplicationDashboard[] => {
    if (selectedSource === 'grafana') {
      return dashboards.filter(d =>
        !d.dashboard_uid?.startsWith('performance-test-metrics-') &&
        !d.dashboard_uid?.startsWith('dynatrace-')
      );
    } else if (selectedSource === 'performance-metrics') {
      return dashboards.filter(d =>
        d.dashboard_uid?.startsWith('performance-test-metrics-')
      );
    } else {
      return dynatraceDashboards.map((d, index) => ({
        id: `dynatrace-${index}`,
        dashboard_label: d.dashboardLabel,
        dashboard_name: d.dashboardLabel,
        dashboard_uid: ''
      } as ApplicationDashboard));
    }
  }, [selectedSource, dashboards, dynatraceDashboards]);

  // Handle source selection
  const handleSourceSelect = useCallback((source: DataSource) => {
    setSelectedSource(source);
    setSelectedDashboard(null);
    setSelectedMetric(null);
    setPanels([]);
    setDynatraceMetrics([]);
    setMetricsData([]);
    setSelectedSeriesNames(new Set());
    setAvailableMetrics([]);
    setSelectedMetricNames([]);
  }, []);

  // Handle dashboard selection
  const handleDashboardSelect = useCallback((
    dashboard: ApplicationDashboard | null,
    dynatraceDashboardLabel?: string,
    source?: DataSource
  ) => {
    setSelectedDashboard(dashboard);
    setSelectedMetric(null);
    setPanels([]);
    setDynatraceMetrics([]);
    setMetricsData([]);
    setSelectedSeriesNames(new Set());
    setAvailableMetrics([]);
    setSelectedMetricNames([]);

    const sourceToUse = source || selectedSource;

    if (sourceToUse === 'dynatrace' && dynatraceDashboardLabel) {
      fetchDynatraceMetricsList(dynatraceDashboardLabel);
    } else if ((sourceToUse === 'grafana' || sourceToUse === 'performance-metrics') && dashboard?.dashboard_uid) {
      fetchDashboardPanels(dashboard.dashboard_uid);
    }
  }, [selectedSource, fetchDynatraceMetricsList, fetchDashboardPanels]);

  // Handle metric (panel) selection
  const handleMetricSelect = useCallback((metric: Panel | null) => {
    setSelectedMetric(metric);
    setMetricsData([]);
    setSelectedSeriesNames(new Set());
    setAvailableMetrics([]);
    setSelectedMetricNames([]);

    if (metric && selectedDashboard) {
      const applicationDashboardId = metric.applicationDashboardId || selectedDashboard.id;
      const metricsSourceId = metric.metricsSourceId || selectedDashboard.metrics_source_id;
      fetchPanelMetrics(applicationDashboardId, metric.id, metricsSourceId);
    }
  }, [selectedDashboard, fetchPanelMetrics]);

  // Handle adding selected metrics as series
  const handleAddSeries = useCallback(() => {
    if (!selectedDashboard || !selectedMetric || selectedMetricNames.length === 0) return;

    const getSource = (): DataSource => {
      if (selectedMetric.type === 'dynatrace') return 'dynatrace';
      if (selectedDashboard.dashboard_uid?.startsWith('performance-test-metrics-')) return 'performance-metrics';
      return 'grafana';
    };
    const source = getSource();

    const applicationDashboardId = selectedMetric.applicationDashboardId || selectedDashboard.id;
    const metricsSourceId = selectedMetric.metricsSourceId || selectedDashboard.metrics_source_id;

    const newSeries: TrendsSeries[] = selectedMetricNames.map(metricName => ({
      id: `${applicationDashboardId}-${selectedMetric.id}-${metricName}-${Date.now()}-${Math.random()}`,
      dashboardId: applicationDashboardId,
      dashboardLabel: selectedDashboard.dashboard_label,
      panelId: selectedMetric.id,
      panelTitle: selectedMetric.title,
      metricName: metricName,
      source: source,
      metricsSourceId: metricsSourceId
    }));

    const filteredNewSeries = newSeries.filter(newS =>
      !addedSeries.some(
        existing =>
          existing.dashboardId === newS.dashboardId &&
          existing.panelId === newS.panelId &&
          existing.metricName === newS.metricName
      )
    );

    if (filteredNewSeries.length > 0) {
      setAddedSeries(prev => [...prev, ...filteredNewSeries]);
      setSelectedMetricNames([]);
      return filteredNewSeries.length;
    }
    return 0;
  }, [selectedDashboard, selectedMetric, selectedMetricNames, addedSeries]);

  // Handle removing a series
  const handleRemoveSeries = useCallback((seriesId: string) => {
    setAddedSeries(prev => prev.filter(s => s.id !== seriesId));
  }, []);

  // Handle clearing all series
  const handleClearAllSeries = useCallback(() => {
    setAddedSeries([]);
    setMetricsData([]);
  }, []);

  // Handle updating series unit
  const handleUpdateSeriesUnit = useCallback((seriesId: string, newUnit: string | null) => {
    setAddedSeries(prev => prev.map(series =>
      series.id === seriesId
        ? { ...series, yAxisFormat: newUnit || undefined }
        : series
    ));
  }, []);

  // Handle time range change
  const handleTimeRangeChange = useCallback((newRange: typeof TIME_RANGE_OPTIONS[number]) => {
    setTimeRange(newRange);
  }, []);

  // Handle custom time range change
  const handleCustomTimeRangeChange = useCallback((field: 'from' | 'to', date: Date | null) => {
    if (!date) return;
    setCustomTimeRange(prev => ({ ...prev, [field]: date }));
  }, []);

  // Handle evaluate type change
  const handleEvaluateTypeChange = useCallback((newType: string) => {
    setEvaluateType(newType);
  }, []);

  return {
    // State
    selectedSource,
    availableSources,
    selectedDashboard,
    selectedMetric,
    timeRange,
    customTimeRange,
    evaluateType,
    dashboards,
    dashboardsLoading,
    panels,
    panelsLoading,
    dynatraceDashboards,
    dynatraceDashboardsLoading,
    dynatraceMetrics,
    dynatraceMetricsLoading,
    availableMetrics,
    availableMetricsLoading,
    selectedMetricNames,
    addedSeries,
    metricsData,
    metricsLoading,
    selectedSeriesNames,
    oldestTestRunDate,
    oldestTestRunLoading,

    // State setters (for preset application)
    setSelectedSource,
    setSelectedDashboard,
    setSelectedMetric,
    setEvaluateType,
    setAddedSeries,
    setSelectedMetricNames,
    setDynatraceMetrics,

    // Fetch functions
    fetchApplicationDashboards,
    fetchDynatraceDashboardsList,
    fetchDashboardPanels,
    fetchDynatraceMetricsList,
    fetchPanelMetrics,
    fetchMetricsData,

    // Handlers
    getFilteredDashboards,
    handleSourceSelect,
    handleDashboardSelect,
    handleMetricSelect,
    handleAddSeries,
    handleRemoveSeries,
    handleClearAllSeries,
    handleUpdateSeriesUnit,
    handleTimeRangeChange,
    handleCustomTimeRangeChange,
    handleEvaluateTypeChange,
  };
}
