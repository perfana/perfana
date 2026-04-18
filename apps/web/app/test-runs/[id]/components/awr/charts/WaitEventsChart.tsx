'use client';

/**
 * WaitEventsChart Component
 *
 * Displays wait events from AWR reports in various chart formats.
 * Supports bar charts, pie charts, and treemap views. Can group
 * wait events by wait class for better visualization.
 *
 * @example
 * ```tsx
 * <WaitEventsChart
 *   data={waitEventsData}
 *   height={300}
 *   groupByClass
 *   chartType="bar"
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
  PieChart,
  Pie,
  Treemap,
} from 'recharts';
import type { WaitEventsChartProps, WaitEventChartData } from '../types';
import { WAIT_CLASS_COLORS } from '../types';
import {, formatPercentage, formatDuration } from '../utils/formatters';

// ==================== Constants ====================

const DEFAULT_HEIGHT = 300;
const DEFAULT_MAX_EVENTS = 10;

// Default colors for wait classes if not defined in WAIT_CLASS_COLORS
const DEFAULT_WAIT_CLASS_COLORS: Record<string, string> = {
  'User I/O': '#4caf50',
  'System I/O': '#8bc34a',
  Concurrency: '#ff9800',
  Application: '#2196f3',
  Commit: '#9c27b0',
  Configuration: '#795548',
  Network: '#00bcd4',
  Scheduler: '#607d8b',
  Cluster: '#e91e63',
  Administrative: '#9e9e9e',
  Other: '#bdbdbd',
  Idle: '#f5f5f5',
};

// ==================== Helper Functions ====================

/**
 * Get color for a wait class
 */
function getWaitClassColor(waitClass: string): string {
  return (
    WAIT_CLASS_COLORS[waitClass] ||
    DEFAULT_WAIT_CLASS_COLORS[waitClass] ||
    '#9e9e9e'
  );
}

/**
 * Group wait events by wait class
 */
function groupByWaitClass(
  data: WaitEventChartData[],
): WaitEventChartData[] {
  const grouped = data.reduce(
    (acc, event) => {
      const className = event.waitClass || 'Other';
      if (!acc[className]) {
        acc[className] = {
          event: className,
          waitClass: className,
          waitTime: 0,
          percent: 0,
          color: getWaitClassColor(className),
        };
      }
      acc[className].waitTime += event.waitTime;
      acc[className].percent += event.percent;
      return acc;
    },
    {} as Record<string, WaitEventChartData>,
  );

  return Object.values(grouped).sort((a, b) => b.waitTime - a.waitTime);
}

/**
 * Sort and limit wait events
 */
function prepareData(
  data: WaitEventChartData[],
  maxEvents: number,
  groupByClass: boolean,
): WaitEventChartData[] {
  let processed = groupByClass ? groupByWaitClass(data) : [...data];

  // Sort by wait time descending
  processed.sort((a, b) => b.waitTime - a.waitTime);

  // Limit to max events
  if (processed.length > maxEvents) {
    const top = processed.slice(0, maxEvents - 1);
    const others = processed.slice(maxEvents - 1);
    const otherTotal = others.reduce((sum, e) => sum + e.waitTime, 0);
    const otherPercent = others.reduce((sum, e) => sum + e.percent, 0);

    top.push({
      event: 'Other Events',
      waitClass: 'Other',
      waitTime: otherTotal,
      percent: otherPercent,
      color: getWaitClassColor('Other'),
    });

    processed = top;
  }

  // Assign colors
  return processed.map((event) => ({
    ...event,
    color: event.color || getWaitClassColor(event.waitClass),
  }));
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
        No wait events data available
      </Typography>
    </Box>
  );
}

// ==================== Chart Type Components ====================

interface BarChartViewProps {
  data: WaitEventChartData[];
  height: number;
  showPercentages: boolean;
}

function BarChartView({
  data,
  height,
  showPercentages,
}: BarChartViewProps) {
  const theme = useTheme();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 20, right: 30, left: 120, bottom: 5 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke={alpha(theme.palette.divider, 0.5)}
        />
        <XAxis
          type="number"
          tickFormatter={(value) => formatDuration(value, 1)}
          style={{ fontSize: '0.75rem' }}
        />
        <YAxis
          type="category"
          dataKey="event"
          style={{ fontSize: '0.75rem' }}
          width={110}
          tickFormatter={(value) =>
            value.length > 20 ? `${value.substring(0, 18)}...` : value
          }
        />
        <RechartsTooltip
          formatter={(value: number) => [formatDuration(value), 'Wait Time']}
          labelFormatter={(label) => label}
          contentStyle={{
            backgroundColor: alpha(theme.palette.background.paper, 0.95),
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 8,
            boxShadow: theme.shadows[3],
          }}
          content={({ payload, label }) => {
            if (!payload || payload.length === 0) return null;
            const data = payload[0].payload as WaitEventChartData;
            return (
              <Box
                sx={{
                  backgroundColor: alpha(theme.palette.background.paper, 0.95),
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 1,
                  p: 1.5,
                  boxShadow: theme.shadows[3],
                }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {label}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Wait Class: {data.waitClass}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Wait Time: {formatDuration(data.waitTime)}
                </Typography>
                {showPercentages && (
                  <Typography variant="body2" color="text.secondary">
                    % of Total: {formatPercentage(data.percent)}
                  </Typography>
                )}
              </Box>
            );
          }}
        />
        <Legend />
        <Bar dataKey="waitTime" name="Wait Time" radius={[0, 4, 4, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface PieChartViewProps {
  data: WaitEventChartData[];
  height: number;
  showPercentages: boolean;
}

function PieChartView({
  data,
  height,
  showPercentages,
}: PieChartViewProps) {
  const theme = useTheme();

  // Custom label renderer
  const renderLabel = ({
    name,
    percent,
  }: {
    name: string;
    percent: number;
  }) => {
    if (percent < 0.05) return null; // Don't show labels for small slices
    const displayName = name.length > 15 ? `${name.substring(0, 13)}...` : name;
    return showPercentages
      ? `${displayName} (${(percent * 100).toFixed(1)}%)`
      : displayName;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="waitTime"
          nameKey="event"
          cx="50%"
          cy="50%"
          outerRadius={height / 3}
          innerRadius={height / 6}
          label={renderLabel}
          labelLine={{ stroke: theme.palette.text.secondary, strokeWidth: 1 }}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
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
          formatter={(value) =>
            value.length > 20 ? `${value.substring(0, 18)}...` : value
          }
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

interface TreemapViewProps {
  data: WaitEventChartData[];
  height: number;
  showPercentages: boolean;
}

// Custom treemap content renderer
interface TreemapContentProps {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  value: number;
  color: string;
  showPercentages: boolean;
  totalValue: number;
}

function TreemapContent({
  x,
  y,
  width,
  height,
  name,
  value,
  color,
  showPercentages,
  totalValue,
}: TreemapContentProps) {
  // Only show text if the cell is large enough
  const showText = width > 60 && height > 40;
  const percent = totalValue > 0 ? (value / totalValue) * 100 : 0;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill: color,
          stroke: '#fff',
          strokeWidth: 2,
          strokeOpacity: 1,
        }}
      />
      {showText && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - (showPercentages ? 8 : 0)}
            textAnchor="middle"
            fill="#fff"
            fontSize={Math.min(width / 10, 12)}
            fontWeight={600}
          >
            {name.length > width / 8
              ? `${name.substring(0, Math.floor(width / 8))}...`
              : name}
          </text>
          {showPercentages && (
            <text
              x={x + width / 2}
              y={y + height / 2 + 12}
              textAnchor="middle"
              fill="#fff"
              fontSize={Math.min(width / 12, 11)}
            >
              {formatPercentage(percent)}
            </text>
          )}
        </>
      )}
    </g>
  );
}

function TreemapView({
  data,
  height,
  showPercentages,
}: TreemapViewProps) {
  const theme = useTheme();
  const totalValue = useMemo(
    () => data.reduce((sum, d) => sum + d.waitTime, 0),
    [data],
  );

  // Transform data for treemap
  const treemapData = data.map((d) => ({
    name: d.event,
    value: d.waitTime,
    color: d.color || getWaitClassColor(d.waitClass),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <Treemap
        data={treemapData}
        dataKey="value"
        aspectRatio={4 / 3}
        stroke="#fff"
        content={
          <TreemapContent
            x={0}
            y={0}
            width={0}
            height={0}
            name=""
            value={0}
            color=""
            showPercentages={showPercentages}
            totalValue={totalValue}
          />
        }
      >
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
      </Treemap>
    </ResponsiveContainer>
  );
}

// ==================== Main Component ====================

/**
 * WaitEventsChart - Displays wait events visualization
 */
export function WaitEventsChart({
  data,
  height = DEFAULT_HEIGHT,
  groupByClass = false,
  maxEvents = DEFAULT_MAX_EVENTS,
  chartType = 'bar',
  showPercentages = true,
}: WaitEventsChartProps) {
  const theme = useTheme();

  // Prepare chart data
  const chartData = useMemo(
    () => prepareData(data, maxEvents, groupByClass),
    [data, maxEvents, groupByClass],
  );

  // Check for empty data
  if (!data || data.length === 0) {
    return <EmptyState height={height} />;
  }

  // Render based on chart type
  const renderChart = () => {
    switch (chartType) {
      case 'pie':
        return (
          <PieChartView
            data={chartData}
            height={height}
            showPercentages={showPercentages}
          />
        );
      case 'treemap':
        return (
          <TreemapView
            data={chartData}
            height={height}
            showPercentages={showPercentages}
          />
        );
      case 'bar':
      default:
        return (
          <BarChartView
            data={chartData}
            height={height}
            showPercentages={showPercentages}
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

export function WaitEventsChartLoading({
  height = DEFAULT_HEIGHT,
}: {
  height?: number;
}) {
  return <LoadingState height={height} />;
}

export default WaitEventsChart;
