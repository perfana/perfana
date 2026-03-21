import { formatValueWithUnit } from '@/lib/units';
import { ChartDataPoint, PlotData, RawChartData } from '../types';

/**
 * Process raw chart data from API into Plotly trace format
 */
export function processTrackedRegressionData(data: RawChartData, isDarkMode = false): PlotData[] {
  const controlGroup: Array<ChartDataPoint & { x: number }> = [];
  const introducedRegression: Array<ChartDataPoint & { x: number }> = [];
  const subsequentRuns: Array<ChartDataPoint & { x: number }> = [];

  data.testRuns.forEach((point: ChartDataPoint, index: number) => {
    const plotPoint = { x: index, ...point };

    if (point.isControlGroup) {
      controlGroup.push(plotPoint);
    } else if (point.isSourceTestRun) {
      introducedRegression.push(plotPoint);
    } else {
      subsequentRuns.push(plotPoint);
    }
  });

  return [
    createControlGroupTrace(controlGroup, isDarkMode),
    createRegressionIntroducedTrace(introducedRegression, isDarkMode),
    createSubsequentRunsTrace(subsequentRuns, isDarkMode),
  ];
}

/**
 * Create trace for control group (baseline) data points
 */
function createControlGroupTrace(points: Array<ChartDataPoint & { x: number }>, isDarkMode: boolean): PlotData {
  return {
    name: 'Control Group (Baseline)',
    x: points.map(p => p.x),
    y: points.map(p => p.value),
    type: 'scatter',
    mode: 'markers',
    marker: {
      symbol: 'square',
      size: 8,
      color: 'rgb(77, 89, 231)',
      line: { color: isDarkMode ? '#1e293b' : 'white', width: 1 }
    },
    hovertemplate: '%{text}<extra></extra>',
    text: points.map(p =>
      `Test Run: ${p.testRunId}<br>` +
      `Value: ${formatValueWithUnit(p.value, p.unit || '')}<br>` +
      `Date: ${new Date(p.date).toLocaleDateString()}<br>` +
      `Status: Control Group`
    )
  };
}

/**
 * Create trace for the test run where regression was first introduced
 */
function createRegressionIntroducedTrace(points: Array<ChartDataPoint & { x: number }>, isDarkMode: boolean): PlotData {
  return {
    name: 'Regression Introduced',
    x: points.map(p => p.x),
    y: points.map(p => p.value),
    type: 'scatter',
    mode: 'markers',
    marker: {
      symbol: 'x',
      size: 12,
      color: 'rgb(222, 45, 38)',
      line: { color: isDarkMode ? '#1e293b' : 'white', width: 2 }
    },
    hovertemplate: '%{text}<extra></extra>',
    text: points.map(p =>
      `Test Run: ${p.testRunId}<br>` +
      `Value: ${formatValueWithUnit(p.value, p.unit || '')}<br>` +
      `Date: ${new Date(p.date).toLocaleDateString()}<br>` +
      `Status: Regression Detected<br>` +
      `Change: ${(p.percentageChange ?? 0) > 0 ? '+' : ''}${(p.percentageChange ?? 0).toFixed(1)}%`
    )
  };
}

/**
 * Create trace for test runs after regression was introduced
 */
function createSubsequentRunsTrace(points: Array<ChartDataPoint & { x: number }>, isDarkMode: boolean): PlotData {
  return {
    name: 'Subsequent Test Runs',
    x: points.map(p => p.x),
    y: points.map(p => p.value),
    type: 'scatter',
    mode: 'markers',
    marker: {
      symbol: 'triangle-up',
      size: 8,
      color: points.map(p =>
        p.hasRegression ? 'rgb(222, 45, 38)' : 'rgb(77, 89, 231)'
      ),
      line: { color: isDarkMode ? '#1e293b' : 'white', width: 1 }
    },
    hovertemplate: '%{text}<extra></extra>',
    text: points.map(p =>
      `Test Run: ${p.testRunId}<br>` +
      `Value: ${formatValueWithUnit(p.value, p.unit || '')}<br>` +
      `Date: ${new Date(p.date).toLocaleDateString()}<br>` +
      `Status: ${p.hasRegression ? 'Regression Still Present' : 'Normal'}`
    )
  };
}

/**
 * Create Plotly layout configuration for regression timeline chart
 */
export function createChartLayout(metricName: string, unit: string, isDarkMode = false) {
  const textColor = isDarkMode ? '#e0e0e0' : '#333';
  const textSecondary = isDarkMode ? '#aaa' : 'gray';
  const gridColor = isDarkMode ? 'rgba(255,255,255,0.12)' : 'rgba(128,128,128,0.2)';
  const bgColor = isDarkMode ? 'transparent' : '#ffffff';
  const plotBgColor = isDarkMode ? 'transparent' : '#ffffff';

  return {
    title: {
      text: `Performance Trend: ${metricName}`,
      font: { size: 14, color: textColor }
    },
    xaxis: {
      title: { text: 'Test Run Sequence', font: { color: textSecondary } },
      showgrid: true,
      gridcolor: gridColor,
      color: textSecondary,
      tickfont: { color: textSecondary },
    },
    yaxis: {
      title: { text: `Value (${unit})`, font: { color: textSecondary } },
      showgrid: true,
      gridcolor: gridColor,
      color: textSecondary,
      tickfont: { color: textSecondary },
    },
    height: 350,
    hovermode: 'closest' as const,
    showlegend: true,
    legend: {
      orientation: 'h' as const,
      y: -0.3,
      font: { size: 10, color: textSecondary }
    },
    plot_bgcolor: plotBgColor,
    paper_bgcolor: bgColor,
    font: {
      color: textColor,
    },
    annotations: [
      {
        x: 0.02,
        y: 0.98,
        xref: 'paper' as const,
        yref: 'paper' as const,
        text: 'Hover over points for details',
        showarrow: false,
        font: { size: 10, color: textSecondary }
      }
    ]
  };
}

/**
 * Create Plotly config for chart interactions
 */
export function createChartConfig() {
  return {
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d'] as const
  };
}
