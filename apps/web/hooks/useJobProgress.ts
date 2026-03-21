/**
 * useJobProgress Hook
 *
 * React hook that tracks job progress via WebSocket events and REST API fallback.
 * Connects to the /job-progress namespace for real-time updates.
 *
 * Features:
 * - Real-time progress updates via Socket.IO (/job-progress namespace)
 * - Polling fallback when WebSocket unavailable
 * - Loading states and error handling
 * - Completion/failure callbacks
 * - Job blocking detection
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { authenticatedFetch } from '@/lib/api';
import keycloakAuth from '@/lib/keycloak-auth';
import { env } from '@/lib/env';
import type {
  JobProgress,
  JobBlockedInfo,
  JobLockInfo,
} from '@perfana/shared/types';

/**
 * Hook options for filtering and callbacks
 */
export interface UseJobProgressOptions {
  /** Filter by test run ID */
  testRunId?: string;
  /** Filter by system under test ID (for scope-based tracking) */
  systemUnderTestId?: string;
  /** Filter by test environment (for scope-based tracking) */
  testEnvironment?: string;
  /** Filter by workload (for scope-based tracking) */
  workload?: string;
  /** Callback when job completes successfully */
  onCompleted?: () => void;
  /** Callback when job fails */
  onFailed?: (error: string) => void;
  /** Enable polling fallback (default: true) */
  enablePolling?: boolean;
  /** Polling interval in milliseconds (default: 3000) */
  pollingInterval?: number;
}

/**
 * Hook return value
 */
export interface UseJobProgressReturn {
  /** Current job progress (null if no active job) */
  progress: JobProgress | null;
  /** Whether a job is currently running */
  isRunning: boolean;
  /** Whether the job is blocked by another job */
  isBlocked: boolean;
  /** Whether the job appears to be stuck (no progress for extended time) */
  isStuck: boolean;
  /** Information about the blocking job */
  blockingInfo: JobBlockedInfo | null;
  /** Lock information including TTL */
  lockInfo: JobLockInfo | null;
  /** Error message if job failed or API error occurred */
  error: string | null;
  /** Whether the hook is loading initial data */
  loading: boolean;
  /** Release the lock for the current scope (admin action for stuck jobs) */
  releaseLock: () => Promise<{ success: boolean; message: string }>;
}

/**
 * Get WebSocket URL from API URL
 */
function getWebSocketUrl(): string {
  const apiUrl = env.API_URL || 'http://localhost:3001/api';
  const baseUrl = apiUrl.replace(/\/api\/?$/, '');
  return baseUrl.replace(/^http/, 'ws');
}

/**
 * useJobProgress Hook
 *
 * Tracks job progress for a specific scope (testRunId or system/environment/workload).
 * Connects to the /job-progress WebSocket namespace for real-time updates.
 */
export function useJobProgress(options: UseJobProgressOptions): UseJobProgressReturn {
  const {
    testRunId,
    systemUnderTestId,
    testEnvironment,
    workload,
    onCompleted,
    onFailed,
    enablePolling = true,
    pollingInterval = 3000,
  } = options;

  // State
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [blockingInfo, setBlockingInfo] = useState<JobBlockedInfo | null>(null);
  const [lockInfo, setLockInfo] = useState<JobLockInfo | null>(null);
  const [isStuck, setIsStuck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);

  // Refs
  const socketRef = useRef<Socket | null>(null);
  const onCompletedRef = useRef(onCompleted);
  const onFailedRef = useRef(onFailed);
  // Track completed job IDs to prevent stale data from polling
  const completedJobsRef = useRef<Set<string>>(new Set());
  // Ref for fetchLockInfo to avoid stale closures in event handlers
  const fetchLockInfoRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // Update refs when callbacks change
  useEffect(() => {
    onCompletedRef.current = onCompleted;
    onFailedRef.current = onFailed;
  }, [onCompleted, onFailed]);

  /**
   * Check if an event matches the current scope
   */
  const matchesScope = useCallback(
    (eventData: { testRunId?: string; systemUnderTestId?: string; testEnvironment?: string; workload?: string }): boolean => {
      // Match by test run ID if provided
      if (testRunId && eventData.testRunId === testRunId) {
        return true;
      }

      // Match by scope (system/environment/workload) if all are provided
      if (systemUnderTestId && testEnvironment && workload) {
        return (
          eventData.systemUnderTestId === systemUnderTestId &&
          eventData.testEnvironment === testEnvironment &&
          eventData.workload === workload
        );
      }

      return false;
    },
    [testRunId, systemUnderTestId, testEnvironment, workload]
  );

  /**
   * Fetch active job for the current scope via REST API
   * Note: This is a fallback - WebSocket updates take priority
   */
  const fetchActiveJob = useCallback(async (): Promise<void> => {
    try {
      let url: string;

      if (systemUnderTestId && testEnvironment && workload) {
        url = `/data/jobs/active/${encodeURIComponent(systemUnderTestId)}/${encodeURIComponent(testEnvironment)}/${encodeURIComponent(workload)}`;
      } else {
        // No scope defined, can't fetch
        setLoading(false);
        return;
      }

      const response = await authenticatedFetch(url);

      if (response.status === 404) {
        // No active job for this scope according to REST API
        // Only clear if we're not receiving WebSocket updates (no current progress)
        // This prevents polling from clearing WebSocket-provided progress
        setProgress((currentProgress) => {
          if (currentProgress) {
            console.log('[useJobProgress] REST API returned 404 but we have WebSocket progress, keeping it');
            return currentProgress;
          }
          return null;
        });
        setBlockingInfo(null);
        setError(null);
        setLoading(false);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch active job: ${response.statusText}`);
      }

      const data = await response.json();
      // API returns { scope: {...}, activeJob: JobProgress | null }
      if (data && data.activeJob && data.activeJob.jobId) {
        // Don't restore progress for jobs that have already completed
        if (completedJobsRef.current.has(data.activeJob.jobId)) {
          console.log('[useJobProgress] Ignoring REST API data for completed job:', data.activeJob.jobId);
          setLoading(false);
          return;
        }
        setProgress(data.activeJob);
        setBlockingInfo(null);
        setError(null);
      } else {
        // No active job from REST API - only clear if no current progress from WebSocket
        setProgress((currentProgress) => {
          if (currentProgress) {
            console.log('[useJobProgress] REST API returned no activeJob but we have WebSocket progress, keeping it');
            return currentProgress;
          }
          return null;
        });

        // Check lock state so we surface "blocked" even if we missed the WS event
        // (e.g., user navigated to this page after the block event was emitted)
        await fetchLockInfoRef.current();
      }
      setLoading(false);
    } catch (err) {
      console.error('[useJobProgress] Failed to fetch active job:', err);
      // Don't set error for fetch failures - just use polling
      setLoading(false);
    }
  }, [systemUnderTestId, testEnvironment, workload]);

  /**
   * Fetch lock information for the current scope.
   * When a lock is found (locked === true), also populates blockingInfo
   * so the UI can show the blocked indicator even without a WebSocket event.
   */
  const fetchLockInfo = useCallback(async (): Promise<void> => {
    if (!systemUnderTestId || !testEnvironment || !workload) {
      return;
    }

    try {
      const url = `/data/locks/${encodeURIComponent(systemUnderTestId)}/${encodeURIComponent(testEnvironment)}/${encodeURIComponent(workload)}`;
      const response = await authenticatedFetch(url);

      if (!response.ok) {
        // No lock or endpoint error — clear blocking state
        setLockInfo(null);
        setBlockingInfo((current) => {
          // Only clear if blocking was from a lock (not a WebSocket event we should keep)
          if (current && !current.existingJobProgress) return current;
          return null;
        });
        return;
      }

      const data = await response.json();
      if (data && data.lock) {
        setLockInfo(data.lock);

        // Surface lock as blocked state so the UI renders the BlockedJobIndicator
        if (data.lock.locked) {
          setBlockingInfo((current) => {
            // Don't overwrite richer info from a WebSocket event
            if (current?.blocked) return current;
            return {
              blocked: true,
              reason: `Scope is locked by job ${data.lock.jobId || 'unknown'}`,
              existingJobId: data.lock.jobId,
              existingJobProgress: data.lock.progress || undefined,
              scopeKey: `job:lock:${systemUnderTestId}:${testEnvironment}:${workload}`,
            };
          });
        }
      } else {
        setLockInfo(null);
      }
    } catch (err) {
      console.error('[useJobProgress] Failed to fetch lock info:', err);
    }
  }, [systemUnderTestId, testEnvironment, workload]);

  // Update fetchLockInfo ref when it changes
  useEffect(() => {
    fetchLockInfoRef.current = fetchLockInfo;
  }, [fetchLockInfo]);

  /**
   * Release the lock for the current scope (admin action for stuck jobs)
   */
  const releaseLock = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    if (!systemUnderTestId || !testEnvironment || !workload) {
      return { success: false, message: 'No scope defined' };
    }

    try {
      const url = `/data/locks/${encodeURIComponent(systemUnderTestId)}/${encodeURIComponent(testEnvironment)}/${encodeURIComponent(workload)}`;
      const response = await authenticatedFetch(url, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Clear local state
        setProgress(null);
        setBlockingInfo(null);
        setLockInfo(null);
        setIsStuck(false);
        setError(null);
        return { success: true, message: data.message || 'Lock released successfully' };
      }

      return { success: false, message: data.message || 'Failed to release lock' };
    } catch (err) {
      console.error('[useJobProgress] Failed to release lock:', err);
      return { success: false, message: 'Failed to release lock' };
    }
  }, [systemUnderTestId, testEnvironment, workload]);

  /**
   * Connect to WebSocket
   */
  useEffect(() => {
    const wsUrl = getWebSocketUrl();
    const token = keycloakAuth.getToken();

    console.log('[useJobProgress] Connecting to WebSocket:', `${wsUrl}/job-progress`);

    const socket = io(`${wsUrl}/job-progress`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[useJobProgress] WebSocket connected');
      setIsConnected(true);

      // Subscribe to scope if we have one
      if (systemUnderTestId && testEnvironment && workload) {
        socket.emit('subscribe:scope', {
          systemUnderTestId,
          testEnvironment,
          workload,
        });
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('[useJobProgress] WebSocket disconnected:', reason);
      setIsConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.error('[useJobProgress] WebSocket connection error:', err.message);
      setIsConnected(false);
    });

    // Job progress event
    socket.on('job:progress', (data: JobProgress) => {
      console.log('[useJobProgress] Progress event:', data);
      if (matchesScope(data)) {
        // Ignore progress for jobs that have already completed
        if (completedJobsRef.current.has(data.jobId)) {
          console.log('[useJobProgress] Ignoring progress for completed job:', data.jobId);
          return;
        }
        setProgress(data);
        setBlockingInfo(null);
        setError(null);
      }
    });

    // Job completed event
    socket.on('job:completed', (data: { jobId?: string; testRunId: string; systemUnderTestId: string; testEnvironment: string; workload: string }) => {
      console.log('[useJobProgress] Completed event:', data);
      if (matchesScope(data)) {
        // Mark this job as completed to prevent stale data from polling
        if (data.jobId) {
          completedJobsRef.current.add(data.jobId);
          // Clear after 30 seconds to prevent memory leak
          setTimeout(() => {
            completedJobsRef.current.delete(data.jobId!);
          }, 30000);
        }
        setProgress(null);
        setBlockingInfo(null);
        setError(null);
        onCompletedRef.current?.();
      }
    });

    // Job failed event
    socket.on('job:failed', (data: { testRunId: string; systemUnderTestId: string; testEnvironment: string; workload: string; error: string }) => {
      console.log('[useJobProgress] Failed event:', data);
      if (matchesScope(data)) {
        setProgress(null);
        setBlockingInfo(null);
        setError(data.error);
        onFailedRef.current?.(data.error);
      }
    });

    // Job blocked event
    socket.on('job:blocked', (data: JobBlockedInfo & { requestedTestRunId?: string }) => {
      console.log('[useJobProgress] Blocked event:', data);

      // Match by testRunId (the blocked job's requested test run)
      const matchesByTestRunId = testRunId && data.requestedTestRunId === testRunId;

      // Match by scope via the existing (blocking) job's progress info
      const matchesByScope =
        data.existingJobProgress &&
        systemUnderTestId &&
        testEnvironment &&
        workload &&
        data.existingJobProgress.systemUnderTestId === systemUnderTestId &&
        data.existingJobProgress.testEnvironment === testEnvironment &&
        data.existingJobProgress.workload === workload;

      if (matchesByTestRunId || matchesByScope) {
        setBlockingInfo(data);
        // Fetch lock info for TTL and acquiredAt details
        fetchLockInfoRef.current();
      }
    });

    // Job stuck event
    socket.on('job:stuck', (data: { testRunId: string; systemUnderTestId: string; testEnvironment: string; workload: string }) => {
      console.log('[useJobProgress] Stuck event:', data);
      if (matchesScope(data)) {
        setIsStuck(true);
        setError('Job appears to be stuck and may need manual intervention');
        // Fetch lock info to get TTL details
        fetchLockInfoRef.current();
      }
    });

    return () => {
      console.log('[useJobProgress] Cleaning up WebSocket');
      socket.disconnect();
      socketRef.current = null;
    };
    // Note: fetchLockInfo is intentionally not in deps - it's only called in event handler via ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemUnderTestId, testEnvironment, workload, testRunId, matchesScope]);

  /**
   * Initial data fetch and polling fallback
   */
  useEffect(() => {
    // Fetch initial active job state
    fetchActiveJob();

    // Set up polling if enabled
    if (enablePolling) {
      const pollInterval = setInterval(() => {
        // Poll regardless of WebSocket state to ensure we have latest data
        fetchActiveJob();
      }, pollingInterval);

      return () => {
        clearInterval(pollInterval);
      };
    }
  }, [fetchActiveJob, enablePolling, pollingInterval]);

  return {
    progress,
    isRunning: progress !== null && (progress.status === 'active' || progress.status === 'waiting'),
    isBlocked: blockingInfo?.blocked ?? false,
    isStuck: isStuck || progress?.status === 'stuck',
    blockingInfo,
    lockInfo,
    error,
    loading,
    releaseLock,
  };
}
