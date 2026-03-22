import { TestRun } from '@/types/test-runs';

export interface AnomalyData {
  dashboard_label: string;
  panel_title: string;
  metric_name: string;
  unit: string | null;
  classification: string;
  conclusion_label: string;
  test_value: string;
  control_group_value: string;
  difference: string | null;
  application_dashboard_id: string;
  metrics_source_id?: string;
  panel_id: string;
  compare_config?: {
    thresholds?: {
      percentageThreshold?: number;
      absoluteThreshold?: number;
      iqrThreshold?: number;
      aggregation?: string;
    };
    metricClassification?: {
      classification?: string;
      higherIsBetter?: boolean;
    };
    ignore?: boolean;
    statistic?: string;
    source?: string;
  };
  // Stale tracking fields
  is_stale?: boolean;
  stale_reason?: string;
  stale_at?: string;
  config_hash_used?: string;
}

export interface MetricTrendData {
  test_run_id: string;
  test_run_start: string;
  dashboard_label: string;
  panel_title: string;
  metric_name: string;
  unit?: string | null;
  mean: number;
  value: number;
  thresholds?: {
    lower: { overall: number | null };
    upper: { overall: number | null };
  };
  conclusion_label: string;
  version?: string | null;
  annotations?: string | null;
}

export interface AnomalyDetectionSectionProps {
  testRun: TestRun | null;
  testRunId: string;
  anomalyExpanded: boolean;
  onAnomalyExpand: () => void;
  conclusionFilter: string;
  setConclusionFilter: (value: string) => void;
  showToast: (message: string) => void;
  onTestRunUpdate?: (updatedTestRun: TestRun) => void;
}

export interface ConfigSourceInfo {
  label: string;
  color: 'primary' | 'secondary' | 'default';
  description: string;
}

export interface DrawerData {
  [key: string]: any;
}

export interface TrendsData {
  [key: string]: MetricTrendData[];
}

export interface ConfigFormData {
  [key: string]: any;
}

export interface ThresholdsFormData {
  lower?: number;
  upper?: number;
}

export interface ExpandedRowsState {
  [key: string]: boolean;
}

export interface DrawerOpenState {
  [key: string]: boolean;
}

export interface DrawerLoadingState {
  [key: string]: boolean;
}

export interface TrendsLoadingState {
  [key: string]: boolean;
}

export interface ShowConfigFormState {
  [key: string]: boolean;
}

export interface ChartKeyState {
  [key: string]: number;
}

export type ConclusionLabel = 'REGRESSION' | 'OK' | 'IMPROVEMENT' | string;
export type ClassificationFilter = 'all' | 'higher-is-better' | 'lower-is-better' | string;

export interface ThresholdData {
  x: string[];
  y: number[];
  mode: string;
  type: string;
  line: {
    color: string;
    dash: string;
  };
  name: string;
}