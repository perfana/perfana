/**
 * Utility functions for CurrentTestRunChart component
 */

import { PlotlyGraphDiv } from '@/lib/plotly';
import type { Theme } from '@mui/material';
import { alpha } from '@mui/material';
import { PLOTLY_HOVER_FONT_FAMILY } from '@/lib/plotly-fonts';
import type {
  MetricDataPoint,
  Thresholds,
  UnitConversion,
  ChartThemeColors,
  TimeRange,
} from '../types';

// Default chart height
export const DEFAULT_CHART_HEIGHT = 416;

/**
 * Find global min/max values across all data points
 */
export function findDataRange(
  dataPoints: MetricDataPoint[]
): { min: number | undefined; max: number | undefined } {
  let globalMax: number | undefined;
  let globalMin: number | undefined;

  dataPoints.forEach(dataPoint => {
    if (dataPoint.value !== undefined && dataPoint.value !== null) {
      if (globalMax === undefined || dataPoint.value > globalMax) {
        globalMax = dataPoint.value;
      }
      if (globalMin === undefined || dataPoint.value < globalMin) {
        globalMin = dataPoint.value;
      }
    }
  });

  return { min: globalMin, max: globalMax };
}

/**
 * Calculate unit conversion based on unit type and data range
 */
export function calculateUnitConversion(
  unit: string,
  globalMin: number | undefined,
  globalMax: number | undefined
): UnitConversion {
  let factor = 1;
  let yAxisLabel = 'Value';

  if (unit === 'percentunit') {
    factor = 100;
    yAxisLabel = 'Percentage (%)';
  } else if (unit === 's' && globalMax && globalMax < 1) {
    factor = 1000;
    yAxisLabel = 'Time (ms)';
  } else if (unit === 'ms' && globalMin && globalMin > 1000) {
    factor = 1 / 1000;
    yAxisLabel = 'Time (s)';
  } else if (unit === 's') {
    yAxisLabel = 'Time (s)';
  } else if (unit === 'ms') {
    yAxisLabel = 'Time (ms)';
  }

  return { factor, yAxisLabel };
}

/**
 * Get chart theme colors from MUI theme
 */
export function getChartThemeColors(theme: Theme): ChartThemeColors {
  const isDark = theme.palette.mode === 'dark';
  return {
    textColor: theme.palette.text.primary,
    textSecondary: theme.palette.text.secondary,
    bgColor: isDark ? '#121212' : theme.palette.background.paper,
    plotBgColor: isDark ? '#1e1e1e' : theme.palette.grey[50],
    gridColor: isDark ? 'rgba(255,255,255,0.12)' : '#e0e0e0',
    dividerColor: theme.palette.divider,
    rampUpColor: alpha(theme.palette.info.main, 0.08),
    primaryColor: theme.palette.primary.main,
    thresholdColor: 'rgba(76, 175, 80, 0.7)',
    hoverBgColor: isDark ? '#1e293b' : theme.palette.background.paper,
  };
}

/**
 * Calculate time range from test run info or data points
 */
export function calculateTimeRange(
  testRunStart?: string,
  testRunEnd?: string,
  dataPoints?: MetricDataPoint[]
): TimeRange {
  if (testRunStart && testRunEnd) {
    return {
      start: new Date(testRunStart),
      end: new Date(testRunEnd),
    };
  }

  if (dataPoints && dataPoints.length > 0) {
    const allTimes = dataPoints
      .filter(point => point.time)
      .map(point => new Date(point.time))
      .sort((a, b) => a.getTime() - b.getTime());

    if (allTimes.length > 0) {
      return {
        start: allTimes[0],
        end: allTimes[allTimes.length - 1],
      };
    }
  }

  return {
    start: new Date(),
    end: new Date(),
  };
}

/**
 * Build the main metric line trace for Plotly
 */
export function buildMetricTrace(
  metricName: string,
  x: Date[],
  y: number[],
  unit: string,
  primaryColor: string
): Record<string, unknown> {
  const formatSuffix = unit === 'percentunit' ? '%' : unit ? ` ${unit}` : '';

  return {
    x: x,
    y: y,
    name: metricName,
    type: 'scatter' as const,
    mode: 'lines+markers' as const,
    showlegend: false,
    hovertemplate: `<b>${metricName}</b><br>%{x|%H:%M:%S}<br>%{y:.2f}${formatSuffix}<extra></extra>`,
    connectgaps: true,
    line: {
      color: primaryColor,
      width: 2.5,
      shape: 'linear' as const,
    },
    marker: {
      color: primaryColor,
      size: 4,
    },
  };
}

/**
 * Build threshold line traces for Plotly
 */
export function buildThresholdTraces(
  thresholds: Thresholds,
  timeRange: TimeRange,
  conversionFactor: number,
  thresholdColor: string
): unknown[] {
  const traces: unknown[] = [];
  const { start, end } = timeRange;

  // Lower threshold line
  if (thresholds.lower?.overall !== null && thresholds.lower?.overall !== undefined) {
    const lowerThreshold = thresholds.lower.overall * conversionFactor;
    traces.push({
      x: [start, end],
      y: [lowerThreshold, lowerThreshold],
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: 'Lower Threshold',
      line: { color: thresholdColor, width: 1, dash: 'dash' },
      marker: { color: 'transparent', size: 0 },
      hoverinfo: 'skip' as const,
      showlegend: false,
    });
  }

  // Upper threshold line
  if (thresholds.upper?.overall !== null && thresholds.upper?.overall !== undefined) {
    const upperThreshold = thresholds.upper.overall * conversionFactor;
    traces.push({
      x: [start, end],
      y: [upperThreshold, upperThreshold],
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: 'Upper Threshold',
      line: { color: thresholdColor, width: 1, dash: 'dash' },
      marker: { color: 'transparent', size: 0 },
      hoverinfo: 'skip' as const,
      showlegend: false,
    });

    // Add filled ribbon between thresholds if both exist
    if (thresholds.lower?.overall !== null && thresholds.lower?.overall !== undefined) {
      const lowerThreshold = thresholds.lower.overall * conversionFactor;
      traces.push({
        x: [start, end, end, start],
        y: [lowerThreshold, lowerThreshold, upperThreshold, upperThreshold],
        fill: 'toself',
        fillcolor: 'rgba(76, 175, 80, 0.1)',
        line: { width: 0 },
        name: 'Threshold Range',
        hoverinfo: 'skip' as const,
        showlegend: false,
      });
    }
  }

  return traces;
}

/**
 * Build chart layout configuration
 */
// Amber dashed boundary, matching the SLO charts (slo-chart-utils.ts) so the
// ADAPT analysis window reads identically across both surfaces.
const ANALYSIS_BOUNDARY_COLOR = '#f59e0b';

/**
 * Build the analysis-time-range shapes: shaded excluded regions for the leading
 * start offset and trailing end offset, plus a dashed boundary line at each edge.
 * Mirrors the SLO chart (service-level-objectives/utils/slo-chart-utils.ts) so
 * ADAPT and SLO show the same window. Offsets are in seconds from start/end.
 */
function buildAnalysisWindowShapes(
  timeRange: TimeRange,
  analysisStartOffset: number | undefined,
  analysisEndOffset: number | undefined,
  colors: ChartThemeColors
): Record<string, unknown>[] {
  const { start, end } = timeRange;
  const shapes: Record<string, unknown>[] = [];

  const startBoundary = new Date(start.getTime() + (analysisStartOffset ?? 0) * 1000);
  const endBoundary = new Date(end.getTime() - (analysisEndOffset ?? 0) * 1000);
  // Guard against the end boundary crossing before the start boundary.
  const safeEndBoundary =
    endBoundary.getTime() > startBoundary.getTime() ? endBoundary : startBoundary;

  if (analysisStartOffset !== undefined && analysisStartOffset > 0) {
    shapes.push({
      type: 'rect' as const,
      x0: start, y0: 0, x1: startBoundary, y1: 1,
      xref: 'x' as const, yref: 'paper' as const,
      line: { width: 0 }, fillcolor: colors.rampUpColor, layer: 'below' as const, opacity: 1,
    });
  }
  if (analysisStartOffset !== undefined) {
    shapes.push({
      type: 'line' as const,
      x0: startBoundary, y0: 0, x1: startBoundary, y1: 1,
      xref: 'x' as const, yref: 'paper' as const,
      line: { color: ANALYSIS_BOUNDARY_COLOR, width: 1.5, dash: 'dash' as const },
      layer: 'above' as const,
    });
  }
  if (analysisEndOffset !== undefined && analysisEndOffset > 0) {
    shapes.push({
      type: 'rect' as const,
      x0: safeEndBoundary, y0: 0, x1: end, y1: 1,
      xref: 'x' as const, yref: 'paper' as const,
      line: { width: 0 }, fillcolor: colors.rampUpColor, layer: 'below' as const, opacity: 1,
    });
  }
  if (analysisEndOffset !== undefined) {
    shapes.push({
      type: 'line' as const,
      x0: safeEndBoundary, y0: 0, x1: safeEndBoundary, y1: 1,
      xref: 'x' as const, yref: 'paper' as const,
      line: { color: ANALYSIS_BOUNDARY_COLOR, width: 1.5, dash: 'dash' as const },
      layer: 'above' as const,
    });
  }
  return shapes;
}

export function buildChartLayout(
  metricName: string,
  timeRange: TimeRange,
  analysisStartOffset: number | undefined,
  analysisEndOffset: number | undefined,
  yAxisLabel: string,
  colors: ChartThemeColors,
  fontFamily: string,
  hasData: boolean
): Record<string, unknown> {
  const { start, end } = timeRange;

  return {
    plot_bgcolor: colors.plotBgColor,
    paper_bgcolor: colors.bgColor,
    font: {
      color: colors.textColor,
      family: fontFamily,
    },
    showlegend: false,
    xaxis: {
      range: hasData ? [start, end] : undefined,
      showgrid: true,
      showline: true,
      visible: true,
      gridcolor: colors.gridColor,
      linecolor: colors.dividerColor,
      color: colors.textSecondary,
      tickfont: {
        size: 11,
        color: colors.textSecondary,
      },
      ticks: '',
      zerolinecolor: colors.gridColor,
      zerolinewidth: 1,
      automargin: true,
      title: {
        standoff: 15,
      },
    },
    yaxis: {
      rangemode: 'tozero' as const,
      title: {
        text: yAxisLabel,
        font: {
          size: 12,
          color: colors.textSecondary,
        },
      },
      showgrid: true,
      showline: true,
      gridcolor: colors.gridColor,
      linecolor: colors.dividerColor,
      color: colors.textSecondary,
      tickfont: {
        size: 11,
        color: colors.textSecondary,
      },
      ticks: '',
      zerolinecolor: colors.gridColor,
      zerolinewidth: 1,
      automargin: true,
      nticks: 5,
    },
    title: {
      text: metricName,
      font: {
        color: colors.textColor,
        size: 14,
        family: fontFamily,
      },
      x: 0.5,
      xanchor: 'center' as const,
      y: 0.95,
      yanchor: 'top' as const,
    },
    hovermode: hasData ? ('x unified' as const) : ('closest' as const),
    hoverlabel: {
      bgcolor: colors.hoverBgColor,
      bordercolor: colors.dividerColor,
      font: {
        color: colors.textColor,
        size: 12,
        family: PLOTLY_HOVER_FONT_FAMILY,
      },
      align: 'left' as const,
    },
    margin: { l: 50, r: 20, t: 40, b: 80 },
    shapes: hasData
      ? buildAnalysisWindowShapes(timeRange, analysisStartOffset, analysisEndOffset, colors)
      : [],
    height: DEFAULT_CHART_HEIGHT,
  };
}

/**
 * Build chart configuration with optional copy-to-clipboard button
 */
export function buildChartConfig(
  metricName: string,
  showToast?: (message: string) => void
): Record<string, unknown> {
  const modeBarButtonsToAdd = showToast
    ? [
        {
          name: 'Copy to Clipboard',
          icon: {
            width: 1792,
            height: 1792,
            path: 'M768 1664h896v-640h-416q-40 0-68-28t-28-68v-416h-384v1152zm256-1440v-64q0-13-9.5-22.5t-22.5-9.5h-704q-13 0-22.5 9.5t-9.5 22.5v64q0 13 9.5 22.5t22.5 9.5h704q13 0 22.5-9.5t9.5-22.5zm256 672h299l-299-299v299zm512 128v672q0 40-28 68t-68 28h-960q-40 0-68-28t-28-68v-160h-544q-40 0-68-28t-28-68v-1344q0-40 28-68t68-28h1088q40 0 68 28t28 68v328q21 13 36 28l408 408q28 28 48 76t20 88z',
            transform: 'scale(0.8)',
          },
          click: function (gd: PlotlyGraphDiv) {
            copyChartToClipboard(gd, showToast);
          },
        },
      ]
    : [];

  return {
    responsive: true,
    displayModeBar: true,
    modeBarButtonsToRemove: [
      'pan2d',
      'lasso2d',
      'select2d',
      'autoScale2d',
      'zoom2d',
      'zoomIn2d',
      'zoomOut2d',
      'resetScale2d',
    ],
    displaylogo: false,
    toImageButtonOptions: {
      format: 'png',
      filename: `${metricName}_current_test_run_chart`,
      height: DEFAULT_CHART_HEIGHT,
      width: 1200,
      scale: 2,
    },
    modeBarButtonsToAdd,
  };
}

/**
 * Copy chart to clipboard as PNG with fallback methods
 */
function copyChartToClipboard(gd: PlotlyGraphDiv, showToast: (message: string) => void): void {
  const Plotly = (window as { Plotly?: typeof import('plotly.js') }).Plotly;
  if (!Plotly) {
    showToast('Failed to generate graph image');
    return;
  }

  Plotly.toImage(gd, {
    format: 'png',
    width: gd._fullLayout?.width || 800,
    height: gd._fullLayout?.height || DEFAULT_CHART_HEIGHT,
    scale: 2,
  })
    .then((dataUrl: string) => {
      // Try modern Clipboard API with blob
      if (
        navigator.clipboard &&
        'write' in navigator.clipboard &&
        typeof ClipboardItem !== 'undefined'
      ) {
        fetch(dataUrl)
          .then(res => res.blob())
          .then(blob => {
            return navigator.clipboard.write([
              new ClipboardItem({
                'image/png': blob,
              }),
            ]);
          })
          .then(() => {
            showToast('Graph copied to clipboard');
          })
          .catch(() => {
            tryTextFallback(dataUrl, showToast);
          });
      } else {
        tryTextFallback(dataUrl, showToast);
      }
    })
    .catch(() => {
      showToast('Failed to generate graph image');
    });
}

/**
 * Fallback: Copy data URL as text
 */
function tryTextFallback(dataUrl: string, showToast: (message: string) => void): void {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(dataUrl)
      .then(() => {
        showToast('Graph data URL copied to clipboard (paste into image editor)');
      })
      .catch(() => {
        showFinalFallback(dataUrl, showToast);
      });
  } else {
    showFinalFallback(dataUrl, showToast);
  }
}

/**
 * Final fallback: Use document.execCommand
 */
function showFinalFallback(dataUrl: string, showToast: (message: string) => void): void {
  const textarea = document.createElement('textarea');
  textarea.value = dataUrl;
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const successful = document.execCommand('copy');
    if (successful) {
      showToast('Graph data URL copied to clipboard (paste into image editor)');
    } else {
      showToast('Please right-click the graph and select "Save image as..."');
    }
  } catch {
    showToast('Please right-click the graph and select "Save image as..."');
  }

  document.body.removeChild(textarea);
}
