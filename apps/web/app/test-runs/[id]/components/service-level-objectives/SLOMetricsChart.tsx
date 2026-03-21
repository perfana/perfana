'use client';

import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import dynamic from 'next/dynamic';
import { useSLOMetricsChart } from './hooks';
import { ChartLoadingState, ChartErrorState, ChartEmptyState } from './components';
import { DEFAULT_CHART_HEIGHT } from './utils/slo-chart-utils';
import type { SLOMetricsChartProps } from './types';

// Dynamically import react-plotly.js to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

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
