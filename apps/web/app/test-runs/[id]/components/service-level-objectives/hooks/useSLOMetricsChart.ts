'use client';

/**
 * useSLOMetricsChart - Data fetching and chart configuration hook for SLO metrics
 */

import { useState, useEffect, useCallback } from 'react';
import { useTheme} from '@mui/material';
import { authenticatedFetch } from '@/lib/api';
import type {
  DSMetric,
  MetricDataPoint,
  CheckResult,
  TestRunInfo,
} from '../types';
import {
  _DEFAULT_CHART_HEIGHT,
  METRIC_COLOR_PALETTE,
  groupDataByMetricName,
  findGlobalDataRange,
  calculateUnitConversion,
  getChartThemeColors,
  calculateTimeRange,
  buildBarTrace,
  buildLineTrace,
  buildRequirementTrace,
  buildChartLayout,
  buildChartConfig,
} from '../utils/slo-chart-utils';

interface UseSLOMetricsChartProps {
  testRunId: string;
  checkResult: CheckResult;
  testRun?: TestRunInfo;
  targetName?: string;
  isVisible?: boolean;
}

interface UseSLOMetricsChartReturn {
  loading: boolean;
  error: string | null;
  metricsData: DSMetric | MetricDataPoint[] | null;
  plotData: unknown[];
  plotLayout: unknown;
  plotConfig: unknown;
  metricName: string;
  hasData: boolean;
}

export function useSLOMetricsChart({
  testRunId,
  checkResult,
  testRun,
  targetName,
  isVisible = true,
}: UseSLOMetricsChartProps): UseSLOMetricsChartReturn {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metricsData, setMetricsData] = useState<DSMetric | MetricDataPoint[] | null>(null);
  const [plotData, setPlotData] = useState<any[]>([]);
  const [plotLayout, setPlotLayout] = useState<any>({});
  const [plotConfig, setPlotConfig] = useState<any>({});

  const metricName = checkResult.metric_name || checkResult.panel_title || 'Unknown Metric';

  const fetchMetricsData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (checkResult.panel_id === null || checkResult.panel_id === undefined) {
        setMetricsData(null);
        setLoading(false);
        return;
      }

      let url = `/metrics/ds-metrics/${testRunId}/${checkResult.panel_id}`;
      const queryParams = new URLSearchParams();

      if (checkResult.application_dashboard_id) {
        queryParams.append('applicationDashboardId', checkResult.application_dashboard_id);
      } else if (checkResult.benchmark_id) {
        queryParams.append('benchmarkId', checkResult.benchmark_id);
      }

      if (queryParams.toString()) {
        url += `?${queryParams.toString()}`;
      }

      const response = await authenticatedFetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          setMetricsData(null);
          return;
        }
        throw new Error(`Failed to fetch metrics data: ${response.status} ${response.statusText}`);
      }

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error('Invalid JSON response from metrics endpoint');
      }
      setMetricsData(data || null);
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to fetch metrics data'
      );
    } finally {
      setLoading(false);
    }
  }, [testRunId, checkResult.panel_id, checkResult.application_dashboard_id, checkResult.benchmark_id]);

  const createPlotlyGraph = useCallback(() => {
    if (!metricsData) return;

    // Handle both old format (object with data property) and new format (direct array)
    const dataPoints: MetricDataPoint[] = Array.isArray(metricsData)
      ? metricsData
      : (metricsData as DSMetric).data;
    if (!dataPoints || dataPoints.length === 0) return;

    const requirementValue = checkResult.requirement?.value || 0;
    const panelYAxesFormat = checkResult.metric_unit || '';

    // Group data by metric name
    const metricGroups = groupDataByMetricName(dataPoints, targetName);

    // Find global min/max for unit conversion
    const { min: globalMin, max: globalMax } = findGlobalDataRange(metricGroups);

    // Calculate unit conversion
    const { factor, adjustedRequirement, adjustedFormat, yAxisLabel } = calculateUnitConversion(
      panelYAxesFormat,
      requirementValue,
      globalMin,
      globalMax
    );

    // Get theme colors
    const colors = getChartThemeColors(theme);

    // Calculate time range
    const { start: testRunStart, end: testRunEnd } = calculateTimeRange(
      testRun?.start_time,
      testRun?.end_time,
      metricGroups
    );

    const rampUpSeconds = testRun?.ramp_up_seconds || 60;
    const lastRampUpTimestamp = new Date(testRunStart.getTime() + rampUpSeconds * 1000);

    // Create traces for each metric
    const metricTraces: unknown[] = [];
    let colorIndex = 0;
    let hasTimeSeriesData = false;

    metricGroups.forEach((metricData, groupMetricName) => {
      const x: Date[] = [];
      const y: number[] = [];

      metricData.forEach(dataPoint => {
        if (dataPoint.value !== undefined && dataPoint.value !== null) {
          x.push(new Date(dataPoint.time));
          y.push(dataPoint.value * factor);
        }
      });

      if (x.length === 0) return;

      const metricColor = METRIC_COLOR_PALETTE[colorIndex % METRIC_COLOR_PALETTE.length];
      colorIndex++;

      // Check if this metric meets requirements (only if we have a specific target)
      const meetsRequirement = targetName
        ? y.every(value => value <= adjustedRequirement)
        : true;
      const finalColor = targetName && !meetsRequirement ? theme.palette.error.main : metricColor;

      if (x.length === 1) {
        metricTraces.push(
          buildBarTrace(groupMetricName, y[0], finalColor, adjustedFormat, colors.textColor)
        );
      } else {
        hasTimeSeriesData = true;
        metricTraces.push(
          buildLineTrace(groupMetricName, x, y, finalColor, colors.bgColor, adjustedFormat)
        );
      }
    });

    // Add requirement line if we have a requirement value
    const data: unknown[] = adjustedRequirement
      ? [
          ...metricTraces,
          buildRequirementTrace(
            testRunStart,
            testRunEnd,
            adjustedRequirement,
            colors.sloColor,
            adjustedFormat
          ),
        ]
      : metricTraces;

    // Build layout
    const layout = buildChartLayout(
      hasTimeSeriesData,
      testRunStart,
      testRunEnd,
      lastRampUpTimestamp,
      yAxisLabel,
      colors,
      theme.typography.fontFamily as string
    );

    // Build config
    const config = buildChartConfig(metricName);

    setPlotData(data);
    setPlotLayout(layout);
    setPlotConfig(config);
  }, [metricsData, checkResult.requirement?.value, checkResult.metric_unit, targetName, testRun, theme, metricName]);

  // Fetch data on mount and when dependencies change
  useEffect(() => {
    fetchMetricsData();
  }, [fetchMetricsData]);

  // Create chart when data changes
  useEffect(() => {
    if (metricsData && !loading) {
      createPlotlyGraph();
    }
  }, [metricsData, loading, createPlotlyGraph]);

  // Trigger Plotly resize when chart becomes visible
  useEffect(() => {
    if (isVisible && plotData.length > 0) {
      const timer = setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isVisible, plotData.length]);

  // Check if we have valid data
  const hasData = Boolean(
    metricsData &&
      (Array.isArray(metricsData)
        ? metricsData.length > 0
        : (metricsData as DSMetric).data?.length > 0)
  );

  return {
    loading,
    error,
    metricsData,
    plotData,
    plotLayout,
    plotConfig,
    metricName,
    hasData,
  };
}
