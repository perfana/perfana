'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { authenticatedFetch } from '@/lib/api';
import {
  TestRunDetails,
  BaselinePreviewResponse,
  BaselinePreviewItem,
  Scope,
  SortColumn,
  SortDirection,
  DEFAULT_MIN_SAMPLES,
} from '../types';

interface UseBaselineApdexProps {
  open: boolean;
  testRunId: string;
  onSuccess: () => void;
  onClose: () => void;
}

export function useBaselineApdex({
  open,
  testRunId,
  onSuccess,
  onClose,
}: UseBaselineApdexProps) {
  // Form state
  const [targetApdex, setTargetApdex] = useState<number>(0.85);
  const [scope, setScope] = useState<Scope>('workload');
  const [minSamples, setMinSamples] = useState<number>(DEFAULT_MIN_SAMPLES);

  // Test run details state
  const [testRunDetails, setTestRunDetails] = useState<TestRunDetails | null>(null);
  const [loadingTestRun, setLoadingTestRun] = useState(false);

  // API state
  const [previewData, setPreviewData] = useState<BaselinePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Table sorting state
  const [sortBy, setSortBy] = useState<SortColumn>('transaction_name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Reset state when dialog opens
  useEffect(() => {
    if (open && testRunId) {
      setTargetApdex(0.85);
      setScope('workload');
      setMinSamples(DEFAULT_MIN_SAMPLES);
      setPreviewData(null);
      setError(null);
      setSuccess(false);
      setTestRunDetails(null);
      fetchTestRunDetails();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, testRunId]);

  const fetchTestRunDetails = useCallback(async () => {
    try {
      setLoadingTestRun(true);
      const response = await authenticatedFetch(`/test-runs/${testRunId}`);
      if (response.ok) {
        const data = await response.json();
        setTestRunDetails({
          system_name: data.system_name || data.systems_under_test?.name || data.system_under_test_id || 'Unknown',
          test_environment: data.test_environment || 'Unknown',
          workload: data.workload || 'Unknown',
        });
      }
    } catch (err) {
      // Silently handle error - details are not critical
    } finally {
      setLoadingTestRun(false);
    }
  }, [testRunId]);

  const handleCalculatePreview = useCallback(async () => {
    setPreviewLoading(true);
    setError(null);
    setPreviewData(null);

    try {
      const response = await authenticatedFetch(
        `/test-runs/${testRunId}/baseline-apdex/preview`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            target_apdex: targetApdex,
            scope: scope,
            min_samples: minSamples,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `Failed to calculate preview: ${response.statusText}`
        );
      }

      const data: BaselinePreviewResponse = await response.json();
      setPreviewData(data);
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to calculate baseline Apdex preview'
      );
    } finally {
      setPreviewLoading(false);
    }
  }, [testRunId, targetApdex, scope, minSamples]);

  const handleApplyThresholds = useCallback(async () => {
    if (!previewData) return;

    setApplyLoading(true);
    setError(null);

    try {
      const response = await authenticatedFetch(
        `/test-runs/${testRunId}/baseline-apdex/apply`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            target_apdex: previewData.target_apdex,
            scope: previewData.scope,
            // Must match the preview the user is looking at, or apply would skip
            // the low-sample transactions they just accepted.
            min_samples: minSamples,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `Failed to apply thresholds: ${response.statusText}`
        );
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
          : 'Failed to apply baseline Apdex thresholds'
      );
    } finally {
      setApplyLoading(false);
    }
  }, [previewData, testRunId, minSamples, onSuccess, onClose]);

  const handleSort = useCallback((column: SortColumn) => {
    setSortDirection((prev) => (sortBy === column && prev === 'asc' ? 'desc' : 'asc'));
    setSortBy(column);
  }, [sortBy]);

  const handleTargetApdexChange = useCallback((value: number) => {
    setTargetApdex(value);
    setPreviewData(null);
  }, []);

  const handleMinSamplesChange = useCallback((value: number) => {
    setMinSamples(value);
    setPreviewData(null);
  }, []);

  const handleScopeChange = useCallback((newScope: Scope) => {
    setScope(newScope);
    setPreviewData(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Get sorted items
  const sortedItems = useMemo((): BaselinePreviewItem[] => {
    if (!previewData) return [];

    return [...previewData.items].sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }

      // Handle null values
      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return sortDirection === 'asc' ? 1 : -1;
      if (bValue === null) return sortDirection === 'asc' ? -1 : 1;

      return 0;
    });
  }, [previewData, sortBy, sortDirection]);

  // Group items by scenario name
  const groupedItems = useMemo((): Record<string, BaselinePreviewItem[]> => {
    if (!previewData) return {};

    const groups: Record<string, BaselinePreviewItem[]> = {};

    for (const item of sortedItems) {
      const scenarioKey = item.scenario_name || 'default';
      if (!groups[scenarioKey]) {
        groups[scenarioKey] = [];
      }
      groups[scenarioKey].push(item);
    }

    return groups;
  }, [previewData, sortedItems]);

  // Get scenario names sorted
  const scenarioNames = useMemo((): string[] => {
    return Object.keys(groupedItems).sort((a, b) => {
      // 'default' should come first
      if (a === 'default') return -1;
      if (b === 'default') return 1;
      return a.localeCompare(b);
    });
  }, [groupedItems]);

  return {
    // Form state
    targetApdex,
    scope,
    minSamples,

    // Test run details
    testRunDetails,
    loadingTestRun,

    // API state
    previewData,
    previewLoading,
    applyLoading,
    error,
    success,

    // Table state
    sortBy,
    sortDirection,

    // Computed values
    sortedItems,
    groupedItems,
    scenarioNames,

    // Handlers
    handleTargetApdexChange,
    handleMinSamplesChange,
    handleScopeChange,
    handleCalculatePreview,
    handleApplyThresholds,
    handleSort,
    clearError,
  };
}
