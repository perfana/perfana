'use client';

import { useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import type React from 'react';
import {
  GraphData,
  CompareSeries,
  RelatedTestRun,
  MetricComparison,
  MetricStatistic,
} from '../types';
import { TestRun } from '@/types/test-runs';
import { ALL_AGGREGATED_OPTION, buildAggregatedMetricName } from '@/lib/aggregated-perf-series';
import { graphKeyOf } from '../utils/compare-utils';
import type { SeriesPick } from '../components/CompareSelectionPanel';

interface UseCompareHandlersProps {
  testRun: TestRun | null;
  testRunId: string;
  showToast: (message: string) => void;

  // State
  addedSeries: CompareSeries[];
  selectedTestRun: RelatedTestRun | null;
  showGraphs: Record<string, boolean>;

  // State setters
  setAddedSeries: (series: CompareSeries[] | ((prev: CompareSeries[]) => CompareSeries[])) => void;
  setMetricComparisons: React.Dispatch<React.SetStateAction<MetricComparison[]>>;
  setCurrentMetrics: React.Dispatch<React.SetStateAction<MetricStatistic[]>>;
  setSelectedMetrics: React.Dispatch<React.SetStateAction<MetricStatistic[]>>;
  setShowGraphs: (graphs: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  setGraphData: (data: Record<string, GraphData> | ((prev: Record<string, GraphData>) => Record<string, GraphData>)) => void;
  setGraphLoading: (loading: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
}

export function useCompareHandlers({
  testRun,
  testRunId,
  showToast,
  addedSeries,
  selectedTestRun,
  showGraphs,
  setAddedSeries,
  setMetricComparisons,
  setCurrentMetrics,
  setSelectedMetrics,
  setShowGraphs,
  setGraphData,
  setGraphLoading,
}: UseCompareHandlersProps) {

  // Add the picked series to the comparison. The picks carry their own dashboard and panel,
  // so one click can add series from several panels across several dashboards.
  const handleAddSeries = useCallback((picks: SeriesPick[]) => {
    if (picks.length === 0) return;

    const newSeries: CompareSeries[] = picks
      .map(({ dashboard, panel, metricName }) => {
        const isAggregated = metricName === ALL_AGGREGATED_OPTION;
        return {
          id: `${dashboard.id}-${panel.id}-${metricName}-${Date.now()}`,
          dashboardId: panel.applicationDashboardId || dashboard.id,
          dashboardLabel: dashboard.dashboard_label,
          panelId: panel.id,
          panelTitle: panel.title,
          metricName: isAggregated ? buildAggregatedMetricName(panel.title) : metricName,
          source: panel.source,
          metricsSourceId: panel.metricsSourceId || dashboard.metrics_source_id,
          yAxesFormat: panel.yAxesFormat,
          isAggregated,
        };
      })
      .filter(newS => !addedSeries.some(
        existing =>
          existing.dashboardId === newS.dashboardId &&
          existing.panelId === newS.panelId &&
          existing.metricName === newS.metricName
      ));

    if (newSeries.length > 0) {
      setAddedSeries(prev => [...prev, ...newSeries]);
      showToast(`Added ${newSeries.length} series to comparison`);
    } else {
      showToast('Selected series already added');
    }
  }, [addedSeries, setAddedSeries, showToast]);

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

  // Fetch graph data for a specific row (dashboard+panel+metric).
  const fetchGraphData = useCallback(async (row: { dashboardId: string; panelId: number; metricName: string }) => {
    if (!selectedTestRun) return;
    const graphKey = graphKeyOf(row.dashboardId, row.panelId, row.metricName);
    setGraphLoading(prev => ({ ...prev, [graphKey]: true }));

    try {
      const params = new URLSearchParams({
        currentTestRunId: testRun?.test_run_id || testRunId,
        baselineTestRunId: selectedTestRun.test_run_id,
        applicationDashboardId: row.dashboardId,
        panelId: row.panelId.toString(),
        metricName: row.metricName,
      });

      const response = await authenticatedFetch(`/metrics/ds-metrics-comparison?${params.toString()}`);
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
  }, [selectedTestRun, testRun?.test_run_id, testRunId, showToast, setGraphLoading, setGraphData]);

  // Toggle graph visibility for a row.
  const toggleGraph = useCallback(async (row: { dashboardId: string; panelId: number; metricName: string }) => {
    const graphKey = graphKeyOf(row.dashboardId, row.panelId, row.metricName);
    const isCurrentlyShown = showGraphs[graphKey];
    if (!isCurrentlyShown) {
      await fetchGraphData(row);
    }
    setShowGraphs(prev => ({ ...prev, [graphKey]: !isCurrentlyShown }));
  }, [showGraphs, fetchGraphData, setShowGraphs]);

  return {
    handleAddSeries,
    handleRemoveSeries,
    handleClearAllSeries,
    fetchGraphData,
    toggleGraph,
  };
}
