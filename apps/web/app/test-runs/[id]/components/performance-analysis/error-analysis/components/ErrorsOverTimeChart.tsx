'use client';

import { useMemo } from 'react';
import type { Config, Layout } from 'plotly.js';
import { Box, Typography, Paper, Grid, Divider, useTheme } from '@mui/material';
import { Error as ErrorIcon } from '@mui/icons-material';
// Observes its own container, so the hover label stays aligned when this chart's
// grid column resizes without the window doing anything.
import Plot from '@/components/ResponsivePlot';
import { buildChartConfig } from '../../../graphs/utils/chart-utils';
import { MONO, SIZE, catColor, chartTheme } from '@/lib/charts';
import { ErrorOverTime, ErrorOverTimeByCode } from '../types';
import ErrorsByCodeTable from './ErrorsByCodeTable';
import { ErrorByCode } from '../types';

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
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode === 'dark' ? 'dark' : 'light';
  const theme = chartTheme(mode);

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
        .map((code, i) => {
          // By SLOT off the sorted code list, from the one categorical palette — it used
          // to hash the code into a private `CHART_COLORS` array, which gave two codes the
          // same colour on a collision and ignored the theme.
          const color = catColor(i, mode);
          return {
            x,
            y: errorsOverTimeByCode.map((d) => (d[code] as number) ?? 0),
            name: `Error ${code}`,
            type: 'scatter' as const,
            // Markers, against the standard's "no markers on a time series": an error code
            // can occur in ONE bucket of a run, and Plotly draws a one-point line as
            // nothing at all.
            mode: 'lines+markers' as const,
            line: { width: SIZE.line, color },
            marker: { size: 3, color },
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
        // The total is the one series that IS a verdict, so it keeps the verdict colour.
        line: { width: SIZE.line, color: theme.error },
        marker: { size: 3, color: theme.error },
        hovertemplate: '<b>Total</b><br>%{y} errors/min<extra></extra>',
      },
    ];
  }, [errorsOverTime, errorsOverTimeByCode, theme.error, mode]);

  const layout = {
    xaxis: {
      type: 'date' as const,
      // No vertical gridlines: they fight the crosshair, which is the line that means
      // something. Same reading as `lib/charts/layout.ts`.
      showgrid: false,
      showline: false,
      zeroline: false,
      color: theme.muted,
      tickfont: { family: MONO, size: SIZE.tickFont, color: theme.faint },
      ticks: '',
      automargin: true,
      showspikes: true,
      spikemode: 'across' as const,
      spikesnap: 'cursor' as const,
      spikecolor: theme.faint,
      spikethickness: 1,
      spikedash: 'dot' as const,
    },
    yaxis: {
      title: { text: 'Errors', font: { family: MONO, size: SIZE.axisLabelFont, color: theme.faint } },
      rangemode: 'tozero' as const,
      gridcolor: theme.grid,
      showline: false,
      zeroline: false,
      color: theme.muted,
      tickfont: { family: MONO, size: SIZE.tickFont, color: theme.faint },
      automargin: true,
    },
    hovermode: 'x' as const,
    hoverlabel: {
      bgcolor: theme.paper,
      bordercolor: theme.divider,
      font: { family: MONO, size: SIZE.valueFont, color: theme.text },
      align: 'left' as const,
    },
    // Kept, unlike the Analyst cards: there is no series table beside this chart, so the
    // legend is the only thing naming a response code.
    showlegend: true,
    legend: {
      orientation: 'h' as const,
      yanchor: 'top' as const,
      y: -0.2,
      xanchor: 'center' as const,
      x: 0.5,
      font: { family: MONO, size: SIZE.tableFont, color: theme.faint },
      bgcolor: 'rgba(0,0,0,0)',
      borderwidth: 0,
    },
    height: 400,
    margin: { l: 60, r: 30, t: 20, b: 90 },
    autosize: true,
    plot_bgcolor: theme.plotBg,
    paper_bgcolor: 'transparent',
    font: { family: MONO, size: SIZE.tickFont, color: theme.muted },
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
