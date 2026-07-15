'use client';

import { useEffect } from 'react';
import { Box, Paper, Typography, useTheme } from '@mui/material';
import dynamic from 'next/dynamic';
import { Config } from 'plotly.js';
import { HostMetricsResponse } from '@/lib/dynatrace';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface HostPerformanceGraphsProps {
  metrics: HostMetricsResponse;
  startTime: string;
  endTime: string;
  hostDisplayName?: string;
}

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
  // the grid before it has its final width — leaving the 2x2 plots overlapping
  // until an unrelated resize (e.g. switching host tabs) fixes them. autosize +
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
      hovertemplate: `%{y:.2f}${unit}<extra></extra>`,
    };
  };

  const createLayout = (title: string, yAxisTitle: string, ticksuffix: string) => {
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
      showlegend: false,
    };
  };

  const createPlotConfig = (metricName: string): Partial<Config> => ({
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d', 'autoScale2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d'],
    toImageButtonOptions: {
      format: 'png' as const,
      filename: `${hostDisplayName || 'host'}_${metricName.toLowerCase().replace(/\s+/g, '_')}`,
      height: 300,
      width: 1200,
      scale: 2
    },
  });

  // Extract first data series from each metric category
  const cpuData = metrics.metrics.cpu[0]?.dataPoints || [];
  const memoryData = metrics.metrics.memory[0]?.dataPoints || [];
  const diskData = metrics.metrics.disk[0]?.dataPoints || [];
  const networkData = metrics.metrics.network[0]?.dataPoints || [];

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

      {/* 2x2 Grid of Graphs */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
          gap: 3,
        }}
      >
        {/* CPU Usage */}
        <Box>
          {cpuData.length > 0 ? (
            <Plot
              data={[createPlotData(cpuData, 'CPU Usage', '#1976d2', '%')]}
              layout={createLayout('CPU Usage', 'Usage (%)', '%')}
              config={createPlotConfig('cpu_usage')}
              style={{ width: '100%' }}
              useResizeHandler={true}
            />
          ) : (
            <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
              No CPU data available
            </Box>
          )}
        </Box>

        {/* Memory Usage */}
        <Box>
          {memoryData.length > 0 ? (
            <Plot
              data={[createPlotData(memoryData, 'Memory Usage', '#9c27b0', '%')]}
              layout={createLayout('Memory Usage', 'Usage (%)', '%')}
              config={createPlotConfig('memory_usage')}
              style={{ width: '100%' }}
              useResizeHandler={true}
            />
          ) : (
            <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
              No memory data available
            </Box>
          )}
        </Box>

        {/* Disk Utilization */}
        <Box>
          {diskData.length > 0 ? (
            <Plot
              data={[createPlotData(diskData, 'Disk Utilization', '#ff9800', '%')]}
              layout={createLayout('Disk Utilization', 'Utilization (%)', '%')}
              config={createPlotConfig('disk_utilization')}
              style={{ width: '100%' }}
              useResizeHandler={true}
            />
          ) : (
            <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
              No disk data available
            </Box>
          )}
        </Box>

        {/* Network Traffic */}
        <Box>
          {networkData.length > 0 ? (
            <Plot
              data={[createPlotData(networkData, 'Network Traffic', '#4caf50', ' B/s')]}
              layout={createLayout('Network Traffic', 'Traffic (Bytes/s)', ' B/s')}
              config={createPlotConfig('network_traffic')}
              style={{ width: '100%' }}
              useResizeHandler={true}
            />
          ) : (
            <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
              No network data available
            </Box>
          )}
        </Box>
      </Box>
    </Paper>
  );
}
