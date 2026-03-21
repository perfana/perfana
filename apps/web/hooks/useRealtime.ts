/**
 * React hooks for real-time WebSocket updates
 *
 * Provides hooks for subscribing to test run updates with:
 * - Automatic subscription/unsubscription
 * - Connection state management
 * - Error handling
 * - Fallback to API polling
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { socketManager } from '@/lib/socket';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import {
  ConnectionState,
  WebSocketError,
  TestRunsInitialPayload,
  TestRunInitialPayload,
  TestRunCreatedPayload,
  TestRunUpdatedPayload,
  TestRunDeletedPayload,
  TestRunFilters,
} from '@/types/realtime';

/**
 * Hook state for real-time test runs list
 */
interface UseRealtimeTestRunsState {
  testRuns: TestRun[];
  loading: boolean;
  error: string | null;
  connectionState: ConnectionState;
  isRealtime: boolean;
}

/**
 * Hook options for real-time test runs
 */
interface UseRealtimeTestRunsOptions {
  filters?: TestRunFilters;
  fallbackToPolling?: boolean;
  pollingInterval?: number;
  enabled?: boolean;
}

/**
 * Hook for subscribing to test runs list with real-time updates
 *
 * Features:
 * - Real-time updates via WebSocket
 * - Automatic fallback to polling if WebSocket fails
 * - Optimistic UI updates
 * - Debounced updates to prevent UI flickering
 *
 * @param options - Hook options including filters and polling settings
 * @returns State object with test runs data and connection status
 */
export function useRealtimeTestRuns(options: UseRealtimeTestRunsOptions = {}): UseRealtimeTestRunsState {
  const {
    filters,
    fallbackToPolling = true,
    pollingInterval = 5000,
    enabled = true,
  } = options;

  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isRealtime, setIsRealtime] = useState(false);

  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const updateDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const pendingUpdatesRef = useRef<Map<string, TestRun>>(new Map());
  const mountedRef = useRef(true);

  /**
   * Fetch test runs from API
   */
  const fetchTestRuns = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/test-runs', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch test runs');
      }

      const data = await response.json();
      const runs = Array.isArray(data) ? data : data.data || [];

      if (mountedRef.current) {
        setTestRuns(runs);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to load test runs'
        );
      }
    }
  }, []);

  /**
   * Apply debounced updates to prevent UI flickering
   */
  const applyPendingUpdates = useCallback(() => {
    if (pendingUpdatesRef.current.size === 0) return;

    setTestRuns(prevRuns => {
      const updatesMap = new Map(pendingUpdatesRef.current);
      pendingUpdatesRef.current.clear();

      return prevRuns.map(run => {
        const update = updatesMap.get(run.test_run_id);
        return update || run;
      });
    });
  }, []);

  /**
   * Handle test run created event
   */
  const handleTestRunCreated = useCallback((payload: TestRunCreatedPayload) => {
    console.log('[Realtime] Test run created:', payload.testRun.test_run_id);
    console.log('[Realtime] systems_under_test in payload:', payload.testRun.systems_under_test);

    setTestRuns(prevRuns => {
      // Check if already exists (deduplicate)
      const exists = prevRuns.some(run => run.test_run_id === payload.testRun.test_run_id);
      if (exists) {
        return prevRuns.map(run =>
          run.test_run_id === payload.testRun.test_run_id ? payload.testRun : run
        );
      }
      return [payload.testRun, ...prevRuns];
    });
  }, []);

  /**
   * Handle test run updated event (debounced)
   */
  const handleTestRunUpdated = useCallback((payload: TestRunUpdatedPayload) => {
    console.log('[Realtime] Test run updated:', payload.testRun.test_run_id);
    console.log('[Realtime] systems_under_test in payload:', payload.testRun.systems_under_test);
    console.log('[Realtime] Full payload.testRun:', JSON.stringify(payload.testRun, null, 2));

    // Add to pending updates
    pendingUpdatesRef.current.set(payload.testRun.test_run_id, payload.testRun);

    // Clear existing debounce timer
    if (updateDebounceRef.current) {
      clearTimeout(updateDebounceRef.current);
    }

    // Schedule debounced update
    updateDebounceRef.current = setTimeout(() => {
      applyPendingUpdates();
    }, 300); // 300ms debounce
  }, [applyPendingUpdates]);

  /**
   * Handle test run deleted event
   */
  const handleTestRunDeleted = useCallback((payload: TestRunDeletedPayload) => {
    const deletedTestRunId = payload?.testRunId;
    if (!deletedTestRunId) {
      console.warn('[Realtime] Invalid delete payload:', payload);
      return;
    }

    console.log('[Realtime] Test run deleted:', deletedTestRunId);

    setTestRuns(prevRuns =>
      prevRuns.filter(run => run.test_run_id !== deletedTestRunId)
    );
  }, []);

  /**
   * Setup WebSocket connection and subscriptions
   */
  useEffect(() => {
    if (!enabled) return;

    let connectionStateUnsubscribe: (() => void) | undefined;
    let errorUnsubscribe: (() => void) | undefined;
    let initialUnsubscribe: (() => void) | undefined;
    let createdUnsubscribe: (() => void) | undefined;
    let updatedUnsubscribe: (() => void) | undefined;
    let deletedUnsubscribe: (() => void) | undefined;

    const setupRealtimeConnection = async () => {
      try {
        setLoading(true);

        // Fetch initial data immediately (don't wait for WebSocket)
        await fetchTestRuns();
        setLoading(false);

        // Connect to WebSocket
        await socketManager.connect();

        // Subscribe to connection state changes
        connectionStateUnsubscribe = socketManager.onConnectionStateChange((state) => {
          setConnectionState(state);
          setIsRealtime(state === 'connected');

          // Fallback to polling if connection fails
          if (state === 'error' && fallbackToPolling) {
            console.log('[Realtime] WebSocket error, falling back to polling');
            startPolling();
          } else if (state === 'connected') {
            stopPolling();
          }
        });

        // Subscribe to errors
        errorUnsubscribe = socketManager.onError((wsError: WebSocketError) => {
          console.error('[Realtime] WebSocket error:', wsError);
          setError(wsError.message);
        });

        // Subscribe to test runs updates
        socketManager.subscribeTestRuns(filters);

        // Listen for initial data (update from WebSocket if/when it arrives)
        initialUnsubscribe = socketManager.on<TestRunsInitialPayload>(
          'test_runs_initial',
          (payload) => {
            console.log('[Realtime] Received initial test runs from WebSocket:', payload.data.length);
            setTestRuns(payload.data);
            setError(null);
          }
        );

        // Listen for test run events
        createdUnsubscribe = socketManager.on<TestRunCreatedPayload>(
          'test_run_created',
          handleTestRunCreated
        );

        updatedUnsubscribe = socketManager.on<TestRunUpdatedPayload>(
          'test_run_updated',
          handleTestRunUpdated
        );

        deletedUnsubscribe = socketManager.on<TestRunDeletedPayload>(
          'test_run_deleted',
          handleTestRunDeleted
        );

        setIsRealtime(true);
      } catch (err) {
        console.error('[Realtime] Failed to setup WebSocket:', err);
        setError(
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to connect to real-time updates'
        );
        setIsRealtime(false);

        // Fallback to polling
        if (fallbackToPolling) {
          await fetchTestRuns();
          startPolling();
        }

        setLoading(false);
      }
    };

    /**
     * Start polling for updates
     */
    const startPolling = () => {
      stopPolling();

      pollingTimerRef.current = setInterval(() => {
        fetchTestRuns();
      }, pollingInterval);
    };

    /**
     * Stop polling
     */
    const stopPolling = () => {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };

    // Initialize
    setupRealtimeConnection();

    // Cleanup
    return () => {
      // Unsubscribe from WebSocket
      if (socketManager.isConnected()) {
        socketManager.unsubscribeTestRuns(filters);
      }

      // Unsubscribe from events
      connectionStateUnsubscribe?.();
      errorUnsubscribe?.();
      initialUnsubscribe?.();
      createdUnsubscribe?.();
      updatedUnsubscribe?.();
      deletedUnsubscribe?.();

      // Stop polling
      stopPolling();

      // Clear debounce timer
      if (updateDebounceRef.current) {
        clearTimeout(updateDebounceRef.current);
      }
    };
  }, [
    enabled,
    filters,
    fallbackToPolling,
    pollingInterval,
    fetchTestRuns,
    handleTestRunCreated,
    handleTestRunUpdated,
    handleTestRunDeleted,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    testRuns,
    loading,
    error,
    connectionState,
    isRealtime,
  };
}

/**
 * Hook state for single test run
 */
interface UseRealtimeTestRunState {
  testRun: TestRun | null;
  loading: boolean;
  error: string | null;
  connectionState: ConnectionState;
  isRealtime: boolean;
}

/**
 * Hook options for single test run
 */
interface UseRealtimeTestRunOptions {
  fallbackToPolling?: boolean;
  pollingInterval?: number;
  enabled?: boolean;
}

/**
 * Hook for subscribing to single test run with real-time updates
 *
 * Features:
 * - Real-time updates via WebSocket
 * - Automatic fallback to polling if WebSocket fails
 * - Optimistic UI updates
 *
 * @param testRunId - Test run ID to subscribe to
 * @param options - Hook options including polling settings
 * @returns State object with test run data and connection status
 */
export function useRealtimeTestRun(
  testRunId: string | null,
  options: UseRealtimeTestRunOptions = {}
): UseRealtimeTestRunState {
  const {
    fallbackToPolling = true,
    pollingInterval = 5000,
    enabled = true,
  } = options;

  const [testRun, setTestRun] = useState<TestRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isRealtime, setIsRealtime] = useState(false);

  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  /**
   * Fetch test run from API
   */
  const fetchTestRun = useCallback(async () => {
    if (!testRunId) return;

    try {
      const response = await authenticatedFetch(`/test-runs/${testRunId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch test run');
      }

      const data = await response.json();

      if (mountedRef.current) {
        setTestRun(data);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to load test run'
        );
      }
    }
  }, [testRunId]);

  /**
   * Handle test run updated event
   */
  const handleTestRunUpdated = useCallback(
    (payload: TestRunUpdatedPayload) => {
      if (payload.testRun.test_run_id === testRunId) {
        console.log('[Realtime] Test run updated:', payload.testRun.test_run_id);
        setTestRun(payload.testRun);
      }
    },
    [testRunId]
  );

  /**
   * Handle test run deleted event
   */
  const handleTestRunDeleted = useCallback(
    (payload: TestRunDeletedPayload) => {
      const deletedTestRunId = payload?.testRunId;
      if (!deletedTestRunId) {
        console.warn('[Realtime] Invalid delete payload:', payload);
        return;
      }

      if (deletedTestRunId === testRunId) {
        console.log('[Realtime] Test run deleted:', deletedTestRunId);
        setTestRun(null);
        setError('Test run was deleted');
      }
    },
    [testRunId]
  );

  /**
   * Setup WebSocket connection and subscriptions
   */
  useEffect(() => {
    if (!enabled || !testRunId) {
      setLoading(false);
      return;
    }

    let connectionStateUnsubscribe: (() => void) | undefined;
    let errorUnsubscribe: (() => void) | undefined;
    let initialUnsubscribe: (() => void) | undefined;
    let updatedUnsubscribe: (() => void) | undefined;
    let deletedUnsubscribe: (() => void) | undefined;

    const setupRealtimeConnection = async () => {
      try {
        setLoading(true);

        // Connect to WebSocket
        await socketManager.connect();

        // Subscribe to connection state changes
        connectionStateUnsubscribe = socketManager.onConnectionStateChange((state) => {
          setConnectionState(state);
          setIsRealtime(state === 'connected');

          // Fallback to polling if connection fails
          if (state === 'error' && fallbackToPolling) {
            console.log('[Realtime] WebSocket error, falling back to polling');
            startPolling();
          } else if (state === 'connected') {
            stopPolling();
          }
        });

        // Subscribe to errors
        errorUnsubscribe = socketManager.onError((wsError: WebSocketError) => {
          console.error('[Realtime] WebSocket error:', wsError);
          setError(wsError.message);
        });

        // Subscribe to test run updates
        socketManager.subscribeTestRun(testRunId);

        // Listen for initial data
        initialUnsubscribe = socketManager.on<TestRunInitialPayload>(
          'test_run_initial',
          (payload) => {
            console.log('[Realtime] Received initial test run:', payload.data.test_run_id);
            setTestRun(payload.data);
            setLoading(false);
            setError(null);
          }
        );

        // Listen for test run events
        updatedUnsubscribe = socketManager.on<TestRunUpdatedPayload>(
          'test_run_updated',
          handleTestRunUpdated
        );

        deletedUnsubscribe = socketManager.on<TestRunDeletedPayload>(
          'test_run_deleted',
          handleTestRunDeleted
        );

        setIsRealtime(true);
      } catch (err) {
        console.error('[Realtime] Failed to setup WebSocket:', err);
        setError(
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to connect to real-time updates'
        );
        setIsRealtime(false);

        // Fallback to polling
        if (fallbackToPolling) {
          await fetchTestRun();
          startPolling();
        }

        setLoading(false);
      }
    };

    /**
     * Start polling for updates
     */
    const startPolling = () => {
      stopPolling();

      pollingTimerRef.current = setInterval(() => {
        fetchTestRun();
      }, pollingInterval);
    };

    /**
     * Stop polling
     */
    const stopPolling = () => {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };

    // Initialize
    setupRealtimeConnection();

    // Cleanup
    return () => {
      // Unsubscribe from WebSocket
      if (socketManager.isConnected()) {
        socketManager.unsubscribeTestRun(testRunId);
      }

      // Unsubscribe from events
      connectionStateUnsubscribe?.();
      errorUnsubscribe?.();
      initialUnsubscribe?.();
      updatedUnsubscribe?.();
      deletedUnsubscribe?.();

      // Stop polling
      stopPolling();
    };
  }, [
    enabled,
    testRunId,
    fallbackToPolling,
    pollingInterval,
    fetchTestRun,
    handleTestRunUpdated,
    handleTestRunDeleted,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    testRun,
    loading,
    error,
    connectionState,
    isRealtime,
  };
}
