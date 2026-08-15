/**
 * Chart configuration utilities for TransactionGraphModal
 */

import { PlotlyGraphDiv, getPlotly } from '@/lib/plotly';
import type { Theme } from '@mui/material';
import type { MetricType, MetricOption, AggregationOption, SamplerColor } from '../types';

export const AGGREGATION_OPTIONS: AggregationOption[] = [
  { value: 5, label: '5 seconds' },
  { value: 10, label: '10 seconds' },
  { value: 30, label: '30 seconds' },
];

export const METRIC_OPTIONS: MetricOption[] = [
  { value: 'avg_response_time', label: 'Average' },
  { value: 'median_response_time', label: 'Median (P50)' },
  { value: 'p90_response_time', label: 'P90' },
  { value: 'p95_response_time', label: 'P95' },
  { value: 'p99_response_time', label: 'P99' },
];

// Tableau 10 palette - colorblind-safe and perceptually uniform
export const SAMPLER_COLORS: SamplerColor[] = [
  { fill: 'rgba(31, 119, 180, 0.25)', border: 'rgba(31, 119, 180, 0.6)' },    // Strong Blue
  { fill: 'rgba(255, 127, 14, 0.25)', border: 'rgba(255, 127, 14, 0.6)' },    // Orange
  { fill: 'rgba(44, 160, 44, 0.25)', border: 'rgba(44, 160, 44, 0.6)' },      // Green
  { fill: 'rgba(214, 39, 40, 0.25)', border: 'rgba(214, 39, 40, 0.6)' },      // Red
  { fill: 'rgba(148, 103, 189, 0.25)', border: 'rgba(148, 103, 189, 0.6)' },  // Purple
  { fill: 'rgba(140, 86, 75, 0.25)', border: 'rgba(140, 86, 75, 0.6)' },      // Brown
  { fill: 'rgba(227, 119, 194, 0.25)', border: 'rgba(227, 119, 194, 0.6)' },  // Pink
  { fill: 'rgba(127, 127, 127, 0.25)', border: 'rgba(127, 127, 127, 0.6)' },  // Gray
  { fill: 'rgba(188, 189, 34, 0.25)', border: 'rgba(188, 189, 34, 0.6)' },    // Olive
  { fill: 'rgba(23, 190, 207, 0.25)', border: 'rgba(23, 190, 207, 0.6)' },    // Cyan
  { fill: 'rgba(255, 152, 150, 0.25)', border: 'rgba(255, 152, 150, 0.6)' },  // Light Red
  { fill: 'rgba(197, 176, 213, 0.25)', border: 'rgba(197, 176, 213, 0.6)' },  // Light Purple
];

export function getMetricLabel(metric: MetricType): string {
  return METRIC_OPTIONS.find(m => m.value === metric)?.label || 'Average';
}

export function buildPlotLayout(metricLabel: string, theme?: Theme): Record<string, unknown> {
  const isDark = theme?.palette.mode === 'dark';
  const textColor = theme?.palette.text.primary ?? 'inherit';
  const textSecondary = theme?.palette.text.secondary ?? 'inherit';
  const gridColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0, 0, 0, 0.05)';
  const plotBgColor = isDark ? '#1e1e1e' : 'rgba(250, 250, 250, 1)';
  const paperBgColor = isDark ? '#121212' : 'white';
  const legendBgColor = isDark ? 'rgba(30, 41, 59, 0.9)' : 'rgba(255, 255, 255, 0.9)';
  const legendBorderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
  const hoverBgColor = isDark ? '#1e293b' : 'white';

  return {
    title: {
      text: `${metricLabel} Response Time`,
      font: {
        size: 18,
        weight: 600,
        family: 'Roboto, sans-serif',
        color: textColor,
      },
      x: 0.05,
    },
    xaxis: {
      title: {
        text: 'Time',
        font: { size: 14, weight: 500, color: textSecondary },
      },
      type: 'date' as const,
      gridcolor: gridColor,
      linecolor: isDark ? 'rgba(255,255,255,0.2)' : undefined,
      color: textSecondary,
      tickfont: { color: textSecondary },
    },
    yaxis: {
      title: {
        text: 'Response Time (ms)',
        font: { size: 14, weight: 500, color: textSecondary },
      },
      gridcolor: gridColor,
      linecolor: isDark ? 'rgba(255,255,255,0.2)' : undefined,
      color: textSecondary,
      tickfont: { color: textSecondary },
      side: 'left' as const,
    },
    yaxis2: {
      title: {
        text: 'Transactions/s',
        font: { size: 14, weight: 500, color: textSecondary },
      },
      overlaying: 'y' as const,
      side: 'right' as const,
      showgrid: false,
      color: textSecondary,
      tickfont: { color: textSecondary },
    },
    hovermode: 'x unified' as const,
    hoverlabel: {
      bgcolor: hoverBgColor,
      bordercolor: isDark ? 'rgba(255,255,255,0.2)' : undefined,
      font: { color: textColor },
    },
    showlegend: true,
    legend: {
      orientation: 'v' as const,
      x: 1.01,
      y: 1,
      font: { size: 12, color: textColor },
      bgcolor: legendBgColor,
      bordercolor: legendBorderColor,
      borderwidth: 1,
    },
    margin: {
      l: 70,
      r: 220,
      t: 80,
      b: 70,
    },
    autosize: true,
    plot_bgcolor: plotBgColor,
    paper_bgcolor: paperBgColor,
    font: {
      color: textColor,
    },
  };
}

export function buildPlotConfig(
  transactionName: string,
  metricLabel: string,
  showToast: (message: string) => void
): Record<string, unknown> {
  return {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: [
      'pan2d', 'lasso2d', 'select2d', 'autoScale2d',
      'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d'
    ],
    toImageButtonOptions: {
      format: 'png' as const,
      filename: `transaction_${transactionName}_${metricLabel.toLowerCase().replace(/\s+/g, '_')}`,
      width: 1920,
      height: 1080,
    },
    modeBarButtons: [
      [
        'toImage',
        {
          name: 'Copy to clipboard',
          icon: {
            width: 1792,
            height: 1792,
            path: 'M768 1664h896v-640h-416q-40 0-68-28t-28-68v-416h-384v1152zm256-1440v-64q0-13-9.5-22.5t-22.5-9.5h-704q-13 0-22.5 9.5t-9.5 22.5v64q0 13 9.5 22.5t22.5 9.5h704q13 0 22.5-9.5t9.5-22.5zm256 672h299l-299-299v299zm512 128v672q0 40-28 68t-68 28h-960q-40 0-68-28t-28-68v-160h-544q-40 0-68-28t-28-68v-1344q0-40 28-68t68-28h1088q40 0 68 28t28 68v328q21 13 36 28l408 408q28 28 48 76t20 88z',
            transform: 'scale(0.8)'
          },
          click: function(gd: PlotlyGraphDiv) {
            copyChartToClipboard(gd, showToast);
          }
        }
      ]
    ] as unknown,
  };
}

function copyChartToClipboard(gd: PlotlyGraphDiv, showToast: (message: string) => void): void {
  const plotly = getPlotly();
  if (!plotly) return;
  plotly.toImage(gd, {
    format: 'png',
    width: gd._fullLayout?.width || 800,
    height: gd._fullLayout?.height || 400,
    scale: 2
  }).then((dataUrl: string) => {
    fetch(dataUrl)
      .then(res => res.blob())
      .then(blob => {
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
        showToast('Graph copied to clipboard');
      })
      .catch((err: Error) => {
        console.error('Failed to copy to clipboard:', err);
        showToast('Failed to copy graph to clipboard');
      });
  });
}
