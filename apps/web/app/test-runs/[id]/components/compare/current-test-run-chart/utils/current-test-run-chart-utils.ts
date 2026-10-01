/**
 * Utility functions for CurrentTestRunChart component
 */

import { PlotlyGraphDiv, copyPlotToClipboard, plotlyPngBlob, plotSize } from '@/lib/plotly';
import type { Theme } from '@mui/material';
import { PLOTLY_HOVER_FONT_FAMILY } from '@/lib/plotly-fonts';
import {
  SIZE,
  analysisWindowBands,
  chartTheme,
  displayUnit,
  toDisplay,
  unitFactor,
  unitFamily,
  unitText,
} from '@/lib/charts';
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
 * Unit conversion, via the shared resolver.
 *
 * The four-branch `percentunit` / `s` / `ms` ladder this replaces was one of four
 * diverging copies in the app; `displayUnit` auto-scales every family the units table
 * knows about, and `factor` is the multiplier from the stored code to the drawn one.
 */
export function calculateUnitConversion(
  unit: string,
  _globalMin: number | undefined,
  globalMax: number | undefined
): UnitConversion {
  const display = displayUnit(unitFamily(unit), (globalMax ?? 0) * unitFactor(unit), unit);
  return {
    factor: toDisplay(1, unit, display),
    yAxisLabel: display.label || unitText(unit),
  };
}

/**
 * Chart colours, from the one chart theme.
 *
 * The dark-mode `#121212` paper and `#1e1e1e` plot background that used to be hard-coded
 * here sat inside a `#1e293b` card — three surfaces, three greys, one card.
 */
export function getChartThemeColors(theme: Theme): ChartThemeColors {
  const chart = chartTheme(theme.palette.mode === 'dark' ? 'dark' : 'light');
  return {
    textColor: chart.text,
    textSecondary: chart.muted,
    bgColor: chart.paper,
    plotBgColor: chart.plotBg,
    gridColor: chart.grid,
    dividerColor: chart.divider,
    rampUpColor: chart.excluded,
    primaryColor: chart.primary,
    // Red is the standard's only verdict colour, and a threshold is a verdict.
    thresholdColor: chart.error,
    hoverBgColor: chart.paper,
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
      width: SIZE.line,
      shape: 'linear' as const,
    },
    marker: {
      color: primaryColor,
      size: 3,
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
  }

  return traces;
}

/**
 * The analysis window, drawn by the shared builder: an `excluded` wash over the trimmed
 * head and tail, a hairline at each edge, and mono `start` / `end` labels.
 *
 * The amber dashed boundary this replaces was the same colour the SLO charts used for a
 * data series, so an analysis edge and a metric line read as the same thing.
 */
function buildAnalysisWindowShapes(
  timeRange: TimeRange,
  analysisStartOffset: number | undefined,
  analysisEndOffset: number | undefined,
  colors: ChartThemeColors
): { shapes: Record<string, unknown>[]; annotations: Record<string, unknown>[] } {
  const { start, end } = timeRange;
  const startBoundary = new Date(start.getTime() + (analysisStartOffset ?? 0) * 1000);
  const endBoundary = new Date(end.getTime() - (analysisEndOffset ?? 0) * 1000);
  // Guard against the end boundary crossing before the start boundary.
  const safeEndBoundary =
    endBoundary.getTime() > startBoundary.getTime() ? endBoundary : startBoundary;

  return analysisWindowBands(
    {
      from: start,
      start: analysisStartOffset ? startBoundary : null,
      end: analysisEndOffset ? safeEndBoundary : null,
      to: end,
    },
    { excluded: colors.rampUpColor, faint: colors.textSecondary },
  );
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
    ...(hasData
      ? buildAnalysisWindowShapes(timeRange, analysisStartOffset, analysisEndOffset, colors)
      : { shapes: [], annotations: [] }),
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
            copyChartToClipboard(gd, metricName, showToast);
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
 * Copy chart to clipboard as PNG, falling back to a download.
 *
 * The old fallback chain copied the base64 data URL as TEXT and told the user to paste
 * it into an image editor, which no editor accepts. A download is the only fallback
 * that produces the thing the user asked for.
 */
function copyChartToClipboard(
  gd: PlotlyGraphDiv,
  metricName: string,
  showToast: (message: string) => void,
): void {
  copyPlotToClipboard(
    () => plotlyPngBlob(gd, plotSize(gd, { width: 800, height: DEFAULT_CHART_HEIGHT })),
    { fallbackFilename: `${metricName}_current_test_run_chart.png`, notify: showToast },
  );
}
