'use client';

import { useEffect } from 'react';
import { Box, Paper, Typography, useTheme } from '@mui/material';
import dynamic from 'next/dynamic';
import type { Config } from 'plotly.js';
import { HostMetricsResponse } from '@/lib/dynatrace';

const Plot = dynamic(() => import('@/components/plotly-cartesian'), { ssr: false });

interface HostPerformanceGraphsProps {
  metrics: HostMetricsResponse;
  startTime: string;
  endTime: string;
  hostDisplayName?: string;
}

type MetricKey = keyof HostMetricsResponse['metrics'];

/**
 * One chart per row of this list. A chart can draw several of the response's
 * series — disk read and write belong on the same axis, and separating them
 * would cost two charts to say one thing.
 *
 * The series are the same ones `HOST_METRICS` in the API collects, folded across
 * every disk on the host. Before v0.2.96.22 this drew a single "Disk Utilization"
 * chart from `metrics.disk[0]` — the FIRST of several per-disk series, labelled as
 * if it were the host's. Keep reading `[0]` here only because each key now holds
 * exactly one folded series by construction.
 */
const CHARTS: {
  id: string;
  title: string;
  yAxisTitle: string;
  ticksuffix: string;
  series: { key: MetricKey; name: string; color: string }[];
}[] = [
  {
    id: 'cpu_usage',
    title: 'CPU Usage',
    yAxisTitle: 'Usage (%)',
    ticksuffix: '%',
    series: [{ key: 'cpu', name: 'CPU Usage', color: '#1976d2' }],
  },
  {
    id: 'memory_usage',
    title: 'Memory Usage',
    yAxisTitle: 'Usage (%)',
    ticksuffix: '%',
    series: [{ key: 'memory', name: 'Memory Usage', color: '#9c27b0' }],
  },
  {
    id: 'disk_latency',
    title: 'Disk Latency',
    yAxisTitle: 'Latency (ms)',
    ticksuffix: ' ms',
    series: [
      { key: 'diskReadTime', name: 'Read', color: '#ff9800' },
      { key: 'diskWriteTime', name: 'Write', color: '#e91e63' },
    ],
  },
  {
    id: 'disk_iops',
    title: 'Disk IOPS',
    yAxisTitle: 'Operations (io/s)',
    ticksuffix: ' io/s',
    series: [
      { key: 'diskReadOps', name: 'Read', color: '#ff9800' },
      { key: 'diskWriteOps', name: 'Write', color: '#e91e63' },
    ],
  },
  {
    id: 'disk_queue_length',
    title: 'Disk Queue Length',
    yAxisTitle: 'Queued requests',
    ticksuffix: '',
    series: [{ key: 'diskQueueLength', name: 'Queue Length', color: '#795548' }],
  },
  {
    id: 'network_traffic',
    title: 'Network Traffic',
    yAxisTitle: 'Traffic (Bytes/s)',
    ticksuffix: ' B/s',
    series: [{ key: 'network', name: 'Network Traffic', color: '#4caf50' }],
  },
];

export default function HostPerformanceGraphs({
  metrics,
  startTime,
  endTime,
  hostDisplayName
}: HostPerformanceGraphsProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const textColor = theme.palette.text.primary;
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

  // On the very first render these plots mount after the async metrics fetch and
  // after the lazy react-plotly chunk loads, so Plotly's first draw can measure
  // the grid before it has its final width — leaving the plots overlapping until
  // an unrelated resize (e.g. switching host tabs) fixes them. autosize +
  // useResizeHandler only relayout on a window resize, so dispatch one on mount.
  useEffect(() => {
    const nudge = () => window.dispatchEvent(new Event('resize'));
    const raf = requestAnimationFrame(nudge);
    const timer = setTimeout(nudge, 200); // covers the lazy Plot chunk arriving late
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, []);

  const createPlotData = (
    timeSeries: { timestamp: string; value: number }[],
    name: string,
    color: string,
    unit: string
  ) => {
    return {
      x: timeSeries.map(d => new Date(d.timestamp)),
      y: timeSeries.map(d => d.value),
      type: 'scatter' as const,
      mode: 'lines' as const,
      name,
      line: { color, width: 2 },
      hovertemplate: `%{y:.2f}${unit}<extra>${name}</extra>`,
    };
  };

  const createLayout = (
    title: string,
    yAxisTitle: string,
    ticksuffix: string,
    showlegend: boolean,
  ) => {
    return {
      title: {
        text: title,
        font: { size: 14, weight: 600, color: textColor },
      },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      xaxis: {
        title: { text: 'Time', font: { color: textColor } },
        showgrid: true,
        gridcolor: gridColor,
        range: [new Date(startTime), new Date(endTime)],
        tickfont: { color: textColor },
      },
      yaxis: {
        title: { text: yAxisTitle, font: { color: textColor } },
        showgrid: true,
        gridcolor: gridColor,
        ticksuffix: ticksuffix,
        rangemode: 'tozero' as const,
        tickfont: { color: textColor },
      },
      margin: { l: 70, r: 40, t: 40, b: 60 },
      // autosize is required for useResizeHandler to have any effect: react-plotly's
      // resize handler calls Plotly.Plots.resize, which is a no-op on fixed-size
      // layouts — without it the width measured at first draw (possibly mid-Collapse
      // animation) is frozen forever.
      autosize: true,
      height: 300,
      hovermode: 'x unified' as const,
      showlegend,
      legend: { orientation: 'h' as const, y: -0.3, font: { color: textColor } },
    };
  };

  const createPlotConfig = (metricName: string): Partial<Config> => ({
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d', 'autoScale2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d'],
    toImageButtonOptions: {
      format: 'png' as const,
      filename: `${hostDisplayName || 'host'}_${metricName}`,
      height: 300,
      width: 1200,
      scale: 2
    },
  });

  return (
    <Paper
      elevation={1}
      sx={{
        p: 4,
        borderRadius: 3,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
          Performance Metrics
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Time-series performance data during test execution
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
          gap: 3,
        }}
      >
        {CHARTS.map((chart) => {
          const traces = chart.series
            .map((s) => ({ ...s, points: metrics.metrics[s.key]?.[0]?.dataPoints ?? [] }))
            .filter((s) => s.points.length > 0)
            .map((s) => createPlotData(s.points, s.name, s.color, chart.ticksuffix));

          return (
            <Box key={chart.id}>
              {traces.length > 0 ? (
                <Plot
                  data={traces}
                  layout={createLayout(
                    chart.title,
                    chart.yAxisTitle,
                    chart.ticksuffix,
                    chart.series.length > 1,
                  )}
                  config={createPlotConfig(chart.id)}
                  style={{ width: '100%' }}
                  useResizeHandler={true}
                />
              ) : (
                <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                  No {chart.title.toLowerCase()} data available
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}
