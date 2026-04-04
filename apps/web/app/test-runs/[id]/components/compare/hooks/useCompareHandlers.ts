'use client';

import { useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import {
  ApplicationDashboard,
  Panel,
  GraphData,
  CompareSeries,
  DataSource,
  RelatedTestRun,
} from '../types';
import { TestRun } from '@/types/test-runs';
import { getSourceType } from '@/lib/metrics-source-utils';

interface UseCompareHandlersProps {
  testRun: TestRun | null;
  testRunId: string;
  showToast: (message: string) => void;

  // State
  selectedSource: DataSource;
  selectedDashboard: ApplicationDashboard | null;
  selectedMetric: Panel | null;
  selectedMetricNames: string[];
  addedSeries: CompareSeries[];
  selectedTestRun: RelatedTestRun | null;
  showGraphs: Record<string, boolean>;

  // State setters
  setSelectedSource: (source: DataSource) => void;
  setSelectedDashboard: (dashboard: ApplicationDashboard | null) => void;
  setSelectedMetric: (metric: Panel | null) => void;
  setPanels: (panels: Panel[]) => void;
  setDynatraceMetrics: (metrics: any[]) => void;
  setAvailableMetrics: (metrics: string[]) => void;
  setSelectedMetricNames: (names: string[]) => void;
  setAddedSeries: (series: CompareSeries[] | ((prev: CompareSeries[]) => CompareSeries[])) => void;
  setMetricComparisons: (comparisons: any[]) => void;
  setCurrentMetrics: (metrics: any[]) => void;
  setSelectedMetrics: (metrics: any[]) => void;
  setShowGraphs: (graphs: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  setGraphData: (data: Record<string, GraphData> | ((prev: Record<string, GraphData>) => Record<string, GraphData>)) => void;
  setGraphLoading: (loading: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;

  // Fetch functions
  fetchDashboardPanels: (uid: string) => Promise<Panel[]>;
  fetchDynatraceMetricsList: (label: string) => Promise<void>;
  fetchPanelMetrics: (dashboardId: string, panelId: number, metricsSourceId?: string) => Promise<string[]>;
}

export function useCompareHandlers({
  testRun,
  testRunId,
  showToast,
  selectedSource,
  selectedDashboard,
  selectedMetric,
  selectedMetricNames,
  addedSeries,
  selectedTestRun,
  showGraphs,
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
  setShowGraphs,
  setGraphData,
  setGraphLoading,
  fetchDashboardPanels,
  fetchDynatraceMetricsList,
  fetchPanelMetrics,
}: UseCompareHandlersProps) {

  // Handle source selection
  const handleSourceSelect = useCallback((source: DataSource) => {
    setSelectedSource(source);
    setSelectedDashboard(null);
    setSelectedMetric(null);
    setPanels([]);
    setDynatraceMetrics([]);
    setCurrentMetrics([]);
    setSelectedMetrics([]);
    setMetricComparisons([]);
    setAvailableMetrics([]);
    setSelectedMetricNames([]);
  }, [
    setSelectedSource, setSelectedDashboard, setSelectedMetric, setPanels,
    setDynatraceMetrics, setCurrentMetrics, setSelectedMetrics,
    setMetricComparisons, setAvailableMetrics, setSelectedMetricNames
  ]);

  // Handle dashboard selection
  const handleDashboardSelect = useCallback((
    dashboard: ApplicationDashboard | null,
    dynatraceDashboardLabel?: string
  ) => {
    setSelectedDashboard(dashboard);
    setSelectedMetric(null);
    setPanels([]);
    setDynatraceMetrics([]);
    setCurrentMetrics([]);
    setSelectedMetrics([]);
    setMetricComparisons([]);
    setAvailableMetrics([]);
    setSelectedMetricNames([]);

    if (!dashboard) return;

    // Auto-determine source from the dashboard itself
    const detectedSourceType = getSourceType(dashboard);
    const sourceToUse = (
      detectedSourceType === 'dynatrace' ? 'dynatrace' as DataSource :
      detectedSourceType === 'performance_test' ? 'performance-metrics' as DataSource :
      'grafana' as DataSource
    );
    setSelectedSource(sourceToUse);

    if (sourceToUse === 'dynatrace') {
      const label = dynatraceDashboardLabel || dashboard.dashboard_label;
      fetchDynatraceMetricsList(label);
    } else if (sourceToUse === 'performance-metrics') {
      // Fetch panels from ds_metrics for performance-test dashboards
      if (testRun) {
        authenticatedFetch(
          `/metrics/ds-metrics/available/${testRun.test_run_id}`,
          { headers: { 'Content-Type': 'application/json' } }
        ).then(async (response) => {
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
                  applicationDashboardId: dashboard.id,
                  metricsSourceId: dashboard.metrics_source_id,
                });
              }
            }
            setPanels(panels);
          } else {
            setPanels([]);
          }
        }).catch(() => setPanels([]));
      }
    } else if (dashboard.dashboard_uid) {
      fetchDashboardPanels(dashboard.dashboard_uid);
    }
  }, [
    testRun,
    setSelectedSource, setSelectedDashboard, setSelectedMetric, setPanels,
    setDynatraceMetrics, setCurrentMetrics, setSelectedMetrics,
    setMetricComparisons, setAvailableMetrics, setSelectedMetricNames,
    fetchDashboardPanels, fetchDynatraceMetricsList
  ]);

  // Handle metric/panel selection
  const handleMetricSelect = useCallback(async (metric: Panel | null) => {
    setSelectedMetric(metric);
    setSelectedMetricNames([]);

    if (metric && selectedDashboard) {
      const applicationDashboardId = metric.applicationDashboardId || selectedDashboard.id;
      const metricsSourceId = metric.metricsSourceId || selectedDashboard.metrics_source_id;
      await fetchPanelMetrics(applicationDashboardId, metric.id, metricsSourceId);
    } else {
      setAvailableMetrics([]);
    }
  }, [selectedDashboard, setSelectedMetric, setSelectedMetricNames, setAvailableMetrics, fetchPanelMetrics]);

  // Add selected metrics as series to the comparison
  const handleAddSeries = useCallback(() => {
    if (!selectedDashboard || !selectedMetric || selectedMetricNames.length === 0) return;

    const newSeries: CompareSeries[] = selectedMetricNames
      .filter(metricName => {
        return !addedSeries.some(
          existing =>
            existing.dashboardId === (selectedMetric.applicationDashboardId || selectedDashboard.id) &&
            existing.panelId === selectedMetric.id &&
            existing.metricName === metricName
        );
      })
      .map(metricName => ({
        id: `${selectedDashboard.id}-${selectedMetric.id}-${metricName}-${Date.now()}`,
        dashboardId: selectedMetric.applicationDashboardId || selectedDashboard.id,
        dashboardLabel: selectedDashboard.dashboard_label,
        panelId: selectedMetric.id,
        panelTitle: selectedMetric.title,
        metricName,
        source: selectedSource,
        metricsSourceId: selectedMetric.metricsSourceId || selectedDashboard.metrics_source_id,
      }));

    if (newSeries.length > 0) {
      setAddedSeries(prev => [...prev, ...newSeries]);
      showToast(`Added ${newSeries.length} series to comparison`);
    } else {
      showToast('Selected series already added');
    }

    setSelectedMetricNames([]);
  }, [
    selectedDashboard, selectedMetric, selectedMetricNames, addedSeries,
    selectedSource, setAddedSeries, setSelectedMetricNames, showToast
  ]);

  // Remove a series from the comparison
  const handleRemoveSeries = useCallback((seriesId: string) => {
    setAddedSeries(prev => prev.filter(s => s.id !== seriesId));
  }, [setAddedSeries]);

  // Clear all added series
  const handleClearAllSeries = useCallback(() => {
    setAddedSeries([]);
    setMetricComparisons([]);
    setCurrentMetrics([]);
    setSelectedMetrics([]);
    setShowGraphs({});
    setGraphData({});
  }, [
    setAddedSeries, setMetricComparisons, setCurrentMetrics,
    setSelectedMetrics, setShowGraphs, setGraphData
  ]);

  // Fetch graph data for a specific metric
  const fetchGraphData = useCallback(async (metricName: string) => {
    if (!selectedTestRun) return;

    const seriesInfo = addedSeries.find(s => s.metricName === metricName);
    if (!seriesInfo) return;

    const graphKey = metricName;
    setGraphLoading(prev => ({ ...prev, [graphKey]: true }));

    try {
      const params = new URLSearchParams({
        currentTestRunId: testRun?.test_run_id || testRunId,
        baselineTestRunId: selectedTestRun.test_run_id,
        applicationDashboardId: seriesInfo.dashboardId,
        panelId: seriesInfo.panelId.toString(),
        metricName: metricName
      });

      const response = await authenticatedFetch(
        `/metrics/ds-metrics-comparison?${params.toString()}`
      );

      if (response.ok) {
        const data: GraphData = await response.json();
        setGraphData(prev => ({ ...prev, [graphKey]: data }));
      } else {
        showToast('Failed to load graph data');
      }
    } catch (error) {
      console.error('Error fetching graph data:', error);
      showToast('Error loading graph data');
    } finally {
      setGraphLoading(prev => ({ ...prev, [graphKey]: false }));
    }
  }, [selectedTestRun, addedSeries, testRun?.test_run_id, testRunId, showToast, setGraphLoading, setGraphData]);

  // Toggle graph visibility
  const toggleGraph = useCallback(async (metricName: string) => {
    const graphKey = metricName;
    const isCurrentlyShown = showGraphs[graphKey];

    if (!isCurrentlyShown) {
      await fetchGraphData(metricName);
    }

    setShowGraphs(prev => ({ ...prev, [graphKey]: !isCurrentlyShown }));
  }, [showGraphs, fetchGraphData, setShowGraphs]);

  return {
    handleSourceSelect,
    handleDashboardSelect,
    handleMetricSelect,
    handleAddSeries,
    handleRemoveSeries,
    handleClearAllSeries,
    fetchGraphData,
    toggleGraph,
  };
}
