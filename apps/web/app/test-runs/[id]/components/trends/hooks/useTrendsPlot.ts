'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTheme } from '@mui/material';
import { MetricStatistic, TrendsSeries, Panel } from '../types';
import { getYAxisConfig } from '../utils';

interface UseTrendsPlotProps {
  metricsData: MetricStatistic[];
  selectedSeriesNames: Set<string>;
  selectedMetric: Panel | null;
  evaluateType: string;
  trendsExpanded: boolean;
  addedSeries: TrendsSeries[];
  showToast: (message: string) => void;
}

interface PlotDataPoint {
  x: string;
  y: number;
  created_at: string;
  version?: string | null;
  annotations?: string | null;
  is_changepoint?: boolean;
  consolidated_result?: {
    overall?: boolean;
    passed?: boolean;
  } | null;
}

export function useTrendsPlot({
  metricsData,
  selectedSeriesNames,
  selectedMetric,
  evaluateType,
  trendsExpanded,
  addedSeries,
  showToast,
}: UseTrendsPlotProps) {
  const theme = useTheme();
  const [plotData, setPlotData] = useState<any[]>([]);
  const [plotLayout, setPlotLayout] = useState<any>({});
  const [plotConfig, setPlotConfig] = useState<any>({});

  // Build Plotly chart data and layout
  useEffect(() => {
    if (!trendsExpanded || metricsData.length === 0) {
      setPlotData([]);
      setPlotLayout({});
      setPlotConfig({});
      return;
    }

    // Group data by metric_name and sort by created_at
    const seriesData = metricsData.reduce((acc, item) => {
      if (!acc[item.metric_name]) {
        acc[item.metric_name] = [];
      }
      acc[item.metric_name].push({
        x: item.test_run_id,
        y: item.value,
        created_at: item.created_at,
        version: item.version,
        annotations: item.annotations,
        is_changepoint: item.is_changepoint,
        consolidated_result: item.consolidated_result
      });
      return acc;
    }, {} as Record<string, PlotDataPoint[]>);

    // Sort each series by created_at and create sequential x-axis positions
    Object.keys(seriesData).forEach(seriesName => {
      seriesData[seriesName].sort((a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    });

    const isDark = theme.palette.mode === 'dark';

    // Create traces for each series with datetime x-axis but equal spacing
    const traces = Object.entries(seriesData)
      .filter(([seriesName]) => selectedSeriesNames.has(seriesName))
      .map(([seriesName, data]) => ({
        x: data.map((_, index) => index),
        y: data.map(point => point.y),
        type: 'scatter' as const,
        mode: 'lines+markers' as const,
        name: seriesName,
        customdata: data.map(point => {
          const formattedDate = new Date(point.created_at).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });

          return {
            testRunId: point.x,
            datetime: formattedDate,
            version: point.version,
            annotations: point.annotations,
            versionLine: point.version ? `Version: ${point.version}<br>` : '',
            annotationsLine: point.annotations ? `Annotations: ${point.annotations}<br>` : '',
            isFailedTest: point.consolidated_result?.overall === false
          };
        }),
        hovertemplate:
          `<b>${seriesName}</b><br>` +
          'Test Run: %{customdata.testRunId}<br>' +
          'Time: %{customdata.datetime}<br>' +
          'Value: %{y}<br>' +
          '%{customdata.versionLine}' +
          '%{customdata.annotationsLine}' +
          '<extra></extra>',
        marker: {
          size: data.map(point => point.consolidated_result?.overall === false ? 10 : 6),
          symbol: data.map(point => point.consolidated_result?.overall === false ? 'x' : 'circle'),
          color: data.map(point => point.consolidated_result?.overall === false ? '#d32f2f' : undefined),
          line: {
            width: 2,
            color: isDark ? '#1e293b' : '#ffffff'
          }
        },
        line: { width: 2 },
        showlegend: true
      }));

    // Create custom x-axis labels from the first series
    const firstSeries = Object.values(seriesData)[0] || [];
    const xAxisLabels = firstSeries.map(point => {
      const date = new Date(point.created_at);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    });

    // Get all available series
    const allSeriesNames = Object.keys(seriesData);
    const allSeriesSelected = selectedSeriesNames.size === allSeriesNames.length;

    // Identify changepoint positions from the first series
    const changepointPositions = firstSeries
      .map((point, index) => ({ index, isChangepoint: point.is_changepoint }))
      .filter(p => p.isChangepoint)
      .map(p => p.index);

    // Theme colors
    const textColor = theme.palette.text.primary;
    const textSecondary = theme.palette.text.secondary;
    const bgColor = isDark ? 'transparent' : theme.palette.background.paper;
    const plotBgColor = isDark ? 'transparent' : theme.palette.grey[50];
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.12)' : '#e0e0e0';

    // Determine graph title based on selection
    let graphTitle = '';
    if (selectedSeriesNames.size === 0 || allSeriesSelected) {
      graphTitle = `${selectedMetric?.title || 'Metrics'} Trends (${evaluateType})`;
    } else if (selectedSeriesNames.size === 1) {
      const singleSeriesName = Array.from(selectedSeriesNames)[0];
      graphTitle = `${singleSeriesName} Trends (${evaluateType})`;
    } else {
      graphTitle = `${selectedMetric?.title || 'Metrics'} Trends - ${selectedSeriesNames.size} series (${evaluateType})`;
    }

    const yAxisConfig = getYAxisConfig(addedSeries);

    const layout = {
      title: {
        text: graphTitle,
        font: {
          color: textColor,
          size: 16,
          family: theme.typography.fontFamily
        },
        x: 0.5,
        xanchor: 'center',
        y: 0.95,
        yanchor: 'top'
      },
      xaxis: {
        title: {
          text: 'Time',
          font: {
            size: 12,
            color: textSecondary
          }
        },
        tickvals: firstSeries.map((_, index) => index),
        ticktext: xAxisLabels,
        tickangle: -45,
        showgrid: true,
        showline: true,
        gridcolor: gridColor,
        linecolor: theme.palette.divider,
        color: textSecondary,
        tickfont: {
          size: 11,
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
          text: yAxisConfig.title,
          font: {
            size: 12,
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
          size: 11,
          color: textSecondary
        },
        ticksuffix: yAxisConfig.ticksuffix,
        ticks: '',
        zeroline: true,
        zerolinecolor: gridColor,
        zerolinewidth: 1,
        automargin: true,
        nticks: 5
      },
      hovermode: 'x unified' as const,
      hoverlabel: {
        bgcolor: bgColor,
        bordercolor: theme.palette.divider,
        font: {
          color: textColor,
          size: 12,
          family: theme.typography.fontFamily
        },
        align: 'left' as const,
      },
      showlegend: true,
      legend: {
        orientation: 'h' as const,
        yanchor: 'top',
        y: -0.35,
        xanchor: 'center',
        x: 0.5,
        font: {
          size: 11,
          color: textSecondary
        },
        bgcolor: isDark ? 'rgba(30, 41, 59, 0.9)' : 'rgba(255, 255, 255, 0.8)',
        bordercolor: isDark ? 'rgba(255, 255, 255, 0.1)' : gridColor,
        borderwidth: 1
      },
      height: 400,
      margin: { l: 60, r: 30, t: 40, b: 140 },
      plot_bgcolor: plotBgColor,
      paper_bgcolor: bgColor,
      font: {
        color: textColor,
        family: theme.typography.fontFamily
      },
      shapes: changepointPositions.map(position => ({
        type: 'line',
        x0: position,
        x1: position,
        y0: 0,
        y1: 1,
        yref: 'paper',
        line: {
          color: '#FF6B35',
          width: 2,
          dash: 'dash'
        },
        name: 'Changepoint'
      })),
      annotations: []
    };

    const config = {
      responsive: true,
      displayModeBar: true,
      modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d', 'autoScale2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'resetScale2d'],
      displaylogo: false,
      toImageButtonOptions: {
        format: 'png',
        filename: `${selectedMetric?.title || 'trends'}_${evaluateType}`,
        height: 400,
        width: null,
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
          click: function(gd: any) {
            (window as any).Plotly.toImage(gd, {
              format: 'png',
              width: gd._fullLayout.width || 800,
              height: gd._fullLayout.height || 400,
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
        }
      ]
    };

    // Add a dummy trace for changepoint legend entry (only if there are changepoints)
    if (changepointPositions.length > 0) {
      traces.push({
        x: [null],
        y: [null],
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Changepoints',
        line: {
          color: '#FF6B35',
          width: 2,
          dash: 'dash'
        },
        showlegend: true,
        hoverinfo: 'skip' as const
      } as any);
    }

    setPlotData(traces);
    setPlotLayout(layout);
    setPlotConfig(config);
  }, [metricsData, selectedSeriesNames, selectedMetric, evaluateType, theme, trendsExpanded, showToast, addedSeries]);

  return {
    plotData,
    plotLayout,
    plotConfig,
  };
}
