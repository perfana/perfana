'use client';

/**
 * TimeModelChart Component
 *
 * Displays Oracle time model breakdown from AWR reports.
 * Shows how DB time is distributed across different categories
 * (SQL execute, parse, PL/SQL, background, etc.).
 *
 * Supports pie, donut, and bar chart views.
 *
 * @example
 * ```tsx
 * <TimeModelChart
 *   data={timeModelData}
 *   height={300}
 *   showBreakdown
 *   chartType="donut"
 * />
 * ```
 */

import React, { useMemo } from 'react';
import {
  Box,
  Typography,
  useTheme,
  alpha,
  Skeleton,
  Grid,
  Paper,
} from '@mui/material';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type {
  TimeModelChartProps,
  TimeModelChartData,
  ChartDataPoint,
} from '../types';
import {
  formatDuration,
  formatPercentage,
  formatDbTime,
} from '../utils/formatters';

// ==================== Constants ====================

const DEFAULT_HEIGHT = 300;

const TIME_MODEL_COLORS: Record<string, string> = {
  'DB CPU': '#4caf50',
  'SQL Execute': '#2196f3',
  'Parse Time': '#ff9800',
  'PL/SQL': '#9c27b0',
  'Background': '#607d8b',
  'Connection Management': '#00bcd4',
  'Sequence Load': '#795548',
  'Java': '#e91e63',
  'Failed Parse': '#f44336',
  'Recursive Calls': '#3f51b5',
  'Other': '#9e9e9e',
};

// ==================== Helper Functions ====================

/**
 * Get color for a time model segment
 */
function getTimeModelColor(name: string): string {
  // Check for exact match
  if (TIME_MODEL_COLORS[name]) {
    return TIME_MODEL_COLORS[name];
  }

  // Check for partial matches
  const lowerName = name.toLowerCase();
  if (lowerName.includes('cpu')) return TIME_MODEL_COLORS['DB CPU'];
  if (lowerName.includes('sql') && lowerName.includes('exec')) return TIME_MODEL_COLORS['SQL Execute'];
  if (lowerName.includes('parse')) return TIME_MODEL_COLORS['Parse Time'];
  if (lowerName.includes('pl/sql') || lowerName.includes('plsql')) return TIME_MODEL_COLORS['PL/SQL'];
  if (lowerName.includes('background')) return TIME_MODEL_COLORS['Background'];
  if (lowerName.includes('connection')) return TIME_MODEL_COLORS['Connection Management'];
  if (lowerName.includes('sequence')) return TIME_MODEL_COLORS['Sequence Load'];
  if (lowerName.includes('java')) return TIME_MODEL_COLORS['Java'];
  if (lowerName.includes('failed')) return TIME_MODEL_COLORS['Failed Parse'];
  if (lowerName.includes('recursive')) return TIME_MODEL_COLORS['Recursive Calls'];

  return TIME_MODEL_COLORS['Other'];
}

/**
 * Prepare chart segments from time model data
 */
function prepareSegments(data: TimeModelChartData): ChartDataPoint[] {
  // If segments are already provided, use them
  if (data.segments && data.segments.length > 0) {
    return data.segments.map((seg) => ({
      ...seg,
      color: seg.color || getTimeModelColor(seg.name),
    }));
  }

  // Otherwise, construct from individual values
  const segments: ChartDataPoint[] = [];
  const total = data.dbTime || 0;

  if (data.dbCpu) {
    segments.push({
      name: 'DB CPU',
      value: data.dbCpu,
      percent: total > 0 ? (data.dbCpu / total) * 100 : 0,
      color: getTimeModelColor('DB CPU'),
    });
  }

  if (data.sqlExecute) {
    segments.push({
      name: 'SQL Execute',
      value: data.sqlExecute,
      percent: total > 0 ? (data.sqlExecute / total) * 100 : 0,
      color: getTimeModelColor('SQL Execute'),
    });
  }

  if (data.parseTime) {
    segments.push({
      name: 'Parse Time',
      value: data.parseTime,
      percent: total > 0 ? (data.parseTime / total) * 100 : 0,
      color: getTimeModelColor('Parse Time'),
    });
  }

  if (data.plsqlTime) {
    segments.push({
      name: 'PL/SQL',
      value: data.plsqlTime,
      percent: total > 0 ? (data.plsqlTime / total) * 100 : 0,
      color: getTimeModelColor('PL/SQL'),
    });
  }

  if (data.backgroundTime) {
    segments.push({
      name: 'Background',
      value: data.backgroundTime,
      percent: total > 0 ? (data.backgroundTime / total) * 100 : 0,
      color: getTimeModelColor('Background'),
    });
  }

  // Calculate "Other" if there's a gap
  const segmentTotal = segments.reduce((sum, s) => sum + s.value, 0);
  if (total > segmentTotal && total - segmentTotal > 0.01) {
    const otherValue = total - segmentTotal;
    segments.push({
      name: 'Other',
      value: otherValue,
      percent: total > 0 ? (otherValue / total) * 100 : 0,
      color: getTimeModelColor('Other'),
    });
  }

  // Sort by value descending
  return segments.sort((a, b) => b.value - a.value);
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
        No time model data available
      </Typography>
    </Box>
  );
}

// ==================== Chart Type Components ====================

interface PieChartViewProps {
  data: ChartDataPoint[];
  height: number;
  isDonut: boolean;
  dbTime: number;
}

function PieChartView({ data, height, isDonut, dbTime }: PieChartViewProps) {
  const theme = useTheme();
  const outerRadius = height / 3;
  const innerRadius = isDonut ? height / 5 : 0;

  // Custom label
  const renderLabel = ({
    percent,
  }: {
    name: string;
    percent: number;
  }) => {
    if (percent < 0.05) return null;
    return `${(percent * 100).toFixed(1)}%`;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={outerRadius}
          innerRadius={innerRadius}
          label={renderLabel}
          labelLine={{ stroke: theme.palette.text.secondary, strokeWidth: 1 }}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        {isDonut && (
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ fill: theme.palette.text.primary, fontSize: '0.75rem' }}
          >
            <tspan x="50%" dy="-0.6em" fontWeight={600}>
              DB Time
            </tspan>
            <tspan x="50%" dy="1.4em" fontSize="0.9rem">
              {formatDbTime(dbTime / 60)} {/* Convert seconds to minutes */}
            </tspan>
          </text>
        )}
        <RechartsTooltip
          formatter={(value: number, name: string) => [
            formatDuration(value),
            name,
          ]}
          contentStyle={{
            backgroundColor: alpha(theme.palette.background.paper, 0.95),
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 8,
            boxShadow: theme.shadows[3],
          }}
        />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          formatter={(value, _entry) => {
            const item = data.find((d) => d.name === value);
            if (item) {
              return `${value} (${formatPercentage(item.percent || 0)})`;
            }
            return value;
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

interface BarChartViewProps {
  data: ChartDataPoint[];
  height: number;
}

function BarChartView({ data, height }: BarChartViewProps) {
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
          tickFormatter={(value) => formatDuration(value, 0)}
          style={{ fontSize: '0.75rem' }}
        />
        <YAxis
          type="category"
          dataKey="name"
          style={{ fontSize: '0.75rem' }}
          width={90}
        />
        <RechartsTooltip
          formatter={(value: number, name: string, props: { payload: { percent?: number; name?: string } }) => {
            const percent = props.payload.percent || 0;
            return [
              `${formatDuration(value)} (${formatPercentage(percent)})`,
              name === 'value' ? props.payload.name : name,
            ];
          }}
          contentStyle={{
            backgroundColor: alpha(theme.palette.background.paper, 0.95),
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 8,
            boxShadow: theme.shadows[3],
          }}
        />
        <Bar dataKey="value" name="Time" radius={[0, 4, 4, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface BreakdownViewProps {
  data: ChartDataPoint[];
  dbTime: number;
}

function BreakdownView({ data, dbTime }: BreakdownViewProps) {
  const _theme = useTheme();

  return (
    <Grid container spacing={1} sx={{ mt: 1 }}>
      <Grid size={{ xs: 12 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Total DB Time: {formatDbTime(dbTime / 60)} ({formatDuration(dbTime)})
        </Typography>
      </Grid>
      {data.map((segment) => (
        <Grid size={{ xs: 6, sm: 4 }} key={segment.name}>
          <Paper
            sx={{
              p: 1.5,
              borderLeft: `4px solid ${segment.color}`,
              backgroundColor: alpha(segment.color || '#9e9e9e', 0.04),
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block' }}
            >
              {segment.name}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {formatDuration(segment.value)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatPercentage(segment.percent || 0)}
            </Typography>
          </Paper>
        </Grid>
      ))}
    </Grid>
  );
}

// ==================== Main Component ====================

/**
 * TimeModelChart - Displays Oracle time model breakdown visualization
 */
export function TimeModelChart({
  data,
  height = DEFAULT_HEIGHT,
  showBreakdown = false,
  chartType = 'donut',
}: TimeModelChartProps) {
  const theme = useTheme();

  // Prepare chart segments
  const segments = useMemo(() => prepareSegments(data), [data]);

  // Check for empty data
  if (!data || data.dbTime <= 0 || segments.length === 0) {
    return <EmptyState height={height} />;
  }

  // Render based on chart type
  const renderChart = () => {
    switch (chartType) {
      case 'pie':
        return (
          <PieChartView
            data={segments}
            height={height}
            isDonut={false}
            dbTime={data.dbTime}
          />
        );
      case 'bar':
        return <BarChartView data={segments} height={height} />;
      case 'donut':
      default:
        return (
          <PieChartView
            data={segments}
            height={height}
            isDonut={true}
            dbTime={data.dbTime}
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
      {showBreakdown && <BreakdownView data={segments} dbTime={data.dbTime} />}
    </Box>
  );
}

// ==================== Loading Component ====================

export function TimeModelChartLoading({
  height = DEFAULT_HEIGHT,
}: {
  height?: number;
}) {
  return <LoadingState height={height} />;
}

export default TimeModelChart;
