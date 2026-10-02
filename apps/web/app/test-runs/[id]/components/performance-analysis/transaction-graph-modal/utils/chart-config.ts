/**
 * Chart configuration utilities for TransactionGraphModal
 */

import { PlotlyGraphDiv, copyPlotToClipboard, plotlyPngBlob, plotSize } from '@/lib/plotly';
import { alpha } from '@mui/material';
import type { Theme } from '@mui/material';
import { MONO, SIZE, catColor, chartTheme, type ChartMode } from '@/lib/charts';
import type { MetricType, MetricOption, AggregationOption, SamplerColor } from '../types';

// Must list every value the API's server-side ladder can return, or the Select
// renders blank when the server picks one the user never chose.
export const AGGREGATION_OPTIONS: AggregationOption[] = [
  { value: 5, label: '5 seconds' },
  { value: 10, label: '10 seconds' },
  { value: 15, label: '15 seconds' },
  { value: 20, label: '20 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 120, label: '2 minutes' },
  { value: 180, label: '3 minutes' },
  { value: 300, label: '5 minutes' },
];

export const METRIC_OPTIONS: MetricOption[] = [
  { value: 'avg_response_time', label: 'Average' },
  { value: 'median_response_time', label: 'Median (P50)' },
  { value: 'p90_response_time', label: 'P90' },
  { value: 'p95_response_time', label: 'P95' },
  { value: 'p99_response_time', label: 'P99' },
];

/**
 * A stacked sampler's fill and border, by colour SLOT.
 *
 * Replaces a private Tableau-10 table of rgba pairs — the sixth chart palette in the app.
 * `catColor` is mode-aware, which the fixed table was not: its mid-tones at 25% over the
 * dark plot background came out muddy. `alpha()` is safe on these because they are opaque
 * hex (see the `alpha()` warning in apps/web/CLAUDE.md, which is about translucent tokens).
 */
export function samplerColor(slot: number, mode: ChartMode): SamplerColor {
  const base = catColor(slot, mode);
  return { fill: alpha(base, 0.25), border: alpha(base, 0.6) };
}

export function getMetricLabel(metric: MetricType): string {
  return METRIC_OPTIONS.find(m => m.value === metric)?.label || 'Average';
}

/**
 * The chart's layout, in the Analyst standard.
 *
 * What changed from the hand-rolled version: the colours come from `chartTheme` instead of
 * seven hex literals (the dark `#121212` paper and `#1e1e1e` plot sat inside a `#1e293b`
 * dialog — three greys, one surface), ticks are mono, the vertical gridlines are gone in
 * favour of the dotted crosshair spike, and the in-plot title is gone because the dialog
 * header already names the transaction and the metric.
 */
export function buildPlotLayout(metricLabel: string, theme?: Theme): Record<string, unknown> {
  const chart = chartTheme(theme?.palette.mode === 'dark' ? 'dark' : 'light');
  const axisTitle = { family: MONO, size: SIZE.axisLabelFont, color: chart.faint };
  const tickfont = { family: MONO, size: SIZE.tickFont, color: chart.faint };

  return {
    xaxis: {
      type: 'date' as const,
      showgrid: false,
      showline: false,
      zeroline: false,
      color: chart.muted,
      tickfont,
      ticks: '',
      automargin: true,
      showspikes: true,
      spikemode: 'across' as const,
      spikesnap: 'cursor' as const,
      spikecolor: chart.faint,
      spikethickness: 1,
      spikedash: 'dot' as const,
    },
    yaxis: {
      title: { text: 'Response Time (ms)', font: axisTitle },
      gridcolor: chart.grid,
      showline: false,
      zeroline: false,
      color: chart.muted,
      tickfont,
      side: 'left' as const,
      automargin: true,
    },
    yaxis2: {
      title: { text: 'Transactions/s', font: axisTitle },
      overlaying: 'y' as const,
      side: 'right' as const,
      showgrid: false,
      zeroline: false,
      color: chart.muted,
      tickfont,
    },
    // `x`, not `x unified`: the stack can hold nineteen samplers, and a unified box lists
    // every one of them at every hover.
    hovermode: 'x' as const,
    hoverlabel: {
      bgcolor: chart.paper,
      bordercolor: chart.divider,
      font: { family: MONO, size: SIZE.valueFont, color: chart.text },
    },
    // Kept: a stacked band is unreadable without the names, and this chart has no series
    // table beside it.
    showlegend: true,
    legend: {
      orientation: 'v' as const,
      x: 1.01,
      y: 1,
      font: { family: MONO, size: SIZE.tableFont, color: chart.faint },
      bgcolor: 'rgba(0,0,0,0)',
      borderwidth: 0,
    },
    // `t` drops from 80 to 24: the in-plot title it was leaving room for is gone.
    margin: { l: 70, r: 220, t: 24, b: 70 },
    autosize: true,
    plot_bgcolor: chart.plotBg,
    paper_bgcolor: chart.paper,
    font: { family: MONO, size: SIZE.tickFont, color: chart.muted },
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
  copyPlotToClipboard(
    () => plotlyPngBlob(gd, plotSize(gd, { width: 800, height: 400 })),
    { fallbackFilename: 'transaction_graph.png', notify: showToast },
  );
}
