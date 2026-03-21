'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import { useTestRunRealtime } from '@/hooks/useTestRunRealtime';
import { normalizeTestRun } from '../utils/test-runs-filters';
import { SnackbarState } from '../types';

interface UseTestRunsDataProps {
  onSnackbar: (state: SnackbarState) => void;
  organizationId?: string | null;
}

export function useTestRunsData({ onSnackbar, organizationId }: UseTestRunsDataProps) {
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Real-time connection
  const { connectionStatus: _connectionStatus, isLive: _isLive } = useTestRunRealtime({
    enabled: true,
    onTestRunCreated: useCallback((testRun: TestRun) => {
      const normalizedTestRun = normalizeTestRun(testRun);
      setTestRuns((prevRuns) => {
        const exists = prevRuns.some(run => run.id === normalizedTestRun.id);
        if (exists) {
          return prevRuns;
        }
        return [normalizedTestRun, ...prevRuns];
      });
    }, []),
    onTestRunUpdated: useCallback((testRun: TestRun) => {
      const normalizedTestRun = normalizeTestRun(testRun);
      setTestRuns((prevRuns) => {
        const index = prevRuns.findIndex(run =>
          run.id === normalizedTestRun.id || run.test_run_id === normalizedTestRun.test_run_id
        );

        if (index === -1) {
          return [normalizedTestRun, ...prevRuns];
        }

        const newRuns = [...prevRuns];
        newRuns[index] = normalizedTestRun;
        return newRuns;
      });
    }, []),
    onTestRunDeleted: useCallback((testRunId: string) => {
      setTestRuns((prevRuns) => prevRuns.filter(run => run.test_run_id !== testRunId));
    }, []),
    onTestRunsInitial: useCallback((testRuns: TestRun[]) => {
      setTestRuns(testRuns);
      setLoading(false);
    }, []),
  });

  // Load initial data
  const loadTestRuns = useCallback(async () => {
    try {
      setLoading(true);
      const url = organizationId
        ? `/test-runs?organizationId=${encodeURIComponent(organizationId)}`
        : `/test-runs`;
      const response = await authenticatedFetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch test runs');
      }

      const data = await response.json();
      setTestRuns(Array.isArray(data) ? data : data.data || []);
      setError(null);
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to load test runs');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  // Initial load
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

  // Monitor job and refresh when complete
  const monitorJobAndRefresh = useCallback(async (jobId: string) => {
    const estimatedJobTime = 30 * 1000;
    const maxWaitTime = 2 * 60 * 1000;
    const checkInterval = 10 * 1000;
    const startTime = Date.now();

    await new Promise(resolve => setTimeout(resolve, 5000));

    const checkJobStatusWithFallback = async (): Promise<boolean> => {
      try {
        const response = await authenticatedFetch(`/data/jobs/${jobId}/status`);

        if (response.ok) {
          const jobStatus = await response.json();
          const isCompleted = jobStatus.status === 'completed' ||
                             jobStatus.status === 'failed' ||
                             jobStatus.finished;

          if (isCompleted) {
            if (jobStatus.status === 'failed') {
              onSnackbar({ open: true, message: 'Re-evaluation job failed' });
            } else {
              onSnackbar({ open: true, message: 'Re-evaluation completed, refreshing view...' });
            }
            loadTestRuns();
            return true;
          }
        } else {
          const elapsedTime = Date.now() - startTime;
          if (elapsedTime >= estimatedJobTime) {
            onSnackbar({ open: true, message: 'Re-evaluation likely completed, refreshing view...' });
            loadTestRuns();
            return true;
          }
        }

        return false;
      } catch (_error) {
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime >= estimatedJobTime) {
          onSnackbar({ open: true, message: 'Re-evaluation likely completed, refreshing view...' });
          loadTestRuns();
          return true;
        }
        return false;
      }
    };

    const poll = async () => {
      const isCompleted = await checkJobStatusWithFallback();

      if (isCompleted) {
        return;
      }

      if (Date.now() - startTime > maxWaitTime) {
        onSnackbar({ open: true, message: 'Re-evaluation is taking longer than expected, refreshing view...' });
        loadTestRuns();
        return;
      }

      setTimeout(poll, checkInterval);
    };

    poll();
  }, [loadTestRuns, onSnackbar]);

  return {
    testRuns,
    loading,
    error,
    currentTime,
    loadTestRuns,
    deleteTestRun,
    monitorJobAndRefresh,
  };
}
