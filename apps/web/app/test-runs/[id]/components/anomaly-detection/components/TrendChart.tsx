import type { Config, Data, Layout } from 'plotly.js';
import React, { useEffect, useState } from 'react';
import { Box, CircularProgress, Alert, useTheme } from '@mui/material';
import dynamic from 'next/dynamic';
import { MetricTrendData } from '../types';
import { createTrendsPlot } from '../utils';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface TrendChartProps {
  data: MetricTrendData[];
  rowKey: string;
  metricName: string;
  unit?: string;
  loading?: boolean;
  error?: string;
  height?: number;
  chartKey?: number;
  regressionDetectionTestRunId?: string;
}

export default function TrendChart({
  data,
  rowKey,
  metricName,
  unit,
  loading = false,
  error,
  height = 400,
  chartKey = 0,
  regressionDetectionTestRunId
}: TrendChartProps) {
  const theme = useTheme();
  const [plotData, setPlotData] = useState<unknown[]>([]);
  const [plotLayout, setPlotLayout] = useState<unknown>({});
  const [plotConfig, setPlotConfig] = useState<unknown>({});

  useEffect(() => {
    if (data && data.length > 0) {
      const { plotData: newPlotData, plotLayout: newPlotLayout, plotConfig: newPlotConfig } =
        createTrendsPlot(data, rowKey, metricName, unit, theme, regressionDetectionTestRunId);

      setPlotData(newPlotData);
      setPlotLayout({ ...newPlotLayout, height });
      setPlotConfig(newPlotConfig);
    } else {
      setPlotData([]);
      setPlotLayout({});
      setPlotConfig({});
    }
  }, [data, rowKey, metricName, unit, theme, height, chartKey, regressionDetectionTestRunId]);

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: height || 400,
          backgroundColor: 'background.paper'
        }}
      >
        <CircularProgress size={40} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">
          Failed to load trend data: {error}
        </Alert>
      </Box>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: height || 400,
          backgroundColor: 'background.paper',
          color: 'text.secondary'
        }}
      >
        No trend data available
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', height: height || 400 }}>
      <Plot
        key={chartKey}
        data={plotData as Data[]}
        layout={plotLayout as Partial<Layout>}
        config={plotConfig as Partial<Config>}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler={true}
      />
    </Box>
  );
}