'use client';

import type { Config, Data, Layout } from 'plotly.js';
import { useMemo } from 'react';
import { Box, useTheme } from '@mui/material';
// Observes its own container: this chart lives in a dialog that resizes without the
// window, which left the hover label measured against the old box.
import Plot from '@/components/ResponsivePlot';
import type { TimeSeriesResponse, MetricType } from '../types';
import type { PerfanaEvent } from '@/lib/events';
import { generatePlotlyData, getMetricLabel, buildPlotLayout, buildPlotConfig } from '../utils';
import { mergeEventShapesIntoLayout } from '../../../shared/event-lines';


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
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light';
  const metricLabel = getMetricLabel(selectedMetric);

  const plotData = useMemo(
    () => generatePlotlyData(data, transactionName, selectedMetric, aggregationSeconds, mode),
    [data, transactionName, selectedMetric, aggregationSeconds, mode]
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
        data={plotData as Data[]}
        layout={plotLayout as Partial<Layout>}
        config={plotConfig as Partial<Config>}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
      />
    </Box>
  );
}
