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
  METRIC_COLOR_PALETTE,
  groupDataByMetricName,
  findGlobalDataRange,
  calculateUnitConversion,
  getChartThemeColors,
  calculateTimeRange,
  buildBarTrace,
  buildLineTrace,
  buildRequirementTrace,
  buildTrendLineTrace,
  analysisWindowBounds,
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
  const [plotData, setPlotData] = useState<unknown[]>([]);
  const [plotLayout, setPlotLayout] = useState<unknown>({});
  const [plotConfig, setPlotConfig] = useState<unknown>({});

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

    const isTrend = checkResult.evaluate_type === 'trend';
    const requirementValue = checkResult.requirement?.value || 0;
    const panelYAxesFormat = checkResult.metric_unit || '';

    // Group data by metric name. A selected target that matches no charted
    // series -- an artificial validate_with_default_if_no_data row, which no
    // dashboard produced, or a name that drifted from ds_metrics -- would leave
    // this empty and render a titled but blank chart, because hasData below is
    // computed from the raw fetch and would still be true. Fall back to every
    // series rather than show nothing.
    const selectedGroups = groupDataByMetricName(dataPoints, targetName);
    const metricGroups = selectedGroups.size > 0
      ? selectedGroups
      : groupDataByMetricName(dataPoints);

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

    // Collect every series before building a trace. A single-point series drawn
    // as a bar puts Plotly's x-axis into CATEGORY mode, which turns each
    // timestamp of every other series into its own tick label -- the wall of
    // full dates that made this chart unreadable. Bars only when nothing on the
    // chart is a time series.
    const series: { name: string; x: Date[]; y: number[] }[] = [];
    metricGroups.forEach((metricData, groupMetricName) => {
      const x: Date[] = [];
      const y: number[] = [];

      metricData.forEach(dataPoint => {
        if (dataPoint.value !== undefined && dataPoint.value !== null) {
          x.push(new Date(dataPoint.time));
          y.push(dataPoint.value * factor);
        }
      });

      if (x.length > 0) series.push({ name: groupMetricName, x, y });
    });

    const hasTimeSeriesData = series.some(s => s.x.length > 1);

    // The analysis window the worker fitted the trend over -- the same bounds
    // buildChartLayout shades to, read from one place so they cannot drift.
    const { start: windowStart, end: windowEnd } = analysisWindowBounds(
      testRunStart,
      testRunEnd,
      testRun?.analysis_start_offset,
      testRun?.analysis_end_offset
    );

    const metricTraces: unknown[] = [];
    series.forEach(({ name, x, y }, colorIndex) => {
      const metricColor = METRIC_COLOR_PALETTE[colorIndex % METRIC_COLOR_PALETTE.length];

      // A trend SLO judges the slope, not the level, so the "every value under
      // the requirement" test below is meaningless for it -- and its
      // requirement is in %/h, a different unit from this axis. Colour from the
      // verdict the worker already reached instead.
      const trendTarget = isTrend
        ? checkResult.targets?.find(t => t.target === name)
        : undefined;
      const finalColor = isTrend
        ? (trendTarget?.meets_requirement === false ? theme.palette.error.main : metricColor)
        : targetName && !y.every(value => value <= adjustedRequirement)
          ? theme.palette.error.main
          : metricColor;

      if (x.length === 1 && !hasTimeSeriesData) {
        metricTraces.push(
          buildBarTrace(name, y[0], finalColor, adjustedFormat, colors.textColor)
        );
        return;
      }

      metricTraces.push(
        buildLineTrace(name, x, y, finalColor, colors.bgColor, adjustedFormat)
      );

      const pctPerHour = Number(trendTarget?.value);
      if (isTrend && Number.isFinite(pctPerHour)) {
        const fit = buildTrendLineTrace(
          name, x, y, pctPerHour, windowStart, windowEnd, finalColor
        );
        if (fit) metricTraces.push(fit);
      }
    });

    // Add requirement line if we have a requirement value. Never for a trend:
    // its requirement is %/h and this axis is the panel's own unit.
    const data: unknown[] = adjustedRequirement && !isTrend
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
      testRun?.analysis_start_offset,
      testRun?.analysis_end_offset,
      yAxisLabel,
      colors,
      theme.typography.fontFamily as string
    );
    // The fitted line needs a legend entry to say what it is.
    if (isTrend) layout.showlegend = true;

    // Build config
    const config = buildChartConfig(metricName);

    setPlotData(data);
    setPlotLayout(layout);
    setPlotConfig(config);
  }, [metricsData, checkResult.requirement?.value, checkResult.metric_unit, checkResult.evaluate_type, checkResult.targets, targetName, testRun, theme, metricName]);

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
