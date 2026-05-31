'use client';

/**
 * useCurrentTestRunChart - Data fetching and chart configuration hook
 */

import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '@mui/material';
import { authenticatedFetch } from '@/lib/api';
import type {
  MetricDataPoint,
  TestRunInfo,
  Thresholds,
  AggregatedMetricSource,
} from '../types';
import {
  DEFAULT_CHART_HEIGHT,
  findDataRange,
  calculateUnitConversion,
  getChartThemeColors,
  calculateTimeRange,
  buildMetricTrace,
  buildThresholdTraces,
  buildChartLayout,
  buildChartConfig,
} from '../utils';

interface UseCurrentTestRunChartProps {
  testRunId: string;
  applicationDashboardId: string;
  panelId: string;
  metricName: string;
  testRun?: TestRunInfo;
  thresholds?: Thresholds;
  unit?: string | null;
  isDrawerOpen?: boolean;
  showToast?: (message: string) => void;
  aggregatedMetricSource?: AggregatedMetricSource;
}

interface UseCurrentTestRunChartReturn {
  loading: boolean;
  error: string | null;
  metricsData: MetricDataPoint[];
  plotData: unknown[];
  plotLayout: unknown;
  plotConfig: unknown;
  hasData: boolean;
  chartHeight: number;
}

export function useCurrentTestRunChart({
  testRunId,
  applicationDashboardId,
  panelId,
  metricName,
  testRun,
  thresholds,
  unit,
  isDrawerOpen = false,
  showToast,
  aggregatedMetricSource,
}: UseCurrentTestRunChartProps): UseCurrentTestRunChartReturn {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metricsData, setMetricsData] = useState<MetricDataPoint[]>([]);
  const [plotData, setPlotData] = useState<unknown[]>([]);
  const [plotLayout, setPlotLayout] = useState<unknown>({});
  const [plotConfig, setPlotConfig] = useState<unknown>({});

  const fetchMetricsData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (aggregatedMetricSource) {
        // Use the aggregated timeseries endpoint for performance-metrics source
        const queryParams = new URLSearchParams({ metric: aggregatedMetricSource.metric });
        if (aggregatedMetricSource.stat) {
          queryParams.append('stat', aggregatedMetricSource.stat);
        }

        const response = await authenticatedFetch(
          `/test-runs/${testRunId}/aggregated-metric-timeseries?${queryParams.toString()}`,
          { method: 'GET', headers: { 'Content-Type': 'application/json' } },
        );

        if (!response.ok) {
          if (response.status === 404) { setMetricsData([]); return; }
          throw new Error(`Failed to fetch aggregated metric data: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const buckets: Array<{ time: string; value: number }> = data.buckets ?? [];
        const bucketSize: number = data.bucketSizeSeconds ?? 60;

        setMetricsData(buckets.map(b => ({
          metric_name: metricName,
          time: b.time,
          timestep: bucketSize,
          ramp_up: false,
          value: b.value,
        })));
      } else {
        // Use the Grafana panel metrics endpoint
        let url = `/metrics/ds-metrics/${testRunId}/${panelId}`;
        const queryParams = new URLSearchParams();
        if (applicationDashboardId) {
          queryParams.append('applicationDashboardId', applicationDashboardId);
        }
        if (queryParams.toString()) url += `?${queryParams.toString()}`;

        const response = await authenticatedFetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          if (response.status === 404) { setMetricsData([]); return; }
          throw new Error(`Failed to fetch metrics data: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const dataPoints = Array.isArray(data) ? data : data.data;

        if (dataPoints && Array.isArray(dataPoints)) {
          setMetricsData(dataPoints.filter(
            (point: MetricDataPoint) => point.metric_name === metricName,
          ));
        } else {
          setMetricsData([]);
        }
      }
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to fetch metrics data'
      );
    } finally {
      setLoading(false);
    }
  }, [testRunId, panelId, applicationDashboardId, metricName, aggregatedMetricSource]);

  const createPlotlyGraph = useCallback(() => {
    if (!metricsData || metricsData.length === 0) return;

    const panelYAxesFormat = unit || '';

    // Find global min/max for unit conversion
    const { min: globalMin, max: globalMax } = findDataRange(metricsData);

    // Calculate unit conversion
    const { factor, yAxisLabel } = calculateUnitConversion(panelYAxesFormat, globalMin, globalMax);

    // Get theme colors
    const colors = getChartThemeColors(theme);

    // Calculate time range
    const timeRange = calculateTimeRange(testRun?.start_time, testRun?.end_time, metricsData);

    // Calculate ramp-up end timestamp
    const rampUpSeconds = testRun?.ramp_up_seconds || 60;
    const lastRampUpTimestamp = new Date(timeRange.start.getTime() + rampUpSeconds * 1000);

    // Sort data by time for proper line rendering
    const sortedData = [...metricsData].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
    );

    // Extract x and y values
    const x: Date[] = [];
    const y: number[] = [];

    sortedData.forEach(dataPoint => {
      if (dataPoint.value !== undefined && dataPoint.value !== null && dataPoint.time) {
        x.push(new Date(dataPoint.time));
        y.push(dataPoint.value * factor);
      }
    });

    const traces: unknown[] = [];

    if (x.length > 0) {
      // Main metric trace
      traces.push(buildMetricTrace(metricName, x, y, panelYAxesFormat, colors.primaryColor));

      // Add threshold traces if available
      if (thresholds) {
        const thresholdTraces = buildThresholdTraces(
          thresholds,
          timeRange,
          factor,
          colors.thresholdColor
        );
        traces.push(...thresholdTraces);
      }
    }

    // Build layout and config
    const layout = buildChartLayout(
      metricName,
      timeRange,
      lastRampUpTimestamp,
      yAxisLabel,
      colors,
      theme.typography.fontFamily as string,
      x.length > 1
    );

    const config = buildChartConfig(metricName, showToast);

    // Update state
    setPlotData(traces);
    setPlotLayout(layout);
    setPlotConfig(config);
  }, [metricsData, unit, thresholds, testRun, theme, metricName, showToast]);

  // Fetch data on mount and when dependencies change
  useEffect(() => {
    fetchMetricsData();
  }, [fetchMetricsData]);

  // Create chart when data changes
  useEffect(() => {
    if (metricsData.length > 0 && !loading) {
      createPlotlyGraph();
    }
  }, [metricsData, loading, createPlotlyGraph, isDrawerOpen]);

  return {
    loading,
    error,
    metricsData,
    plotData,
    plotLayout,
    plotConfig,
    hasData: metricsData.length > 0,
    chartHeight: DEFAULT_CHART_HEIGHT,
  };
}
