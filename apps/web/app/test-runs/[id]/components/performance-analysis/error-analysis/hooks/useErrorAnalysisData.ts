'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { NO_SCENARIO_LABEL } from '../../components/ScenarioFilter';
import {
  ErrorSummary,
  ErrorByCode,
  ErrorByTransaction,
  ErrorOverTime,
  ErrorOverTimeByCode,
  ErrorDetail,
} from '../types';

const NO_SCENARIO_SENTINEL = '__NO_SCENARIO__';

export interface UseErrorAnalysisDataProps {
  testRunId: string;
  selectedScenarios?: string[];
  excludeRampUp?: boolean;
}

export interface UseErrorAnalysisDataReturn {
  // Loading and error states
  loading: boolean;
  error: string | null;

  // Data
  summary: ErrorSummary | null;
  errorsByCode: ErrorByCode[];
  errorsByTransaction: ErrorByTransaction[];
  errorsOverTime: ErrorOverTime[];
  errorsOverTimeByCode: ErrorOverTimeByCode[];

  // Selected error details
  selectedError: ErrorDetail | null;
  detailsOpen: boolean;

  // Handlers
  handleViewDetails: (transaction: ErrorByTransaction) => Promise<void>;
  handleCloseDetails: () => void;

  // Refresh
  refreshData: () => Promise<void>;
}

export function useErrorAnalysisData({
  testRunId,
  selectedScenarios = [],
  excludeRampUp = false,
}: UseErrorAnalysisDataProps): UseErrorAnalysisDataReturn {
  // Loading and error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable query string (scenarios + analysis-timerange toggle) — rebuilds only when contents change
  const scenariosQueryKey = [...selectedScenarios].sort().join(',');
  const scenariosQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedScenarios.length > 0) {
      const sentinels = selectedScenarios.map((s) =>
        s === NO_SCENARIO_LABEL ? NO_SCENARIO_SENTINEL : s,
      );
      params.set('scenarios', sentinels.join(','));
    }
    params.set('excludeRampUp', String(excludeRampUp));
    return `?${params.toString()}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenariosQueryKey, excludeRampUp]);

  // Data states
  const [summary, setSummary] = useState<ErrorSummary | null>(null);
  const [errorsByCode, setErrorsByCode] = useState<ErrorByCode[]>([]);
  const [errorsByTransaction, setErrorsByTransaction] = useState<ErrorByTransaction[]>([]);
  const [errorsOverTime, setErrorsOverTime] = useState<ErrorOverTime[]>([]);
  const [errorsOverTimeByCode, setErrorsOverTimeByCode] = useState<ErrorOverTimeByCode[]>([]);

  // Selected error details
  const [selectedError, setSelectedError] = useState<ErrorDetail | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Fetch all error analysis data
  const fetchErrorAnalysis = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch summary
      const summaryResponse = await authenticatedFetch(
        `test-runs/${testRunId}/error-analysis/summary${scenariosQuery}`
      );
      if (!summaryResponse.ok) throw new Error('Failed to fetch error summary');
      const summaryData = await summaryResponse.json();
      setSummary(summaryData);

      // Fetch errors by code
      const byCodeResponse = await authenticatedFetch(
        `test-runs/${testRunId}/error-analysis/by-code${scenariosQuery}`
      );
      if (!byCodeResponse.ok) throw new Error('Failed to fetch errors by code');
      const byCodeData = await byCodeResponse.json();
      setErrorsByCode(byCodeData);

      // Fetch errors by transaction
      const byTransactionResponse = await authenticatedFetch(
        `test-runs/${testRunId}/error-analysis/by-transaction${scenariosQuery}`
      );
      if (!byTransactionResponse.ok) throw new Error('Failed to fetch errors by transaction');
      const byTransactionData = await byTransactionResponse.json();
      setErrorsByTransaction(byTransactionData);

      // Fetch errors over time
      const overTimeResponse = await authenticatedFetch(
        `test-runs/${testRunId}/error-analysis/over-time${scenariosQuery}`
      );
      if (!overTimeResponse.ok) throw new Error('Failed to fetch errors over time');
      const overTimeData = await overTimeResponse.json();
      setErrorsOverTime(overTimeData);

      // Fetch errors over time grouped by code (optional endpoint)
      try {
        const overTimeByCodeResponse = await authenticatedFetch(
          `test-runs/${testRunId}/error-analysis/over-time-by-code${scenariosQuery}`
        );
        if (overTimeByCodeResponse.ok) {
          const overTimeByCodeData = await overTimeByCodeResponse.json();
          setErrorsOverTimeByCode(overTimeByCodeData);
        } else {
          // Fallback: use empty array if endpoint doesn't exist yet
          setErrorsOverTimeByCode([]);
        }
      } catch {
        // Endpoint not implemented yet
        setErrorsOverTimeByCode([]);
      }
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load error analysis'
      );
    } finally {
      setLoading(false);
    }
  }, [testRunId, scenariosQuery]);

  // Initial fetch + refetch when scenarios change
  useEffect(() => {
    if (testRunId) {
      fetchErrorAnalysis();
    }
  }, [testRunId, fetchErrorAnalysis]);

  // View error details handler
  const handleViewDetails = useCallback(async (transaction: ErrorByTransaction) => {
    try {
      const response = await authenticatedFetch(
        `test-runs/${testRunId}/error-analysis/details?` +
          `transaction=${encodeURIComponent(transaction.transactionName)}&` +
          `sampler=${encodeURIComponent(transaction.samplerName)}&` +
          `url=${encodeURIComponent(transaction.url)}`
      );
      if (!response.ok) throw new Error('Failed to fetch error details');
      const details = await response.json();
      setSelectedError(details[0]); // Show first error instance
      setDetailsOpen(true);
    } catch (err) {
      // Log error but don't show to user
      if (err && typeof err === 'object' && 'message' in err) {
        // Error fetching details - silently ignore for now
      }
    }
  }, [testRunId]);

  // Close details handler
  const handleCloseDetails = useCallback(() => {
    setDetailsOpen(false);
    setSelectedError(null);
  }, []);

  return {
    // Loading and error states
    loading,
    error,

    // Data
    summary,
    errorsByCode,
    errorsByTransaction,
    errorsOverTime,
    errorsOverTimeByCode,

    // Selected error details
    selectedError,
    detailsOpen,

    // Handlers
    handleViewDetails,
    handleCloseDetails,

    // Refresh
    refreshData: fetchErrorAnalysis,
  };
}
