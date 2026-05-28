'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import { useTestRunRealtime } from '@/hooks/useTestRunRealtime';
import { ConnectionState } from '@/types/realtime';
import { normalizeTestRun } from '../utils/test-runs-filters';
import { SnackbarState } from '../types';

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
}

export interface ServerFilters {
  system?: string;
  environment?: string;
  workload?: string;
}

interface UseTestRunsDataProps {
  onSnackbar: (state: SnackbarState) => void;
  organizationId?: string | null;
  serverFilters?: ServerFilters;
}

export function useTestRunsData({ onSnackbar, organizationId, serverFilters }: UseTestRunsDataProps) {
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    pageSize: 25,
    total: 0,
  });

  // Abort controller for cancelling stale requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Real-time connection — with server-side pagination, we only update in-place
  // for test runs already on the current page. New/deleted runs trigger a re-fetch.
  const loadTestRunsRef = useRef<() => void>(() => { /* noop */ });

  // Track previous connection state to detect reconnections
  const prevConnectionStateRef = useRef<ConnectionState | null>(null);

  const { connectionStatus: _connectionStatus, isLive: _isLive } = useTestRunRealtime({
    enabled: true,
    onTestRunCreated: useCallback((_testRun: TestRun) => {
      // New test run created — re-fetch to get accurate page data and total count
      loadTestRunsRef.current();
    }, []),
    onTestRunUpdated: useCallback((testRun: TestRun) => {
      const normalizedTestRun = normalizeTestRun(testRun);
      setTestRuns((prevRuns) => {
        const index = prevRuns.findIndex(run =>
          run.id === normalizedTestRun.id || run.test_run_id === normalizedTestRun.test_run_id
        );

        if (index === -1) {
          // Test run not on current page — ignore
          return prevRuns;
        }

        const newRuns = [...prevRuns];
        newRuns[index] = normalizedTestRun;
        return newRuns;
      });
    }, []),
    onTestRunDeleted: useCallback((_testRunId: string) => {
      // Deleted run — re-fetch to get accurate page data and total count
      loadTestRunsRef.current();
    }, []),
    onTestRunsInitial: useCallback((_testRuns: TestRun[]) => {
      // Ignore socket initial snapshot — we load via HTTP with pagination
    }, []),
    onConnectionStateChange: useCallback((state: ConnectionState) => {
      // Re-fetch on WS reconnect to recover any events missed during disconnection.
      // Without this, a disconnect during post-abort analysis leaves the result
      // column spinner stuck indefinitely (analysis-complete event is never received).
      const wasDisconnected = prevConnectionStateRef.current !== null &&
        prevConnectionStateRef.current !== 'connected';
      if (state === 'connected' && wasDisconnected) {
        loadTestRunsRef.current();
      }
      prevConnectionStateRef.current = state;
    }, []),
  });

  // Load data with server-side pagination and filtering
  const loadTestRuns = useCallback(async (pageOverride?: number, pageSizeOverride?: number) => {
    // Cancel any in-flight request to prevent stale responses
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setLoading(true);
      const p = pageOverride ?? pagination.page;
      const ps = pageSizeOverride ?? pagination.pageSize;

      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('pageSize', String(ps));
      params.set('sortBy', 'createdAt');
      params.set('sortOrder', 'DESC');

      if (organizationId) {
        params.set('organizationId', organizationId);
      }
      if (serverFilters?.system) {
        params.set('system', serverFilters.system);
      }
      if (serverFilters?.environment) {
        params.set('environment', serverFilters.environment);
      }
      if (serverFilters?.workload) {
        params.set('workload', serverFilters.workload);
      }

      const response = await authenticatedFetch(`/test-runs?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to fetch test runs');
      }

      const data = await response.json();

      // Handle both paginated response and plain array (backward compat)
      if (data.data && typeof data.total === 'number') {
        setTestRuns(data.data);
        setPagination(prev => ({
          ...prev,
          page: data.page ?? p,
          pageSize: data.pageSize ?? ps,
          total: data.total,
        }));
      } else {
        setTestRuns(Array.isArray(data) ? data : []);
      }

      setError(null);
    } catch (err) {
      // Ignore abort errors — they're expected when cancelling stale requests
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to load test runs');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setInitialLoadDone(true);
      }
    }
  }, [organizationId, serverFilters, pagination.page, pagination.pageSize]);

  // Keep ref in sync so real-time callbacks can trigger re-fetches
  loadTestRunsRef.current = loadTestRuns;

  // Pagination controls
  const setPage = useCallback((page: number) => {
    setPagination(prev => ({ ...prev, page }));
  }, []);

  const setPageSize = useCallback((pageSize: number) => {
    setPagination(prev => ({ ...prev, page: 1, pageSize }));
  }, []);

  // Reset to page 1 when filters or org change
  const prevFiltersRef = useRef(serverFilters);
  const prevOrgRef = useRef(organizationId);
  useEffect(() => {
    const filtersChanged =
      prevFiltersRef.current?.system !== serverFilters?.system ||
      prevFiltersRef.current?.environment !== serverFilters?.environment ||
      prevFiltersRef.current?.workload !== serverFilters?.workload;
    const orgChanged = prevOrgRef.current !== organizationId;

    if (filtersChanged || orgChanged) {
      prevFiltersRef.current = serverFilters;
      prevOrgRef.current = organizationId;
      setPagination(prev => prev.page === 1 ? prev : { ...prev, page: 1 });
    }
  }, [serverFilters, organizationId]);

  // Initial load + reload when pagination/filters change
  useEffect(() => {
    loadTestRuns();
  }, [loadTestRuns]);

  // Update current time every 5 seconds for stale status refresh
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Delete a single test run
  const deleteTestRun = useCallback(async (id: string) => {
    try {
      const response = await authenticatedFetch(`/test-runs/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete test run');
      }
      await loadTestRuns();
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to delete test run');
    }
  }, [loadTestRuns]);

  // Monitor job and refresh when complete — returns cleanup function to cancel polling
  const monitorJobAndRefresh = useCallback((jobId: string) => {
    const estimatedJobTime = 30 * 1000;
    const maxWaitTime = 2 * 60 * 1000;
    const checkInterval = 10 * 1000;
    const startTime = Date.now();
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const checkJobStatusWithFallback = async (): Promise<boolean> => {
      try {
        const response = await authenticatedFetch(`/data/jobs/${jobId}/status`);

        if (response.ok) {
          const jobStatus = await response.json();
          const isCompleted = jobStatus.status === 'completed' ||
                             jobStatus.status === 'failed' ||
                             jobStatus.finished;

          if (isCompleted) {
            if (!cancelled) {
              if (jobStatus.status === 'failed') {
                onSnackbar({ open: true, message: 'Re-evaluation job failed' });
              } else {
                onSnackbar({ open: true, message: 'Re-evaluation completed, refreshing view...' });
              }
              loadTestRuns();
            }
            return true;
          }
        } else {
          const elapsedTime = Date.now() - startTime;
          if (elapsedTime >= estimatedJobTime) {
            if (!cancelled) {
              onSnackbar({ open: true, message: 'Re-evaluation likely completed, refreshing view...' });
              loadTestRuns();
            }
            return true;
          }
        }

        return false;
      } catch (_error) {
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime >= estimatedJobTime) {
          if (!cancelled) {
            onSnackbar({ open: true, message: 'Re-evaluation likely completed, refreshing view...' });
            loadTestRuns();
          }
          return true;
        }
        return false;
      }
    };

    const poll = async () => {
      if (cancelled) return;
      const isCompleted = await checkJobStatusWithFallback();

      if (cancelled || isCompleted) return;

      if (Date.now() - startTime > maxWaitTime) {
        if (!cancelled) {
          onSnackbar({ open: true, message: 'Re-evaluation is taking longer than expected, refreshing view...' });
          loadTestRuns();
        }
        return;
      }

      timeoutId = setTimeout(poll, checkInterval);
    };

    // Initial delay before first poll
    timeoutId = setTimeout(poll, 5000);

    // Return cleanup function
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [loadTestRuns, onSnackbar]);

  return {
    testRuns,
    loading: loading && !initialLoadDone,
    pageLoading: loading && initialLoadDone,
    error,
    currentTime,
    pagination,
    setPage,
    setPageSize,
    loadTestRuns,
    deleteTestRun,
    monitorJobAndRefresh,
  };
}
