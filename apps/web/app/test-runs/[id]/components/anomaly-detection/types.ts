import { TestRun } from '@/types/test-runs';

export interface AnomalyData {
  dashboard_label: string;
  dashboard_uid?: string | null;
  source_type?: string | null;
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

/** Response of GET /adapt/conclusion/:testRunId — the run-level ADAPT verdict. */
export interface AdaptConclusion {
  label?: string;
  tracked_regressions?: unknown[];
  details?: { message?: string };
  [key: string]: unknown;
}

export type ConclusionLabel = 'REGRESSION' | 'OK' | 'IMPROVEMENT' | string;

/** One of the three ADAPT difference checks (percentage, IQR, absolute). */
export interface AdaptCheck {
  isDifference?: boolean;
  /** False when the check could not be evaluated (missing baseline, etc.). */
  valid?: boolean;
  [key: string]: unknown;
}

/**
 * The ADAPT result behind an expanded anomaly row. The payload carries more
 * than this, so the index signature stays — these are the fields the drawer
 * and the threshold table actually read.
 */
/** Test vs control for one statistic. Keyed dynamically on DrawerData. */
export interface AdaptStatisticValues {
  test: number;
  control: number;
  diff: number;
}

export interface DrawerData {
  statistic?: {
    /** Which keyed statistic (mean, median, q95, ...) is the primary one. */
    name?: string;
    test?: number;
    control?: number;
    diff?: number;
    effect_size?: number | string;
    [key: string]: unknown;
  };
  checks?: {
    pct?: AdaptCheck;
    iqr?: AdaptCheck;
    abs?: AdaptCheck;
    [key: string]: AdaptCheck | undefined;
  };
  compare_config?: {
    source?: string;
    thresholds?: {
      percentageThreshold?: number | null;
      iqrThreshold?: number | null;
      absoluteThreshold?: number | null;
      aggregation?: string;
      [key: string]: unknown;
    };
    metricClassification?: {
      classification?: string;
      higherIsBetter?: boolean;
    };
    ignore?: boolean;
    [key: string]: unknown;
  };
  thresholds?: {
    lower?: Record<string, number | undefined>;
    upper?: Record<string, number | undefined>;
  };
  metric_classification?: {
    higherIsBetter?: boolean;
    [key: string]: unknown;
  };
  conclusion?: {
    label?: ConclusionLabel;
    [key: string]: unknown;
  };
  /**
   * Per-statistic distributions (mean, median, iqr, q10, q25, ...) live at the
   * top level under their own key, so they are read through the index
   * signature and narrowed to AdaptStatisticValues at the call site.
   */
  [key: string]: unknown;
}

export interface TrendsData {
  [key: string]: MetricTrendData[];
}

/** The ADAPT compare-config form, as edited in the anomaly row drawer. */
export interface ConfigFormData {
  ignore?: boolean;
  metricClassification: {
    classification?: string;
    higherIsBetter?: boolean;
  };
  thresholds: {
    aggregation?: string;
    /** Entered as a percentage; divided by 100 before it is sent. */
    percentageThreshold: number;
    iqrThreshold?: number;
    absoluteThreshold?: number;
  };
  defaultValueIfControlGroupMissing?: number;
  [key: string]: unknown;
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