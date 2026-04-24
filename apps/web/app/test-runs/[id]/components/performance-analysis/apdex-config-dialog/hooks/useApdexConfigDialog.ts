'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { TestRunDetails, ExistingSlo, ApdexConfigState, ApdexConfigActions } from '../types';
import { validateThreshold, validateApdexScore } from '../utils/apdex-utils';

interface UseApdexConfigDialogParams {
  open: boolean;
  testRunId: string;
  transactionName?: string;
  currentThreshold?: number;
  onSuccess: () => void;
  onClose: () => void;
}

export function useApdexConfigDialog({
  open,
  testRunId,
  transactionName,
  currentThreshold,
  onSuccess,
  onClose,
}: UseApdexConfigDialogParams): ApdexConfigState & ApdexConfigActions {
  const [threshold, setThreshold] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [enableSlo, setEnableSlo] = useState(false);
  const [minApdexScore, setMinApdexScore] = useState<number>(0.85);
  const [includeFailedRequests, setIncludeFailedRequests] = useState(false);
  const [excludeRampUpTime, setExcludeRampUpTime] = useState(true);
  const [testRunDetails, setTestRunDetails] = useState<TestRunDetails | null>(null);
  const [loadingTestRun, setLoadingTestRun] = useState(false);
  const [existingSlo, setExistingSlo] = useState<ExistingSlo | null>(null);
  const [loadingSlo, setLoadingSlo] = useState(false);
  const [sloCheckFailed, setSloCheckFailed] = useState(false);

  const isTransactionLevel = !!transactionName;

  const fetchTestRunDetails = useCallback(async () => {
    try {
      setLoadingTestRun(true);
      const response = await authenticatedFetch(`/test-runs/${testRunId}`);
      if (response.ok) {
        const data = await response.json();
        setTestRunDetails({
          system_under_test_id: data.system_under_test_id,
          system_name: data.system_name || data.systems_under_test?.name || data.system_under_test_id,
          test_environment: data.test_environment,
          workload: data.workload,
        });
      }
    } catch (err) {
      // Silently handle - test run details are optional for threshold config
    } finally {
      setLoadingTestRun(false);
    }
  }, [testRunId]);

  const checkExistingSlo = useCallback(async () => {
    if (!testRunDetails) return;

    const sloCheckErrorMessage =
      'Failed to check for an existing Apdex SLO. Please retry before saving to avoid creating a duplicate.';

    try {
      setLoadingSlo(true);
      setSloCheckFailed(false);
      const params = new URLSearchParams({
        systemUnderTestId: testRunDetails.system_under_test_id,
        testEnvironment: testRunDetails.test_environment,
        workload: testRunDetails.workload,
        benchmarkType: 'apdex',
      });

      const response = await authenticatedFetch(`/benchmarks?${params}`);
      if (!response.ok) {
        setError(sloCheckErrorMessage);
        setSloCheckFailed(true);
        return;
      }

      const benchmarks = await response.json();
      const matchingSlo = benchmarks.find((b: unknown) =>
        transactionName ? b.transaction_name === transactionName : !b.transaction_name
      );

      if (matchingSlo) {
        setExistingSlo({
          id: matchingSlo.id,
          min_apdex_score: matchingSlo.min_apdex_score || 0.85,
          include_failed_requests: matchingSlo.include_failed_requests || false,
          exclude_ramp_up_time: matchingSlo.exclude_ramp_up_time !== false,
          enabled: matchingSlo.enabled !== false,
        });
        setEnableSlo(matchingSlo.enabled !== false);
        setMinApdexScore(matchingSlo.min_apdex_score || 0.85);
        setIncludeFailedRequests(matchingSlo.include_failed_requests || false);
        setExcludeRampUpTime(matchingSlo.exclude_ramp_up_time !== false);
      }
    } catch (err) {
      setError(sloCheckErrorMessage);
      setSloCheckFailed(true);
    } finally {
      setLoadingSlo(false);
    }
  }, [testRunDetails, transactionName]);

  useEffect(() => {
    if (open) {
      setThreshold(currentThreshold?.toString() || '500');
      setError(null);
      setSuccess(false);
      setEnableSlo(false);
      setMinApdexScore(0.85);
      setIncludeFailedRequests(false);
      setExcludeRampUpTime(true);
      setTestRunDetails(null);
      setExistingSlo(null);
      setSloCheckFailed(false);
      fetchTestRunDetails();
    }
    // `testRunId` is listed explicitly (Bug A guard) so a URL-level testRunId
    // swap while the dialog stays open never leaks the previous run's state,
    // even if an upstream memoization breaks fetchTestRunDetails identity.
  }, [open, currentThreshold, fetchTestRunDetails, testRunId]);

  useEffect(() => {
    if (testRunDetails && open) {
      checkExistingSlo();
    }
  }, [testRunDetails, open, checkExistingSlo]);

  const handleSave = useCallback(async () => {
    const thresholdError = validateThreshold(threshold);
    if (thresholdError) {
      setError(thresholdError);
      return;
    }

    // Block SLO save when the existence check failed — otherwise we could
    // create a duplicate SLO record (issue #171 Bug B).
    if (!isTransactionLevel && sloCheckFailed) {
      setError(
        'Cannot save: failed to check for an existing Apdex SLO. Please close and reopen the dialog.',
      );
      return;
    }

    if (enableSlo) {
      const scoreError = validateApdexScore(minApdexScore);
      if (scoreError) {
        setError(scoreError);
        return;
      }
    }

    const thresholdValue = parseInt(threshold, 10);

    try {
      setLoading(true);
      setError(null);

      const thresholdUrl = isTransactionLevel
        ? `/test-runs/${testRunId}/transactions/${encodeURIComponent(transactionName!)}/apdex-threshold`
        : `/test-runs/${testRunId}/apdex-threshold`;

      const thresholdResponse = await authenticatedFetch(thresholdUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apdex_threshold: thresholdValue }),
      });

      if (!thresholdResponse.ok) {
        const errorData = await thresholdResponse.json();
        throw new Error(errorData.message || 'Failed to update threshold');
      }

      if (testRunDetails && !isTransactionLevel) {
        await handleSloUpdate(thresholdValue);
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to save configuration');
    } finally {
      setLoading(false);
    }
  }, [threshold, enableSlo, minApdexScore, includeFailedRequests, excludeRampUpTime, existingSlo, isTransactionLevel, sloCheckFailed, testRunId, transactionName, testRunDetails, onSuccess, onClose]);

  const handleSloUpdate = async (thresholdValue: number) => {
    if (enableSlo) {
      if (existingSlo) {
        const updateResponse = await authenticatedFetch(`/benchmarks/apdex/${existingSlo.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            minApdexScore,
            apdexThresholdMs: thresholdValue,
            includeFailedRequests,
            excludeRampUpTime,
            enabled: true,
          }),
        });
        if (!updateResponse.ok) {
          const errorData = await updateResponse.json();
          throw new Error(errorData.message || 'Failed to update Apdex SLO');
        }
      } else {
        const createResponse = await authenticatedFetch('/benchmarks/apdex', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemUnderTestId: testRunDetails!.system_under_test_id,
            testEnvironment: testRunDetails!.test_environment,
            workload: testRunDetails!.workload,
            minApdexScore,
            apdexThresholdMs: thresholdValue,
            includeFailedRequests,
            excludeRampUpTime,
          }),
        });
        if (!createResponse.ok) {
          const errorData = await createResponse.json();
          throw new Error(errorData.message || 'Failed to create Apdex SLO');
        }
      }
    } else if (existingSlo) {
      const disableResponse = await authenticatedFetch(`/benchmarks/apdex/${existingSlo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: false,
          excludeRampUpTime,
        }),
      });
      if (!disableResponse.ok) {
        const errorData = await disableResponse.json();
        throw new Error(errorData.message || 'Failed to disable Apdex SLO');
      }
    }
  };

  const handleDelete = useCallback(async () => {
    if (!isTransactionLevel) return;

    try {
      setLoading(true);
      setError(null);

      const url = `/test-runs/${testRunId}/transactions/${encodeURIComponent(transactionName!)}/apdex-threshold`;
      const response = await authenticatedFetch(url, { method: 'DELETE' });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete threshold');
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to delete threshold');
    } finally {
      setLoading(false);
    }
  }, [isTransactionLevel, testRunId, transactionName, onSuccess, onClose]);

  return {
    threshold,
    loading,
    error,
    success,
    enableSlo,
    minApdexScore,
    includeFailedRequests,
    excludeRampUpTime,
    testRunDetails,
    loadingTestRun,
    existingSlo,
    loadingSlo,
    sloCheckFailed,
    setThreshold,
    setEnableSlo,
    setMinApdexScore,
    setIncludeFailedRequests,
    setExcludeRampUpTime,
    handleSave,
    handleDelete,
  };
}
