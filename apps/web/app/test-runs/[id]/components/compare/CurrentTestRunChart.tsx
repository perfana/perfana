'use client';

import React from 'react';
import { Box, useTheme } from '@mui/material';
import dynamic from 'next/dynamic';
import { useCurrentTestRunChart } from './current-test-run-chart/hooks';
import { ChartLoadingState, ChartErrorState, ChartEmptyState } from './current-test-run-chart/components';
import type { CurrentTestRunChartProps } from './current-test-run-chart/types';

// Dynamically import react-plotly.js to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

export default function CurrentTestRunChart({
  testRunId,
  applicationDashboardId,
  panelId,
  metricName,
  testRun,
  thresholds,
  unit,
  isDrawerOpen = false,
  showToast,
}: CurrentTestRunChartProps) {
  const theme = useTheme();

  const {
    loading,
    error,
    hasData,
    plotData,
    plotLayout,
    plotConfig,
    chartHeight,
  } = useCurrentTestRunChart({
    testRunId,
    applicationDashboardId,
    panelId,
    metricName,
    testRun,
    thresholds,
    unit,
    isDrawerOpen,
    showToast,
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
        overflow: 'hidden',
      }}
    >
      {/* Chart Container - Full width without padding */}
      <Box sx={{ width: '100%', height: chartHeight }}>
        {plotData.length > 0 && (
          <Plot
            key={`${testRunId}-${panelId}-${metricName}-${isDrawerOpen ? 'open' : 'closed'}`}
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
