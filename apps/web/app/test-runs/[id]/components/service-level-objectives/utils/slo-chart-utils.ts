/**
 * Utility functions for SLO Metrics Chart
 */

import { PlotlyGraphDiv } from '@/lib/plotly';
import type { Theme } from '@mui/material';
import type {
  MetricDataPoint,
  UnitConversion,
  ChartThemeColors,
} from '../types';
import { PLOTLY_HOVER_FONT_FAMILY } from '@/lib/plotly-fonts';

// Default chart height
export const DEFAULT_CHART_HEIGHT = 320;

const ANALYSIS_BOUNDARY_COLOR = '#f59e0b';

// Color palette for different metrics
export const METRIC_COLOR_PALETTE = [
  '#1976d2', // Primary blue
  '#9c27b0', // Purple
  '#2196f3', // Info blue
  '#4caf50', // Success green
  '#ff9800', // Warning orange
  '#f44336', // Error red
  '#673ab7', // Deep purple
  '#ff5722', // Deep orange
  '#795548', // Brown
  '#607d8b', // Blue grey
];

/**
 * Group data points by metric name
 */
export function groupDataByMetricName(
  dataPoints: MetricDataPoint[],
  targetName?: string
): Map<string, MetricDataPoint[]> {
  const metricGroups = new Map<string, MetricDataPoint[]>();

  if (targetName) {
    const targetData = dataPoints.filter(point => point.metric_name === targetName);
    if (targetData.length > 0) {
      metricGroups.set(targetName, targetData);
    }
  } else {
    dataPoints.forEach(point => {
      if (!metricGroups.has(point.metric_name)) {
        metricGroups.set(point.metric_name, []);
      }
      metricGroups.get(point.metric_name)!.push(point);
    });
  }

  return metricGroups;
}

/**
 * Find global min/max values across all metric groups
 */
export function findGlobalDataRange(
  metricGroups: Map<string, MetricDataPoint[]>
): { min: number | undefined; max: number | undefined } {
  let globalMax: number | undefined;
  let globalMin: number | undefined;

  metricGroups.forEach(metricData => {
    metricData.forEach(dataPoint => {
      if (dataPoint.value !== undefined && dataPoint.value !== null) {
        if (globalMax === undefined || dataPoint.value > globalMax) {
          globalMax = dataPoint.value;
        }
        if (globalMin === undefined || dataPoint.value < globalMin) {
          globalMin = dataPoint.value;
        }
      }
    });
  });

  return { min: globalMin, max: globalMax };
}

/**
 * Calculate unit conversion based on metric unit and data range
 */
export function calculateUnitConversion(
  metricUnit: string,
  requirementValue: number,
  globalMin: number | undefined,
  globalMax: number | undefined
): UnitConversion {
  let factor = 1;
  let adjustedRequirement = requirementValue;
  let adjustedFormat = metricUnit;
  let yAxisLabel = 'Value';

  if (metricUnit === 'percentunit') {
    factor = 100;
    adjustedRequirement = requirementValue * 100;
    yAxisLabel = 'Percentage (%)';
  } else if (metricUnit === 's' && globalMax && globalMax < 1) {
    factor = 1000;
    adjustedRequirement = requirementValue * 1000;
    adjustedFormat = 'ms';
    yAxisLabel = 'Time (ms)';
  } else if (metricUnit === 'ms' && globalMin && globalMin > 1000) {
    factor = 1 / 1000;
    adjustedRequirement = requirementValue / 1000;
    adjustedFormat = 's';
    yAxisLabel = 'Time (s)';
  } else if (metricUnit === 's') {
    yAxisLabel = 'Time (s)';
  } else if (metricUnit === 'ms') {
    yAxisLabel = 'Time (ms)';
  }

  return { factor, adjustedRequirement, adjustedFormat, yAxisLabel };
}

/**
 * Get chart theme colors from MUI theme
 */
export function getChartThemeColors(theme: Theme): ChartThemeColors {
  const isDark = theme.palette.mode === 'dark';
  return {
    sloColor: theme.palette.error.main,
    excludedRegionColor: isDark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.12)',
    textColor: theme.palette.text.primary,
    textSecondary: theme.palette.text.secondary,
    bgColor: isDark ? '#121212' : theme.palette.background.paper,
    plotBgColor: isDark ? '#1e1e1e' : theme.palette.grey[50],
    gridColor: isDark ? 'rgba(255,255,255,0.12)' : '#e0e0e0',
    dividerColor: theme.palette.divider,
    hoverBgColor: isDark ? '#1e293b' : theme.palette.background.paper,
  };
}

/**
 * Calculate time range from test run or data points
 */
export function calculateTimeRange(
  testRunStart?: string,
  testRunEnd?: string,
  metricGroups?: Map<string, MetricDataPoint[]>
): { start: Date; end: Date } {
  if (testRunStart && testRunEnd) {
    return {
      start: new Date(testRunStart),
      end: new Date(testRunEnd),
    };
  }

  if (metricGroups) {
    const allTimes: Date[] = [];
    metricGroups.forEach(metricData => {
      metricData.forEach(point => {
        if (point.time) {
          allTimes.push(new Date(point.time));
        }
      });
    });

    if (allTimes.length > 0) {
      allTimes.sort((a, b) => a.getTime() - b.getTime());
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
 * Build a single data point bar trace for Plotly
 */
export function buildBarTrace(
  metricName: string,
  value: number,
  color: string,
  adjustedFormat: string,
  textColor: string
): Record<string, unknown> {
  const formatSuffix =
    adjustedFormat === 'percentunit' ? '%' : adjustedFormat ? ` ${adjustedFormat}` : '';

  return {
    x: [metricName],
    y: [value],
    name: metricName,
    type: 'bar' as const,
    hovertemplate: `<b>${metricName}</b><br>${value.toFixed(2)}${formatSuffix}<extra></extra>`,
    marker: {
      color: color,
      line: {
        color: color,
        width: 0,
      },
    },
    showlegend: false,
    text: [value.toFixed(2)],
    textposition: 'outside' as const,
    textfont: {
      size: 12,
      color: textColor,
    },
  };
}

/**
 * Build a line trace for Plotly
 */
export function buildLineTrace(
  metricName: string,
  x: Date[],
  y: number[],
  color: string,
  bgColor: string,
  adjustedFormat: string
): Record<string, unknown> {
  const formatSuffix =
    adjustedFormat === 'percentunit' ? '%' : adjustedFormat ? ` ${adjustedFormat}` : '';

  return {
    x: x,
    y: y,
    name: metricName,
    type: 'scatter' as const,
    mode: x.length < 50 ? ('lines+markers' as const) : ('lines' as const),
    showlegend: false,
    hovertemplate: `<b>${metricName}</b><br>%{x|%H:%M:%S}<br>%{y:.2f}${formatSuffix}<extra></extra>`,
    connectgaps: true,
    line: {
      color: color,
      width: 2.5,
      shape: 'linear' as const,
    },
    marker: {
      size: 4,
      color: color,
      line: {
        color: bgColor,
        width: 1,
      },
    },
  };
}

/**
 * Build requirement (SLO) line trace
 */
export function buildRequirementTrace(
  testRunStart: Date,
  testRunEnd: Date,
  adjustedRequirement: number,
  sloColor: string,
  adjustedFormat: string
): Record<string, unknown> {
  const formatSuffix =
    adjustedFormat === 'percentunit' ? '%' : adjustedFormat ? ` ${adjustedFormat}` : '';

  return {
    x: [testRunStart, testRunEnd],
    y: [adjustedRequirement, adjustedRequirement],
    type: 'scatter' as const,
    mode: 'lines' as const,
    name: `SLO: ${adjustedRequirement.toFixed(2)}${formatSuffix}`,
    line: {
      color: sloColor,
      dash: 'dash',
      width: 2,
    },
    hoverinfo: 'skip' as const,
  };
}

/**
 * Build chart layout configuration
 */
export function buildChartLayout(
  hasTimeSeriesData: boolean,
  testRunStart: Date,
  testRunEnd: Date,
  analysisStartOffset: number | undefined,
  analysisEndOffset: number | undefined,
  yAxisLabel: string,
  colors: ChartThemeColors,
  fontFamily: string
): Record<string, unknown> {
  const shapes: unknown[] = [];

  if (hasTimeSeriesData) {
    const startBoundary = new Date(
      testRunStart.getTime() + ((analysisStartOffset ?? 0) * 1000)
    );
    const endBoundary = new Date(
      testRunEnd.getTime() - ((analysisEndOffset ?? 0) * 1000)
    );
    const safeEndBoundary = endBoundary.getTime() > startBoundary.getTime()
      ? endBoundary
      : startBoundary;

    if (analysisStartOffset !== undefined && analysisStartOffset > 0) {
      shapes.push({
        type: 'rect' as const,
        x0: testRunStart,
        y0: 0,
        x1: startBoundary,
        y1: 1,
        xref: 'x' as const,
        yref: 'paper' as const,
        line: { width: 0 },
        fillcolor: colors.excludedRegionColor,
        layer: 'above' as const,
        opacity: 1,
      });
    }

    if (analysisStartOffset !== undefined) {
      shapes.push({
        type: 'line' as const,
        x0: startBoundary,
        y0: 0,
        x1: startBoundary,
        y1: 1,
        xref: 'x' as const,
        yref: 'paper' as const,
        line: { color: ANALYSIS_BOUNDARY_COLOR, width: 1.5, dash: 'dash' as const },
        layer: 'above' as const,
      });
    }

    if (analysisEndOffset !== undefined && analysisEndOffset > 0) {
      shapes.push({
        type: 'rect' as const,
        x0: safeEndBoundary,
        y0: 0,
        x1: testRunEnd,
        y1: 1,
        xref: 'x' as const,
        yref: 'paper' as const,
        line: { width: 0 },
        fillcolor: colors.excludedRegionColor,
        layer: 'above' as const,
        opacity: 1,
      });
    }

    if (analysisEndOffset !== undefined) {
      shapes.push({
        type: 'line' as const,
        x0: safeEndBoundary,
        y0: 0,
        x1: safeEndBoundary,
        y1: 1,
        xref: 'x' as const,
        yref: 'paper' as const,
        line: { color: ANALYSIS_BOUNDARY_COLOR, width: 1.5, dash: 'dash' as const },
        layer: 'above' as const,
      });
    }
  }

  return {
    plot_bgcolor: colors.plotBgColor,
    paper_bgcolor: colors.bgColor,
    font: {
      color: colors.textColor,
      family: fontFamily,
    },
    showlegend: false,
    xaxis: {
      range: hasTimeSeriesData ? [testRunStart, testRunEnd] : undefined,
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
      text: '',
      font: { color: colors.textColor, size: 0 },
    },
    hovermode: hasTimeSeriesData ? ('x unified' as const) : ('closest' as const),
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
    margin: { t: 20, b: 50, l: 60, r: 20 },
    shapes,
    width: undefined,
    height: DEFAULT_CHART_HEIGHT,
    autosize: true,
  };
}

/**
 * Build chart configuration with copy-to-clipboard button
 */
export function buildChartConfig(metricName: string): Record<string, unknown> {
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
      filename: `${metricName}_slo_chart`,
      height: DEFAULT_CHART_HEIGHT,
      width: 1200,
      scale: 2,
    },
    modeBarButtonsToAdd: [
      {
        name: 'Copy to Clipboard',
        icon: {
          width: 1792,
          height: 1792,
          path: 'M768 1664h896v-640h-416q-40 0-68-28t-28-68v-416h-384v1152zm256-1440v-64q0-13-9.5-22.5t-22.5-9.5h-704q-13 0-22.5 9.5t-9.5 22.5v64q0 13 9.5 22.5t22.5 9.5h704q13 0 22.5-9.5t9.5-22.5zm256 672h299l-299-299v299zm512 128v672q0 40-28 68t-68 28h-960q-40 0-68-28t-28-68v-160h-544q-40 0-68-28t-28-68v-1344q0-40 28-68t68-28h1088q40 0 68 28t28 68v328q21 13 36 28l408 408q28 28 48 76t20 88z',
          transform: 'scale(0.8)',
        },
        click: function (gd: PlotlyGraphDiv) {
          copyChartToClipboard(gd);
        },
      },
    ],
  };
}

/**
 * Copy chart to clipboard as PNG
 */
function copyChartToClipboard(gd: PlotlyGraphDiv): void {
  const Plotly = (window as { Plotly?: typeof import('plotly.js') }).Plotly;
  if (!Plotly) return;

  Plotly.toImage(gd, {
    format: 'png',
    width: gd._fullLayout?.width || 800,
    height: gd._fullLayout?.height || DEFAULT_CHART_HEIGHT,
    scale: 2,
  }).then((dataUrl: string) => {
    fetch(dataUrl)
      .then(res => res.blob())
      .then(blob => {
        if (navigator.clipboard && 'write' in navigator.clipboard) {
          return navigator.clipboard.write([
            new ClipboardItem({
              'image/png': blob,
            }),
          ]);
        } else {
          throw new Error('Clipboard API not supported');
        }
      })
      .catch((err: Error) => {
        console.error('Failed to copy SLO chart to clipboard:', err);
      });
  });
}
