/**
 * React Hook for Dashboard Data with Real-Time Updates
 *
 * This hook manages dashboard data fetching and real-time updates via WebSocket.
 * It automatically refreshes dashboard data when test runs change.
 *
 * Features:
 * - Initial data fetching for statistics, failures, and systems
 * - Real-time updates via WebSocket (test run created/updated/deleted)
 * - Time period filtering (24h, 7d, 30d, all)
 * - Loading and error states
 * - Automatic data refresh on test run events
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   const {
 *     statistics,
 *     failures,
 *     systems,
 *     loading,
 *     error,
 *     timePeriod,
 *     setTimePeriod,
 *     refresh
 *   } = useDashboardData();
 *
 *   if (loading) return <Loading />;
 *   if (error) return <Error message={error} />;
 *
 *   return <DashboardView data={{ statistics, failures, systems }} />;
 * }
 * ```
 */

import { useState, useEffect, useCallback } from 'react';
import {
  fetchDashboardStatistics,
  fetchRecentFailures,
  fetchDashboardSystemsSummary,
  DashboardStatistics,
  RecentFailure,
  SystemSummary,
} from '@/lib/api';
import { useTestRunRealtime } from './useTestRunRealtime';

export type TimePeriod = '24h' | '7d' | '30d' | 'all' | 'custom';

export interface CustomTimeRange {
  from: Date;
  to: Date;
}

/**
 * Options for useDashboardData hook
 */
export interface UseDashboardDataOptions {
  /**
   * Enable/disable real-time updates
   * @default true
   */
  enableRealtime?: boolean;

  /**
   * Initial time period for statistics
   * @default '7d'
   */
  initialTimePeriod?: TimePeriod;

  /**
   * Number of recent unreviewed failures to fetch
   * @default 5
   */
  failuresLimit?: number;

  /**
   * Auto-refresh interval in milliseconds (0 to disable)
   * @default 0 (disabled, relying on WebSocket)
   */
  autoRefreshInterval?: number;

  /**
   * Organization ID to scope dashboard data
   */
  organizationId?: string | null;
}

/**
 * Return value from useDashboardData hook
 */
export interface UseDashboardDataReturn {
  /** Dashboard statistics */
  statistics: DashboardStatistics | null;

  /** Recent failed test runs */
  failures: RecentFailure[];

  /** Systems summary */
  systems: SystemSummary[];

  /** Loading state */
  loading: boolean;

  /** Error message if any */
  error: string | null;

  /** Current time period filter */
  timePeriod: TimePeriod;

  /** Change time period filter */
  setTimePeriod: (period: TimePeriod) => void;

  /** Custom time range */
  customTimeRange: CustomTimeRange;

  /** Set custom time range */
  setCustomTimeRange: (range: CustomTimeRange) => void;

  /** Manually refresh all data */
  refresh: () => Promise<void>;

  /** WebSocket connection status */
  isLive: boolean;
}

/**
 * Hook for managing dashboard data with real-time updates
 */
export function useDashboardData(
  options: UseDashboardDataOptions = {}
): UseDashboardDataReturn {
  const {
    enableRealtime = true,
    initialTimePeriod = '7d',
    failuresLimit = 5,
    autoRefreshInterval = 0,
    organizationId,
  } = options;

  const [statistics, setStatistics] = useState<DashboardStatistics | null>(null);
  const [failures, setFailures] = useState<RecentFailure[]>([]);
  const [systems, setSystems] = useState<SystemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(initialTimePeriod);
  const [customTimeRange, setCustomTimeRange] = useState<CustomTimeRange>({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    to: new Date()
  });

  /**
   * Fetch all dashboard data
   */
  const fetchAllData = useCallback(async () => {
    try {
      setError(null);

      // Prepare parameters for custom time range
      const fromISO = customTimeRange.from.toISOString();
      const toISO = customTimeRange.to.toISOString();
      const orgId = organizationId || undefined;

      // Fetch all three endpoints in parallel for better performance
      const [statsData, failuresData, systemsData] = await Promise.all([
        fetchDashboardStatistics(
          timePeriod,
          timePeriod === 'custom' ? fromISO : undefined,
          timePeriod === 'custom' ? toISO : undefined,
          orgId,
        ),
        fetchRecentFailures(
          failuresLimit,
          timePeriod,
          timePeriod === 'custom' ? fromISO : undefined,
          timePeriod === 'custom' ? toISO : undefined,
          orgId,
        ),
        fetchDashboardSystemsSummary(orgId),
      ]);

      setStatistics(statsData);
      setFailures(failuresData);
      setSystems(systemsData);
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to fetch dashboard data';
      setError(message);
      console.error('[useDashboardData] Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, [timePeriod, failuresLimit, customTimeRange, organizationId]);

  /**
   * Refresh data (exposed to component)
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchAllData();
  }, [fetchAllData]);

  /**
   * Handle time period change
   */
  const handleTimePeriodChange = useCallback((period: TimePeriod) => {
    setTimePeriod(period);
    setLoading(true);
  }, []);

  /**
   * Setup WebSocket real-time updates
   */
  const { isLive } = useTestRunRealtime({
    enabled: enableRealtime,
    onTestRunCreated: () => {
      // Refresh dashboard when new test runs are created
      fetchAllData();
    },
    onTestRunUpdated: () => {
      // Refresh dashboard when test runs are updated
      fetchAllData();
    },
    onTestRunDeleted: () => {
      // Refresh dashboard when test runs are deleted
      fetchAllData();
    },
  });

  /**
   * Initial data fetch
   */
  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  /**
   * Auto-refresh interval (if enabled)
   */
  useEffect(() => {
    if (autoRefreshInterval > 0) {
      const interval = setInterval(() => {
        fetchAllData();
      }, autoRefreshInterval);

      return () => clearInterval(interval);
    }
  }, [autoRefreshInterval, fetchAllData]);

  return {
    statistics,
    failures,
    systems,
    loading,
    error,
    timePeriod,
    setTimePeriod: handleTimePeriodChange,
    customTimeRange,
    setCustomTimeRange,
    refresh,
    isLive,
  };
}
