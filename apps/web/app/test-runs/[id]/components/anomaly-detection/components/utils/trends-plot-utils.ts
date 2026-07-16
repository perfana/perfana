import { Theme } from '@mui/material/styles';
import { MetricTrendData } from '../../types';
import { TrendsPlotData } from '../types';
import { PLOTLY_HOVER_FONT_FAMILY } from '@/lib/plotly-fonts';

/**
 * Create a Plotly trends plot for anomaly detection
 */
export function createTrendsPlot(
  data: MetricTrendData[],
  rowKey: string,
  metricName: string,
  theme: Theme,
  showToast?: (message: string) => void,
  unit?: string,
  selectedTestRunIdForRow?: string,
  currentTestRunId?: string
): TrendsPlotData {
  if (!data || data.length === 0) return { plotData: [], plotLayout: {}, plotConfig: {} };

  const isDark = theme.palette.mode === 'dark';

  // Sort by test run start time
  const sortedData = [...data].sort((a, b) =>
    new Date(a.test_run_start).getTime() - new Date(b.test_run_start).getTime()
  );

  // Find global min/max for unit conversion logic (same as SLO graph)
  let globalMaxDataPoint: number | undefined;
  let globalMinDataPoint: number | undefined;

  sortedData.forEach(dataPoint => {
    if (dataPoint.mean !== undefined && dataPoint.mean !== null) {
      if (globalMaxDataPoint === undefined || dataPoint.mean > globalMaxDataPoint) {
        globalMaxDataPoint = dataPoint.mean;
      }
      if (globalMinDataPoint === undefined || dataPoint.mean < globalMinDataPoint) {
        globalMinDataPoint = dataPoint.mean;
      }
    }
  });

  // Unit conversion logic from SLO graph
  let conversionFactor = 1;
  let yAxisLabel = 'Value';
  let unitSuffix = '';

  // If unit is 'percentunit' convert to percentage
  if (unit === 'percentunit') {
    conversionFactor = 100;
    yAxisLabel = 'Percentage (%)';
    unitSuffix = '%';
  }
  // If unit is 'seconds' and all data points are under 1, convert to 'ms'
  else if (unit === 's' && globalMaxDataPoint && globalMaxDataPoint < 1) {
    conversionFactor = 1000;
    yAxisLabel = 'Time (ms)';
    unitSuffix = ' ms';
  }
  // If unit is 'ms' and all data points are over 1000, convert to 'sec'
  else if (unit === 'ms' && globalMinDataPoint && globalMinDataPoint > 1000) {
    conversionFactor = 1/1000;
    yAxisLabel = 'Time (s)';
    unitSuffix = ' s';
  } else if (unit === 's') {
    yAxisLabel = 'Time (s)';
    unitSuffix = ' s';
  } else if (unit === 'ms') {
    yAxisLabel = 'Time (ms)';
    unitSuffix = ' ms';
  } else if (unit) {
    unitSuffix = ` ${unit}`;
  }

  // Create traces with color coding based on conclusion_label
  const traces: unknown[] = [];

  // Create a single connected trace with conditional marker colors
  if (sortedData.length > 0) {
    // Create marker colors, sizes, and symbols based on conclusion and selection state
    const markerColors = sortedData.map(point => {
      // Selected point gets orange color (or current test run if no selection)
      const displayedTestRunId = selectedTestRunIdForRow || currentTestRunId;
      if (point.test_run_id === displayedTestRunId) {
        return '#ff9800'; // Orange for selected/current
      }
      // Default colors based on conclusion
      return point.conclusion_label === 'regression' ? '#d32f2f' : '#1976d2';
    });

    const markerSizes = sortedData.map(point => {
      // Selected or current test run gets larger marker
      const displayedTestRunId = selectedTestRunIdForRow || currentTestRunId;
      if (point.test_run_id === displayedTestRunId) {
        return 18; // Increased from 14 to 18 for better visibility
      }
      return 10;
    });

    const markerSymbols = sortedData.map(point => {
      // Selected or current test run gets a star
      const displayedTestRunId = selectedTestRunIdForRow || currentTestRunId;
      if (point.test_run_id === displayedTestRunId) {
        return 'star';
      }
      // Default symbols based on conclusion
      return point.conclusion_label === 'regression' ? 'x' : 'circle';
    });

    const mainTrace = {
      x: sortedData.map((_, index) => index),
      y: sortedData.map(point => point.mean * conversionFactor),
      type: 'scatter' as const,
      mode: 'lines+markers' as const,
      name: 'Trends',
      showlegend: false,
      customdata: sortedData.map(point => {
        const formattedDate = new Date(point.test_run_start).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        return {
          testRunId: point.test_run_id,
          datetime: formattedDate,
          version: point.version,
          annotations: point.annotations,
          versionLine: point.version ? `Version: ${point.version}<br>` : '',
          annotationsLine: point.annotations ? `Annotations: ${point.annotations}<br>` : '',
          formattedValue: (point.mean * conversionFactor).toFixed(2),
          conclusion: point.conclusion_label
        };
      }),
      // Build a per-point hovertemplate so every <br> stays literal in the template
      // (Plotly renders literal <br> as line breaks, but escapes them inside %{customdata.*}
      // substitutions). Mirrors the working test-run-details graph hover implementation.
      hovertemplate: sortedData.map(point => {
        // Escape user-authored values before interpolating — Plotly renders the
        // hovertemplate as pseudo-HTML, so raw <, >, & could be read as markup.
        const esc = (v: unknown) => String(v ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
        const formattedDate = new Date(point.test_run_start).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        const value = (point.mean * conversionFactor).toFixed(2);
        const versionLine = point.version ? `Version: ${esc(point.version)}<br>` : '';
        const annotationsLine = point.annotations ? `Annotations: ${esc(point.annotations)}<br>` : '';
        return `<b>Trends</b><br>` +
          `Test Run: ${esc(point.test_run_id)}<br>` +
          `Time: ${formattedDate}<br>` +
          `Value: ${value}${unitSuffix}<br>` +
          `Conclusion: ${esc(point.conclusion_label)}<br>` +
          versionLine +
          annotationsLine +
          '<extra></extra>';
      }),
      marker: {
        size: markerSizes,
        color: markerColors,
        symbol: markerSymbols,
        line: {
          width: 2,
          color: isDark ? '#1e293b' : '#ffffff'
        }
      },
      line: { width: 2, color: '#1976d2' }
    };

    traces.push(mainTrace);
  }

  // Add dynamic threshold ribbons that change per test run
  const xValues = sortedData.map((_, index) => index);

  // Extract threshold data for each test run
  const lowerThresholds = sortedData.map(point =>
    point.thresholds?.lower?.overall !== null && point.thresholds?.lower?.overall !== undefined
      ? point.thresholds.lower.overall * conversionFactor
      : null
  );

  const upperThresholds = sortedData.map(point =>
    point.thresholds?.upper?.overall !== null && point.thresholds?.upper?.overall !== undefined
      ? point.thresholds.upper.overall * conversionFactor
      : null
  );

  // Check if we have any threshold data
  const hasLowerThresholds = lowerThresholds.some(val => val !== null);
  const hasUpperThresholds = upperThresholds.some(val => val !== null);

  if (hasLowerThresholds || hasUpperThresholds) {
    // Add lower threshold line (dynamic)
    if (hasLowerThresholds) {
      traces.push({
        x: xValues,
        y: lowerThresholds,
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Lower Threshold',
        line: { color: 'rgba(76, 175, 80, 0.7)', width: 1, dash: 'dash' },
        hoverinfo: 'skip' as const,
        showlegend: false,
        connectgaps: false // Don't connect gaps where thresholds are null
      });
    }

    // Add upper threshold line (dynamic)
    if (hasUpperThresholds) {
      traces.push({
        x: xValues,
        y: upperThresholds,
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Upper Threshold',
        line: { color: 'rgba(76, 175, 80, 0.7)', width: 1, dash: 'dash' },
        hoverinfo: 'skip' as const,
        showlegend: false,
        connectgaps: false // Don't connect gaps where thresholds are null
      });

      // Add filled area between dynamic thresholds if both exist
      if (hasLowerThresholds) {
        // Create filled area using segments where both thresholds exist
        const validSegments: { x: number[]; yUpper: number[]; yLower: number[] }[] = [];
        let currentSegment: { x: number[]; yUpper: number[]; yLower: number[] } | null = null;

        for (let i = 0; i < sortedData.length; i++) {
          const lowerVal = lowerThresholds[i];
          const upperVal = upperThresholds[i];

          if (lowerVal !== null && upperVal !== null) {
            if (!currentSegment) {
              currentSegment = { x: [i], yUpper: [upperVal], yLower: [lowerVal] };
            } else {
              currentSegment.x.push(i);
              currentSegment.yUpper.push(upperVal);
              currentSegment.yLower.push(lowerVal);
            }
          } else {
            if (currentSegment) {
              validSegments.push(currentSegment);
              currentSegment = null;
            }
          }
        }

        // Push the last segment if it exists
        if (currentSegment) {
          validSegments.push(currentSegment);
        }

        // Create filled areas for each valid segment
        validSegments.forEach((segment, index) => {
          if (segment.x.length >= 2) {
            traces.push({
              x: [...segment.x, ...segment.x.slice().reverse()],
              y: [...segment.yUpper, ...segment.yLower.slice().reverse()],
              type: 'scatter' as const,
              mode: 'none' as const,
              fill: 'toself' as const,
              fillcolor: 'rgba(144, 238, 144, 0.2)',
              name: `Threshold Range ${index + 1}`,
              hoverinfo: 'skip' as const,
              showlegend: false
            });
          }
        });
      }
    }
  }

  // Create x-axis labels
  const xAxisLabels = sortedData.map(point => {
    const date = new Date(point.test_run_start);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  });

  const textColor = theme.palette.text.primary;
  const textSecondary = theme.palette.text.secondary;
  const paperBgColor = isDark ? '#1e293b' : theme.palette.background.paper;
  const bgColor = isDark ? '#121212' : paperBgColor;
  const plotBgColor = isDark ? '#1e1e1e' : theme.palette.grey[50];
  const gridColor = isDark ? 'rgba(255,255,255,0.12)' : '#e0e0e0';

  const layout = {
    title: {
      text: metricName || 'Metric',
      font: {
        color: textColor,
        size: 14,
        family: theme.typography.fontFamily
      },
      x: 0.5,
      xanchor: 'center' as const,
      y: 0.95,
      yanchor: 'top' as const
    },
    xaxis: {
      title: {
        text: 'Time',
        font: {
          size: 11,
          color: textSecondary
        }
      },
      tickvals: sortedData.map((_, index) => index),
      ticktext: xAxisLabels,
      tickangle: -45,
      showgrid: true,
      showline: true,
      gridcolor: gridColor,
      linecolor: theme.palette.divider,
      color: textSecondary,
      tickfont: {
        size: 10,
        color: textSecondary
      },
      ticks: '',
      zeroline: true,
      zerolinecolor: gridColor,
      zerolinewidth: 1,
      automargin: true
    },
    yaxis: {
      title: {
        text: yAxisLabel,
        font: {
          size: 11,
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
        size: 10,
        color: textSecondary
      },
      ticks: '',
      zeroline: true,
      zerolinecolor: gridColor,
      zerolinewidth: 1,
      automargin: true,
      nticks: 5
    },
    hovermode: 'closest' as const, // Changed from 'x unified' to allow better click detection
    hoverlabel: {
      bgcolor: paperBgColor,
      bordercolor: theme.palette.divider,
      font: {
        color: textColor,
        size: 11,
        family: PLOTLY_HOVER_FONT_FAMILY
      },
      align: 'left' as const,
    },
    showlegend: false,
    height: 400,
    margin: { l: 50, r: 20, t: 40, b: 80 },
    plot_bgcolor: plotBgColor,
    paper_bgcolor: bgColor,
    font: {
      color: textColor,
      family: theme.typography.fontFamily
    }
  };

  const config: Record<string, unknown> = {
    responsive: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d', 'autoScale2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d'],
    displaylogo: false,
    staticPlot: false, // Enable interactivity
    scrollZoom: false, // Disable scroll zoom to prevent conflicts with clicks
    toImageButtonOptions: {
      format: 'png' as const,
      filename: `${sortedData[0]?.panel_title || 'trends'}_control_group`,
      height: 400,
      width: 1200,
      scale: 2
    },
    modeBarButtonsToAdd: showToast ? [
      createCopyToClipboardButton(showToast)
    ] : []
  };

  return { plotData: traces, plotLayout: layout, plotConfig: config };
}

/**
 * Create the copy to clipboard button for Plotly mode bar
 */
function createCopyToClipboardButton(showToast: (message: string) => void) {
  return {
    name: 'Copy to Clipboard',
    icon: {
      width: 1792,
      height: 1792,
      path: 'M768 1664h896v-640h-416q-40 0-68-28t-28-68v-416h-384v1152zm256-1440v-64q0-13-9.5-22.5t-22.5-9.5h-704q-13 0-22.5 9.5t-9.5 22.5v64q0 13 9.5 22.5t22.5 9.5h704q13 0 22.5-9.5t9.5-22.5zm256 672h299l-299-299v299zm512 128v672q0 40-28 68t-68 28h-960q-40 0-68-28t-28-68v-160h-544q-40 0-68-28t-28-68v-1344q0-40 28-68t68-28h1088q40 0 68 28t28 68v328q21 13 36 28l408 408q28 28 48 76t20 88z',
      transform: 'scale(0.8)'
    },
    click: function(gd: unknown) {
      console.log('Navigator clipboard support:', !!navigator.clipboard);
      console.log('Clipboard write support:', navigator.clipboard && 'write' in navigator.clipboard);
      console.log('ClipboardItem support:', typeof ClipboardItem !== 'undefined');

      // Convert plot to PNG and copy to clipboard
      type PlotlyGd = { _fullLayout?: { width?: number; height?: number } };
      const plotlyWindow = window as { Plotly?: { toImage: (gd: unknown, opts: Record<string, unknown>) => Promise<string> } };
      plotlyWindow.Plotly!.toImage(gd, {
        format: 'png',
        width: (gd as PlotlyGd)._fullLayout?.width || 800,
        height: (gd as PlotlyGd)._fullLayout?.height || 400,
        scale: 2
      }).then((dataUrl: string) => {
        console.log('Successfully generated image data URL, length:', dataUrl.length);

        // Method 1: Try modern Clipboard API with blob
        if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
          console.log('Attempting modern Clipboard API with blob...');

          fetch(dataUrl)
            .then(res => {
              console.log('Fetch response ok:', res.ok);
              return res.blob();
            })
            .then(blob => {
              console.log('Created blob, size:', blob.size, 'type:', blob.type);

              return navigator.clipboard.write([
                new ClipboardItem({
                  'image/png': blob
                })
              ]);
            })
            .then(() => {
              console.log('Successfully copied image to clipboard via modern API');
              showToast('Graph copied to clipboard');
            })
            .catch((err: Error) => {
              console.error('Modern clipboard API failed:', err);
              // Fallback to text method
              tryTextFallback(dataUrl, showToast);
            });
        } else {
          console.log('Modern Clipboard API not supported, trying fallback...');
          tryTextFallback(dataUrl, showToast);
        }
      }).catch((err: Error) => {
        console.error('Failed to generate image:', err);
        showToast('Failed to generate graph image');
      });
    }
  };
}

/**
 * Fallback method: Copy data URL as text
 */
function tryTextFallback(dataUrl: string, showToast: (message: string) => void) {
  console.log('Attempting text fallback...');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(dataUrl)
      .then(() => {
        console.log('Successfully copied data URL as text');
        showToast('Graph data URL copied to clipboard (paste into image editor)');
      })
      .catch((err: Error) => {
        console.error('Text clipboard failed:', err);
        // Final fallback: Manual copy instructions
        showFinalFallback(dataUrl, showToast);
      });
  } else {
    console.log('No clipboard API available, showing final fallback...');
    showFinalFallback(dataUrl, showToast);
  }
}

/**
 * Final fallback: Show instructions to user
 */
function showFinalFallback(dataUrl: string, showToast: (message: string) => void) {
  console.log('Using final fallback method...');
  // Create a temporary text area to select the data URL
  const textarea = document.createElement('textarea');
  textarea.value = dataUrl;
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const successful = document.execCommand('copy');
    if (successful) {
      console.log('Successfully copied via document.execCommand');
      showToast('Graph data URL copied to clipboard (paste into image editor)');
    } else {
      console.log('document.execCommand failed');
      showToast('Please right-click the graph and select "Save image as..."');
    }
  } catch (err) {
    console.error('document.execCommand failed:', err);
    showToast('Please right-click the graph and select "Save image as..."');
  }

  document.body.removeChild(textarea);
}
