import { formatValueWithUnit } from '@/lib/units';
import { MetricTrendData, ConfigSourceInfo, ThresholdData } from './types';

// Data formatting functions
export const formatNumber = (value: any): string => {
  if (value === null || value === undefined || value === '' || isNaN(Number(value))) {
    return '-';
  }

  const numValue = Number(value);
  if (numValue === 0) {
    return '0';
  }
  if (Math.abs(numValue) < 0.01) {
    return parseFloat(numValue.toFixed(5)).toString();
  }
  const roundedToTwoDecimals = Math.round(numValue * 100) / 100;
  if (roundedToTwoDecimals === 0) {
    return numValue.toFixed(5).toString();
  } else if (Math.floor(roundedToTwoDecimals) === roundedToTwoDecimals) {
    return numValue.toFixed(0);
  } else {
    return numValue.toFixed(2).toString();
  }
};

export const formatDifference = (
  testValue: string,
  controlValue: string,
  rawDifference: string | null,
  unit: string | null
): string => {
  if (!testValue || !controlValue || !rawDifference) {
    return '-';
  }

  const test = parseFloat(testValue);
  const control = parseFloat(controlValue);
  const diff = parseFloat(rawDifference);

  if (isNaN(test) || isNaN(control) || isNaN(diff) || control === 0) {
    return rawDifference;
  }

  const percentageChange = ((test - control) / Math.abs(control)) * 100;
  const sign = diff > 0 ? '+' : '';
  const formattedDiffWithUnit = formatValueWithUnit(Math.abs(diff), unit || undefined);
  const formattedPercentage = formatNumber(Math.abs(percentageChange));

  return `${sign}${formattedDiffWithUnit} (${formattedPercentage}%)`;
};

// Color mapping functions
export const getConclusionColor = (conclusion: string): string => {
  switch (conclusion.toLowerCase()) {
    case 'regression':
      return 'error';
    case 'improvement':
      return 'success';
    case 'increase':
      return 'warning';
    case 'decrease':
      return 'info';
    case 'no difference':
      return 'default';
    case 'incomparable':
      return 'warning';
    default:
      return 'default';
  }
};

export const getClassificationDisplayInfo = (classification: string): {
  label: string;
  color: 'error' | 'warning' | 'primary' | 'info' | 'secondary' | 'default'
} => {
  const normalizedClassification = classification?.toLowerCase();
  switch (normalizedClassification) {
    case 'red_duration':
      return { label: 'RED Duration', color: 'error' as const };
    case 'red_rate':
      return { label: 'RED Rate', color: 'error' as const };
    case 'red_errors':
      return { label: 'RED Errors', color: 'error' as const };
    case 'use_saturation':
      return { label: 'USE Saturation', color: 'warning' as const };
    case 'use_utilization':
      return { label: 'USE Utilization', color: 'warning' as const };
    case 'use_errors':
      return { label: 'USE Errors', color: 'warning' as const };
    case 'business_metric':
      return { label: 'Business Metric', color: 'primary' as const };
    case 'infrastructure_metric':
      return { label: 'Infrastructure Metric', color: 'info' as const };
    case 'application_metric':
      return { label: 'Application Metric', color: 'secondary' as const };
    case 'custom':
      return { label: 'Custom', color: 'default' as const };
    case 'unclassified':
    default:
      return { label: 'Unclassified', color: 'default' as const };
  }
};

// Configuration helpers
export const getConfigSourceInfo = (configSource?: string): ConfigSourceInfo => {
  switch (configSource) {
    case 'metric-specific':
      return { label: 'Metric-Specific', color: 'primary' as const, description: 'Configuration specific to this metric' };
    case 'panel-level':
      return { label: 'Panel-Level', color: 'secondary' as const, description: 'Configuration inherited from panel settings' };
    default:
      return { label: 'Default', color: 'default' as const, description: 'Using default system configuration' };
  }
};

// Chart data generation functions
export const createTrendsPlot = (
  data: MetricTrendData[],
  rowKey: string,
  metricName: string,
  unit?: string,
  theme?: any,
  regressionDetectionTestRunId?: string
) => {
  // console.log(`createTrendsPlot called for metric: ${metricName}`, {
  //   metricName,
  //   dataLength: data?.length || 0,
  //   firstDataPoint: data?.[0],
  //   regressionDetectionTestRunId,
  //   rowKey
  // });

  if (!data || data.length === 0) return { plotData: [], plotLayout: {}, plotConfig: {} };

  const isDark = theme?.palette?.mode === 'dark';

  const sortedData = [...data].sort((a, b) =>
    new Date(a.test_run_start).getTime() - new Date(b.test_run_start).getTime()
  );

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

  let conversionFactor = 1;
  let adjustedYAxesFormat = unit || '';
  let yAxisLabel = 'Value';
  let unitSuffix = '';

  if (unit === 'percentunit') {
    conversionFactor = 100;
    yAxisLabel = 'Percentage (%)';
    unitSuffix = '%';
  } else if (unit === 's' && globalMaxDataPoint && globalMaxDataPoint < 1) {
    conversionFactor = 1000;
    adjustedYAxesFormat = 'ms';
    yAxisLabel = 'Time (ms)';
    unitSuffix = ' ms';
  } else if (unit === 'ms' && globalMinDataPoint && globalMinDataPoint > 1000) {
    conversionFactor = 1/1000;
    adjustedYAxesFormat = 's';
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

  const traces = [];

  if (sortedData.length > 0) {
    const markerColors = sortedData.map(point =>
      point.conclusion_label === 'regression' ? '#d32f2f' : '#1976d2'
    );

    const markerSizes = sortedData.map(point =>
      point.conclusion_label === 'regression' ? 10 : 10
    );

    const markerSymbols = sortedData.map(point =>
      point.conclusion_label === 'regression' ? 'x' : 'circle'
    );

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
      hovertemplate:
        `<b>Trends</b><br>` +
        'Test Run: %{customdata.testRunId}<br>' +
        'Time: %{customdata.datetime}<br>' +
        'Value: %{customdata.formattedValue}' + unitSuffix + '<br>' +
        'Conclusion: %{customdata.conclusion}<br>' +
        '%{customdata.versionLine}' +
        '%{customdata.annotationsLine}' +
        '<extra></extra>',
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

  const xValues = sortedData.map((_, index) => index);

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

  const hasLowerThresholds = lowerThresholds.some(val => val !== null);
  const hasUpperThresholds = upperThresholds.some(val => val !== null);

  if (hasLowerThresholds || hasUpperThresholds) {
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
        connectgaps: false
      });
    }

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
        connectgaps: false
      });

      if (hasLowerThresholds) {
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

        if (currentSegment) {
          validSegments.push(currentSegment);
        }

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

  // Prepare regression detection line data if specified
  let regressionLineTrace = null;
  let regressionAnnotation = null;

  if (regressionDetectionTestRunId) {
    const regressionIndex = sortedData.findIndex(point =>
      point.test_run_id === regressionDetectionTestRunId
    );

    if (regressionIndex !== -1) {
      // Find the y-axis range to draw the vertical line
      const allYValues = sortedData
        .map(point => point.mean * conversionFactor)
        .filter(val => val !== null && val !== undefined);

      const minY = Math.min(...allYValues);
      const maxY = Math.max(...allYValues);
      const yRange = maxY - minY;
      const lineMinY = minY - (yRange * 0.1); // Extend slightly below
      const lineMaxY = maxY + (yRange * 0.1); // Extend slightly above

      // Create vertical line trace
      regressionLineTrace = {
        x: [regressionIndex, regressionIndex],
        y: [lineMinY, lineMaxY],
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Regression Detection',
        line: {
          color: '#ff9800', // Orange color for the regression detection line
          width: 3,
          dash: 'dot'
        },
        hoverinfo: 'skip' as const,
        showlegend: true,
        legendgroup: 'regression-detection'
      };

      // Create annotation for the vertical line
      regressionAnnotation = {
        x: regressionIndex,
        y: lineMaxY,
        xref: 'x',
        yref: 'y',
        text: 'Regression Detected',
        showarrow: true,
        arrowhead: 2,
        arrowsize: 1,
        arrowwidth: 2,
        arrowcolor: '#ff9800',
        ax: 0,
        ay: -30,
        font: {
          color: '#ff9800',
          size: 12,
          family: theme?.typography?.fontFamily || 'Arial'
        },
        bgcolor: 'rgba(255, 152, 0, 0.1)',
        bordercolor: '#ff9800',
        borderwidth: 1
      };
    }
  }

  const xAxisLabels = sortedData.map(point => {
    const date = new Date(point.test_run_start);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  });

  const textColor = theme?.palette?.text?.primary || (isDark ? '#e0e0e0' : '#000');
  const textSecondary = theme?.palette?.text?.secondary || (isDark ? '#aaa' : '#666');
  const paperBgColor = isDark ? '#1e293b' : (theme?.palette?.background?.paper || '#fff');
  const bgColor = isDark ? '#121212' : paperBgColor;
  const plotBgColor = isDark ? '#1e1e1e' : (theme?.palette?.grey?.[50] || '#f5f5f5');
  const gridColor = isDark ? 'rgba(255,255,255,0.12)' : '#e0e0e0';

  const layout = {
    title: {
      text: metricName || 'Metric',
      font: {
        color: textColor,
        size: 14,
        family: theme?.typography?.fontFamily || 'Arial'
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
      linecolor: theme?.palette?.divider || (isDark ? 'rgba(255,255,255,0.12)' : '#e0e0e0'),
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
      linecolor: theme?.palette?.divider || (isDark ? 'rgba(255,255,255,0.12)' : '#e0e0e0'),
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
    hovermode: 'x unified' as const,
    hoverlabel: {
      bgcolor: paperBgColor,
      bordercolor: theme?.palette?.divider || (isDark ? 'rgba(255,255,255,0.12)' : '#e0e0e0'),
      font: {
        color: textColor,
        size: 11,
        family: theme?.typography?.fontFamily || 'Arial'
      },
      align: 'left' as const,
    },
    showlegend: regressionDetectionTestRunId ? true : false,
    height: 400,
    margin: { l: 50, r: 20, t: 40, b: 80 },
    plot_bgcolor: plotBgColor,
    paper_bgcolor: bgColor,
    font: {
      color: textColor,
      family: theme?.typography?.fontFamily || 'Arial'
    }
  };

  const config = {
    responsive: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d', 'autoScale2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d'],
    displaylogo: false,
    toImageButtonOptions: {
      format: 'png' as const,
      filename: `${sortedData[0]?.panel_title || 'trends'}_control_group`,
      height: 400,
      width: 1200,
      scale: 2
    },
  };

  // Add regression detection line and annotation if specified
  if (regressionLineTrace) {
    traces.push(regressionLineTrace);
  }

  if (regressionAnnotation) {
    const layoutAny = layout as any;
    if (!layoutAny.annotations) {
      layoutAny.annotations = [];
    }
    layoutAny.annotations.push(regressionAnnotation);
  }

  return { plotData: traces, plotLayout: layout, plotConfig: config };
};

// Threshold generation functions
export const generateThresholdData = (drawerData: any, unit?: string) => {
  const thresholds = [];

  if (drawerData.checks && drawerData.statistic && drawerData.compare_config) {
    const testValue = drawerData.statistic?.test || 0;
    const controlValue = drawerData.statistic?.control || 0;
    const observedDiff = drawerData.statistic?.diff || 0;

    const config = drawerData.compare_config;
    const checks = drawerData.checks || {};
    const thresholdRanges = drawerData.thresholds || {};
    const lowerThresholds = thresholdRanges.lower || {};
    const upperThresholds = thresholdRanges.upper || {};

    // Use the stored source from config, with proper mapping
    const configSource = config.source === 'metric' ? 'metric-specific' :
                        config.source === 'panel' ? 'panel-level' :
                        'default';

    const pctThreshold = config.thresholds?.percentageThreshold;
    const pctSource = configSource;
    const hasPercentageThreshold = pctThreshold !== null && pctThreshold !== undefined;

    let pctValidRange = 'Not set';
    if (hasPercentageThreshold && lowerThresholds.pct !== undefined && upperThresholds.pct !== undefined) {
      const lowerFormatted = formatValueWithUnit(lowerThresholds.pct, unit);
      const upperFormatted = formatValueWithUnit(upperThresholds.pct, unit);
      pctValidRange = `${lowerFormatted} - ${upperFormatted}`;
    } else if (hasPercentageThreshold) {
      pctValidRange = `± ${formatNumber(pctThreshold)}%`;
    }

    thresholds.push({
      threshold: 'Percent',
      configuredValue: hasPercentageThreshold ? `${formatNumber(pctThreshold)}%` : 'Not set',
      thresholdValue: pctValidRange,
      source: pctSource,
      observedDifference: formatValueWithUnit(testValue, unit),
      result: hasPercentageThreshold ? (checks.pct?.isDifference === false ? 'passed' : 'failed') : 'skipped',
      enabled: hasPercentageThreshold
    });

    const iqrThreshold = config.thresholds?.iqrThreshold;
    const iqrSource = configSource;
    const hasIqrThreshold = iqrThreshold !== null && iqrThreshold !== undefined;

    let iqrValidRange = 'Not set';
    if (hasIqrThreshold && lowerThresholds.iqr !== undefined && upperThresholds.iqr !== undefined) {
      const lowerFormatted = formatValueWithUnit(lowerThresholds.iqr, unit);
      const upperFormatted = formatValueWithUnit(upperThresholds.iqr, unit);
      iqrValidRange = `${lowerFormatted} - ${upperFormatted}`;
    } else if (hasIqrThreshold) {
      iqrValidRange = `IQR Factor: ${formatNumber(iqrThreshold)}`;
    }

    thresholds.push({
      threshold: 'Interquartile Range Factor',
      configuredValue: hasIqrThreshold ? formatNumber(iqrThreshold) : 'Not set',
      thresholdValue: iqrValidRange,
      source: iqrSource,
      observedDifference: formatValueWithUnit(testValue, unit),
      result: hasIqrThreshold ? (checks.iqr?.isDifference === false ? 'passed' : 'failed') : 'skipped',
      enabled: hasIqrThreshold
    });

    const absThreshold = config.thresholds?.absoluteThreshold;
    const absSource = configSource;
    const hasAbsoluteThreshold = absThreshold !== null && absThreshold !== undefined;

    let absValidRange = 'Not set';
    if (hasAbsoluteThreshold && lowerThresholds.overall !== undefined && upperThresholds.overall !== undefined) {
      const lowerFormatted = formatValueWithUnit(lowerThresholds.overall, unit);
      const upperFormatted = formatValueWithUnit(upperThresholds.overall, unit);
      absValidRange = `${lowerFormatted} - ${upperFormatted}`;
    } else if (hasAbsoluteThreshold) {
      const formattedThreshold = formatValueWithUnit(absThreshold, unit);
      absValidRange = `± ${formattedThreshold}`;
    }

    thresholds.push({
      threshold: 'Absolute',
      configuredValue: hasAbsoluteThreshold ? formatNumber(absThreshold) : 'Not set',
      thresholdValue: absValidRange,
      source: absSource,
      observedDifference: formatValueWithUnit(testValue, unit),
      result: hasAbsoluteThreshold ? (checks.abs?.isDifference === false ? 'passed' : 'failed') : 'skipped',
      enabled: hasAbsoluteThreshold
    });
  }

  if (thresholds.length === 0 && drawerData.thresholds && drawerData.statistic) {
    const testValue = drawerData.statistic?.test || 0;
    const controlValue = drawerData.statistic?.control || 0;
    const observedDiff = drawerData.statistic?.diff || 0;

    const percentageDiff = controlValue !== 0
      ? ((testValue - controlValue) / Math.abs(controlValue)) * 100
      : 0;

    if (drawerData.thresholds.lower?.overall !== undefined || drawerData.thresholds.upper?.overall !== undefined) {
      const lowerOverall = drawerData.thresholds.lower?.overall;
      const upperOverall = drawerData.thresholds.upper?.overall;
      const thresholdValue = lowerOverall !== undefined && upperOverall !== undefined
        ? `${formatNumber(lowerOverall)} - ${formatNumber(upperOverall)}`
        : lowerOverall !== undefined ? `> ${formatNumber(lowerOverall)}`
        : `< ${formatNumber(upperOverall)}`;

      const isWithinThreshold = (
        (lowerOverall === undefined || testValue >= lowerOverall) &&
        (upperOverall === undefined || testValue <= upperOverall)
      );

      thresholds.push({
        threshold: 'Overall',
        thresholdValue,
        source: 'Legacy',
        observedDifference: formatValueWithUnit(testValue, unit),
        result: isWithinThreshold ? 'passed' : 'failed',
        enabled: true
      });
    }
  }

  return thresholds;
};