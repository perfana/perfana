import { SeriesConfig, MetricDataPoint } from '../types';
import { AxisAssignment, UnitConversion, ChartThemeColors, PlotTrace } from '../types/chart.types';
import { TestRun } from '@/types/test-runs';
import { PLOTLY_HOVER_FONT_FAMILY } from '@/lib/plotly-fonts';

/**
 * Extended color palette for automatic series color assignment
 * Cycles through colors for each series in the chart
 */
export const CHART_COLOR_PALETTE = [
  '#2E86AB', // Blue
  '#FF6B35', // Orange
  '#4CAF50', // Green
  '#9C27B0', // Purple
  '#F57C00', // Dark Orange
  '#00897B', // Teal
  '#E91E63', // Pink
  '#3F51B5', // Indigo
];

/**
 * Get color for a chart series based on its index
 */
export function getChartSeriesColor(index: number): string {
  return CHART_COLOR_PALETTE[index % CHART_COLOR_PALETTE.length];
}

/**
 * Group series by their unit format and determine which axis to use
 *
 * Rules:
 * 1. Group by unit (yAxisFormat)
 * 2. If all same unit -> single Y-axis (left)
 * 3. If 2+ different units -> first unit on left, others on right
 * 4. If same unit but magnitude ratio > 100 -> split by magnitude
 */
export function assignSeriesToAxes(
  seriesConfig: SeriesConfig[],
  seriesData: Map<string, MetricDataPoint[]>
): AxisAssignment {
  if (seriesConfig.length === 0) {
    return { leftAxisSeries: [], rightAxisSeries: [] };
  }

  // Group series by unit
  const unitGroups = new Map<string, SeriesConfig[]>();
  seriesConfig.forEach(series => {
    const unit = series.yAxisFormat || 'default';
    if (!unitGroups.has(unit)) {
      unitGroups.set(unit, []);
    }
    unitGroups.get(unit)!.push(series);
  });

  // Single unit - check for magnitude split
  if (unitGroups.size === 1) {
    const [, series] = Array.from(unitGroups.entries())[0];

    // Calculate max/min values across all series with this unit
    let globalMax = -Infinity;
    let globalMin = Infinity;

    series.forEach(s => {
      const data = seriesData.get(s.id);
      if (data) {
        data.forEach(point => {
          if (point.value > globalMax) globalMax = point.value;
          if (point.value < globalMin) globalMin = point.value;
        });
      }
    });

    // Check magnitude ratio
    if (globalMax > 0 && globalMin > 0 && (globalMax / globalMin > 100)) {
      // Split by magnitude - series with values > midpoint go to right axis
      const midpoint = (globalMax + globalMin) / 2;
      const leftSeries: SeriesConfig[] = [];
      const rightSeries: SeriesConfig[] = [];

      series.forEach(s => {
        const data = seriesData.get(s.id);
        if (data && data.length > 0) {
          const avgValue = data.reduce((sum, p) => sum + p.value, 0) / data.length;
          if (avgValue > midpoint) {
            rightSeries.push(s);
          } else {
            leftSeries.push(s);
          }
        } else {
          leftSeries.push(s);
        }
      });

      return { leftAxisSeries: leftSeries, rightAxisSeries: rightSeries };
    }

    // No magnitude split needed - all on left axis
    return { leftAxisSeries: series, rightAxisSeries: [] };
  }

  // Multiple units - first unit on left, others on right
  const unitEntries = Array.from(unitGroups.entries());
  const leftAxisSeries = unitEntries[0][1];
  const rightAxisSeries = unitEntries.slice(1).flatMap(([, series]) => series);

  return { leftAxisSeries, rightAxisSeries };
}

/**
 * Apply unit conversions based on yAxisFormat and data characteristics
 * Returns conversion factor and adjusted label
 */
export function getUnitConversion(
  yAxisFormat: string | undefined,
  dataPoints: MetricDataPoint[]
): UnitConversion {
  // Calculate global min/max
  let globalMax = -Infinity;
  let globalMin = Infinity;
  dataPoints.forEach(point => {
    if (point.value > globalMax) globalMax = point.value;
    if (point.value < globalMin) globalMin = point.value;
  });

  if (!yAxisFormat || yAxisFormat === 'short' || yAxisFormat === 'none') {
    // For short/none format, provide intelligent default based on value range
    if (globalMax < 1) {
      return { factor: 1, label: 'Value (decimal)' };
    } else if (globalMax > 1000000) {
      return { factor: 1/1000000, label: 'Value (millions)' };
    } else if (globalMax > 1000) {
      return { factor: 1/1000, label: 'Value (thousands)' };
    }
    return { factor: 1, label: 'Value' };
  }

  // Percentage conversion
  if (yAxisFormat === 'percentunit') {
    return { factor: 100, label: 'Percentage (%)' };
  }

  // Seconds to milliseconds (if all values < 1)
  if (yAxisFormat === 's' && globalMax < 1) {
    return { factor: 1000, label: 'Time (ms)' };
  }

  if (yAxisFormat === 's') {
    return { factor: 1, label: 'Time (s)' };
  }

  // Milliseconds to seconds (if all values > 1000)
  if (yAxisFormat === 'ms' && globalMin > 1000) {
    return { factor: 1/1000, label: 'Time (s)' };
  }

  if (yAxisFormat === 'ms') {
    return { factor: 1, label: 'Time (ms)' };
  }

  // Bytes conversions
  if (yAxisFormat === 'bytes') {
    if (globalMax > 1073741824) { // > 1GB
      return { factor: 1/1073741824, label: 'Size (GB)' };
    } else if (globalMax > 1048576) { // > 1MB
      return { factor: 1/1048576, label: 'Size (MB)' };
    } else if (globalMax > 1024) { // > 1KB
      return { factor: 1/1024, label: 'Size (KB)' };
    }
    return { factor: 1, label: 'Size (bytes)' };
  }

  // Requests per second
  if (yAxisFormat === 'reqps' || yAxisFormat === 'rps') {
    return { factor: 1, label: 'Requests/sec' };
  }

  // Operations per second
  if (yAxisFormat === 'ops' || yAxisFormat === 'iops') {
    return { factor: 1, label: 'Operations/sec' };
  }

  // Default - no conversion, but provide readable label
  return { factor: 1, label: yAxisFormat };
}

/**
 * Format time for display on hover and tick labels
 */
export function formatTimeLabel(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Build sorted timestamps and index mapping from series data
 */
export function buildTimestampMapping(
  allSeries: SeriesConfig[],
  seriesData: Map<string, MetricDataPoint[]>
): { sortedTimestamps: string[]; timestampToIndex: Map<string, number> } {
  const allTimestamps = new Set<string>();

  allSeries.forEach((series) => {
    const data = seriesData.get(series.id);
    if (data && data.length > 0) {
      data.forEach(d => allTimestamps.add(d.time));
    }
  });

  const sortedTimestamps = Array.from(allTimestamps).sort((a, b) =>
    new Date(a).getTime() - new Date(b).getTime()
  );
  const timestampToIndex = new Map(sortedTimestamps.map((ts, idx) => [ts, idx]));

  return { sortedTimestamps, timestampToIndex };
}

/**
 * Calculate tick values and labels for x-axis
 */
export function calculateXAxisTicks(
  sortedTimestamps: string[],
  targetTicks = 10
): { tickValues: number[]; tickLabels: string[] } {
  const totalDataPoints = sortedTimestamps.length;
  const tickInterval = Math.max(1, Math.ceil(totalDataPoints / targetTicks));

  const tickValues: number[] = [];
  const tickLabels: string[] = [];

  for (let i = 0; i < totalDataPoints; i += tickInterval) {
    tickValues.push(i);
    tickLabels.push(formatTimeLabel(sortedTimestamps[i]));
  }

  // Always include the last timestamp if not already included
  const lastIndex = totalDataPoints - 1;
  if (tickValues[tickValues.length - 1] !== lastIndex && lastIndex >= 0) {
    tickValues.push(lastIndex);
    tickLabels.push(formatTimeLabel(sortedTimestamps[lastIndex]));
  }

  return { tickValues, tickLabels };
}

// Amber dashed boundary, matching the SLO and Compare charts so the ADAPT
// analysis window reads identically across every surface.
const ANALYSIS_BOUNDARY_COLOR = '#f59e0b';

/**
 * Analysis-window boundaries in sample-index space, derived from the test run's
 * `analysis_start_offset` / `analysis_end_offset` (seconds trimmed off the head and
 * tail). `startIndex` is the first in-window sample, `endIndex` the first excluded
 * trailing sample; `null` means that edge is not trimmed.
 */
export function calculateAnalysisWindowIndices(
  testRun: TestRun | null,
  sortedTimestamps: string[]
): { startIndex: number | null; endIndex: number | null } {
  const n = sortedTimestamps.length;
  if (!testRun || n === 0) return { startIndex: null, endIndex: null };

  const firstTime = new Date(sortedTimestamps[0]).getTime();
  const lastTime = new Date(sortedTimestamps[n - 1]).getTime();

  let startIndex: number | null = null;
  if (testRun.analysis_start_offset) {
    const boundary = firstTime + testRun.analysis_start_offset * 1000;
    const found = sortedTimestamps.findIndex(ts => new Date(ts).getTime() >= boundary);
    startIndex = found === -1 ? n - 1 : found;
  }

  let endIndex: number | null = null;
  if (testRun.analysis_end_offset) {
    const boundary = lastTime - testRun.analysis_end_offset * 1000;
    const found = sortedTimestamps.findIndex(ts => new Date(ts).getTime() > boundary);
    endIndex = found === -1 ? n - 1 : Math.max(startIndex ?? 0, found);
  }

  return { startIndex, endIndex };
}

/**
 * Dim the excluded leading/trailing regions and mark each boundary with an amber
 * dashed line. Mirrors `ComparisonPlot`'s overlay so both cards look the same.
 */
export function buildAnalysisWindowShapes(
  startIndex: number | null,
  endIndex: number | null,
  n: number,
  excludedColor: string
): Record<string, unknown>[] {
  const shapes: Record<string, unknown>[] = [];
  const dimRect = (x0: number, x1: number) => ({
    type: 'rect' as const, x0, x1, y0: 0, y1: 1, yref: 'paper' as const,
    line: { width: 0 }, fillcolor: excludedColor, layer: 'below' as const, opacity: 0.3,
  });
  const boundaryLine = (x: number) => ({
    type: 'line' as const, x0: x, x1: x, y0: 0, y1: 1, yref: 'paper' as const,
    line: { color: ANALYSIS_BOUNDARY_COLOR, width: 1.5, dash: 'dash' as const }, layer: 'below' as const,
  });
  if (startIndex !== null && startIndex > 0) {
    shapes.push(dimRect(0, startIndex), boundaryLine(startIndex));
  }
  if (endIndex !== null && endIndex < n - 1) {
    shapes.push(dimRect(endIndex, n - 1), boundaryLine(endIndex));
  }
  return shapes;
}

/**
 * Build a single trace for the chart
 */
export function buildTrace(
  series: SeriesConfig,
  data: MetricDataPoint[],
  isRightAxis: boolean,
  conversion: UnitConversion,
  color: string,
  bgColor: string,
  timestampToIndex: Map<string, number>
): PlotTrace {
  // Sort data by time to ensure proper line rendering
  const sortedData = [...data].sort((a, b) =>
    new Date(a.time).getTime() - new Date(b.time).getTime()
  );

  // Use sequential indices for X-axis
  const xValues = sortedData.map(d => timestampToIndex.get(d.time) as number);
  const yValues = sortedData.map(d => d.value * conversion.factor);

  return {
    x: xValues,
    y: yValues,
    type: 'scatter',
    mode: sortedData.length < 50 ? 'lines+markers' : 'lines',
    name: `${series.panelTitle} - ${series.metricName}`,
    line: {
      color,
      width: 2.5,
      shape: 'linear'
    },
    marker: {
      size: 4,
      color,
      line: {
        color: bgColor,
        width: 1
      }
    },
    yaxis: isRightAxis ? 'y2' : 'y',
    connectgaps: true,
    hovertemplate: `<b>${series.panelTitle}</b><br>` +
      `${series.metricName}<br>` +
      'Time: %{text}<br>' +
      'Value: %{y:.2f}<br>' +
      '<extra></extra>',
    text: sortedData.map(d => formatTimeLabel(d.time))
  };
}

/**
 * Build the Plotly layout configuration
 */
export function buildChartLayout(
  themeColors: ChartThemeColors,
  _chartName: string | undefined,
  leftConversion: UnitConversion,
  rightConversion: UnitConversion | null,
  tickValues: number[],
  tickLabels: string[],
  timestampCount: number,
  analysisStartIndex: number | null,
  analysisEndIndex: number | null,
  containerWidth: number
): Record<string, unknown> {
  const layout: Record<string, unknown> = {
    plot_bgcolor: themeColors.plotBgColor,
    paper_bgcolor: themeColors.bgColor,
    font: {
      color: themeColors.textColor,
      family: themeColors.fontFamily,
    },
    showlegend: true,
    legend: {
      x: 0.5,
      y: -0.2,
      xanchor: 'center',
      yanchor: 'top',
      orientation: 'h',
      bgcolor: 'rgba(0,0,0,0)',
      bordercolor: 'rgba(0,0,0,0)',
      font: {
        color: themeColors.textColor,
        size: 11
      }
    },
    xaxis: {
      title: {
        text: 'Time',
        font: {
          size: 12,
          color: themeColors.textSecondary
        }
      },
      tickvals: tickValues,
      ticktext: tickLabels,
      tickangle: -45,
      range: [0, timestampCount - 1],
      showgrid: true,
      showline: true,
      gridcolor: themeColors.gridColor,
      linecolor: themeColors.dividerColor,
      color: themeColors.textSecondary,
      tickfont: {
        size: 11,
        color: themeColors.textSecondary
      },
      ticks: '',
      zeroline: false,
      automargin: true,
    },
    yaxis: {
      title: {
        text: leftConversion.label,
        font: {
          size: 12,
          color: themeColors.textSecondary
        }
      },
      rangemode: 'tozero',
      showgrid: true,
      showline: true,
      gridcolor: themeColors.gridColor,
      linecolor: themeColors.dividerColor,
      color: themeColors.textSecondary,
      tickfont: {
        size: 11,
        color: themeColors.textSecondary
      },
      ticks: '',
      zeroline: true,
      zerolinecolor: themeColors.gridColor,
      zerolinewidth: 1,
      automargin: true,
      nticks: 5
    },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: themeColors.hoverBgColor,
      bordercolor: themeColors.dividerColor,
      font: {
        color: themeColors.textColor,
        size: 12,
        family: PLOTLY_HOVER_FONT_FAMILY
      },
      align: 'left',
    },
    margin: { t: 50, b: 100, l: 60, r: rightConversion ? 60 : 20 },
    width: containerWidth,
    height: 500,
    shapes: buildAnalysisWindowShapes(
      analysisStartIndex,
      analysisEndIndex,
      timestampCount,
      themeColors.gridColor
    )
  };

  // Add right Y-axis if needed
  if (rightConversion) {
    layout.yaxis2 = {
      title: {
        text: rightConversion.label,
        font: {
          size: 12,
          color: themeColors.textSecondary
        }
      },
      rangemode: 'tozero',
      overlaying: 'y',
      side: 'right',
      showgrid: false,
      showline: true,
      linecolor: themeColors.dividerColor,
      color: themeColors.textSecondary,
      tickfont: {
        size: 11,
        color: themeColors.textSecondary
      },
      ticks: '',
      zeroline: false,
      automargin: true,
      nticks: 5
    };
  }

  return layout;
}

/**
 * Plotly renders an export from the live layout, which no longer carries a title —
 * the editable heading above the chart is the on-screen title now. An exported PNG
 * is a different context: once it leaves the app nothing else names it, so the title
 * goes back on for the image only. `toImage` accepts a figure object as well as a
 * graph div, so building one here never touches what is on screen.
 *
 * The layout already reserves `margin.t: 50`, so the title has room without shifting
 * the plot area between the on-screen and exported versions.
 */
function buildExportFigure(gd: unknown, chartName: string | undefined) {
  const graph = gd as { data?: unknown[]; layout?: Record<string, unknown> };
  const layout = graph.layout ?? {};
  const font = (layout.font ?? {}) as { color?: string; family?: string };

  return {
    data: graph.data ?? [],
    layout: {
      ...layout,
      title: {
        text: chartName || 'Custom Metrics Chart',
        font: { color: font.color, size: 16, family: font.family },
        x: 0.5,
        xanchor: 'center',
        y: 0.95,
        yanchor: 'top'
      }
    }
  };
}

/** Filename shared by every export path, so a PNG is named the same however it was saved. */
function exportFilename(chartName: string | undefined): string {
  return chartName ? chartName.toLowerCase().replace(/\s+/g, '_') : 'custom_metrics_chart';
}

/** Trigger a browser download for an already-rendered blob. */
function downloadBlob(blob: Blob | null, chartName: string | undefined): void {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFilename(chartName) + '.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Convert Plotly's data-URL output into a Blob. */
function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mime = parts[0]!.match(/:(.*?);/)?.[1] || 'image/png';
  const raw = atob(parts[1]!);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return new Blob([arr], { type: mime });
}

/** Last resort when both the export and its fallback fail, so it is never silent. */
function warnExportFailed(err: unknown): void {
  console.warn('[chart-export] could not export the chart image', err);
}

/** Render the chart to a PNG blob with the export title applied. */
function renderExportPng(
  gd: unknown,
  chartName: string | undefined,
  size: { width: number; height: number }
): Promise<Blob> {
  // Deferred so a missing window.Plotly rejects rather than throwing synchronously
  // out of the modebar click handler. clipboard.write still gets its promise inline.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Promise.resolve().then(() => (window as any).Plotly
    .toImage(buildExportFigure(gd, chartName), { format: 'png', ...size, scale: 2 })
    .then(dataUrlToBlob));
}

/**
 * Build the Plotly config with copy to clipboard functionality
 */
export function buildChartConfig(chartName: string | undefined): Record<string, unknown> {
  const plotSize = (gd: unknown) => {
    const full = (gd as { _fullLayout?: { width?: number; height?: number } })._fullLayout;
    return { width: full?.width || 1200, height: full?.height || 600 };
  };

  return {
    displayModeBar: true,
    // 'toImage' is removed and replaced below: the built-in download renders the live
    // layout, which deliberately has no title, so its PNG would come out unlabelled.
    modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d', 'autoScale2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d', 'toImage'],
    displaylogo: false,
    responsive: true,
    toImageButtonOptions: {
      format: 'png',
      filename: exportFilename(chartName),
      height: 600,
      width: 1200,
      scale: 2
    },
    modeBarButtonsToAdd: [
      {
        name: 'Download as PNG',
        icon: {
          width: 1000,
          height: 1000,
          path: 'm500 450c-83 0-150-67-150-150 0-83 67-150 150-150 83 0 150 67 150 150 0 83-67 150-150 150z m400 150h-120c-16 0-34 13-39 29l-31 93c-6 15-23 28-40 28h-340c-16 0-34-13-39-28l-31-94c-6-15-23-28-40-28h-120c-55 0-100-45-100-100v-450c0-55 45-100 100-100h800c55 0 100 45 100 100v450c0 55-45 100-100 100z m-400-550c-138 0-250 112-250 250 0 138 112 250 250 250 138 0 250-112 250-250 0-138-112-250-250-250z m365 380c-19 0-35 16-35 35 0 19 16 35 35 35 19 0 35-16 35-35 0-19-16-35-35-35z',
          transform: 'matrix(1 0 0 -1 0 850)'
        },
        click: function(gd: unknown) {
          renderExportPng(gd, chartName, { width: 1200, height: 600 })
            .then((blob) => downloadBlob(blob, chartName))
            .catch(() => {
              // Fall back to Plotly's own download so the button is never a dead end.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return (window as any).Plotly.downloadImage(gd, {
                format: 'png',
                filename: exportFilename(chartName),
                width: 1200,
                height: 600,
                scale: 2
              });
            })
            // Both paths can fail (Plotly absent, toImage throwing). Without this the
            // second rejection is unhandled and the button silently does nothing.
            .catch(warnExportFailed);
        }
      },
      {
        name: 'Copy to Clipboard',
        icon: {
          width: 1792,
          height: 1792,
          path: 'M768 1664h896v-640h-416q-40 0-68-28t-28-68v-416h-384v1152zm256-1440v-64q0-13-9.5-22.5t-22.5-9.5h-704q-13 0-22.5 9.5t-9.5 22.5v64q0 13 9.5 22.5t22.5 9.5h704q13 0 22.5-9.5t9.5-22.5zm256 672h299l-299-299v299zm512 128v672q0 40-28 68t-68 28h-960q-40 0-68-28t-28-68v-160h-544q-40 0-68-28t-28-68v-1344q0-40 28-68t68-28h1088q40 0 68 28t28 68v328q21 13 36 28l408 408q28 28 48 76t20 88z',
          transform: 'scale(0.8)'
        },
        click: function(gd: unknown) {
          const blobPromise = renderExportPng(gd, chartName, plotSize(gd));
          // If renderExportPng rejected, blobPromise is ALREADY rejected here — the
          // fallback must carry its own .catch or the second rejection is unhandled.
          const fallbackToDownload = () =>
            blobPromise.then((blob) => downloadBlob(blob, chartName)).catch(warnExportFailed);

          // clipboard.write must be called synchronously with the Promise<Blob> to
          // keep the user-activation context, otherwise the browser treats it as a
          // download instead.
          if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
            navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blobPromise })
            ]).catch(fallbackToDownload);
          } else {
            fallbackToDownload();
          }
        }
      }
    ]
  };
}
