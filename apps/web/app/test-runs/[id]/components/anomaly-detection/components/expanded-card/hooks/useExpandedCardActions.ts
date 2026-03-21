'use client';

/**
 * Hook for handling expanded card actions (changepoint marking, reevaluation, etc.)
 */

import { useCallback } from 'react';
import { TestRun } from '@/types/test-runs';
import { authenticatedFetch } from '@/lib/api';
import { useBatchReevaluation } from '../../../hooks/useBatchReevaluation';
import type { AdaptConfigStatus } from '../types';

interface UseExpandedCardActionsProps {
  testRun: TestRun | null;
  testRunId: string;
  showToast: (message: string) => void;
  updateAdaptConfig: (status: AdaptConfigStatus) => void;
}

interface UseExpandedCardActionsReturn {
  markAsChangepoint: () => Promise<void>;
  handleMarkAsRegression: () => Promise<void>;
  handleMarkAsVariability: () => Promise<void>;
}

export function useExpandedCardActions({
  testRun,
  testRunId,
  showToast,
  updateAdaptConfig,
}: UseExpandedCardActionsProps): UseExpandedCardActionsReturn {
  const { triggerBatchReevaluation } = useBatchReevaluation({
    testRun,
    testRunId,
    showToast,
  });

  /**
   * Marks the current test run as a changepoint for the control group
   */
  const markAsChangepoint = useCallback(async () => {
    if (!testRun?.system_under_test_id || !testRun?.test_environment || !testRun?.workload) {
      showToast('Unable to mark as changepoint - missing test run information');
      return;
    }

    try {
      const response = await authenticatedFetch('/test-runs/mark-changepoint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemUnderTestId: testRun.system_under_test_id,
          testEnvironment: testRun.test_environment,
          workload: testRun.workload,
          testRunId: testRunId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to mark as changepoint');
      }

      showToast('Successfully marked as changepoint and triggered re-evaluation');
    } catch (error) {
      showToast('Failed to mark as changepoint');
    }
  }, [testRun, testRunId, showToast]);

  /**
   * Marks anomalies as regression and triggers re-evaluation
   */
  const handleMarkAsRegression = useCallback(async () => {
    updateAdaptConfig('DENIED');
    await triggerBatchReevaluation();
  }, [updateAdaptConfig, triggerBatchReevaluation]);

  /**
   * Marks anomalies as variability and triggers re-evaluation
   */
  const handleMarkAsVariability = useCallback(async () => {
    updateAdaptConfig('ACCEPTED');
    await triggerBatchReevaluation();
  }, [updateAdaptConfig, triggerBatchReevaluation]);

  return {
    markAsChangepoint,
    handleMarkAsRegression,
    handleMarkAsVariability,
  };
}
