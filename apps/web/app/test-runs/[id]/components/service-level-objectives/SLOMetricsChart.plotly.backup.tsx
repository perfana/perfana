'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import Plotly from 'plotly.js-dist';
import { authenticatedFetch } from '@/lib/api';

interface MetricDataPoint {
  metric_name: string;
  time: string;
  timestep: number;
  ramp_up: boolean;
  value: number;
}

interface DSMetric {
  test_run_id: string;
  panel_id: number;
  panel_title: string;
  dashboard_label: string;
  data: MetricDataPoint[];
}

interface SLOMetricsChartProps {
  testRunId: string;
  checkResult: {
    panel_id: number;
    panel_title?: string;
    dashboard_label?: string;
    metric_name?: string;
    benchmark_id?: string;
    requirement?: {
      operator: string;
      value: number;
    };
    evaluate_type?: string;
    metric_unit?: string;
    targets?: Array<{
      target: string;
      value: number;
      meets_requirement: boolean;
    }>;
  };
  testRun?: {
    start_time: string;
    end_time?: string;
    ramp_up_seconds?: number;
  };
}

export default function SLOMetricsChart({ 
  testRunId, 
  checkResult, 
  testRun 
}: SLOMetricsChartProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metricsData, setMetricsData] = useState<DSMetric | null>(null);

  const fetchMetricsData = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('SLOMetricsChart - Fetching metrics with:', {
        testRunId,
        panelId: checkResult.panel_id,
        benchmarkId: checkResult.benchmark_id,
        metricName: checkResult.metric_name
      });

      // Query ds_metrics PostgreSQL table for this panel, including benchmark filter
      const url = `/metrics/ds-metrics/${testRunId}/${checkResult.panel_id}${checkResult.benchmark_id ? `?benchmarkId=${checkResult.benchmark_id}` : ''}`;
      console.log('API URL:', url);
      
      const response = await authenticatedFetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.warn('DS metrics not found for this panel');
          setMetricsData(null);
          return;
        }
        throw new Error(`Failed to fetch metrics data: ${response.status} ${response.statusText}`);
      }

      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('Failed to parse JSON response:', jsonError);
        throw new Error('Invalid JSON response from metrics endpoint');
      }
      if (data) {
        setMetricsData(data);
      } else {
        setMetricsData(null);
      }
    } catch (err) {
      console.error('Error fetching metrics data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics data');
    } finally {
      setLoading(false);
    }
  };

  const createPlotlyGraph = () => {
    if (!plotRef.current || !metricsData) return;

    // Handle both old format (object with data property) and new format (direct array)
    const dataPoints = Array.isArray(metricsData) ? metricsData : metricsData.data;
    if (!dataPoints || dataPoints.length === 0) return;

    const metricName = checkResult.metric_name || checkResult.panel_title || 'Unknown Metric';
    const requirementValue = checkResult.requirement?.value || 0;
    const panelYAxesFormat = checkResult.metric_unit || '';

    // Extract data points for the specific metric
    // If we have a specific metric name from checkResult, filter by it
    // Otherwise, use all data points (common for single-metric panels)
    const relevantData = checkResult.metric_name 
      ? dataPoints.filter(point => point.metric_name === checkResult.metric_name)
      : dataPoints;

    // If filtering resulted in no data, use all data points
    const finalData = relevantData.length > 0 ? relevantData : dataPoints;

    console.log('SLOMetricsChart Debug:', {
      totalDataPoints: dataPoints.length,
      checkResultMetricName: checkResult.metric_name,
      availableMetricNames: [...new Set(dataPoints.map(p => p.metric_name))],
      relevantDataCount: relevantData.length,
      finalDataCount: finalData.length,
      usingFallback: relevantData.length === 0,
      sampleDataPoint: dataPoints[0]
    });

    const x: Date[] = [];
    const y: number[] = [];
    let maxDataPoint: number | undefined;
    let minDataPoint: number | undefined;

    finalData.forEach((dataPoint, index) => {
      if (dataPoint.value !== undefined && dataPoint.value !== null) {
        // Track the maximum and minimum data point value
        if (maxDataPoint === undefined || dataPoint.value > maxDataPoint) {
          maxDataPoint = dataPoint.value;
        }
        if (minDataPoint === undefined || dataPoint.value < minDataPoint) {
          minDataPoint = dataPoint.value;
        }

        x.push(new Date(dataPoint.time));
        y.push(dataPoint.value);
        
        // Debug first few data points
        if (index < 3) {
          console.log(`Data point ${index}:`, {
            time: dataPoint.time,
            parsedTime: new Date(dataPoint.time),
            value: dataPoint.value,
            metric_name: dataPoint.metric_name
          });
        }
      }
    });

    console.log('Processed data for chart:', {
      totalProcessed: x.length,
      firstTime: x[0],
      lastTime: x[x.length - 1],
      firstValue: y[0],
      lastValue: y[y.length - 1],
      maxValue: maxDataPoint,
      minValue: minDataPoint
    });

    // Unit conversion logic from legacy code
    let adjustedRequirementValue = requirementValue;
    let adjustedYAxesFormat = panelYAxesFormat;

    // If unit is 'percentunit' convert to percentage
    if (panelYAxesFormat === 'percentunit') {
      y.forEach((item, index) => {
        y[index] = item * 100;
      });
      adjustedRequirementValue = requirementValue * 100;
    }

    // If unit is 'seconds' and all data points are under 1, convert to 'ms'
    if (panelYAxesFormat === 's' && maxDataPoint && maxDataPoint < 1) {
      y.forEach((item, index) => {
        y[index] = item * 1000;
      });
      adjustedRequirementValue = requirementValue * 1000;
      adjustedYAxesFormat = 'ms';
    }
    // If unit is 'ms' and all data points are over 1000, convert to 'sec'
    else if (panelYAxesFormat === 'ms' && minDataPoint && minDataPoint > 1000) {
      y.forEach((item, index) => {
        y[index] = item / 1000;
      });
      adjustedRequirementValue = requirementValue / 1000;
      adjustedYAxesFormat = 's';
    }

    // Use Perfana light theme colors
    const textColor = '#2a3f5f';
    const bgColor = '#f8f8f8';
    const plotBgColor = '#E5ECF6';
    const gridColor = 'white';
    const rectColor = '#C8D4E3';

    const testRunStart = testRun?.start_time ? new Date(testRun.start_time) : (x.length > 0 ? x[0] : new Date());
    const testRunEnd = testRun?.end_time ? new Date(testRun.end_time) : (x.length > 0 ? x[x.length - 1] : new Date());
    const rampUpSeconds = testRun?.ramp_up_seconds || 60;
    const lastRampUpTimestamp = new Date(testRunStart.getTime() + rampUpSeconds * 1000);

    let trace1;
    if (x.length === 1) {
      // Single data point - bar chart
      trace1 = {
        x: [''],
        y: [y[0]],
        type: 'bar' as const,
        hovertemplate: `%{y} ${adjustedYAxesFormat === 'percentunit' ? '%' : adjustedYAxesFormat}<extra></extra>`,
        marker: {
          color: ['#636efa'],
        },
        showlegend: false,
      };
    } else {
      // Multiple data points - line chart
      trace1 = {
        x: x,
        y: y,
        type: 'scatter' as const,
        mode: 'lines+markers' as const,
        showlegend: false,
        hovertemplate: `%{y} ${adjustedYAxesFormat === 'percentunit' ? '%' : adjustedYAxesFormat}<extra></extra>`,
        connectgaps: true,
        line: {
          color: '#636efa'
        }
      };
    }

    // Requirement line (SLO)
    const requirementTrace = {
      x: [testRunStart, testRunEnd],
      y: [adjustedRequirementValue, adjustedRequirementValue],
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: 'SLO',
      line: {
        color: '#EF553B',
        dash: 'dash',
        width: 2
      },
    };

    const layout = {
      plot_bgcolor: plotBgColor,
      paper_bgcolor: bgColor,
      font: {
        color: textColor,
      },
      legend: {
        orientation: 'h' as const,
        yanchor: 'bottom' as const,
        y: 1.02,
        xanchor: 'left' as const,
        x: 0,
      },
      xaxis: {
        range: [testRunStart, testRunEnd],
        showgrid: true,
        showline: true,
        visible: true,
        gridcolor: gridColor,
        linecolor: gridColor,
        color: textColor,
        ticks: '',
        zerolinecolor: gridColor,
        zerolinewidth: 2,
        automargin: true,
        title: {
          standoff: 15,
        },
      },
      yaxis: {
        rangemode: 'tozero' as const,
        title: adjustedYAxesFormat === 'percentunit' ? '%' : adjustedYAxesFormat,
        showgrid: true,
        showline: true,
        gridcolor: gridColor,
        linecolor: gridColor,
        color: textColor,
        ticks: '',
        zerolinecolor: gridColor,
        zerolinewidth: 2,
        automargin: true,
      },
      title: {
        text: x.length === 0 ? 'No data available' : `${metricName}`,
        font: { color: textColor, size: 14 }
      },
      hovermode: x.length > 1 ? 'x' : false,
      hoverlabel: {
        align: 'left',
      },
      margin: { t: 40, b: 40, l: 60, r: 20 },
      shapes: x.length > 1 ? [{
        type: 'rect' as const,
        x0: testRunStart,
        y0: 0,
        x1: lastRampUpTimestamp,
        y1: 1,
        yref: 'paper' as const,
        line: { width: 0 },
        fillcolor: rectColor,
        layer: 'below' as const,
        opacity: 0.3
      }] : []
    };

    const data = x.length > 1 ? [trace1, requirementTrace] : [trace1];
    const config = { 
      displayModeBar: false,
      responsive: true
    };

    Plotly.newPlot(plotRef.current, data, layout, config);
  };

  useEffect(() => {
    fetchMetricsData();
  }, [testRunId, checkResult.panel_id]);

  useEffect(() => {
    if (metricsData && !loading) {
      createPlotlyGraph();
    }
  }, [metricsData, loading]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
        <CircularProgress size={24} />
        <Typography variant="body2" sx={{ ml: 2 }}>
          Loading metrics chart...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ textAlign: 'center', py: 2 }}>
        <Typography variant="body2" color="error">
          Error loading chart: {error}
        </Typography>
      </Box>
    );
  }

  if (!metricsData || (Array.isArray(metricsData) ? metricsData.length === 0 : (!metricsData.data || metricsData.data.length === 0))) {
    return (
      <Box sx={{ textAlign: 'center', py: 2 }}>
        <Typography variant="body2" color="text.secondary">
          No metrics data available for this panel
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', height: 300, mt: 2 }}>
      <div ref={plotRef} style={{ width: '100%', height: '100%' }} />
    </Box>
  );
}