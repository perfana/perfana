import { CheckResult } from '@/lib/types';
'use client';

/**
 * Types for Apdex Thresholds Management Dialog
 */

export interface TestRunDetails {
  test_run_id: string;
  system_under_test_id: string;
  system_name: string;
  test_environment: string;
  workload: string;
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

export interface ApdexThresholdsManagementDialogProps {
  open: boolean;
  onClose: () => void;
  testRunId: string;
  apdexCheckResult: CheckResult | null;
  onSuccess: () => void;
}

export type ApdexScope = 'workload' | 'transaction';
export type ReEvaluateOption = 'none' | 'current' | 'all';
export type SortField = keyof BaselinePreviewItem;
export type SortDirection = 'asc' | 'desc';

export interface UseApdexThresholdsReturn {
  // Form state
  targetApdex: number;
  setTargetApdex: (value: number) => void;
  scope: ApdexScope;
  handleScopeChange: (newScope: ApdexScope) => void;

  // Test run details
  testRunDetails: TestRunDetails | null;
  loadingTestRun: boolean;

  // API state
  previewData: BaselinePreviewResponse | null;
  previewLoading: boolean;
  applyLoading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  success: boolean;

  // Threshold overrides
  thresholdOverrides: Record<string, number | null>;
  workloadThresholdOverride: number | null;
  handleThresholdOverride: (transactionName: string, value: string) => void;
  handleWorkloadThresholdOverride: (value: string) => void;

  // Re-evaluation
  reEvaluateOption: ReEvaluateOption;
  setReEvaluateOption: (option: ReEvaluateOption) => void;

  // Sorting
  sortBy: SortField;
  sortDirection: SortDirection;
  handleSort: (column: SortField) => void;

  // Actions
  handleCalculatePreview: () => Promise<void>;
  handleApplyThresholds: () => Promise<void>;

  // Utilities
  getSortedItems: (items: BaselinePreviewItem[]) => BaselinePreviewItem[];
  getGroupedItems: (items: BaselinePreviewItem[]) => Record<string, BaselinePreviewItem[]>;
  getScenarioNames: (items: BaselinePreviewItem[]) => string[];
  getEffectiveThreshold: (item: BaselinePreviewItem) => number | null;
  hasAnyOverrides: boolean;
}
