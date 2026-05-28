'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import {
  TransactionStat,
  SamplerStat,
  VirtualUserStats,
  ThroughputStats,
  SortField,
  SortOrder,
  RollupPendingState,
} from '../types/performance-analysis.types';

/**
 * Type guard for the `progress` field on the API's 202 rollup-pending response body.
 * Guards against backend schema drift (e.g. `progress: "string"` or
 * `progress: { stageIndex: "1" }`) which would render "stage 1 of undefined: undefined".
 */
const isValidRollupProgress = (p: unknown): p is RollupPendingState['progress'] => {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.stageName === 'string' &&
    typeof o.stageIndex === 'number' &&
    typeof o.totalStages === 'number'
  );
};

export interface UsePerformanceAnalysisDataProps {
  testRunId: string;
  /** Full test run object — used to determine running state and elapsed duration */
  testRun?: TestRun | null;
}

export interface UsePerformanceAnalysisDataReturn {
  // Core data
  transactions: TransactionStat[];
  loading: boolean;
  error: string | null;
  rollupPending: RollupPendingState | null;

  // Additional stats
  testLevelThreshold: number;
  virtualUserStats: VirtualUserStats | null;
  throughputStats: ThroughputStats | null;
  hasExplicitThreshold: boolean;

  // Ramp-up filter
  excludeRampUp: boolean;
  setExcludeRampUp: (value: boolean) => void;

  // Live window (only active when test is running)
  isRunning: boolean;
  elapsedMinutes: number;
  sinceMinutes: number | null;
  setSinceMinutes: (value: number | null) => void;

  // Auto-refresh state — true when the last fetch took ≥5 s (user must refresh manually)
  autoRefreshDisabled: boolean;

  // Sorting
  sortField: SortField;
  sortOrder: SortOrder;
  handleSort: (field: SortField) => void;
  sortedTransactions: TransactionStat[];

  // Scenario grouping
  scenarioGroups: [string, TransactionStat[]][];

  // Expandable rows
  expandedRows: Set<string>;
  rowSamples: Record<string, SamplerStat[]>;
  loadingSamples: Record<string, boolean>;
  samplesError: Record<string, string>;
  handleRowClick: (transactionName: string) => void;

  // Scenario expansion
  expandedScenarios: Set<string>;
  handleToggleScenario: (scenarioName: string) => void;

  // Calculated metrics
  totalRequests: number;
  overallApdexScore: number;
  poorApdexTransactions: TransactionStat[];

  // Refresh functions
  fetchTransactions: () => Promise<void>;
  fetchTestLevelThreshold: () => Promise<void>;
  refreshAll: () => void;
}

export function usePerformanceAnalysisData({
  testRunId,
  testRun,
}: UsePerformanceAnalysisDataProps): UsePerformanceAnalysisDataReturn {
  // Core state
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<TransactionStat[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rollupPending, setRollupPending] = useState<RollupPendingState | null>(null);

  // Additional stats
  const [testLevelThreshold, setTestLevelThreshold] = useState<number>(500);
  const [virtualUserStats, setVirtualUserStats] = useState<VirtualUserStats | null>(null);
  const [throughputStats, setThroughputStats] = useState<ThroughputStats | null>(null);
  const [hasExplicitThreshold, setHasExplicitThreshold] = useState(false);

  // Ramp-up filter
  const [excludeRampUp, setExcludeRampUp] = useState(true);

  // Live window state — null means "complete test", a number means "last N minutes"
  const [sinceMinutes, setSinceMinutes] = useState<number | null>(null);

  // Auto-refresh: disabled when the last fetchTransactions call took ≥5 s
  const [autoRefreshDisabled, setAutoRefreshDisabled] = useState(false);

  // Derive running state and elapsed duration from the testRun prop
  const isRunning = !!testRun && !testRun.completed;
  const elapsedMinutes = (() => {
    if (!testRun?.start_time) return 0;
    const startMs = new Date(testRun.start_time).getTime();
    const endMs = (testRun.end_time && testRun.completed) ? new Date(testRun.end_time).getTime() : Date.now();
    return Math.floor((endMs - startMs) / 60000);
  })();

  // Sorting
  const [sortField, setSortField] = useState<SortField>('transaction_name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Expandable rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [rowSamples, setRowSamples] = useState<Record<string, SamplerStat[]>>({});
  const [loadingSamples, setLoadingSamples] = useState<Record<string, boolean>>({});
  const [samplesError, setSamplesError] = useState<Record<string, string>>({});

  // Scenario expansion
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set());

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    const fetchStartMs = Date.now();
    try {
      setLoading(true);
      setError(null);
      // Note: do NOT optimistically clear rollupPending here. Clearing it before
      // the response arrives causes a flash-of-empty-state on every realtime
      // refetch (pending Alert -> spinner -> pending Alert). We clear it on the
      // 200 success path below and in the catch block instead.

      const params = new URLSearchParams({ excludeRampUp: String(excludeRampUp) });
      if (sinceMinutes != null) params.set('sinceMinutes', String(sinceMinutes));

      const response = await authenticatedFetch(
        `/test-runs/${testRunId}/transactions?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.status === 202) {
        const body = await response.json().catch(() => null) as { progress?: unknown } | null;
        setRollupPending({
          status: 'rollup-pending',
          stage: 'transaction-stats-rollup',
          progress: isValidRollupProgress(body?.progress) ? body!.progress : undefined,
        });
        setTransactions([]);
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch transaction data');
      }

      // 200: clear any prior pending state and store the data.
      setRollupPending(null);
      const data = await response.json();
      setTransactions(data || []);
    } catch (err) {
      console.error('Error fetching transactions:', err);
      // Clear pending state on error so a transient failure doesn't keep the
      // pending UI on screen indefinitely; the user sees the error instead.
      setRollupPending(null);
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to fetch transaction data');
      setTransactions([]);
    } finally {
      setLoading(false);
      setAutoRefreshDisabled(Date.now() - fetchStartMs >= 5000);
    }
  }, [testRunId, excludeRampUp, sinceMinutes]);

  // Fetch test-level threshold
  const fetchTestLevelThreshold = useCallback(async () => {
    try {
      const response = await authenticatedFetch(
        `/test-runs/${testRunId}/apdex-threshold`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setTestLevelThreshold(data.apdex_threshold || 500);
        setHasExplicitThreshold(data.apdex_threshold != null);
      }
    } catch (err) {
      console.error('Error fetching test-level threshold:', err);
      setHasExplicitThreshold(false);
    }
  }, [testRunId]);

  // Fetch virtual user stats
  const fetchVirtualUserStats = useCallback(async () => {
    try {
      const response = await authenticatedFetch(
        `/test-runs/${testRunId}/virtual-users?excludeRampUp=${excludeRampUp}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setVirtualUserStats(data);
      }
    } catch (err) {
      console.error('Error fetching virtual user stats:', err);
      setVirtualUserStats(null);
    }
  }, [testRunId, excludeRampUp]);

  // Fetch throughput stats
  const fetchThroughputStats = useCallback(async () => {
    try {
      const response = await authenticatedFetch(
        `/test-runs/${testRunId}/throughput?excludeRampUp=${excludeRampUp}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setThroughputStats(data);
      }
    } catch (err) {
      console.error('Error fetching throughput stats:', err);
      setThroughputStats(null);
    }
  }, [testRunId, excludeRampUp]);

  // Initial data fetch
  useEffect(() => {
    if (testRunId) {
      fetchTransactions();
      fetchTestLevelThreshold();
      fetchVirtualUserStats();
      fetchThroughputStats();
    }
  }, [testRunId, excludeRampUp, fetchTransactions, fetchTestLevelThreshold, fetchVirtualUserStats, fetchThroughputStats]);

  // While the rollup-pending gate is active, poll every 5s so the card transitions
  // out of the pending state once the post-test rollup completes — even on completed
  // runs where the realtime entity-update trigger is no longer firing.
  // The interval is cleared on unmount AND when rollupPending flips to null
  // (effect re-runs, cleanup tears down the old interval, the new run early-returns).
  useEffect(() => {
    if (!rollupPending) return;
    const interval = setInterval(() => {
      fetchTransactions();
    }, 5000);
    return () => clearInterval(interval);
  }, [rollupPending, fetchTransactions]);

  // When the test stops running, reset sinceMinutes back to null (complete test)
  // so the card shows full data once the run finishes.
  const prevIsRunningRef = useRef(isRunning);
  useEffect(() => {
    if (prevIsRunningRef.current && !isRunning) {
      setSinceMinutes(null);
    }
    prevIsRunningRef.current = isRunning;
  }, [isRunning]);

  // When the time window changes, invalidate any cached sampler data because it
  // was fetched for a different window and is now stale.
  useEffect(() => {
    setRowSamples({});
    setExpandedRows(new Set());
  }, [sinceMinutes]);

  // Refresh all data
  const refreshAll = useCallback(() => {
    fetchTransactions();
    fetchTestLevelThreshold();
    fetchVirtualUserStats();
    fetchThroughputStats();
  }, [fetchTransactions, fetchTestLevelThreshold, fetchVirtualUserStats, fetchThroughputStats]);

  // Auto-refresh: re-fetch whenever a WS update arrives (signalled by updated_at
  // changing), unless the last fetch was slow (≥5 s). The initial load is handled
  // by the mount effect above; this effect skips the first render via prevRef.
  const prevUpdatedAtRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!isRunning || autoRefreshDisabled) return;
    const current = testRun?.updated_at;
    const prev = prevUpdatedAtRef.current;
    prevUpdatedAtRef.current = current;
    // Skip on first run (prev is still the initial sentinel value)
    if (prev === undefined) return;
    // Skip when the value hasn't actually changed
    if (current === prev) return;
    refreshAll();
  }, [testRun?.updated_at, isRunning, autoRefreshDisabled, refreshAll]);

  // Sorting handler
  const handleSort = useCallback((field: SortField) => {
    const isAsc = sortField === field && sortOrder === 'asc';
    setSortOrder(isAsc ? 'desc' : 'asc');
    setSortField(field);
  }, [sortField, sortOrder]);

  // Sorted transactions
  const sortedTransactions = [...transactions].sort((a, b) => {
    let aValue: string | number;
    let bValue: string | number;

    if (sortField === 'error_rate') {
      aValue = a.total_count > 0 ? (a.failed_count / a.total_count) * 100 : 0;
      bValue = b.total_count > 0 ? (b.failed_count / b.total_count) * 100 : 0;
    } else {
      aValue = a[sortField];
      bValue = b[sortField];
    }

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortOrder === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }

    return sortOrder === 'asc'
      ? (aValue as number) - (bValue as number)
      : (bValue as number) - (aValue as number);
  });

  // Group transactions by scenario
  const groupedByScenario = sortedTransactions.reduce((groups, transaction) => {
    const scenario = transaction.scenario_name || 'No Scenario';
    if (!groups[scenario]) {
      groups[scenario] = [];
    }
    groups[scenario].push(transaction);
    return groups;
  }, {} as Record<string, TransactionStat[]>);

  const scenarioGroups = Object.entries(groupedByScenario).sort(([a], [b]) => {
    if (a === 'No Scenario') return 1;
    if (b === 'No Scenario') return -1;
    return a.localeCompare(b);
  });

  // Row expansion handler
  const handleRowClick = useCallback(async (transactionName: string) => {
    const newExpandedRows = new Set(expandedRows);

    if (expandedRows.has(transactionName)) {
      newExpandedRows.delete(transactionName);
      setExpandedRows(newExpandedRows);
    } else {
      newExpandedRows.add(transactionName);
      setExpandedRows(newExpandedRows);

      if (!rowSamples[transactionName]) {
        setLoadingSamples(prev => ({ ...prev, [transactionName]: true }));
        setSamplesError(prev => ({ ...prev, [transactionName]: '' }));

        try {
          const sampleParams = new URLSearchParams({ excludeRampUp: String(excludeRampUp) });
          if (sinceMinutes != null) sampleParams.set('sinceMinutes', String(sinceMinutes));

          const response = await authenticatedFetch(
            `/test-runs/${testRunId}/transactions/${encodeURIComponent(transactionName)}/samples?${sampleParams.toString()}`,
            {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
            }
          );

          if (!response.ok) {
            throw new Error('Failed to fetch request samples');
          }

          const data = await response.json();
          setRowSamples(prev => ({ ...prev, [transactionName]: data }));
        } catch (err) {
          console.error('Error fetching sampler statistics:', err);
          setSamplesError(prev => ({
            ...prev,
            [transactionName]: err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to fetch sampler statistics'
          }));
        } finally {
          setLoadingSamples(prev => ({ ...prev, [transactionName]: false }));
        }
      }
    }
  }, [expandedRows, rowSamples, testRunId, excludeRampUp, sinceMinutes]);

  // Scenario toggle handler
  const handleToggleScenario = useCallback((scenarioName: string) => {
    setExpandedScenarios(prev => {
      const newSet = new Set(prev);
      if (newSet.has(scenarioName)) {
        newSet.delete(scenarioName);
      } else {
        newSet.add(scenarioName);
      }
      return newSet;
    });
  }, []);

  // Calculated metrics
  const totalRequests = transactions.reduce((sum, t) => sum + t.total_count, 0);
  const overallApdexScore = totalRequests > 0
    ? transactions.reduce((sum, t) => sum + (t.apdex_score * t.total_count), 0) / totalRequests
    : 0;
  const poorApdexTransactions = transactions.filter(t => t.apdex_score < 0.7);

  return {
    // Core data
    transactions,
    loading,
    error,
    rollupPending,

    // Additional stats
    testLevelThreshold,
    virtualUserStats,
    throughputStats,
    hasExplicitThreshold,

    // Ramp-up filter
    excludeRampUp,
    setExcludeRampUp,

    // Live window
    isRunning,
    elapsedMinutes,
    sinceMinutes,
    setSinceMinutes,

    // Auto-refresh
    autoRefreshDisabled,

    // Sorting
    sortField,
    sortOrder,
    handleSort,
    sortedTransactions,

    // Scenario grouping
    scenarioGroups,

    // Expandable rows
    expandedRows,
    rowSamples,
    loadingSamples,
    samplesError,
    handleRowClick,

    // Scenario expansion
    expandedScenarios,
    handleToggleScenario,

    // Calculated metrics
    totalRequests,
    overallApdexScore,
    poorApdexTransactions,

    // Refresh functions
    fetchTransactions,
    fetchTestLevelThreshold,
    refreshAll,
  };
}
