'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Box, useTheme } from '@mui/material';
import dynamic from 'next/dynamic';

// Types
import {
  GraphsChartProps,
  extractChartThemeColors,
} from './types';

// Utils
import {
  assignSeriesToAxes,
  getUnitConversion,
  getChartSeriesColor,
  buildTimestampMapping,
  calculateXAxisTicks,
  calculateRampUpEndIndex,
  buildTrace,
  buildChartLayout,
  buildChartConfig,
} from './utils';

// Components
import { ChartLoadingState, ChartEmptyState } from './components';

// Event lines
import { mergeEventShapesIntoIndexedLayout } from '../shared/event-lines';

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

/**
 * GraphsChart Component
 *
 * Renders multi-series time-series visualizations with intelligent
 * multi-axis support, unit conversions, and interactive features.
 *
 * Features:
 * - Automatic color assignment from palette
 * - Smart Y-axis assignment (single or dual axis)
 * - Unit conversion (s/ms, percentunit)
 * - Ramp-up period shading
 * - Interactive hover with unified mode
 * - Copy to clipboard support
 * - Responsive design
 */
export default function GraphsChart({
  testRun,
  seriesData,
  seriesConfig,
  loading,
  chartName,
  events,
}: GraphsChartProps) {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(800);

  // Measure container width on mount and window resize
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Assign series to axes based on units and magnitude
  const axisAssignment = useMemo(
    () => assignSeriesToAxes(seriesConfig, seriesData),
    [seriesConfig, seriesData]
  );

  // Generate Plotly data and layout
  const plotProps = useMemo(() => {
    if (seriesConfig.length === 0 || seriesData.size === 0) {
      return null;
    }

    // Extract theme colors
    const themeColors = extractChartThemeColors(theme);

    // Combine all series for processing
    const allSeries = [...axisAssignment.leftAxisSeries, ...axisAssignment.rightAxisSeries];

    // Build timestamp mapping
    const { sortedTimestamps, timestampToIndex } = buildTimestampMapping(allSeries, seriesData);

    // Calculate tick values and labels
    const { tickValues, tickLabels } = calculateXAxisTicks(sortedTimestamps);

    // Calculate ramp-up end index
    const rampUpEndIndex = calculateRampUpEndIndex(testRun, sortedTimestamps);

    // Determine unit conversions for left and right axes
    const leftAxisData = axisAssignment.leftAxisSeries.flatMap(s => seriesData.get(s.id) || []);
    const rightAxisData = axisAssignment.rightAxisSeries.flatMap(s => seriesData.get(s.id) || []);

    const leftAxisFormat = axisAssignment.leftAxisSeries[0]?.yAxisFormat;
    const rightAxisFormat = axisAssignment.rightAxisSeries[0]?.yAxisFormat;

    const leftConversion = getUnitConversion(leftAxisFormat, leftAxisData);
    const rightConversion = axisAssignment.rightAxisSeries.length > 0
      ? getUnitConversion(rightAxisFormat, rightAxisData)
      : null;

    // Build traces for each series
    const traces = allSeries.map((series, index) => {
      const data = seriesData.get(series.id);
      if (!data || data.length === 0) return null;

      const isRightAxis = axisAssignment.rightAxisSeries.includes(series);
      const conversion = isRightAxis ? rightConversion! : leftConversion;
      const color = getChartSeriesColor(index);

      return buildTrace(
        series,
        data,
        isRightAxis,
        conversion,
        color,
        themeColors.hoverBgColor,
        timestampToIndex
      );
    }).filter(Boolean);

    // Build layout
    let layout = buildChartLayout(
      themeColors,
      chartName,
      leftConversion,
      rightConversion,
      tickValues,
      tickLabels,
      sortedTimestamps.length,
      rampUpEndIndex,
      Boolean(testRun?.analysis_start_offset),
      containerWidth
    );

    // Merge event annotations into layout
    if (events && events.length > 0) {
      layout = mergeEventShapesIntoIndexedLayout(layout as Record<string, any>, events, sortedTimestamps);
    }

    // Build config
    const config = buildChartConfig(chartName);

    return { data: traces, layout, config };
  }, [seriesData, seriesConfig, axisAssignment, testRun, theme, containerWidth, chartName, events]);

  // Loading state
  if (loading) {
    return <ChartLoadingState />;
  }

  // Empty state - no series configured
  if (seriesConfig.length === 0) {
    return <ChartEmptyState variant="no-series" />;
  }

  // Empty state - no data available
  if (seriesData.size === 0 || !plotProps) {
    return <ChartEmptyState variant="no-data" />;
  }

  // Render chart
  return (
    <Box
      ref={containerRef}
      sx={{
        height: 500,
        width: '100%',
        backgroundColor: 'background.paper',
        borderRadius: 2,
        overflow: 'hidden'
      }}
    >
      <Plot
        data={plotProps.data}
        layout={plotProps.layout}
        config={plotProps.config}
        style={{ width: '100%', height: '100%' }}
      />
    </Box>
  );
}
