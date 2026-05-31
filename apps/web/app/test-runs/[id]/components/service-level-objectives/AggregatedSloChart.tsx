'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import dynamic from 'next/dynamic';
import { authenticatedFetch } from '@/lib/api';
import { ChartLoadingState, ChartErrorState, ChartEmptyState } from './components';
import {
  DEFAULT_CHART_HEIGHT,
  getChartThemeColors,
  calculateTimeRange,
  buildLineTrace,
  buildRequirementTrace,
  buildChartLayout,
  buildChartConfig,
  calculateUnitConversion,
} from './utils/slo-chart-utils';
import type { CheckResult, TestRunInfo } from './types';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface AggregatedSloChartProps {
  testRunId: string;
  checkResult: CheckResult;
  testRun?: TestRunInfo;
  isVisible?: boolean;
}

interface TimeseriesBucket {
  time: string;
  value: number;
}

interface TimeseriesResponse {
  bucketSizeSeconds: number;
  buckets: TimeseriesBucket[];
}

export default function AggregatedSloChart({
  testRunId,
  checkResult,
  testRun,
  isVisible = true,
}: AggregatedSloChartProps) {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawBuckets, setRawBuckets] = useState<TimeseriesBucket[]>([]);
  const [plotData, setPlotData] = useState<unknown[]>([]);
  const [plotLayout, setPlotLayout] = useState<unknown>({});
  const [plotConfig, setPlotConfig] = useState<unknown>({});
  const [hasData, setHasData] = useState(false);

  const metric = checkResult.requirement?.aggregate_metric;
  const stat = checkResult.requirement?.aggregate_stat;

  const buildChart = useCallback((buckets: TimeseriesBucket[]) => {
    const requirementValue = Number(checkResult.requirement?.value ?? 0);
    const metricUnit = checkResult.metric_unit || '';

    const { factor, adjustedRequirement, adjustedFormat, yAxisLabel } =
      calculateUnitConversion(metricUnit, requirementValue, undefined, undefined);

    const colors = getChartThemeColors(theme);

    const x = buckets.map(b => new Date(b.time));
    const y = buckets.map(b => b.value * factor);

    const { start: testRunStart, end: testRunEnd } = calculateTimeRange(
      testRun?.start_time,
      testRun?.end_time,
    );

    const label = `${stat?.toUpperCase() ?? ''} ${(metric ?? '').replace(/_/g, ' ')}`.trim();
    const traces: unknown[] = [
      buildLineTrace(label, x, y, '#f59e0b', colors.bgColor, adjustedFormat),
    ];

    if (adjustedRequirement !== null && adjustedRequirement !== undefined) {
      traces.push(
        buildRequirementTrace(testRunStart, testRunEnd, adjustedRequirement, colors.sloColor, adjustedFormat)
      );
    }

    const layout = buildChartLayout(
      x.length > 0,
      testRunStart,
      testRunEnd,
      testRun?.analysis_start_offset,
      testRun?.analysis_end_offset,
      yAxisLabel,
      colors,
      theme.typography.fontFamily as string,
    );

    const config = buildChartConfig(label);

    setPlotData(traces);
    setPlotLayout(layout);
    setPlotConfig(config);
    setHasData(x.length > 0);
  }, [checkResult, testRun, theme, metric, stat]);

  const fetchData = useCallback(async () => {
    if (!metric) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({ metric, applyAnalysisWindow: 'false' });
      if (stat) params.set('stat', stat);

      const response = await authenticatedFetch(
        `/test-runs/${testRunId}/aggregated-metric-timeseries?${params.toString()}`,
        { method: 'GET' },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch timeseries: ${response.status} ${response.statusText}`);
      }

      const data: TimeseriesResponse = await response.json();
      setRawBuckets(data.buckets ?? []);
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to fetch chart data'
      );
    } finally {
      setLoading(false);
    }
  }, [testRunId, metric, stat]);

  useEffect(() => {
    if (isVisible) {
      fetchData();
    }
  }, [isVisible, fetchData]);

  useEffect(() => {
    if (!loading && rawBuckets.length >= 0) {
      buildChart(rawBuckets);
    }
  }, [rawBuckets, loading, buildChart]);

  useEffect(() => {
    if (isVisible && hasData) {
      window.dispatchEvent(new Event('resize'));
    }
  }, [isVisible, hasData]);

  const chartTitle = `${stat?.toUpperCase() ?? ''} ${(metric ?? '').replace(/_/g, ' ')}`.trim();

  if (loading) return <ChartLoadingState />;
  if (error) return <ChartErrorState error={error} />;
  if (!hasData) return <ChartEmptyState />;

  return (
    <Box
      sx={{
        width: '100%',
        mt: 2,
        backgroundColor: theme.palette.background.paper,
        borderRadius: 1,
        border: `1px solid ${theme.palette.divider}`,
        boxShadow: theme.shadows[1],
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{
          p: 2,
          pb: 0,
          mb: 2,
          fontWeight: 600,
          color: theme.palette.text.primary,
        }}
      >
        {chartTitle}
      </Typography>

      <Box sx={{ width: '100%', height: DEFAULT_CHART_HEIGHT }}>
        {plotData.length > 0 && (
          <Plot
            data={plotData}
            layout={plotLayout}
            config={plotConfig}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler={true}
            className="plotly-chart"
          />
        )}
      </Box>
    </Box>
  );
}
