'use client';

import React from 'react';
import { Box, CircularProgress, Typography, useTheme } from '@mui/material';
import dynamic from 'next/dynamic';
import { GraphData, Panel, RelatedTestRun } from '../types/compare.types';
import { TestRun } from '@/types/test-runs';

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface ComparisonPlotProps {
  metricName: string;
  graphData: GraphData | undefined;
  graphLoading: boolean;
  selectedMetric: Panel | null;
  testRun: TestRun | null;
  relatedTestRuns: RelatedTestRun[];
  showToast: (message: string) => void;
}

/**
 * Generate Plotly props for comparison chart
 */
function generatePlotProps(
  metricName: string,
  data: GraphData,
  selectedMetric: Panel | null,
  testRun: TestRun | null,
  relatedTestRuns: RelatedTestRun[],
  theme: ReturnType<typeof useTheme>,
  showToast: (message: string) => void
) {
  // Find the baseline test run for timestep calculation
  const baselineTestRun = relatedTestRuns.find(tr => tr.test_run_id === data.baselineTestRunId);

  // Theme colors matching SLO styling
  const isDark = theme.palette.mode === 'dark';
  const textColor = theme.palette.text.primary;
  const textSecondary = theme.palette.text.secondary;
  const bgColor = isDark ? '#121212' : theme.palette.background.paper;
  const hoverBgColor = isDark ? '#1e293b' : theme.palette.background.paper;
  const plotBgColor = isDark ? '#1e1e1e' : theme.palette.grey[50];
  const gridColor = isDark ? 'rgba(255,255,255,0.12)' : '#e0e0e0';

  // Find global min/max for unit conversion logic (similar to SLOChart)
  let globalMaxDataPoint: number | undefined;
  let globalMinDataPoint: number | undefined;

  [...data.currentMetrics, ...data.baselineMetrics].forEach(dataPoint => {
    if (dataPoint.value !== undefined && dataPoint.value !== null) {
      if (globalMaxDataPoint === undefined || dataPoint.value > globalMaxDataPoint) {
        globalMaxDataPoint = dataPoint.value;
      }
      if (globalMinDataPoint === undefined || dataPoint.value < globalMinDataPoint) {
        globalMinDataPoint = dataPoint.value;
      }
    }
  });

  // Unit conversion logic from SLOChart
  const panelYAxesFormat = selectedMetric?.yAxesFormat;
  let adjustedYAxesFormat = panelYAxesFormat;
  let yAxisLabel = 'Value';
  let conversionFactor = 1;

  // If unit is 'percentunit' convert to percentage
  if (panelYAxesFormat === 'percentunit') {
    conversionFactor = 100;
    yAxisLabel = '%';
  }
  // If unit is 'seconds' and all data points are under 1, convert to 'ms'
  else if (panelYAxesFormat === 's' && globalMaxDataPoint && globalMaxDataPoint < 1) {
    conversionFactor = 1000;
    adjustedYAxesFormat = 'ms';
    yAxisLabel = 'ms';
  }
  // If unit is 'ms' and all data points are over 1000, convert to 'sec'
  else if (panelYAxesFormat === 'ms' && globalMinDataPoint && globalMinDataPoint > 1000) {
    conversionFactor = 1 / 1000;
    adjustedYAxesFormat = 's';
    yAxisLabel = 's';
  } else if (panelYAxesFormat) {
    yAxisLabel = panelYAxesFormat;
  }

  // Sort data by time to ensure proper line rendering
  const sortedBaselineMetrics = [...data.baselineMetrics].sort((a, b) =>
    new Date(a.time).getTime() - new Date(b.time).getTime()
  );
  const sortedCurrentMetrics = [...data.currentMetrics].sort((a, b) =>
    new Date(a.time).getTime() - new Date(b.time).getTime()
  );

  // Calculate ramp-up end index from sorted data
  let rampUpEndIndex: number | null = null;
  if (sortedCurrentMetrics.length > 0) {
    // Find the last ramp-up point's index in the sorted array
    for (let i = sortedCurrentMetrics.length - 1; i >= 0; i--) {
      if (sortedCurrentMetrics[i].ramp_up === true) {
        rampUpEndIndex = i;
        break;
      }
    }
    // Fallback: Calculate from testRun.analysis_start_offset (seconds) and bucket_size
    if (rampUpEndIndex === null && testRun?.analysis_start_offset && testRun?.start_time && sortedCurrentMetrics.length >= 2) {
      const firstTime = new Date(sortedCurrentMetrics[0].time).getTime();
      const secondTime = new Date(sortedCurrentMetrics[1].time).getTime();
      const bucketSizeMs = secondTime - firstTime;
      const bucketSizeSeconds = bucketSizeMs / 1000;

      // Calculate analysis start offset end index, constrained to actual data length
      const calculatedIndex = Math.floor(testRun.analysis_start_offset / bucketSizeSeconds);
      rampUpEndIndex = Math.min(calculatedIndex, sortedCurrentMetrics.length - 1);
    }
  }

  // Generate x-axis values - use sequential indices for consistent rendering
  const baselineX = sortedBaselineMetrics.map((_, index) => index);
  const currentX = sortedCurrentMetrics.map((_, index) => index);

  const plotData = [
    {
      x: baselineX,
      y: sortedBaselineMetrics.map(d => d.value * conversionFactor),
      type: 'scatter' as const,
      mode: (sortedBaselineMetrics.length < 50 ? 'lines+markers' : 'lines') as const,
      name: `Baseline (${data.baselineTestRunId})`,
      line: {
        color: '#FF6B35',
        width: 2.5,
        shape: 'linear' as const
      },
      marker: {
        size: 4,
        color: '#FF6B35',
        line: {
          color: hoverBgColor,
          width: 1
        }
      },
      connectgaps: true,
      hovertemplate: '<b>Baseline</b><br>' +
        'Sample: %{x}<br>' +
        'Value: %{y:.2f}<br>' +
        '<extra></extra>'
    },
    {
      x: currentX,
      y: sortedCurrentMetrics.map(d => d.value * conversionFactor),
      type: 'scatter' as const,
      mode: (sortedCurrentMetrics.length < 50 ? 'lines+markers' : 'lines') as const,
      name: `Current (${data.currentTestRunId})`,
      line: {
        color: '#2E86AB',
        width: 2.5,
        shape: 'linear' as const
      },
      marker: {
        size: 4,
        color: '#2E86AB',
        line: {
          color: hoverBgColor,
          width: 1
        }
      },
      connectgaps: true,
      hovertemplate: '<b>Current</b><br>' +
        'Sample: %{x}<br>' +
        'Value: %{y:.2f}<br>' +
        '<extra></extra>'
    }
  ];

  const layout = {
    plot_bgcolor: plotBgColor,
    paper_bgcolor: bgColor,
    font: {
      color: textColor,
      family: theme.typography.fontFamily,
    },
    showlegend: true,
    legend: {
      x: 0.5,
      y: -0.25,
      xanchor: 'center',
      yanchor: 'top',
      orientation: 'h' as const,
      bgcolor: 'rgba(0,0,0,0)',
      bordercolor: 'rgba(0,0,0,0)',
      font: {
        color: textColor,
        size: 11
      }
    },
    xaxis: {
      title: {
        text: 'Sample',
        font: {
          size: 12,
          color: textSecondary
        }
      },
      rangemode: 'tozero' as const,
      showgrid: true,
      showline: true,
      gridcolor: gridColor,
      linecolor: theme.palette.divider,
      color: textSecondary,
      tickfont: {
        size: 11,
        color: textSecondary
      },
      ticks: '',
      zeroline: true,
      zerolinecolor: theme.palette.divider,
      zerolinewidth: 2,
      automargin: true,
    },
    yaxis: {
      title: {
        text: yAxisLabel,
        font: {
          size: 12,
          color: textSecondary
        }
      },
      rangemode: 'tozero' as const,
      showgrid: true,
      showline: true,
      gridcolor: gridColor,
      linecolor: theme.palette.divider,
      color: textSecondary,
      tickfont: {
        size: 11,
        color: textSecondary
      },
      ticks: '',
      zeroline: true,
      zerolinecolor: theme.palette.divider,
      zerolinewidth: 2,
      automargin: true,
      nticks: 5
    },
    title: {
      text: metricName,
      font: {
        color: textColor,
        size: 16,
        family: theme.typography.fontFamily
      },
      x: 0.5,
      xanchor: 'center',
      y: 0.95,
      yanchor: 'top'
    },
    hovermode: 'x unified' as const,
    hoverlabel: {
      bgcolor: hoverBgColor,
      bordercolor: theme.palette.divider,
      font: {
        color: textColor,
        size: 12,
        family: theme.typography.fontFamily
      },
      align: 'left' as const,
    },
    margin: { t: 40, b: 70, l: 60, r: 20 },
    height: 480,
    shapes: rampUpEndIndex !== null ? [{
      type: 'rect' as const,
      x0: 0,
      y0: 0,
      x1: rampUpEndIndex,
      y1: 1,
      yref: 'paper' as const,
      line: { width: 0 },
      fillcolor: gridColor,
      layer: 'below' as const,
      opacity: 0.15
    }] : []
  };

  const config = {
    displayModeBar: true,
    modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d', 'autoScale2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d'],
    displaylogo: false,
    responsive: true,
    toImageButtonOptions: {
      format: 'png',
      filename: `${metricName}_comparison`,
      height: 480,
      width: 1200,
      scale: 2
    },
    modeBarButtonsToAdd: [
      {
        name: 'Copy to Clipboard',
        icon: {
          width: 1792,
          height: 1792,
          path: 'M768 1664h896v-640h-416q-40 0-68-28t-28-68v-416h-384v1152zm256-1440v-64q0-13-9.5-22.5t-22.5-9.5h-704q-13 0-22.5 9.5t-9.5 22.5v64q0 13 9.5 22.5t22.5 9.5h704q13 0 22.5-9.5t9.5-22.5zm256 672h299l-299-299v299zm512 128v672q0 40-28 68t-68 28h-960q-40 0-68-28t-28-68v-160h-544q-40 0-68-28t-28-68v-1344q0-40 28-68t68-28h1088q40 0 68 28t28 68v328q21 13 36 28l408 408q28 28 48 76t20 88z',
          transform: 'scale(0.8)'
        },
        click: function(gd: any) {
          // Convert plot to PNG blob and copy to clipboard
          (window as any).Plotly.toImage(gd, {
            format: 'png',
            width: gd._fullLayout.width || 800,
            height: gd._fullLayout.height || 480,
            scale: 2
          }).then((dataUrl: string) => {
            // Convert data URL to blob
            fetch(dataUrl)
              .then(res => res.blob())
              .then(blob => {
                // Copy to clipboard using the modern Clipboard API
                if (navigator.clipboard && 'write' in navigator.clipboard) {
                  return navigator.clipboard.write([
                    new ClipboardItem({
                      'image/png': blob
                    })
                  ]);
                } else {
                  throw new Error('Clipboard API not supported');
                }
              })
              .then(() => {
                console.log('Chart copied to clipboard successfully');
                showToast(`Chart "${metricName}" copied to clipboard`);
              })
              .catch((err: any) => {
                console.warn('Failed to copy to clipboard:', err);
                // Fallback: trigger download
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = `${metricName}_comparison.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                showToast(`Clipboard not supported - Chart downloaded instead`);
              });
          }).catch((err: any) => {
            console.error('Failed to generate image:', err);
            showToast('Failed to copy chart - please try again');
          });
        }
      }
    ]
  };

  return { data: plotData, layout, config };
}

export default function ComparisonPlot({
  metricName,
  graphData,
  graphLoading,
  selectedMetric,
  testRun,
  relatedTestRuns,
  showToast
}: ComparisonPlotProps) {
  const theme = useTheme();

  if (graphLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
          Loading graph data...
        </Typography>
      </Box>
    );
  }

  if (!graphData) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          No graph data available
        </Typography>
      </Box>
    );
  }

  const plotProps = generatePlotProps(
    metricName,
    graphData,
    selectedMetric,
    testRun,
    relatedTestRuns,
    theme,
    showToast
  );

  return (
    <Box sx={{ height: 480, width: '100%' }}>
      <Plot
        data={plotProps.data}
        layout={plotProps.layout}
        config={plotProps.config}
        style={{ width: '100%', height: '480px' }}
      />
    </Box>
  );
}
