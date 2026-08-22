'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { Config, Layout } from 'plotly.js';
import { Box, Typography, Paper, Grid, Divider, useTheme } from '@mui/material';
import { Error as ErrorIcon } from '@mui/icons-material';
import { PLOTLY_HOVER_FONT_FAMILY } from '@/lib/plotly-fonts';
import { buildChartConfig } from '../../../graphs/utils/chart-utils';
import { ErrorOverTime, ErrorOverTimeByCode } from '../types';
import { getColorForErrorCode } from '../utils/error-formatters';
import ErrorsByCodeTable from './ErrorsByCodeTable';
import { ErrorByCode } from '../types';

// Dynamically import Plot to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface ErrorsOverTimeChartProps {
  errorsOverTime: ErrorOverTime[];
  errorsOverTimeByCode: ErrorOverTimeByCode[];
  errorsByCode: ErrorByCode[];
}

export function ErrorsOverTimeChart({
  errorsOverTime,
  errorsOverTimeByCode,
  errorsByCode,
}: ErrorsOverTimeChartProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const traces = useMemo(() => {
    if (errorsOverTimeByCode.length > 0) {
      const codes = new Set<string>();
      errorsOverTimeByCode.forEach((point) => {
        Object.keys(point).forEach((key) => {
          if (key !== 'timeBucket') codes.add(key);
        });
      });
      const x = errorsOverTimeByCode.map((d) => new Date(d.timeBucket as string));
      return Array.from(codes)
        .sort()
        .map((code) => {
          const color = getColorForErrorCode(code);
          return {
            x,
            y: errorsOverTimeByCode.map((d) => (d[code] as number) ?? 0),
            name: `Error ${code}`,
            type: 'scatter' as const,
            mode: 'lines+markers' as const,
            line: { width: 2, color },
            marker: { size: 4, color },
            hovertemplate: `<b>Error ${code}</b><br>%{y} errors<extra></extra>`,
          };
        });
    }

    return [
      {
        x: errorsOverTime.map((d) => new Date(d.timeBucket)),
        y: errorsOverTime.map((d) => d.errorsPerMinute),
        name: 'Total errors per minute',
        type: 'scatter' as const,
        mode: 'lines+markers' as const,
        line: { width: 2, color: theme.palette.error.main },
        marker: { size: 4, color: theme.palette.error.main },
        hovertemplate: '<b>Total</b><br>%{y} errors/min<extra></extra>',
      },
    ];
  }, [errorsOverTime, errorsOverTimeByCode, theme.palette.error.main]);

  const textColor = theme.palette.text.primary;
  const textSecondary = theme.palette.text.secondary;
  // The chart sits inside an elevated Paper, so it takes the card's surface rather
  // than the page background the other charts sit on.
  const bgColor = theme.palette.background.paper;
  const plotBgColor = isDark ? 'rgba(255, 255, 255, 0.02)' : theme.palette.grey[50];
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.12)' : '#e0e0e0';

  const layout = {
    xaxis: {
      type: 'date' as const,
      gridcolor: gridColor,
      linecolor: theme.palette.divider,
      color: textSecondary,
      tickfont: { size: 11, color: textSecondary },
      automargin: true,
    },
    yaxis: {
      title: { text: 'Errors', font: { size: 12, color: textSecondary } },
      rangemode: 'tozero' as const,
      gridcolor: gridColor,
      linecolor: theme.palette.divider,
      color: textSecondary,
      tickfont: { size: 11, color: textSecondary },
      automargin: true,
    },
    hovermode: 'x unified' as const,
    hoverlabel: {
      bgcolor: bgColor,
      bordercolor: theme.palette.divider,
      font: { color: textColor, size: 12, family: PLOTLY_HOVER_FONT_FAMILY },
      align: 'left' as const,
    },
    showlegend: true,
    legend: {
      orientation: 'h' as const,
      yanchor: 'top' as const,
      y: -0.2,
      xanchor: 'center' as const,
      x: 0.5,
      font: { size: 11, color: textSecondary },
      bgcolor: isDark ? 'rgba(30, 41, 59, 0.9)' : 'rgba(255, 255, 255, 0.8)',
      bordercolor: isDark ? 'rgba(255, 255, 255, 0.1)' : gridColor,
      borderwidth: 1,
    },
    height: 400,
    margin: { l: 60, r: 30, t: 20, b: 90 },
    autosize: true,
    plot_bgcolor: plotBgColor,
    paper_bgcolor: 'transparent',
    font: { color: textColor, family: theme.typography.fontFamily },
  };

  // Same modebar as the Graphs/Compare charts, including copy-to-clipboard.
  const config = buildChartConfig('Errors Over Time');

  return (
    <Grid container spacing={3} sx={{ mb: 3, width: '100%' }}>
      {/* Errors Over Time Chart */}
      <Grid size={{ xs: 12, md: 9 }} sx={{ minWidth: 0 }}>
        <Paper elevation={2} sx={{ p: 3, borderLeft: '4px solid #f44336', backgroundColor: 'background.paper' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Box sx={{ color: 'error.main', display: 'flex', alignItems: 'center' }}>
              <ErrorIcon />
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1rem' }}>
              Errors Over Time by Response Code
            </Typography>
          </Box>

          <Divider sx={{ mb: 2 }} />

          <Plot
            data={traces}
            layout={layout as Partial<Layout>}
            config={config as Partial<Config>}
            style={{ width: '100%', height: '400px' }}
            useResizeHandler={true}
            className="plotly-chart"
          />
        </Paper>
      </Grid>

      {/* Errors by Code */}
      <Grid size={{ xs: 12, md: 3 }} sx={{ minWidth: 0 }}>
        <ErrorsByCodeTable errorsByCode={errorsByCode} />
      </Grid>
    </Grid>
  );
}

export default ErrorsOverTimeChart;
