'use client';

/**
 * LoadProfileChart Component
 *
 * Displays load profile metrics from AWR reports in various chart formats.
 * Supports bar charts, radar charts, and table views. Shows comparison
 * data when a baseline is provided.
 *
 * @example
 * ```tsx
 * <LoadProfileChart
 *   data={loadProfileData}
 *   height={300}
 *   showLegend
 *   chartType="bar"
 * />
 * ```
 */

import React, { useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  useTheme,
  alpha,
  Skeleton,
} from '@mui/material';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';
import type {
  LoadProfileChartProps,
  LoadProfileChartData,
  ChartDataPoint,
} from '../types';
import { formatNumber, formatCompactNumber, formatChangePercentage } from '../utils/formatters';

// ==================== Constants ====================

const DEFAULT_HEIGHT = 300;

const METRIC_COLORS: Record<string, string> = {
  'DB Time': '#2196f3',
  'DB CPU': '#4caf50',
  'Redo Size': '#ff9800',
  'Logical Reads': '#9c27b0',
  'Block Changes': '#00bcd4',
  'Physical Reads': '#f44336',
  'Physical Writes': '#795548',
  'Transactions': '#607d8b',
  'SQL*Net': '#e91e63',
  'Parses': '#3f51b5',
  Default: '#9e9e9e',
};

// ==================== Helper Functions ====================

/**
 * Get color for a metric name
 */
function getMetricColor(metricName: string): string {
  // Check for exact match first
  if (METRIC_COLORS[metricName]) {
    return METRIC_COLORS[metricName];
  }

  // Check for partial matches
  const lowerName = metricName.toLowerCase();
  if (lowerName.includes('db time')) return METRIC_COLORS['DB Time'];
  if (lowerName.includes('db cpu') || lowerName.includes('cpu')) return METRIC_COLORS['DB CPU'];
  if (lowerName.includes('redo')) return METRIC_COLORS['Redo Size'];
  if (lowerName.includes('logical') || lowerName.includes('buffer')) return METRIC_COLORS['Logical Reads'];
  if (lowerName.includes('block') || lowerName.includes('change')) return METRIC_COLORS['Block Changes'];
  if (lowerName.includes('physical read')) return METRIC_COLORS['Physical Reads'];
  if (lowerName.includes('physical write')) return METRIC_COLORS['Physical Writes'];
  if (lowerName.includes('transaction') || lowerName.includes('commit')) return METRIC_COLORS['Transactions'];
  if (lowerName.includes('sql*net') || lowerName.includes('network')) return METRIC_COLORS['SQL*Net'];
  if (lowerName.includes('parse')) return METRIC_COLORS['Parses'];

  return METRIC_COLORS.Default;
}

/**
 * Calculate percentage change between two values
 */
function calculateChange(current: number, baseline: number): number | null {
  if (baseline === 0) return current === 0 ? 0 : null;
  return ((current - baseline) / baseline) * 100;
}

/**
 * Prepare chart data with comparison values if available
 */
function prepareChartData(
  data: LoadProfileChartData,
  comparisonData?: LoadProfileChartData,
): ChartDataPoint[] {
  return data.metrics.map((metric) => {
    const compareMetric = comparisonData?.metrics.find(
      (m) => m.name === metric.name,
    );

    return {
      ...metric,
      color: metric.color || getMetricColor(metric.name),
      compareValue: compareMetric?.value,
      percent: metric.percent,
    };
  });
}

// ==================== Sub-Components ====================

interface LoadingStateProps {
  height: number;
}

function LoadingState({ height }: LoadingStateProps) {
  return (
    <Box sx={{ width: '100%', height }}>
      <Skeleton variant="rectangular" width="100%" height={height} />
    </Box>
  );
}

interface EmptyStateProps {
  height: number;
}

function EmptyState({ height }: EmptyStateProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height,
        backgroundColor: 'background.default',
        borderRadius: 1,
      }}
    >
      <Typography variant="body2" color="text.secondary">
        No load profile data available
      </Typography>
    </Box>
  );
}

// ==================== Chart Type Components ====================

interface BarChartViewProps {
  data: ChartDataPoint[];
  height: number;
  showLegend: boolean;
  hasComparison: boolean;
}

function BarChartView({
  data,
  height,
  showLegend,
  hasComparison,
}: BarChartViewProps) {
  const theme = useTheme();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 20, right: 30, left: 100, bottom: 5 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke={alpha(theme.palette.divider, 0.5)}
        />
        <XAxis
          type="number"
          tickFormatter={(value) => formatCompactNumber(value)}
          style={{ fontSize: '0.75rem' }}
        />
        <YAxis
          type="category"
          dataKey="name"
          style={{ fontSize: '0.75rem' }}
          width={90}
        />
        <RechartsTooltip
          formatter={(value: number, name: string) => [
            formatNumber(value),
            name === 'value' ? 'Current' : 'Baseline',
          ]}
          contentStyle={{
            backgroundColor: alpha(theme.palette.background.paper, 0.95),
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 8,
            boxShadow: theme.shadows[3],
          }}
        />
        {showLegend && <Legend />}
        <Bar
          dataKey="value"
          name="Current"
          radius={[0, 4, 4, 0]}
        >
          {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.color || getMetricColor(entry.name)}
            />
          ))}
        </Bar>
        {hasComparison && (
          <Bar
            dataKey="compareValue"
            name="Baseline"
            fill={alpha(theme.palette.grey[500], 0.5)}
            radius={[0, 4, 4, 0]}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

interface RadarChartViewProps {
  data: ChartDataPoint[];
  height: number;
  hasComparison: boolean;
}

function RadarChartView({
  data,
  height,
  hasComparison,
}: RadarChartViewProps) {
  const theme = useTheme();

  // Normalize data to 0-100 scale for radar chart
  const maxValue = Math.max(...data.map((d) => Math.max(d.value, d.compareValue || 0)));
  const normalizedData = data.map((d) => ({
    ...d,
    normalizedValue: maxValue > 0 ? (d.value / maxValue) * 100 : 0,
    normalizedCompareValue: d.compareValue && maxValue > 0
      ? (d.compareValue / maxValue) * 100
      : undefined,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={normalizedData}>
        <PolarGrid stroke={alpha(theme.palette.divider, 0.5)} />
        <PolarAngleAxis
          dataKey="name"
          tick={{ fontSize: '0.7rem', fill: theme.palette.text.secondary }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tick={{ fontSize: '0.65rem' }}
        />
        <Radar
          name="Current"
          dataKey="normalizedValue"
          stroke={theme.palette.primary.main}
          fill={alpha(theme.palette.primary.main, 0.3)}
          strokeWidth={2}
        />
        {hasComparison && (
          <Radar
            name="Baseline"
            dataKey="normalizedCompareValue"
            stroke={theme.palette.grey[500]}
            fill={alpha(theme.palette.grey[500], 0.2)}
            strokeWidth={2}
            strokeDasharray="5 5"
          />
        )}
        <Legend />
      </RadarChart>
    </ResponsiveContainer>
  );
}

interface TableViewProps {
  data: ChartDataPoint[];
  hasComparison: boolean;
}

function TableView({ data, hasComparison }: TableViewProps) {
  const theme = useTheme();

  return (
    <TableContainer
      component={Paper}
      sx={{
        boxShadow: 'none',
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 1,
      }}
    >
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Metric</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>
              Value
            </TableCell>
            {hasComparison && (
              <>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  Baseline
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  Change
                </TableCell>
              </>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {data.map((row) => {
            const change = hasComparison && row.compareValue !== undefined
              ? calculateChange(row.value, row.compareValue)
              : null;
            const changeColor = change !== null
              ? change > 5
                ? theme.palette.error.main
                : change < -5
                  ? theme.palette.success.main
                  : theme.palette.text.secondary
              : undefined;

            return (
              <TableRow key={row.name} hover>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        backgroundColor: row.color || getMetricColor(row.name),
                      }}
                    />
                    {row.name}
                  </Box>
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                  {formatNumber(row.value)}
                </TableCell>
                {hasComparison && (
                  <>
                    <TableCell
                      align="right"
                      sx={{
                        fontFamily: 'monospace',
                        color: theme.palette.text.secondary,
                      }}
                    >
                      {row.compareValue !== undefined
                        ? formatNumber(row.compareValue)
                        : 'N/A'}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontFamily: 'monospace',
                        color: changeColor,
                        fontWeight: change !== null && Math.abs(change) > 5 ? 600 : 400,
                      }}
                    >
                      {change !== null ? formatChangePercentage(change) : 'N/A'}
                    </TableCell>
                  </>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// ==================== Main Component ====================

/**
 * LoadProfileChart - Displays load profile metrics visualization
 */
export function LoadProfileChart({
  data,
  height = DEFAULT_HEIGHT,
  showLegend = true,
  comparisonData,
  chartType = 'bar',
}: LoadProfileChartProps) {
  const theme = useTheme();

  // Prepare chart data
  const chartData = useMemo(
    () => prepareChartData(data, comparisonData),
    [data, comparisonData],
  );

  // Check for empty data
  if (!data || !data.metrics || data.metrics.length === 0) {
    return <EmptyState height={height} />;
  }

  const hasComparison = Boolean(comparisonData?.metrics?.length);

  // Render based on chart type
  const renderChart = () => {
    switch (chartType) {
      case 'radar':
        return (
          <RadarChartView
            data={chartData}
            height={height}
            hasComparison={hasComparison}
          />
        );
      case 'table':
        return <TableView data={chartData} hasComparison={hasComparison} />;
      case 'bar':
      default:
        return (
          <BarChartView
            data={chartData}
            height={height}
            showLegend={showLegend}
            hasComparison={hasComparison}
          />
        );
    }
  };

  return (
    <Box
      sx={{
        width: '100%',
        backgroundColor: theme.palette.background.paper,
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      {renderChart()}
    </Box>
  );
}

// ==================== Loading Component ====================

export function LoadProfileChartLoading({
  height = DEFAULT_HEIGHT,
}: {
  height?: number;
}) {
  return <LoadingState height={height} />;
}

export default LoadProfileChart;
