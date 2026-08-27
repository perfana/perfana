import { CheckResult } from '@/lib/types';
'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { triggerSloReEvaluation } from '@/lib/slo-reevaluation';
import {
  TestRunDetails,
  BaselinePreviewItem,
  BaselinePreviewResponse,
  ApdexScope,
  ReEvaluateOption,
  UseApdexThresholdsReturn,
  DEFAULT_MIN_SAMPLES,
} from '../types/apdex-thresholds.types';

interface UseApdexThresholdsManagementProps {
  open: boolean;
  testRunId: string;
  apdexCheckResult: CheckResult | null;
  onSuccess: () => void;
  onClose: () => void;
}

type SortField = keyof BaselinePreviewItem;
type SortDirection = 'asc' | 'desc';

export function useApdexThresholdsManagement({
  open,
  testRunId,
  apdexCheckResult,
  onSuccess,
  onClose,
}: UseApdexThresholdsManagementProps): UseApdexThresholdsReturn {
  // Form state
  const [targetApdex, setTargetApdex] = useState<number>(0.85);
  const [scope, setScope] = useState<ApdexScope>('workload');

  // Test run details state
  const [testRunDetails, setTestRunDetails] = useState<TestRunDetails | null>(null);
  const [loadingTestRun, setLoadingTestRun] = useState(false);

  // API state
  const [previewData, setPreviewData] = useState<BaselinePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Manual threshold overrides
  const [thresholdOverrides, setThresholdOverrides] = useState<Record<string, number | null>>({});
  const [workloadThresholdOverride, setWorkloadThresholdOverride] = useState<number | null>(null);

  // Re-evaluation option
  const [reEvaluateOption, setReEvaluateOption] = useState<ReEvaluateOption>('none');
  const [minSamples, setMinSamples] = useState<number>(DEFAULT_MIN_SAMPLES);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  // Table sorting state
  const [sortBy, setSortBy] = useState<SortField>('transaction_name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Fetch test run details
  const fetchTestRunDetails = useCallback(async () => {
    try {
      setLoadingTestRun(true);
      const response = await authenticatedFetch(`/test-runs/${testRunId}`);
      if (response.ok) {
        const data = await response.json();
        setTestRunDetails({
          test_run_id: data.test_run_id || testRunId,
          system_under_test_id: data.system_under_test_id || '',
          system_name: data.system_name || data.systems_under_test?.name || data.system_under_test_id || 'Unknown',
          test_environment: data.test_environment || 'Unknown',
          workload: data.workload || 'Unknown',
        });
      }
    } catch (err) {
      // Silent error - test run details are optional
    } finally {
      setLoadingTestRun(false);
    }
  }, [testRunId]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open && testRunId) {
      const currentApdex = apdexCheckResult?.panel_average ?? 0.85;
      setTargetApdex(Math.min(Math.max(currentApdex, 0), 1));
      setScope('workload');
      setPreviewData(null);
      setError(null);
      setSuccess(false);
      setReEvaluateOption('none');
      setSaveDialogOpen(false);
      setMinSamples(DEFAULT_MIN_SAMPLES);
      setThresholdOverrides({});
      setWorkloadThresholdOverride(null);
      fetchTestRunDetails();
    }
  }, [open, testRunId, apdexCheckResult, fetchTestRunDetails]);

  // Calculate preview
  const handleCalculatePreview = useCallback(async () => {
    setPreviewLoading(true);
    setError(null);
    setPreviewData(null);
    setThresholdOverrides({});
    setWorkloadThresholdOverride(null);

    try {
      const response = await authenticatedFetch(
        `/test-runs/${testRunId}/baseline-apdex/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_apdex: targetApdex, scope, min_samples: minSamples }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to calculate preview: ${response.statusText}`);
      }

      const data: BaselinePreviewResponse = await response.json();
      setPreviewData(data);
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to calculate threshold preview'
      );
    } finally {
      setPreviewLoading(false);
    }
  }, [testRunId, targetApdex, scope, minSamples]);

  // Trigger re-evaluation
  const triggerReEvaluation = useCallback(async (option: 'current' | 'all') => {
    await triggerSloReEvaluation(option, {
      testRunId: testRunDetails?.test_run_id || testRunId,
      systemUnderTestId: testRunDetails?.system_under_test_id,
      testEnvironment: testRunDetails?.test_environment,
      workload: testRunDetails?.workload,
    });
  }, [testRunDetails, testRunId]);

  // Apply thresholds
  // The Apply button only opens the save dialog — the write happens on confirm,
  // once the user has chosen what to do with the existing analysis.
  const handleOpenSaveDialog = useCallback(() => {
    if (!previewData) return;
    setReEvaluateOption('none');
    setSaveDialogOpen(true);
  }, [previewData]);

  const handleCloseSaveDialog = useCallback(() => {
    setSaveDialogOpen(false);
  }, []);

  const handleApplyThresholds = useCallback(async (option: ReEvaluateOption = reEvaluateOption) => {
    if (!previewData) return;
    setSaveDialogOpen(false);

    setApplyLoading(true);
    setError(null);

    try {
      const hasOverrides = workloadThresholdOverride !== null || Object.keys(thresholdOverrides).length > 0;

      if (hasOverrides) {
        if (scope === 'workload' && workloadThresholdOverride !== null) {
          const response = await authenticatedFetch(`/test-runs/${testRunId}/apdex-threshold`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apdex_threshold: workloadThresholdOverride }),
          });
          if (!response.ok) throw new Error('Failed to apply workload threshold override');
        } else if (scope === 'transaction') {
          for (const item of previewData.items) {
            const overrideValue = thresholdOverrides[item.transaction_name];
            const thresholdToApply = overrideValue ?? item.calculated_threshold;

            if (thresholdToApply !== null && item.achievable) {
              await authenticatedFetch(
                `/test-runs/${testRunId}/transactions/${encodeURIComponent(item.transaction_name)}/apdex-threshold`,
                {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ apdex_threshold: thresholdToApply }),
                }
              );
            }
          }
        }
      } else {
        const response = await authenticatedFetch(`/test-runs/${testRunId}/baseline-apdex/apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_apdex: previewData.target_apdex,
            scope: previewData.scope,
            min_samples: minSamples,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `Failed to apply thresholds: ${response.statusText}`);
        }
      }

      if (option !== 'none') {
        await triggerReEvaluation(option);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to apply thresholds'
      );
    } finally {
      setApplyLoading(false);
    }
  }, [previewData, workloadThresholdOverride, thresholdOverrides, scope, testRunId, minSamples, reEvaluateOption, triggerReEvaluation, onSuccess, onClose]);

  // Handle sorting
  const handleSort = useCallback((column: SortField) => {
    const isAsc = sortBy === column && sortDirection === 'asc';
    setSortDirection(isAsc ? 'desc' : 'asc');
    setSortBy(column);
  }, [sortBy, sortDirection]);

  // Get sorted items
  const getSortedItems = useCallback((items: BaselinePreviewItem[]): BaselinePreviewItem[] => {
    return [...items].sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      }
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return sortDirection === 'asc' ? 1 : -1;
      if (bValue === null) return sortDirection === 'asc' ? -1 : 1;
      return 0;
    });
  }, [sortBy, sortDirection]);

  // Handle scope change
  const handleMinSamplesChange = useCallback((value: number) => {
    setMinSamples(value);
    setPreviewData(null);
  }, []);

  const handleScopeChange = useCallback((newScope: ApdexScope) => {
    setScope(newScope);
    setPreviewData(null);
  }, []);

  // Get grouped items by scenario
  const getGroupedItems = useCallback((items: BaselinePreviewItem[]): Record<string, BaselinePreviewItem[]> => {
    const groups: Record<string, BaselinePreviewItem[]> = {};
    const sorted = getSortedItems(items);

    for (const item of sorted) {
      const key = item.scenario_name || 'default';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }, [getSortedItems]);

  // Get scenario names sorted
  const getScenarioNames = useCallback((items: BaselinePreviewItem[]): string[] => {
    const groups = getGroupedItems(items);
    return Object.keys(groups).sort((a, b) => {
      if (a === 'default') return -1;
      if (b === 'default') return 1;
      return a.localeCompare(b);
    });
  }, [getGroupedItems]);

  // Handle transaction threshold override
  const handleThresholdOverride = useCallback((transactionName: string, value: string) => {
    if (value === '') {
      setThresholdOverrides((prev) => {
        const next = { ...prev };
        delete next[transactionName];
        return next;
      });
    } else {
      const numValue = parseInt(value, 10);
      if (!isNaN(numValue) && numValue >= 1 && numValue <= 60000) {
        setThresholdOverrides((prev) => ({ ...prev, [transactionName]: numValue }));
      }
    }
  }, []);

  // Handle workload threshold override
  const handleWorkloadThresholdOverride = useCallback((value: string) => {
    if (value === '') {
      setWorkloadThresholdOverride(null);
    } else {
      const numValue = parseInt(value, 10);
      if (!isNaN(numValue) && numValue >= 1 && numValue <= 60000) {
        setWorkloadThresholdOverride(numValue);
      }
    }
  }, []);

  // Get effective threshold (override or calculated)
  const getEffectiveThreshold = useCallback((item: BaselinePreviewItem): number | null => {
    return thresholdOverrides[item.transaction_name] ?? item.calculated_threshold;
  }, [thresholdOverrides]);

  // Check if there are any overrides
  const hasAnyOverrides = workloadThresholdOverride !== null || Object.keys(thresholdOverrides).length > 0;

  return {
    // Form state
    targetApdex,
    setTargetApdex,
    scope,
    handleScopeChange,

    // Test run details
    testRunDetails,
    loadingTestRun,

    // API state
    previewData,
    previewLoading,
    applyLoading,
    error,
    setError,
    success,

    // Threshold overrides
    thresholdOverrides,
    workloadThresholdOverride,
    handleThresholdOverride,
    handleWorkloadThresholdOverride,

    // Re-evaluation
    reEvaluateOption,
    setReEvaluateOption,
    minSamples,
    handleMinSamplesChange,
    saveDialogOpen,
    handleOpenSaveDialog,
    handleCloseSaveDialog,

    // Sorting
    sortBy,
    sortDirection,
    handleSort,

    // Actions
    handleCalculatePreview,
    handleApplyThresholds,

    // Utilities
    getSortedItems,
    getGroupedItems,
    getScenarioNames,
    getEffectiveThreshold,
    hasAnyOverrides,
  };
}
