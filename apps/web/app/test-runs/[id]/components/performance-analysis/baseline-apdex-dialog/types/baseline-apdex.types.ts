/**
 * Types and utilities for BaselineApdexDialog
 */

export interface TestRunDetails {
  system_name: string;
  test_environment: string;
  workload: string;
}

export interface BaselineApdexDialogProps {
  open: boolean;
  onClose: () => void;
  testRunId: string;
  onSuccess: () => void;
}

export interface BaselinePreviewItem {
  transaction_name: string;
  scenario_name: string;
  current_threshold: number | null;
  calculated_threshold: number | null;
  current_apdex: number | null;
  projected_apdex: number | null;
  sample_count: number;
  achievable: boolean;
  message?: string | null;
}

export interface BaselineWorkloadSummary {
  current_workload_threshold: number | null;
  calculated_workload_threshold: number | null;
  current_workload_apdex: number | null;
  projected_workload_apdex: number | null;
  total_transactions: number;
  achievable_count: number;
}

export interface BaselinePreviewResponse {
  scope: 'workload' | 'transaction';
  target_apdex: number;
  items: BaselinePreviewItem[];
  workload_summary?: BaselineWorkloadSummary | null;
}

export type SortColumn = keyof BaselinePreviewItem;
export type SortDirection = 'asc' | 'desc';
export type Scope = 'workload' | 'transaction';

/**
 * Get color based on Apdex score category
 */
export const getApdexColor = (apdex: number | null): string => {
  if (apdex === null) return '#9e9e9e';
  if (apdex >= 0.94) return '#4caf50'; // Green - Excellent
  if (apdex >= 0.85) return '#2196f3'; // Blue - Good
  if (apdex >= 0.70) return '#ff9800'; // Orange - Fair
  if (apdex >= 0.50) return '#ff9800'; // Orange - Poor
  return '#f44336'; // Red - Unacceptable
};

/**
 * Get label based on Apdex score category
 */
export const getApdexLabel = (apdex: number): string => {
  if (apdex >= 0.94) return 'Excellent';
  if (apdex >= 0.85) return 'Good';
  if (apdex >= 0.70) return 'Fair';
  if (apdex >= 0.50) return 'Poor';
  return 'Unacceptable';
};

/**
 * Apdex slider marks for the slider component
 */
export const APDEX_SLIDER_MARKS = [
  { value: 0, label: '0.0' },
  { value: 0.5, label: '0.5' },
  { value: 0.7, label: '0.7' },
  { value: 0.85, label: '0.85' },
  { value: 0.94, label: '0.94' },
  { value: 1, label: '1.0' },
] as const;
