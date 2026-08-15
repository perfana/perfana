'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceDashboards, DynatraceDashboard } from '@/lib/dynatrace';
import {
  ApplicationDashboard,
  Panel,
  SeriesConfig,
  MetricDataPoint,
  DataSource,
  SUPPORTED_PANEL_TYPES,
} from '../types';
import { extractYAxisFormat, generateChartName, PERFORMANCE_METRICS_PANEL_UNITS } from '../utils';
import { getFilteredDashboards, computeAvailableSources, determineSource } from '../utils';
import {
  ALL_AGGREGATED_OPTION,
  getAggregateSpec,
  buildAggregatedMetricName,
} from '@/lib/aggregated-perf-series';
import {
  offerAggregatedOption,
  aggregatedYAxisFormat,
  fetchAggregatedSeriesData,
} from '../utils/aggregated-series';
import { isDynatrace, isGrafana, isPerformanceTest, getSourceType } from '@/lib/metrics-source-utils';
import { TestRun } from '@/types/test-runs';

interface UseGraphsDataProps {
  testRun: TestRun | null;
  testRunId: string;
  graphsExpanded: boolean;
}

export function useGraphsData({ testRun, testRunId }: UseGraphsDataProps) {
  // Source selection state
  const [selectedSource, setSelectedSource] = useState<DataSource>('grafana');
  const [availableSources, setAvailableSources] = useState<DataSource[]>([]);

  // Dashboard and panel state
  const [dashboards, setDashboards] = useState<ApplicationDashboard[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [dynatraceDashboards, setDynatraceDashboards] = useState<DynatraceDashboard[]>([]);
  const [dynatraceDashboardsLoading, setDynatraceDashboardsLoading] = useState(false);
  const [selectedDashboard, setSelectedDashboard] = useState<ApplicationDashboard | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const [selectedPanel, setSelectedPanel] = useState<Panel | null>(null);

  // Metrics state
  const [metrics, setMetrics] = useState<string[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>([]);

  // Added series state
  const [addedSeries, setAddedSeries] = useState<SeriesConfig[]>([]);

  // Chart name state
  const [chartName, setChartName] = useState<string>('');

  // Series data state for chart visualization
  const [seriesData, setSeriesData] = useState<Map<string, MetricDataPoint[]>>(new Map());
  const [chartDataLoading, setChartDataLoading] = useState(false);

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
   * Handle source selection (Grafana/Dynatrace/Performance Metrics)
   */
  const handleSourceSelect = useCallback((source: DataSource) => {
    setSelectedSource(source);
    setSelectedDashboard(null);
    setSelectedPanel(null);
    setPanels([]);
    setMetrics([]);
    setSelectedMetrics([]);
  }, []);

  /**
   * Fetch panels for a selected dashboard
   */
  const fetchDashboardPanels = useCallback(async (dashboardUid: string, dashboard?: ApplicationDashboard): Promise<Panel[]> => {
    if (!dashboardUid) return [];

    try {
      setPanelsLoading(true);

      // Check if this is a Dynatrace artificial dashboard
      const dashboardToUse = dashboard || selectedDashboard;
      if (isDynatrace({ dashboard_uid: dashboardUid, source_type: dashboardToUse?.source_type }) && testRun && dashboardToUse) {
        const systemId = testRun.system_under_test_id;
        const environment = testRun.test_environment;
        const workload = testRun.workload;
        const dashboardLabel = dashboardToUse.dashboard_label;

        const params = new URLSearchParams({
          systemId,
          environment,
          workload,
          dashboardLabel
        });

        const response = await authenticatedFetch(
          `/dynatrace/queries/metrics?${params.toString()}`,
          {
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        if (response.ok) {
          const dynatracePanels = await response.json();

          // Transform Dynatrace panels to match the Panel interface
          const transformedPanels = dynatracePanels.map((panel: { panelId: number; panelTitle: string; metricUnit?: string; applicationDashboardId?: string; metricsSourceId?: string }) => ({
            id: panel.panelId,
            title: panel.panelTitle,
            type: 'dynatrace',
            yAxesFormat: panel.metricUnit,
            applicationDashboardId: panel.applicationDashboardId,
            metricsSourceId: panel.metricsSourceId
          }));

          setPanels(transformedPanels);
          return transformedPanels;
        } else {
          console.warn('Failed to fetch Dynatrace panels:', response.statusText);
          setPanels([]);
          return [];
        }
      }

      // Standard Grafana dashboard panel fetching
      const response = await authenticatedFetch(
        `/grafana/dashboards?uid=${dashboardUid}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const dashboardData = await response.json();
        const dashboardJson = Array.isArray(dashboardData) ? dashboardData[0] : dashboardData;

        // Filter panels by supported types
        const rawPanels = dashboardJson?.panels?.filter((panel: { type: string }) =>
          SUPPORTED_PANEL_TYPES.includes(panel.type as typeof SUPPORTED_PANEL_TYPES[number])
        ) || [];

        // Transform panels to extract yAxesFormat
        const transformedPanels = rawPanels.map((panel: {
          id: number;
          title: string;
          type: string;
          fieldConfig?: { defaults?: { unit?: string } };
          yaxes?: Array<{ format?: string }>;
        }) => {
          const format = extractYAxisFormat(panel);
          return {
            ...panel,
            // Use extracted format, or fall back to known units for performance-metrics panels
            yAxesFormat: format || (isPerformanceTest({ dashboard_uid: dashboardUid, source_type: selectedDashboard?.source_type }) ? PERFORMANCE_METRICS_PANEL_UNITS[panel.id] : undefined)
          };
        });

        setPanels(transformedPanels);
        return transformedPanels;
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
  }, [selectedDashboard, testRun]);

  /**
   * Fetch panels for performance-test dashboards from ds_metrics
   */
  const fetchPerformanceTestPanels = useCallback(async (dashboard: ApplicationDashboard): Promise<Panel[]> => {
    if (!testRun) return [];

    try {
      setPanelsLoading(true);
      const response = await authenticatedFetch(
        `/metrics/ds-metrics/available/${testRun.test_run_id}`,
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (response.ok) {
        const rows: Array<{ dashboard_label: string; panel_title: string; panel_id: number; unit?: string }> = await response.json();
        const dashboardLabel = dashboard.dashboard_label;
        const seen = new Set<number>();
        const panels: Panel[] = [];
        for (const row of rows) {
          if (row.dashboard_label === dashboardLabel && !seen.has(row.panel_id)) {
            seen.add(row.panel_id);
            panels.push({
              id: row.panel_id,
              title: row.panel_title,
              type: 'timeseries',
              yAxesFormat: row.unit || PERFORMANCE_METRICS_PANEL_UNITS[row.panel_id] || undefined,
              applicationDashboardId: dashboard.id,
              metricsSourceId: dashboard.metrics_source_id,
            });
          }
        }
        setPanels(panels);
        return panels;
      } else {
        setPanels([]);
        return [];
      }
    } catch (error) {
      console.error('Error fetching performance test panels:', error);
      setPanels([]);
      return [];
    } finally {
      setPanelsLoading(false);
    }
  }, [testRun]);

  /**
   * Fetch available metrics for a selected panel from ds_metrics table
   */
  const fetchPanelMetrics = useCallback(async (dashboardId: string, panelId: number, metricsSourceId?: string) => {
    if (!testRun || !dashboardId || !panelId) return;

    try {
      setMetricsLoading(true);
      const params = new URLSearchParams({
        applicationDashboardId: dashboardId,
        panelId: panelId.toString()
      });
      if (metricsSourceId) {
        params.set('metricsSourceId', metricsSourceId);
      }

      const response = await authenticatedFetch(
        `/metrics/ds-metrics/distinct-names?${params.toString()}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const metricNames = await response.json();
        setMetrics(offerAggregatedOption(selectedSource, panelId, metricNames as string[]));
      } else {
        console.warn('Failed to fetch metrics:', response.statusText);
        setMetrics([]);
      }
    } catch (error) {
      console.error('Error fetching metrics:', error);
      setMetrics([]);
    } finally {
      setMetricsLoading(false);
    }
  }, [testRun, selectedSource]);

  /**
   * Handle dashboard selection
   */
  const handleDashboardSelect = useCallback((
    dashboard: ApplicationDashboard | null,
    source?: DataSource
  ) => {
    setSelectedDashboard(dashboard);
    setSelectedPanel(null);
    setSelectedMetrics([]);
    setPanels([]);
    setMetrics([]);

    if (!dashboard) return;

    // Auto-determine source from the dashboard itself
    const detectedSourceType = getSourceType(dashboard);
    const sourceToUse = source || (
      detectedSourceType === 'dynatrace' ? 'dynatrace' as DataSource :
      detectedSourceType === 'performance_test' ? 'performance-metrics' as DataSource :
      'grafana' as DataSource
    );
    setSelectedSource(sourceToUse);

    if (sourceToUse === 'dynatrace') {
      const dynatraceUid = dashboard.dashboard_uid || `dynatrace-${dashboard.dashboard_label}`;
      fetchDashboardPanels(dynatraceUid, dashboard);
    } else if (sourceToUse === 'performance-metrics') {
      fetchPerformanceTestPanels(dashboard);
    } else if (dashboard.dashboard_uid) {
      fetchDashboardPanels(dashboard.dashboard_uid, dashboard);
    }
  }, [fetchDashboardPanels, fetchPerformanceTestPanels]);

  /**
   * Handle panel selection
   */
  const handlePanelSelect = useCallback((panel: Panel | null) => {
    setSelectedPanel(panel);
    setSelectedMetrics([]);
    setMetrics([]);

    if (panel && selectedDashboard) {
      const applicationDashboardId = panel.applicationDashboardId || selectedDashboard.id;
      const metricsSourceId = panel.metricsSourceId || selectedDashboard.metrics_source_id;
      fetchPanelMetrics(applicationDashboardId, panel.id, metricsSourceId);
    }
  }, [selectedDashboard, fetchPanelMetrics]);

  /**
   * Fetch metric data for a series from the backend
   */
  const fetchSeriesData = useCallback(async (series: SeriesConfig): Promise<MetricDataPoint[]> => {
    if (series.metricName.startsWith(ALL_AGGREGATED_OPTION)) {
      return fetchAggregatedSeriesData(testRun?.test_run_id || testRunId, series);
    }
    try {
      const params = new URLSearchParams({
        applicationDashboardId: series.dashboardId,
        panelId: series.panelId.toString()
      });
      if (series.metricsSourceId) {
        params.set('metricsSourceId', series.metricsSourceId);
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
        const allMetrics = await response.json();
        const filteredMetrics = allMetrics.filter(
          (m: MetricDataPoint) => m.metric_name === series.metricName
        );
        return filteredMetrics;
      } else {
        console.warn(`Failed to fetch data for series ${series.id}:`, response.statusText);
        return [];
      }
    } catch (error) {
      console.error(`Error fetching data for series ${series.id}:`, error);
      return [];
    }
  }, [testRun, testRunId]);

  /**
   * Add selected metrics to the series list
   */
  const handleAddSeries = useCallback(async (showToast: (message: string) => void) => {
    if (!selectedDashboard || !selectedPanel || selectedMetrics.length === 0) {
      showToast('Please select a dashboard, panel, and at least one metric');
      return 0;
    }

    const applicationDashboardId = selectedPanel.applicationDashboardId || selectedDashboard.id;
    const metricsSourceId = selectedPanel.metricsSourceId || selectedDashboard.metrics_source_id;
    const source = determineSource(selectedPanel.type, selectedDashboard.dashboard_uid);

    const newSeriesList: SeriesConfig[] = selectedMetrics.map(metricName => {
      const isAggregated = metricName === ALL_AGGREGATED_OPTION;
      const spec = isAggregated ? getAggregateSpec(selectedPanel.id) : null;
      return {
        id: `${applicationDashboardId}-${selectedPanel.id}-${isAggregated ? 'aggregated' : metricName}-${Date.now()}-${Math.random()}`,
        dashboardId: applicationDashboardId,
        dashboardLabel: selectedDashboard.dashboard_label,
        panelId: selectedPanel.id,
        panelTitle: selectedPanel.title,
        metricName: isAggregated ? buildAggregatedMetricName(selectedPanel.title) : metricName,
        source: source,
        yAxisFormat: isAggregated && spec ? aggregatedYAxisFormat(spec.metric) : selectedPanel.yAxesFormat,
        metricsSourceId: metricsSourceId
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

    // Add series to the list
    setAddedSeries(prev => [...prev, ...filteredNewSeries]);
    setSelectedMetrics([]);

    // Fetch data for new series
    setChartDataLoading(true);
    try {
      const newSeriesData = new Map(seriesData);

      await Promise.all(
        filteredNewSeries.map(async (series) => {
          const data = await fetchSeriesData(series);
          newSeriesData.set(series.id, data);
        })
      );

      setSeriesData(newSeriesData);
      showToast(`Added ${filteredNewSeries.length} metric(s) with data`);
      return filteredNewSeries.length;
    } catch (error) {
      console.error('Error fetching series data:', error);
      showToast('Added metrics but failed to load data');
      return filteredNewSeries.length;
    } finally {
      setChartDataLoading(false);
    }
  }, [selectedDashboard, selectedPanel, selectedMetrics, addedSeries, seriesData, fetchSeriesData]);

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
   * Compute available sources based on loaded dashboards
   */
  useEffect(() => {
    const sources = computeAvailableSources(dashboards, dynatraceDashboards);
    setAvailableSources(sources);

    // Auto-select first available source if current selection is not available
    if (sources.length > 0 && !sources.includes(selectedSource)) {
      setSelectedSource(sources[0]);
    }
  }, [dashboards, dynatraceDashboards, selectedSource]);

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

  /**
   * Get filtered dashboards based on selected source (kept for backward compatibility)
   */
  const getFilteredDashboardsList = useCallback(() => {
    return getFilteredDashboards(selectedSource, dashboards, dynatraceDashboards);
  }, [selectedSource, dashboards, dynatraceDashboards]);

  return {
    // State
    selectedSource,
    availableSources,
    selectedDashboard,
    selectedPanel,
    dashboards,
    dashboardsLoading,
    dynatraceDashboards,
    dynatraceDashboardsLoading,
    panels,
    panelsLoading,
    metrics,
    metricsLoading,
    selectedMetrics,
    addedSeries,
    chartName,
    seriesData,
    chartDataLoading,

    // State setters
    setSelectedSource,
    setSelectedDashboard,
    setSelectedPanel,
    setSelectedMetrics,
    setAddedSeries,
    setSeriesData,
    setChartName,
    setChartDataLoading,

    // Fetch functions
    fetchApplicationDashboards,
    fetchDashboardPanels,
    fetchPanelMetrics,
    fetchSeriesData,

    // Handlers
    getAllDashboardsMerged,
    getFilteredDashboards: getFilteredDashboardsList,
    handleSourceSelect,
    handleDashboardSelect,
    handlePanelSelect,
    handleAddSeries,
    handleRemoveSeries,
    handleUpdateSeriesUnit,
  };
}
