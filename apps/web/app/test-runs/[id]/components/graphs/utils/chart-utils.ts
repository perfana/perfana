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

/**
 * Calculate ramp-up end index based on test run ramp_up duration
 */
export function calculateRampUpEndIndex(
  testRun: TestRun | null,
  sortedTimestamps: string[]
): number {
  if (!testRun?.analysis_start_offset || sortedTimestamps.length === 0) {
    return 0;
  }

  const testStartTime = new Date(sortedTimestamps[0]).getTime();
  const rampUpEndTime = testStartTime + (testRun.analysis_start_offset * 1000); // Convert seconds to ms

  // Find the index of the first timestamp after ramp-up period
  const rampUpEndIndex = sortedTimestamps.findIndex(ts =>
    new Date(ts).getTime() >= rampUpEndTime
  );

  // If not found, it means ramp-up extends beyond all data
  return rampUpEndIndex === -1 ? sortedTimestamps.length - 1 : rampUpEndIndex;
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
  chartName: string | undefined,
  leftConversion: UnitConversion,
  rightConversion: UnitConversion | null,
  tickValues: number[],
  tickLabels: string[],
  timestampCount: number,
  rampUpEndIndex: number,
  hasRampUp: boolean,
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
    title: {
      text: chartName || 'Custom Metrics Chart',
      font: {
        color: themeColors.textColor,
        size: 16,
        family: themeColors.fontFamily
      },
      x: 0.5,
      xanchor: 'center',
      y: 0.95,
      yanchor: 'top'
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
    shapes: hasRampUp && rampUpEndIndex > 0 ? [{
      type: 'rect',
      x0: 0,
      y0: 0,
      x1: rampUpEndIndex,
      y1: 1,
      yref: 'paper',
      line: { width: 0 },
      fillcolor: themeColors.gridColor,
      layer: 'below',
      opacity: 0.15
    }] : []
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
 * Build the Plotly config with copy to clipboard functionality
 */
export function buildChartConfig(chartName: string | undefined): Record<string, unknown> {
  return {
    displayModeBar: true,
    modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d', 'autoScale2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d'],
    displaylogo: false,
    responsive: true,
    toImageButtonOptions: {
      format: 'png',
      filename: chartName ? chartName.toLowerCase().replace(/\s+/g, '_') : 'custom_metrics_chart',
      height: 600,
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
        click: function(gd: unknown) {
          const plotlyGd = gd as { _fullLayout?: { width?: number; height?: number } };
          // Build a blob promise from Plotly's toImage
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const blobPromise = (window as any).Plotly.toImage(gd, {
            format: 'png',
            width: plotlyGd._fullLayout?.width || 1200,
            height: plotlyGd._fullLayout?.height || 600,
            scale: 2
          }).then((dataUrl: string) => {
            // Convert data URL to blob synchronously via atob
            const parts = dataUrl.split(',');
            const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
            const raw = atob(parts[1]);
            const arr = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) {
              arr[i] = raw.charCodeAt(i);
            }
            return new Blob([arr], { type: mime });
          });

          // Call clipboard.write synchronously with a Promise<Blob> to
          // preserve the user-activation context (avoids triggering download)
          if (navigator.clipboard && 'write' in navigator.clipboard) {
            navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blobPromise })
            ]).catch(() => {
              // Fallback to download if clipboard write fails
              blobPromise.then(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = chartName ? chartName.toLowerCase().replace(/\s+/g, '_') + '.png' : 'custom_metrics_chart.png';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              });
            });
          } else {
            // No clipboard API available, download directly
            blobPromise.then(blob => {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = chartName ? chartName.toLowerCase().replace(/\s+/g, '_') + '.png' : 'custom_metrics_chart.png';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            });
          }
        }
      }
    ]
  };
}
