'use client';

/**
 * React Hook for fetching AWR (Automatic Workload Repository) Reports
 *
 * This hook manages AWR report data fetching using TanStack React Query.
 * It provides paginated access to AWR reports for a test run with filtering
 * and automatic cache invalidation.
 *
 * Features:
 * - Fetch AWR reports list for a test run
 * - Parse status filtering (pending, parsing, completed, failed)
 * - Pagination support (limit, offset)
 * - Automatic stale data handling (30s stale time)
 * - Cache invalidation helpers
 * - Loading and error states
 *
 * @example
 * ```tsx
 * function AwrReportsList({ testRunId }: { testRunId: string }) {
 *   const {
 *     reports,
 *     total,
 *     loading,
 *     error,
 *     refetch,
 *   } = useAwrReports(testRunId);
 *
 *   if (loading) return <Loading />;
 *   if (error) return <Error message={error} />;
 *
 *   return <AwrReportList reports={reports} total={total} />;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With filtering and pagination
 * const { reports, total } = useAwrReports(testRunId, {
 *   parseStatus: 'completed',
 *   limit: 10,
 *   offset: 0,
 * });
 * ```
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAwrReports,
  AwrReportListItem,
  AwrReportListResponse,
  ParseStatus,
  ListAwrReportsOptions,
} from '@/lib/api/awr-reports';

/**
 * Query key factory for AWR reports queries
 * Provides consistent query keys for cache management
 */
export const awrReportsQueryKeys = {
  /** Base key for all AWR reports queries */
  all: ['awr-reports'] as const,

  /** Key for AWR reports list by test run */
  list: (testRunId: string) =>
    [...awrReportsQueryKeys.all, 'list', testRunId] as const,

  /** Key for AWR reports list with filters */
  listFiltered: (testRunId: string, filters: ListAwrReportsOptions) =>
    [...awrReportsQueryKeys.list(testRunId), filters] as const,
};

/**
 * Options for useAwrReports hook
 */
export interface UseAwrReportsOptions {
  /**
   * Filter by parse status
   * @example 'completed' | 'pending' | 'parsing' | 'failed'
   */
  parseStatus?: ParseStatus;

  /**
   * Maximum number of reports to fetch
   * @default 20
   */
  limit?: number;

  /**
   * Offset for pagination
   * @default 0
   */
  offset?: number;

  /**
   * Enable/disable the query
   * @default true (when testRunId is provided)
   */
  enabled?: boolean;

  /**
   * Stale time in milliseconds
   * @default 30000 (30 seconds)
   */
  staleTime?: number;

  /**
   * Refetch interval in milliseconds (0 to disable)
   * @default 0 (disabled)
   */
  refetchInterval?: number;
}

/**
 * Return value from useAwrReports hook
 */
export interface UseAwrReportsReturn {
  /** AWR reports list */
  reports: AwrReportListItem[];

  /** Total count of reports (for pagination) */
  total: number;

  /** Current offset */
  offset: number;

  /** Current limit */
  limit: number;

  /** Whether the query is loading */
  loading: boolean;

  /** Whether the query is fetching (including background refetch) */
  isFetching: boolean;

  /** Error message if query failed */
  error: string | null;

  /** Refetch the data */
  refetch: () => Promise<void>;

  /** Invalidate all AWR reports cache for this test run */
  invalidateCache: () => Promise<void>;

  /** Whether there are more pages to fetch */
  hasNextPage: boolean;

  /** Whether there are previous pages */
  hasPreviousPage: boolean;

  /** Check if any reports exist (regardless of filters) */
  hasReports: boolean;
}

/**
 * Hook for fetching AWR reports for a test run
 *
 * @param testRunId - The test run ID to fetch reports for
 * @param options - Optional configuration for the query
 * @returns AWR reports data, loading state, error, and refetch functions
 */
export function useAwrReports(
  testRunId: string,
  options: UseAwrReportsOptions = {}
): UseAwrReportsReturn {
  const {
    parseStatus,
    limit = 20,
    offset = 0,
    enabled = true,
    staleTime = 30000,
    refetchInterval = 0,
  } = options;

  const queryClient = useQueryClient();

  // Build filter options for the API call
  const filterOptions: ListAwrReportsOptions = {
    ...(parseStatus && { parseStatus }),
    limit,
    offset,
  };

  // Create the query
  const query = useQuery({
    queryKey: awrReportsQueryKeys.listFiltered(testRunId, filterOptions),
    queryFn: async (): Promise<AwrReportListResponse> => {
      const response = await listAwrReports(testRunId, filterOptions);
      return response;
    },
    enabled: enabled && !!testRunId,
    staleTime,
    refetchInterval: refetchInterval > 0 ? refetchInterval : undefined,
  });

  // Extract error message safely per CLAUDE.md pattern
  const errorMessage = query.error && typeof query.error === 'object' && 'message' in query.error
    ? (query.error as Error).message
    : query.error
      ? 'Failed to fetch AWR reports'
      : null;

  /**
   * Refetch the current query
   */
  const refetch = async (): Promise<void> => {
    await query.refetch();
  };

  /**
   * Invalidate all AWR reports cache for this test run
   * This will cause all queries for this test run to refetch
   */
  const invalidateCache = async (): Promise<void> => {
    // React Query v5 syntax - must use object with queryKey
    await queryClient.invalidateQueries({
      queryKey: awrReportsQueryKeys.list(testRunId),
    });
  };

  // Extract data with defaults
  const data = query.data;
  const reports = data?.items ?? [];
  const total = data?.total ?? 0;
  const currentOffset = data?.offset ?? offset;
  const currentLimit = data?.limit ?? limit;

  // Calculate pagination flags
  const hasNextPage = currentOffset + currentLimit < total;
  const hasPreviousPage = currentOffset > 0;
  const hasReports = total > 0;

  return {
    reports,
    total,
    offset: currentOffset,
    limit: currentLimit,
    loading: query.isLoading,
    isFetching: query.isFetching,
    error: errorMessage,
    refetch,
    invalidateCache,
    hasNextPage,
    hasPreviousPage,
    hasReports,
  };
}

/**
 * Hook for invalidating AWR reports cache
 * Useful when you need to invalidate cache from a different component
 *
 * @returns Function to invalidate AWR reports cache for a test run
 */
export function useInvalidateAwrReports() {
  const queryClient = useQueryClient();

  /**
   * Invalidate AWR reports cache for a specific test run
   * @param testRunId - The test run ID to invalidate cache for
   */
  const invalidate = async (testRunId: string): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: awrReportsQueryKeys.list(testRunId),
    });
  };

  /**
   * Invalidate all AWR reports cache
   */
  const invalidateAll = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: awrReportsQueryKeys.all,
    });
  };

  return {
    invalidate,
    invalidateAll,
  };
}
