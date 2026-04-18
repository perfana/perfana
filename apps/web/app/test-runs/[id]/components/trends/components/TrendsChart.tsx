'use client';

import React from 'react';
import {
  Box,
  Typography,
  CircularProgress,
} from '@mui/material';
import dynamic from 'next/dynamic';
import { TrendsSeries, MetricStatistic} from '../types';
import { TrendsAddedSeriesList } from './TrendsAddedSeriesList';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface TrendsChartProps {
  addedSeries: TrendsSeries[];
  metricsData: MetricStatistic[];
  metricsLoading: boolean;
  plotData: any[];
  plotLayout: any;
  plotConfig: any;
  onRemoveSeries: (seriesId: string) => void;
  onClearAllSeries: () => void;
  onUpdateSeriesUnit: (seriesId: string, newUnit: string | null) => void;
}

export function TrendsChart({
  addedSeries,
  metricsData,
  metricsLoading,
  plotData,
  plotLayout,
  plotConfig,
  onRemoveSeries,
  onClearAllSeries,
  onUpdateSeriesUnit,
}: TrendsChartProps) {
  if (addedSeries.length === 0) {
    return null;
  }

  if (metricsLoading) {
    return (
      <Box textAlign="center" py={4}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Loading trends data...
        </Typography>
      </Box>
    );
  }

  if (metricsData.length === 0) {
    return (
      <Box textAlign="center" py={4}>
        <Typography variant="body2" color="text.secondary">
          No trends data available for the added series and time range
        </Typography>
      </Box>
    );
  }

  return (
    <>
      {/* Added Series List */}
      <TrendsAddedSeriesList
        addedSeries={addedSeries}
        onRemoveSeries={onRemoveSeries}
        onClearAllSeries={onClearAllSeries}
        onUpdateSeriesUnit={onUpdateSeriesUnit}
      />

      {/* Plotly Chart */}
      <Box sx={{ width: '100%', mb: 3 }}>
        <Plot
          data={plotData}
          layout={plotLayout}
          config={plotConfig}
          style={{ width: '100%', height: '400px' }}
        />
      </Box>
    </>
  );
}
