'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import {
  TestRunDetails,
  ExistingSlo,
  UseApdexConfigProps,
  UseApdexConfigReturn,
} from '../types/apdex-config.types';
import { THRESHOLD_MIN, THRESHOLD_MAX, DEFAULT_MIN_APDEX_SCORE } from '../utils/apdex.utils';

export function useApdexConfig({
  testRunId,
  transactionName,
  currentThreshold,
  onSuccess,
  onClose,
  open,
}: UseApdexConfigProps): UseApdexConfigReturn {
  const [threshold, setThreshold] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // SLO-related state
  const [enableSlo, setEnableSlo] = useState(false);
  const [minApdexScore, setMinApdexScore] = useState<number>(DEFAULT_MIN_APDEX_SCORE);
  const [includeFailedRequests, setIncludeFailedRequests] = useState(false);
  const [testRunDetails, setTestRunDetails] = useState<TestRunDetails | null>(null);
  const [loadingTestRun, setLoadingTestRun] = useState(false);
  const [existingSlo, setExistingSlo] = useState<ExistingSlo | null>(null);
  const [loadingSlo, setLoadingSlo] = useState(false);

  const isTransactionLevel = !!transactionName;
  const title = isTransactionLevel
    ? `Configure Apdex: ${transactionName}`
    : 'Configure Test-Level Apdex';

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
      // Silently fail - test run details are for SLO only
    } finally {
      setLoadingTestRun(false);
    }
  }, [testRunId]);

  const checkExistingSlo = useCallback(async () => {
    if (!testRunDetails) return;

    try {
      setLoadingSlo(true);
      const params = new URLSearchParams({
        systemUnderTestId: testRunDetails.system_under_test_id,
        testEnvironment: testRunDetails.test_environment,
        workload: testRunDetails.workload,
        benchmarkType: 'apdex',
      });

      const response = await authenticatedFetch(`/benchmarks?${params}`);
      if (response.ok) {
        const benchmarks = await response.json();
        const matchingSlo = benchmarks.find((b: any) =>
          transactionName
            ? b.transaction_name === transactionName
            : !b.transaction_name
        );

        if (matchingSlo) {
          setExistingSlo({
            id: matchingSlo.id,
            min_apdex_score: matchingSlo.min_apdex_score || DEFAULT_MIN_APDEX_SCORE,
            include_failed_requests: matchingSlo.include_failed_requests || false,
            enabled: matchingSlo.enabled !== false,
          });
          setEnableSlo(matchingSlo.enabled !== false);
          setMinApdexScore(matchingSlo.min_apdex_score || DEFAULT_MIN_APDEX_SCORE);
          setIncludeFailedRequests(matchingSlo.include_failed_requests || false);
        }
      }
    } catch (err) {
      // Silently fail - SLO check is optional
    } finally {
      setLoadingSlo(false);
    }
  }, [testRunDetails, transactionName]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setThreshold(currentThreshold?.toString() || '500');
      setError(null);
      setSuccess(false);
      setEnableSlo(false);
      setMinApdexScore(DEFAULT_MIN_APDEX_SCORE);
      setIncludeFailedRequests(false);
      setTestRunDetails(null);
      setExistingSlo(null);
      fetchTestRunDetails();
    }
  }, [open, currentThreshold, fetchTestRunDetails]);

  // Check for existing SLO when test run details are loaded
  useEffect(() => {
    if (testRunDetails && open) {
      checkExistingSlo();
    }
  }, [testRunDetails, open, checkExistingSlo]);

  const handleSave = async () => {
    const thresholdValue = parseInt(threshold, 10);

    if (isNaN(thresholdValue) || thresholdValue < THRESHOLD_MIN || thresholdValue > THRESHOLD_MAX) {
      setError(`Threshold must be between ${THRESHOLD_MIN} and ${THRESHOLD_MAX.toLocaleString()} milliseconds`);
      return;
    }

    if (enableSlo && (minApdexScore < 0 || minApdexScore > 1)) {
      setError('Minimum Apdex score must be between 0 and 1');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Save threshold
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

      // Handle SLO at workload level only
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
  };

  const handleSloUpdate = async (thresholdValue: number) => {
    if (!testRunDetails) return;

    if (enableSlo) {
      const sloPayload = {
        minApdexScore,
        apdexThresholdMs: thresholdValue,
        includeFailedRequests,
        ...(existingSlo ? { enabled: true } : { excludeRampUpTime: true }),
      };

      const url = existingSlo
        ? `/benchmarks/apdex/${existingSlo.id}`
        : '/benchmarks/apdex';

      const response = await authenticatedFetch(url, {
        method: existingSlo ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          existingSlo
            ? sloPayload
            : {
                ...sloPayload,
                systemUnderTestId: testRunDetails.system_under_test_id,
                testEnvironment: testRunDetails.test_environment,
                workload: testRunDetails.workload,
              }
        ),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to ${existingSlo ? 'update' : 'create'} Apdex SLO`);
      }
    } else if (existingSlo) {
      // Disable existing SLO
      await authenticatedFetch(`/benchmarks/apdex/${existingSlo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
    }
  };

  const handleDelete = async () => {
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
  };

  return {
    threshold,
    setThreshold,
    loading,
    error,
    success,
    enableSlo,
    setEnableSlo,
    minApdexScore,
    setMinApdexScore,
    includeFailedRequests,
    setIncludeFailedRequests,
    testRunDetails,
    existingSlo,
    loadingTestRun,
    loadingSlo,
    isTransactionLevel,
    title,
    handleSave,
    handleDelete,
  };
}
