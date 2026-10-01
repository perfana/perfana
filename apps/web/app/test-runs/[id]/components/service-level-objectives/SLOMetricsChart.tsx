'use client';

import type { Config, Data, Layout } from 'plotly.js';
import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import dynamic from 'next/dynamic';
import { useSLOMetricsChart } from './hooks';
import { ChartLoadingState, ChartErrorState, ChartEmptyState } from './components';
import { DEFAULT_CHART_HEIGHT } from './utils/slo-chart-utils';
import type { SLOMetricsChartProps } from './types';

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('@/components/plotly-cartesian'), { ssr: false });

export default function SLOMetricsChart({
  testRunId,
  checkResult,
  testRun,
  targetName,
  isVisible = true,
}: SLOMetricsChartProps) {
  const theme = useTheme();

  const {
    loading,
    error,
    hasData,
    plotData,
    plotLayout,
    plotConfig,
    metricName,
  } = useSLOMetricsChart({
    testRunId,
    checkResult,
    testRun,
    targetName,
    isVisible,
  });

  // An SLO with no targets has nothing to chart. Without this the hook falls back to
  // "every series on the panel" (a deliberate fallback for a target that matches no
  // charted series) and draws a bar per transaction — numbers that are not this SLO's,
  // beside a series table that correctly reads "No values available for this SLO". The
  // case in the wild: a trend SLO on a panel whose series hold one point each, so the
  // worker finds no slope to judge and records ERROR / "No targets found for
  // processing", and the chart answered with fifteen unrelated bars.
  if (!checkResult.targets || checkResult.targets.length === 0) {
    return (
      <ChartEmptyState
        message="This SLO produced no values to chart"
        detail={checkResult.message}
      />
    );
  }

  if (loading) {
    return <ChartLoadingState />;
  }

  if (error) {
    return <ChartErrorState error={error} />;
  }

  if (!hasData) {
    return <ChartEmptyState />;
  }

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
      {/* Chart Title */}
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
        {metricName}
      </Typography>

      {/* Chart Container */}
      <Box sx={{ width: '100%', height: DEFAULT_CHART_HEIGHT }}>
        {plotData.length > 0 && (
          <Plot
            data={plotData as Data[]}
            layout={plotLayout as Partial<Layout>}
            config={plotConfig as Partial<Config>}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler={true}
            className="plotly-chart"
          />
        )}
      </Box>
    </Box>
  );
}
