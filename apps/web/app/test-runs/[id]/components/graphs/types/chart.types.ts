import { Theme } from '@mui/material';
import { SeriesConfig, MetricDataPoint } from './graphs.types';
import { TestRun } from '@/types/test-runs';
import type { PerfanaEvent } from '@/lib/events';

/**
 * Props for GraphsChart component
 */
export interface GraphsChartProps {
  testRun: TestRun | null;
  seriesData: Map<string, MetricDataPoint[]>; // key = series.id
  seriesConfig: SeriesConfig[];
  loading: boolean;
  chartName?: string;
  events?: PerfanaEvent[];
}

/**
 * Result of multi-axis assignment logic
 */
export interface AxisAssignment {
  leftAxisSeries: SeriesConfig[];
  rightAxisSeries: SeriesConfig[];
}

/**
 * Unit conversion result with factor and label
 */
export interface UnitConversion {
  factor: number;
  label: string;
}

/**
 * Theme colors for chart rendering
 */
export interface ChartThemeColors {
  textColor: string;
  textSecondary: string;
  bgColor: string;
  plotBgColor: string;
  gridColor: string;
  dividerColor: string;
  fontFamily: string;
  hoverBgColor: string;
}

/**
 * Plotly trace configuration
 */
export interface PlotTrace {
  x: number[];
  y: number[];
  type: 'scatter';
  mode: 'lines' | 'lines+markers';
  name: string;
  line: {
    color: string;
    width: number;
    shape: 'linear';
  };
  marker: {
    size: number;
    color: string;
    line: {
      color: string;
      width: number;
    };
  };
  yaxis: 'y' | 'y2';
  connectgaps: boolean;
  hovertemplate: string;
  text: string[];
}

/**
 * Extract theme colors for chart rendering
 */
export function extractChartThemeColors(theme: Theme): ChartThemeColors {
  const isDark = theme.palette.mode === 'dark';
  return {
    textColor: theme.palette.text.primary,
    textSecondary: theme.palette.text.secondary,
    bgColor: isDark ? 'transparent' : theme.palette.background.paper,
    plotBgColor: isDark ? 'transparent' : theme.palette.grey[50],
    gridColor: isDark ? 'rgba(255, 255, 255, 0.12)' : '#e0e0e0',
    dividerColor: theme.palette.divider,
    fontFamily: theme.typography.fontFamily as string,
    hoverBgColor: isDark ? '#1e293b' : theme.palette.background.paper,
  };
}

/**
 * Props for ChartEmptyState component
 */
export interface ChartEmptyStateProps {
  variant: 'no-series' | 'no-data';
  height?: number;
}

/**
 * Props for ChartLoadingState component
 */
export interface ChartLoadingStateProps {
  height?: number;
}
