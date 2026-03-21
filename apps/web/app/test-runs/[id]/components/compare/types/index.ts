export type {
  CompareCardProps,
  RelatedTestRun,
  ComparisonStatus,
  ApplicationDashboard,
  Panel,
  MetricStatistic,
  MetricComparison,
  MetricDataPoint,
  GraphData,
  DataSource,
  CompareSeries,
  ComparisonPlotProps,
  MetricsComparisonTableProps,
  AddedSeriesDisplayProps,
} from './compare.types';

// Constants for panel types
export const SUPPORTED_PANEL_TYPES = ['graph', 'timeseries', 'stat', 'singlestat', 'flamegraph'];
