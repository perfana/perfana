'use client';

import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import dynamic from 'next/dynamic';
import { Layout, Config } from 'plotly.js';
import { PlotData } from '../types';
import { createChartLayout, createChartConfig } from '../utils';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface RegressionChartProps {
  chartData: PlotData[];
  selectedMetric: string;
  unit: string;
}

export const RegressionChart: React.FC<RegressionChartProps> = ({
  chartData,
  selectedMetric,
  unit,
}) => {
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const layout = createChartLayout(selectedMetric, unit, isDarkMode);
  const config = createChartConfig();

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
        Regression Timeline: {selectedMetric}
      </Typography>

      <Box sx={{
        backgroundColor: 'background.paper',
        borderRadius: 1,
        p: 2,
        border: '1px solid',
        borderColor: 'divider'
      }}>
        <Plot
          data={chartData as any}
          layout={layout as Partial<Layout>}
          config={config as unknown as Partial<Config>}
          style={{ width: '100%' }}
        />
      </Box>
    </Box>
  );
};
