/**
 * React Hook for Real-Time Test Run Updates
 *
 * This hook manages WebSocket connections and real-time updates for test runs.
 * It handles connection lifecycle, event subscriptions, and provides fallback
 * to API polling when WebSocket is unavailable.
 *
 * Features:
 * - Automatic connection management
 * - Event deduplication
 * - Debounced updates (300ms)
 * - Fallback to API polling
 * - TypeScript type safety
 *
 * @example
 * ```tsx
 * function TestRunsList() {
 *   const { connectionStatus, isLive } = useTestRunRealtime({
 *     enabled: true,
 *     onTestRunCreated: (testRun) => console.log('New test run:', testRun),
 *     onTestRunUpdated: (testRun) => console.log('Updated test run:', testRun),
 *     onTestRunDeleted: (testRunId) => console.log('Deleted test run:', testRunId),
 *   });
 *
 *   return <div>Connection: {connectionStatus}</div>;
 * }
 * ```
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { socketManager } from '@/lib/socket';
import {
  ConnectionState,
  TestRunCreatedPayload,
  TestRunUpdatedPayload,
  TestRunDeletedPayload,
  TestRunsInitialPayload,
  TestRunFilters,
} from '@/types/realtime';
import { TestRun } from '@/types/test-runs';

/**
 * Options for useTestRunRealtime hook
 */
export interface UseTestRunRealtimeOptions {
  /**
   * Enable/disable real-time updates
   * @default true
   */
  enabled?: boolean;

  /**
   * Fallback to API polling if WebSocket disconnects
   * @default true
   */
  fallbackToPolling?: boolean;

  /**
   * Polling interval in milliseconds when using fallback
   * @default 5000
   */
  pollingInterval?: number;

  /**
   * Filters for subscribing to specific test runs
   */
  filters?: TestRunFilters;

  /**
   * Callback when a test run is created
   */
  onTestRunCreated?: (testRun: TestRun) => void;

  /**
   * Callback when a test run is updated
   */
  onTestRunUpdated?: (testRun: TestRun) => void;

  /**
   * Callback when a test run is deleted
   */
  onTestRunDeleted?: (testRunId: string) => void;

  /**
   * Callback when initial test runs data is received
   */
  onTestRunsInitial?: (testRuns: TestRun[]) => void;

  /**
   * Callback when connection state changes
   */
  onConnectionStateChange?: (state: ConnectionState) => void;
}

/**
 * Return value from useTestRunRealtime hook
 */
export interface UseTestRunRealtimeReturn {
  /**
   * Current WebSocket connection status
   */
  connectionStatus: ConnectionState;

  /**
   * True if connected to WebSocket
   */
  isLive: boolean;

  /**
   * Manually reconnect to WebSocket
   */
  reconnect: () => Promise<void>;

  /**
   * Manually disconnect from WebSocket
   */
  disconnect: () => void;
}

/**
 * Hook for managing real-time test run updates
 */
export function useTestRunRealtime(
  options: UseTestRunRealtimeOptions = {}
): UseTestRunRealtimeReturn {
  const {
    enabled = true,
    fallbackToPolling = false,
    pollingInterval = 5000,
    filters,
    onTestRunCreated,
    onTestRunUpdated,
    onTestRunDeleted,
    onTestRunsInitial,
    onConnectionStateChange,
  } = options;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionState>(
    socketManager.getConnectionState()
  );

  // Debounce timers
  const debounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Track processed event IDs to avoid duplicates
  const processedEvents = useRef<Set<string>>(new Set());

  // Polling timer ref
  const pollingTimer = useRef<NodeJS.Timeout | null>(null);

  /**
   * Debounced callback execution
   */
  const debounceCallback = useCallback(
    (key: string, callback: () => void, delay: number = 300) => {
      // Clear existing timer
      const existingTimer = debounceTimers.current.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Set new timer
      const timer = setTimeout(() => {
        callback();
        debounceTimers.current.delete(key);
      }, delay);

      debounceTimers.current.set(key, timer);
    },
    []
  );

  /**
   * Handle test run created event
   */
  const handleTestRunCreated = useCallback(
    (payload: TestRunCreatedPayload) => {
      const testRun = payload.testRun;
      if (!testRun) {
        console.warn('[useTestRunRealtime] No testRun in created event:', payload);
        return;
      }

      const eventId = `created-${testRun.id}-${payload.timestamp}`;

      // Avoid duplicate processing
      if (processedEvents.current.has(eventId)) {
        return;
      }

      processedEvents.current.add(eventId);

      // Debounce the callback
      debounceCallback(`created-${testRun.id}`, () => {
        onTestRunCreated?.(testRun);
      });

      // Clean up old events (keep only last 100)
      if (processedEvents.current.size > 100) {
        const events = Array.from(processedEvents.current);
        processedEvents.current = new Set(events.slice(-100));
      }
    },
    [onTestRunCreated, debounceCallback]
  );

  /**
   * Handle test run updated event
   */
  const handleTestRunUpdated = useCallback(
    (payload: TestRunUpdatedPayload) => {
      const testRun = payload.testRun;
      if (!testRun) {
        console.warn('[useTestRunRealtime] No testRun in updated event:', payload);
        return;
      }

      const eventId = `updated-${testRun.id}-${payload.timestamp}`;

      // Avoid duplicate processing
      if (processedEvents.current.has(eventId)) {
        return;
      }

      processedEvents.current.add(eventId);

      // Debounce the callback
      debounceCallback(`updated-${testRun.id}`, () => {
        onTestRunUpdated?.(testRun);
      });

      // Clean up old events
      if (processedEvents.current.size > 100) {
        const events = Array.from(processedEvents.current);
        processedEvents.current = new Set(events.slice(-100));
      }
    },
    [onTestRunUpdated, debounceCallback]
  );

  /**
   * Handle test run deleted event
   */
  const handleTestRunDeleted = useCallback(
    (payload: TestRunDeletedPayload) => {
      const testRunId = payload.testRunId;
      if (!testRunId) {
        console.warn('[useTestRunRealtime] Invalid delete payload:', payload);
        return;
      }

      const eventId = `deleted-${testRunId}-${payload.timestamp}`;

      // Avoid duplicate processing
      if (processedEvents.current.has(eventId)) {
        return;
      }

      processedEvents.current.add(eventId);

      // Debounce the callback
      debounceCallback(`deleted-${testRunId}`, () => {
        onTestRunDeleted?.(testRunId);
      });

      // Clean up old events
      if (processedEvents.current.size > 100) {
        const events = Array.from(processedEvents.current);
        processedEvents.current = new Set(events.slice(-100));
      }
    },
    [onTestRunDeleted, debounceCallback]
  );

  /**
   * Handle initial test runs data
   */
  const handleTestRunsInitial = useCallback(
    (payload: TestRunsInitialPayload) => {
      onTestRunsInitial?.(payload.data);
    },
    [onTestRunsInitial]
  );

  /**
   * Start API polling fallback
   */
  const startPolling = useCallback(() => {
    if (!fallbackToPolling || pollingTimer.current) return;

    // Note: Polling implementation would require API client
    // For now, just set up the interval without logging
    pollingTimer.current = setInterval(() => {
      // TODO: Call API to fetch latest test runs
    }, pollingInterval);
  }, [fallbackToPolling, pollingInterval]);

  /**
   * Stop API polling
   */
  const stopPolling = useCallback(() => {
    if (pollingTimer.current) {
      clearInterval(pollingTimer.current);
      pollingTimer.current = null;
    }
  }, []);

  /**
   * Handle connection state changes
   */
  const handleConnectionStateChange = useCallback(
    (state: ConnectionState) => {
      setConnectionStatus(state);
      onConnectionStateChange?.(state);

      // Subscribe to test runs when connected
      if (state === 'connected') {
        socketManager.subscribeTestRuns(filters);
        stopPolling();
      } else if (fallbackToPolling) {
        // Start polling if disconnected and fallback enabled
        startPolling();
      }
    },
    [onConnectionStateChange, fallbackToPolling, filters, stopPolling, startPolling]
  );

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(async () => {
    if (!enabled) return;

    try {
      await socketManager.connect();

      // If already connected, immediately subscribe (state change event won't fire)
      if (socketManager.isConnected()) {
        socketManager.subscribeTestRuns(filters);
      }
    } catch (error) {
      console.error('[useTestRunRealtime] Failed to connect:', error);
    }
  }, [enabled, filters]);

  /**
   * Manually reconnect
   */
  const reconnect = useCallback(async () => {
    socketManager.disconnect();
    await connect();
  }, [connect]);

  /**
   * Manually disconnect
   */
  const disconnect = useCallback(() => {
    socketManager.disconnect();
    stopPolling();
  }, [stopPolling]);

  /**
   * Setup effect - connect and subscribe
   */
  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Connect to WebSocket
    connect();

    // Subscribe to connection state changes
    const unsubscribeState = socketManager.onConnectionStateChange(handleConnectionStateChange);

    // Subscribe to events (backend uses test-run:created format with colons)
    const unsubscribeCreated = socketManager.on<TestRunCreatedPayload>(
      'test-run:created',
      handleTestRunCreated
    );

    const unsubscribeUpdated = socketManager.on<TestRunUpdatedPayload>(
      'test-run:updated',
      handleTestRunUpdated
    );

    const unsubscribeDeleted = socketManager.on<TestRunDeletedPayload>(
      'test-run:deleted',
      handleTestRunDeleted
    );

    const unsubscribeInitial = socketManager.on<TestRunsInitialPayload>(
      'test_runs_initial',
      handleTestRunsInitial
    );

    // Note: Subscription happens in handleConnectionStateChange when state becomes 'connected'

    // Cleanup on unmount
    return () => {
      // Unsubscribe from events
      unsubscribeState();
      unsubscribeCreated();
      unsubscribeUpdated();
      unsubscribeDeleted();
      unsubscribeInitial();

      // Unsubscribe from test runs
      if (socketManager.isConnected()) {
        socketManager.unsubscribeTestRuns(filters);
      }

      // Clear debounce timers
      debounceTimers.current.forEach((timer) => clearTimeout(timer));
      debounceTimers.current.clear();

      // Stop polling
      stopPolling();
    };
  }, [
    enabled,
    filters,
    connect,
    handleConnectionStateChange,
    handleTestRunCreated,
    handleTestRunUpdated,
    handleTestRunDeleted,
    handleTestRunsInitial,
    stopPolling,
  ]);

  return {
    connectionStatus,
    isLive: connectionStatus === 'connected',
    reconnect,
    disconnect,
  };
}
