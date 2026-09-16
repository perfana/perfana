'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceDashboards, DynatraceDashboard } from '@/lib/dynatrace';
import {
  ApplicationDashboard,
  SeriesConfig,
  MetricDataPoint,
  DataSource,
} from '../types';
import { generateChartName } from '../utils';
import { computeAvailableSources } from '../utils';
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
import { TestRun } from '@/types/test-runs';
import type { SeriesPick } from '../../shared/metric-options';

interface UseGraphsDataProps {
  testRun: TestRun | null;
  testRunId: string;
  graphsExpanded: boolean;
}

export function useGraphsData({ testRun, testRunId }: UseGraphsDataProps) {
  // Source selection state
  const [selectedSource, setSelectedSource] = useState<DataSource>('grafana');
  const [availableSources, setAvailableSources] = useState<DataSource[]>([]);

  // Dashboard state — the cascade (MetricSeriesCascade) holds the panel/series selection.
  const [dashboards, setDashboards] = useState<ApplicationDashboard[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [dynatraceDashboards, setDynatraceDashboards] = useState<DynatraceDashboard[]>([]);
  const [dynatraceDashboardsLoading, setDynatraceDashboardsLoading] = useState(false);

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
   * Fetch metric data for a series from the backend
   */
  const fetchSeriesData = useCallback(async (series: SeriesConfig): Promise<MetricDataPoint[]> => {
    if (series.metricName.startsWith(ALL_AGGREGATED_OPTION)
        && !isAllAggregatedDashboard(series.dashboardLabel)) {
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
   * Add the picked series and fetch their data. Each pick carries its own dashboard and
   * panel, so one click can add series from several panels across several dashboards.
   */
  const handleAddSeries = useCallback(async (picks: SeriesPick[], showToast: (message: string) => void) => {
    const newSeriesList: SeriesConfig[] = picks.map(({ dashboard, panel, metricName }) => {
      const isAggregated = metricName === ALL_AGGREGATED_OPTION
        && !isAllAggregatedDashboard(dashboard.dashboard_label);
      const spec = isAggregated ? getAggregateSpec(panel.id) : null;
      return {
        id: `${dashboard.id}-${panel.id}-${isAggregated ? 'aggregated' : metricName}-${Date.now()}-${Math.random()}`,
        dashboardId: panel.applicationDashboardId || dashboard.id,
        dashboardLabel: dashboard.dashboard_label,
        panelId: panel.id,
        panelTitle: panel.title,
        metricName: isAggregated ? buildAggregatedMetricName(panel.title) : metricName,
        source: panel.source,
        yAxisFormat: isAggregated && spec ? aggregatedYAxisFormat(spec.metric) : panel.yAxesFormat,
        metricsSourceId: panel.metricsSourceId || dashboard.metrics_source_id,
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

    setSelectedSource(filteredNewSeries[0]!.source);
    setAddedSeries(prev => [...prev, ...filteredNewSeries]);

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
  }, [addedSeries, seriesData, fetchSeriesData]);

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

  return {
    // State
    selectedSource,
    availableSources,
    dashboards,
    dashboardsLoading,
    dynatraceDashboards,
    dynatraceDashboardsLoading,
    addedSeries,
    chartName,
    seriesData,
    chartDataLoading,

    // State setters
    setSelectedSource,
    setAddedSeries,
    setSeriesData,
    setChartName,
    setChartDataLoading,

    // Fetch functions
    fetchApplicationDashboards,
    fetchSeriesData,

    // Handlers
    getAllDashboardsMerged,
    handleAddSeries,
    handleRemoveSeries,
    handleUpdateSeriesUnit,
  };
}
