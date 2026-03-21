import {
  CreateProfileBenchmarkData,
  UpdateProfileBenchmarkData,
  ProfileBenchmark,
} from '@/lib/profile-benchmarks';
import { ProfileDashboard } from '@/lib/profiles';

/**
 * Panel data from Grafana dashboard
 */
export interface GrafanaPanel {
  id: number;
  title: string;
  type: string;
  description?: string;
  yAxesFormat?: string | null;
}

/**
 * Parsed value with unit information
 */
export interface ParsedValue {
  value: string;
  unit: string;
  unitId: string;
}

/**
 * Form data state for benchmark creation/editing
 */
export interface BenchmarkFormData {
  selectedDashboard: ProfileDashboard | null;
  selectedPanel: GrafanaPanel | null;
  workloadPattern: string;
  evaluateType: string;
  requirementOperator: string;
  requirementValue: string;
  tags: string[];
  excludeRampUpTime: boolean;
  averageAll: boolean;
  matchPattern: string;
  validateWithDefaultIfNoData: boolean;
  validateWithDefaultIfNoDataValue: string;
}

/**
 * Props for the BenchmarkFormDialog component
 */
export interface BenchmarkFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  benchmark?: ProfileBenchmark;
  profileDashboards: ProfileDashboard[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (data: CreateProfileBenchmarkData | UpdateProfileBenchmarkData) => Promise<void>;
}

/**
 * Evaluation type option for autocomplete
 */
export interface EvaluationTypeOption {
  value: string;
  label: string;
  description: string;
}

/**
 * Operator option for autocomplete
 */
export interface OperatorOption {
  value: string;
  label: string;
  description: string;
}

/**
 * Configuration for evaluation types
 */
export const EVALUATION_TYPES: EvaluationTypeOption[] = [
  { value: 'avg', label: 'Average', description: 'Calculate the average value across all data points' },
  { value: 'max', label: 'Maximum', description: 'Use the maximum value observed' },
  { value: 'min', label: 'Minimum', description: 'Use the minimum value observed' },
  { value: 'last', label: 'Last Value', description: 'Use the most recent value recorded' },
  { value: 'q50', label: '50th Percentile', description: 'Median value - 50% of values are below this' },
  { value: 'q90', label: '90th Percentile', description: '90% of values are below this threshold' },
  { value: 'q95', label: '95th Percentile', description: '95% of values are below this threshold' },
  { value: 'q99', label: '99th Percentile', description: '99% of values are below this threshold' },
];

/**
 * Configuration for requirement operators
 */
export const REQUIREMENT_OPERATORS: OperatorOption[] = [
  { value: 'lt', label: 'Less than (<)', description: 'Metric value must be below the threshold' },
  { value: 'lte', label: 'Less than or equal (≤)', description: 'Metric value must be at or below the threshold' },
  { value: 'gt', label: 'Greater than (>)', description: 'Metric value must be above the threshold' },
  { value: 'gte', label: 'Greater than or equal (≥)', description: 'Metric value must be at or above the threshold' },
  { value: 'eq', label: 'Equal to (=)', description: 'Metric value must exactly match the threshold' },
  { value: 'ne', label: 'Not equal to (≠)', description: 'Metric value must not match the threshold' },
];

/**
 * Labels for evaluation types
 */
export const EVALUATION_TYPE_LABELS: Record<string, string> = {
  'avg': 'Average',
  'max': 'Maximum',
  'min': 'Minimum',
  'last': 'Last Value',
  'q50': '50th Percentile',
  'q90': '90th Percentile',
  'q95': '95th Percentile',
  'q99': '99th Percentile',
};

/**
 * Labels for requirement operators
 */
export const OPERATOR_LABELS: Record<string, string> = {
  'lt': 'Less than (<)',
  'lte': 'Less than or equal (≤)',
  'gt': 'Greater than (>)',
  'gte': 'Greater than or equal (≥)',
  'eq': 'Equal to (=)',
  'ne': 'Not equal to (≠)',
};

/**
 * Supported panel types from Grafana
 */
export const SUPPORTED_PANEL_TYPES = ['graph', 'timeseries', 'stat', 'singlestat', 'flamegraph'];
