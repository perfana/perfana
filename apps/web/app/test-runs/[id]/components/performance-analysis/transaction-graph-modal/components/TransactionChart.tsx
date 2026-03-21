'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Box, useTheme } from '@mui/material';
import type { TimeSeriesResponse, MetricType } from '../types';
import type { PerfanaEvent } from '@/lib/events';
import { generatePlotlyData, getMetricLabel, buildPlotLayout, buildPlotConfig } from '../utils';
import { mergeEventShapesIntoLayout } from '../../../shared/event-lines';

// Dynamically import Plot to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface TransactionChartProps {
  data: TimeSeriesResponse;
  transactionName: string;
  selectedMetric: MetricType;
  aggregationSeconds: number;
  showToast: (message: string) => void;
  events?: PerfanaEvent[];
}

export function TransactionChart({
  data,
  transactionName,
  selectedMetric,
  aggregationSeconds,
  showToast,
  events,
}: TransactionChartProps) {
  const theme = useTheme();
  const metricLabel = getMetricLabel(selectedMetric);

  const plotData = useMemo(
    () => generatePlotlyData(data, transactionName, selectedMetric, aggregationSeconds),
    [data, transactionName, selectedMetric, aggregationSeconds]
  );

  const plotLayout = useMemo(
    () => {
      const base = buildPlotLayout(metricLabel, theme);
      return events ? mergeEventShapesIntoLayout(base, events) : base;
    },
    [metricLabel, events, theme]
  );

  const plotConfig = useMemo(
    () => buildPlotConfig(transactionName, metricLabel, showToast),
    [transactionName, metricLabel, showToast]
  );

  return (
    <Box sx={{ width: '100%', height: '550px' }}>
      <Plot
        data={plotData}
        layout={plotLayout}
        config={plotConfig}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
      />
    </Box>
  );
}
