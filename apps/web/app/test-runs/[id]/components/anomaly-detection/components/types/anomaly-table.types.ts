import type { DrawerData } from '../../types';
import { AnomalyData, MetricTrendData } from '../../types';
import { TestRun } from '@/types/test-runs';
import { DeleteOptions } from '../DeleteAnomalyDialog';
import type { AnomalySortKey, SortDirection, DiffSortMode } from '../../hooks/useAnomalyDetection';

export interface ConfigSetting {
  key: string;
  value: string;
  description?: string;
}

export interface StaleTooltipContentProps {
  row: AnomalyData;
  testRunId: string;
  drawerData?: Record<string, unknown>;
  rowIndex: number;
}

export interface DrillDownFilters {
  scenario?: string;
  transaction?: string;
  sampler?: string;
}

export interface AnomalyDetectionTableProps {
  paginatedData: AnomalyData[];
  filteredData: AnomalyData[];
  expandedRows: Set<string>;
  toggleRowExpanded: (rowKey: string) => void;

  // Pagination props
  page: number;
  rowsPerPage: number;
  onPageChange: (event: unknown, newPage: number) => void;
  onRowsPerPageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;

  // Additional props for expanded functionality
  testRunId: string;
  testRun?: TestRun | null;
  trendsData: Record<string, MetricTrendData[]>;
  trendsLoading: Record<string, boolean>;
  chartKey: Record<string, number>;
  drawerOpen: Record<string, boolean>;
  onDrawerToggle: (rowKey: string) => void;
  /** ADAPT result per expanded row, keyed by the row key. */
  drawerData: Record<string, DrawerData>;
  drawerLoading: Record<string, boolean>;
  showToast?: (message: string) => void;

  // Additional drawer and config functionality
  showConfigForm?: Record<string, boolean>;
  configFormData?: Record<string, unknown>;
  onConfigFormToggle?: (rowKey: string) => void;
  onConfigSave?: (rowKey: string, data: unknown, scope: 'metric' | 'panel') => Promise<void>;

  // Re-analysis functionality
  onRefreshAnomalyData?: () => void;

  // Delete functionality
  onDeleteAnomaly?: (anomaly: AnomalyData, options: DeleteOptions) => Promise<void>;

  // Drill-down functionality
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;
  onDrillDownToDistributedTracing?: (filters: DrillDownFilters) => void;
  onDrillDownToDynatrace?: (filters: DrillDownFilters) => void;

  // Sort state
  sortBy: AnomalySortKey | null;
  sortDirection: SortDirection;
  diffSortMode: DiffSortMode;
  onSortChange: (key: AnomalySortKey) => void;
  onDiffSortModeChange: (mode: DiffSortMode) => void;
}

export interface ThresholdComparisonData {
  threshold: string;
  configuredValue: string;
  thresholdValue: string;
  source: string;
  observedDifference: string;
  // Judgment: in range (neutral), a breach judged by side × metric direction, 'invalid'
  // (configured but not evaluable — e.g. zero-variance baseline), or 'skipped' (not configured).
  // 'passed' | 'failed' retained for the legacy DetailDrawer path only.
  result: 'inRange' | 'improvement' | 'regression' | 'invalid' | 'skipped' | 'passed' | 'failed';
  // Which side of the valid range the test value fell on; drives the arrow (▲ above / ▼ below).
  side?: 'above' | 'below';
  // Tooltip text for an 'invalid' row explaining why it couldn't be evaluated.
  reason?: string;
  enabled: boolean;
}

export interface TrendsPlotData {
  plotData: unknown[];
  plotLayout: unknown;
  plotConfig: unknown;
}
