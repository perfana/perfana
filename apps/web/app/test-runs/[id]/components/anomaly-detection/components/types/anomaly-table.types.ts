import { AnomalyData, MetricTrendData } from '../../types';
import { TestRun } from '@/types/test-runs';
import { DeleteOptions } from '../DeleteAnomalyDialog';

export interface ConfigSetting {
  key: string;
  value: string;
  description?: string;
}

export interface StaleTooltipContentProps {
  row: AnomalyData;
  testRunId: string;
  drawerData?: Record<string, any>;
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
  drawerData: Record<string, any>;
  drawerLoading: Record<string, boolean>;
  showToast?: (message: string) => void;

  // Additional drawer and config functionality
  showConfigForm?: Record<string, boolean>;
  configFormData?: Record<string, any>;
  onConfigFormToggle?: (rowKey: string) => void;
  onConfigSave?: (rowKey: string, data: any, scope: 'metric' | 'panel') => Promise<void>;

  // Re-analysis functionality
  onRefreshAnomalyData?: () => void;

  // Delete functionality
  onDeleteAnomaly?: (anomaly: AnomalyData, options: DeleteOptions) => Promise<void>;

  // Drill-down functionality
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;
  onDrillDownToDistributedTracing?: (filters: DrillDownFilters) => void;
  onDrillDownToDynatrace?: (filters: DrillDownFilters) => void;
}

export interface ThresholdComparisonData {
  threshold: string;
  configuredValue: string;
  thresholdValue: string;
  source: string;
  observedDifference: string;
  result: 'passed' | 'failed' | 'skipped';
  enabled: boolean;
}

export interface TrendsPlotData {
  plotData: any[];
  plotLayout: any;
  plotConfig: any;
}
