'use client';

import { Box, Paper, Typography } from '@mui/material';
import dynamic from 'next/dynamic';
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
        font: { size: 14, weight: 600 },
      },
      xaxis: {
        title: 'Time',
        showgrid: true,
        gridcolor: 'rgba(128,128,128,0.2)',
        range: [new Date(startTime), new Date(endTime)],
      },
      yaxis: {
        title: yAxisTitle,
        showgrid: true,
        gridcolor: 'rgba(128,128,128,0.2)',
        ticksuffix: ticksuffix,
        rangemode: 'tozero' as const,
      },
      margin: { l: 70, r: 40, t: 40, b: 60 },
      height: 300,
      hovermode: 'x unified' as const,
      showlegend: false,
    };
  };

  const createPlotConfig = (metricName: string) => ({
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d', 'autoScale2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d'] as any,
    toImageButtonOptions: {
      format: 'png' as const,
      filename: `${hostDisplayName || 'host'}_${metricName.toLowerCase().replace(/\s+/g, '_')}`,
      height: 300,
      width: null as any,
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
