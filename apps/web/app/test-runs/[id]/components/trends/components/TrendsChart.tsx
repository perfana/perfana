'use client';

import type { Config, Data, Layout } from 'plotly.js';
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
  plotData: unknown[];
  plotLayout: unknown;
  plotConfig: unknown;
  onRemoveSeries: (seriesId: string) => void;
  onClearAllSeries: () => void;
  onUpdateSeriesUnit: (seriesId: string, newUnit: string | null) => void;
}

/** Placeholder that keeps the chart's footprint while there is nothing to draw. */
function ChartPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{
      height: 400,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      border: '1px dashed',
      borderColor: 'divider',
      borderRadius: 2,
    }}>
      {children}
    </Box>
  );
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Chart first, so adding a series shows its result without scrolling */}
      {metricsLoading ? (
        <ChartPlaceholder>
          <CircularProgress />
          <Typography variant="body2" color="text.secondary">
            Loading trends data…
          </Typography>
        </ChartPlaceholder>
      ) : metricsData.length === 0 ? (
        <ChartPlaceholder>
          <Typography variant="body2" color="text.secondary">
            No data for these series in the selected time range. Widen the range, or remove a
            series below.
          </Typography>
        </ChartPlaceholder>
      ) : (
        <Box sx={{ width: '100%' }}>
          <Plot
            data={plotData as Data[]}
            layout={plotLayout as Partial<Layout>}
            config={plotConfig as Partial<Config>}
            useResizeHandler={true}
            style={{ width: '100%', height: '400px' }}
          />
        </Box>
      )}

      {/* Legend / series controls stay reachable even when the chart has nothing to draw,
          so a series that returns no data can still be removed. */}
      <TrendsAddedSeriesList
        addedSeries={addedSeries}
        onRemoveSeries={onRemoveSeries}
        onClearAllSeries={onClearAllSeries}
        onUpdateSeriesUnit={onUpdateSeriesUnit}
      />
    </Box>
  );
}
