import { SeriesConfig, MetricDataPoint } from './graphs.types';
import { TestRun } from '@/types/test-runs';
import type { PerfanaEvent } from '@/lib/events';
import type { AxisDisplayMode } from '@/components/charts';

/**
 * A zoom window, as ISO timestamps. Zooming refetches the visible range so the API's
 * per-panel downsample budget is spent on it; it cannot go below the bucket size the
 * data was collected at.
 */
export interface ChartTimeRange {
  from: string;
  to: string;
}

/**
 * Props for GraphsChart component
 *
 * `extractChartThemeColors`, `AxisAssignment`, `UnitConversion` and `ChartThemeColors`
 * used to live here. They are `@/lib/charts` now — the dark-mode `#121212` paper and
 * `#1e1e1e` plot background they defined sat inside a `#1e293b` card, which is the
 * mismatch the Analyst standard's single theme exists to end.
 */
export interface GraphsChartProps {
  testRun: TestRun | null;
  seriesData: Map<string, MetricDataPoint[]>; // key = series.id
  seriesConfig: SeriesConfig[];
  loading: boolean;
  chartName?: string;
  events?: PerfanaEvent[];
  /** Toast host for the header's copy/download actions. */
  showToast?: (message: string) => void;
  /** The card header's title slot — an editable name in the expanded card. */
  titleNode?: React.ReactNode;
  /** Chart-level buttons (save as preset). */
  actions?: React.ReactNode;
  /** The cascade, shown when `+ add series` is open. `close` collapses the panel again. */
  cascade?: (close: () => void) => React.ReactNode;
  /** Overlay, or one lane per unit family. Persisted with the preset. */
  axisMode?: AxisDisplayMode;
  onAxisModeChange?: (mode: AxisDisplayMode) => void;
  onRemoveSeries?: (seriesId: string) => void;
  onUpdateSeriesUnit?: (seriesId: string, unitId: string) => void;
  onToggleSeriesVisibility?: (seriesId: string) => void;
  /**
   * A drag-zoom on the plot, or `null` on a double-click reset. Given, the card refetches
   * the window at full resolution; omitted, zoom is plot-local as before.
   */
  onZoomRange?: (range: ChartTimeRange | null) => void;
  /** True while a zoom window is in force — the chart holds that window's data only. */
  zoomed?: boolean;
}

/**
 * A Plotly scatter trace as this card builds it. Loose where Plotly is loose (`yaxis` is
 * `y`, `y2`, `y3`… once lanes exist) rather than re-stating the library's types.
 */
export interface PlotTrace {
  x: number[];
  y: number[];
  type: 'scatter';
  /** `lines+markers` for a one-point series, which has no segment to draw. See GraphsChart. */
  mode: 'lines' | 'lines+markers';
  name: string;
  line: { color: string; width: number; shape: 'linear'; dash?: string };
  marker?: { color: string; size: number };
  yaxis: string;
  connectgaps: boolean;
  /** The series table is the readout, so no floating tooltip is drawn. */
  hoverinfo: 'none';
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
