'use client';

/**
 * React Hook for AWR Report Comparison
 *
 * This hook manages AWR comparison data fetching using TanStack React Query.
 * It provides access to comparison results between two AWR reports,
 * including SQL regressions, wait event changes, and load profile differences.
 *
 * Features:
 * - Compare two AWR reports by ID
 * - Compare AWR reports across test runs
 * - Fetch available baselines for comparison
 * - Quick comparison summary
 * - Cache invalidation helpers
 * - Loading and error states
 * - MUI Snackbar callback pattern for notifications
 *
 * @example
 * ```tsx
 * function AwrCompareTab({ reportId, testRunId }: Props) {
 *   const {
 *     baselines,
 *     selectedBaselineId,
 *     setSelectedBaselineId,
 *     comparison,
 *     loading,
 *     compare,
 *   } = useAwrComparison(reportId, testRunId);
 *
 *   return (
 *     <div>
 *       <BaselineSelector
 *         baselines={baselines}
 *         selected={selectedBaselineId}
 *         onChange={setSelectedBaselineId}
 *       />
 *       <ComparisonDisplay comparison={comparison} loading={loading} />
 *       <Button onClick={compare}>Compare</Button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With test run comparison
 * function TestRunComparison({ currentTestRunId, baselineTestRunId }: Props) {
 *   const { compareTestRuns, isComparing, comparison } = useAwrComparison(null, currentTestRunId);
 *
 *   const handleCompare = () => {
 *     compareTestRuns(baselineTestRunId);
 *   };
 *
 *   return <Button onClick={handleCompare} disabled={isComparing}>Compare</Button>;
 * }
 * ```
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import {
  compareAwrReports,
  compareTestRunAwrReports,
  getComparisonSummary,
  getAvailableBaselines,
  getTestRunAvailableBaselines,
  ComparisonResponse,
  ComparisonSummary,
  AvailableBaseline,
  AvailableBaselinesResponse,
  CompareReportsOptions,
  CompareTestRunReportsOptions,
  SqlComparisonItem,
  WaitEventComparisonItem,
  LoadProfileComparisonItem,
  ChangeDirection,
} from '@/lib/api/awr-reports';
import { awrReportsQueryKeys } from './useAwrReports';
import { awrAnalysisQueryKeys } from './useAwrAnalysis';

/**
 * Query key factory for AWR comparison queries
 * Provides consistent query keys for cache management
 */
export const awrComparisonQueryKeys = {
  /** Base key for all AWR comparison queries */
  all: ['awr-comparison'] as const,

  /** Key for comparison between two reports */
  comparison: (currentId: string, baselineId: string) =>
    [...awrComparisonQueryKeys.all, 'compare', currentId, baselineId] as const,

  /** Key for comparison summary */
  summary: (currentId: string, baselineId: string) =>
    [...awrComparisonQueryKeys.all, 'summary', currentId, baselineId] as const,

  /** Key for available baselines by report */
  baselines: (reportId: string) =>
    [...awrComparisonQueryKeys.all, 'baselines', 'report', reportId] as const,

  /** Key for available baselines by test run */
  testRunBaselines: (testRunId: string) =>
    [...awrComparisonQueryKeys.all, 'baselines', 'testrun', testRunId] as const,
};

/**
 * Snackbar severity levels for MUI integration
 */
export type SnackbarSeverity = 'success' | 'error' | 'info' | 'warning';

/**
 * Comparison options for the hook
 */
export interface ComparisonOptions {
  /** Regression threshold percentage (default: 20) */
  regressionThresholdPercent?: number;

  /** Improvement threshold percentage (default: 20) */
  improvementThresholdPercent?: number;

  /** Include SQL comparison (default: true) */
  includeSqlComparison?: boolean;

  /** Include wait event comparison (default: true) */
  includeWaitEventComparison?: boolean;

  /** Include load profile comparison (default: true) */
  includeLoadProfileComparison?: boolean;

  /** Include info-level insights (default: false) */
  includeInfoInsights?: boolean;

  /** Maximum SQL statements to compare (default: 50) */
  maxSqlStatements?: number;
}

/**
 * Options for useAwrComparison hook
 */
export interface UseAwrComparisonOptions {
  /**
   * Enable/disable the baselines query
   * @default true (when reportId or testRunId is provided)
   */
  enabled?: boolean;

  /**
   * Stale time for baselines in milliseconds
   * @default 60000 (1 minute)
   */
  baselinesStaleTime?: number;

  /**
   * Stale time for comparison in milliseconds
   * @default 300000 (5 minutes - comparison doesn't change unless re-triggered)
   */
  comparisonStaleTime?: number;

  /**
   * Initial baseline report ID to select
   */
  initialBaselineId?: string;

  /**
   * Default comparison options
   */
  defaultComparisonOptions?: ComparisonOptions;

  /**
   * Callback when comparison succeeds
   */
  onCompareSuccess?: (response: ComparisonResponse) => void;

  /**
   * Callback when comparison fails
   */
  onCompareError?: (error: Error) => void;

  /**
   * Snackbar notification callback (MUI Snackbar pattern)
   */
  onSnackbar?: (message: string, severity?: SnackbarSeverity) => void;
}

/**
 * Filter options for SQL comparison items
 */
export interface SqlComparisonFilters {
  /** Filter by change direction */
  direction?: ChangeDirection | ChangeDirection[];

  /** Only show significant regressions */
  significantRegressionsOnly?: boolean;

  /** Only show significant improvements */
  significantImprovementsOnly?: boolean;

  /** Minimum elapsed time change percent */
  minElapsedTimeChangePercent?: number;

  /** SQL ID filter */
  sqlId?: string;
}

/**
 * Return value from useAwrComparison hook
 */
export interface UseAwrComparisonReturn {
  /** Available baselines for comparison */
  baselines: AvailableBaseline[];

  /** Whether baselines are loading */
  isLoadingBaselines: boolean;

  /** Error loading baselines */
  baselinesError: string | null;

  /** Selected baseline report ID */
  selectedBaselineId: string | null;

  /** Set the selected baseline report ID */
  setSelectedBaselineId: (id: string | null) => void;

  /** Current comparison result (null if not compared yet) */
  comparison: ComparisonResponse | null;

  /** Quick comparison summary */
  summary: ComparisonSummary | null;

  /** Whether comparison is loading */
  isComparing: boolean;

  /** Whether summary is loading */
  isLoadingSummary: boolean;

  /** Error from comparison */
  comparisonError: string | null;

  /** Execute comparison between current report and selected baseline */
  compare: (options?: ComparisonOptions) => void;

  /** Compare across test runs */
  compareTestRuns: (baselineTestRunId: string, options?: ComparisonOptions) => void;

  /** Refetch baselines */
  refetchBaselines: () => Promise<void>;

  /** Invalidate comparison cache */
  invalidateComparison: () => Promise<void>;

  /** Reset comparison state */
  resetComparison: () => void;

  /** SQL comparison items */
  sqlComparisons: SqlComparisonItem[];

  /** SQL regressions */
  sqlRegressions: SqlComparisonItem[];

  /** SQL improvements */
  sqlImprovements: SqlComparisonItem[];

  /** New SQL statements */
  newSqlStatements: SqlComparisonItem[];

  /** Wait event comparisons */
  waitEventComparisons: WaitEventComparisonItem[];

  /** Wait event increases */
  waitEventIncreases: WaitEventComparisonItem[];

  /** Wait event decreases */
  waitEventDecreases: WaitEventComparisonItem[];

  /** Load profile comparisons */
  loadProfileComparisons: LoadProfileComparisonItem[];

  /** Filter SQL comparisons */
  filterSqlComparisons: (filters: SqlComparisonFilters) => SqlComparisonItem[];

  /** Get overall comparison status */
  overallStatus: 'improved' | 'regressed' | 'stable' | 'unknown';

  /** Whether comparison has been performed */
  hasComparison: boolean;

  /** Whether there are significant regressions */
  hasSignificantRegressions: boolean;

  /** Whether there are significant improvements */
  hasSignificantImprovements: boolean;

  /** Total regression count */
  regressionCount: number;

  /** Total improvement count */
  improvementCount: number;
}

/**
 * Hook for comparing AWR reports
 *
 * @param reportId - The current AWR report ID (null if comparing by test run only)
 * @param testRunId - The test run ID for fetching available baselines
 * @param options - Optional configuration for the hook
 * @returns Comparison data, loading states, and utility functions
 */
export function useAwrComparison(
  reportId: string | null,
  testRunId: string,
  options: UseAwrComparisonOptions = {}
): UseAwrComparisonReturn {
  const {
    enabled = true,
    baselinesStaleTime = 60000,
    comparisonStaleTime = 300000,
    initialBaselineId,
    defaultComparisonOptions = {},
    onCompareSuccess,
    onCompareError,
    onSnackbar,
  } = options;

  const queryClient = useQueryClient();
  const [selectedBaselineId, setSelectedBaselineId] = useState<string | null>(
    initialBaselineId ?? null
  );

  // Fetch available baselines
  const baselinesQuery = useQuery({
    queryKey: reportId
      ? awrComparisonQueryKeys.baselines(reportId)
      : awrComparisonQueryKeys.testRunBaselines(testRunId),
    queryFn: async (): Promise<AvailableBaselinesResponse> => {
      if (reportId) {
        return await getAvailableBaselines(reportId);
      }
      return await getTestRunAvailableBaselines(testRunId);
    },
    enabled: enabled && (!!reportId || !!testRunId),
    staleTime: baselinesStaleTime,
  });

  // Fetch comparison summary (when baseline is selected)
  const summaryQuery = useQuery({
    queryKey: reportId && selectedBaselineId
      ? awrComparisonQueryKeys.summary(reportId, selectedBaselineId)
      : ['disabled-summary'],
    queryFn: async (): Promise<ComparisonSummary> => {
      if (!reportId || !selectedBaselineId) {
        throw new Error('Report ID and baseline ID are required for summary');
      }
      return await getComparisonSummary(reportId, selectedBaselineId);
    },
    enabled: enabled && !!reportId && !!selectedBaselineId,
    staleTime: comparisonStaleTime,
  });

  // Comparison mutation for report-to-report comparison
  const comparisonMutation = useMutation({
    mutationFn: async (
      params: { baselineId: string; options?: ComparisonOptions }
    ): Promise<ComparisonResponse> => {
      if (!reportId) {
        throw new Error('Report ID is required for comparison');
      }

      const requestOptions: CompareReportsOptions = {
        currentReportId: reportId,
        baselineReportId: params.baselineId,
        regressionThresholdPercent:
          params.options?.regressionThresholdPercent ??
          defaultComparisonOptions.regressionThresholdPercent,
        improvementThresholdPercent:
          params.options?.improvementThresholdPercent ??
          defaultComparisonOptions.improvementThresholdPercent,
        includeSqlComparison:
          params.options?.includeSqlComparison ??
          defaultComparisonOptions.includeSqlComparison ??
          true,
        includeWaitEventComparison:
          params.options?.includeWaitEventComparison ??
          defaultComparisonOptions.includeWaitEventComparison ??
          true,
        includeLoadProfileComparison:
          params.options?.includeLoadProfileComparison ??
          defaultComparisonOptions.includeLoadProfileComparison ??
          true,
        includeInfoInsights:
          params.options?.includeInfoInsights ??
          defaultComparisonOptions.includeInfoInsights ??
          false,
        maxSqlStatements:
          params.options?.maxSqlStatements ??
          defaultComparisonOptions.maxSqlStatements ??
          50,
      };

      return await compareAwrReports(requestOptions);
    },
    onSuccess: (data) => {
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: awrAnalysisQueryKeys.all,
      });

      onSnackbar?.('Comparison completed successfully', 'success');
      onCompareSuccess?.(data);
    },
    onError: (error: Error) => {
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Comparison failed';
      onSnackbar?.(`Comparison failed: ${errorMessage}`, 'error');
      onCompareError?.(error);
    },
  });

  // Comparison mutation for test-run-to-test-run comparison
  const testRunComparisonMutation = useMutation({
    mutationFn: async (
      params: { baselineTestRunId: string; options?: ComparisonOptions }
    ): Promise<ComparisonResponse> => {
      const requestOptions: CompareTestRunReportsOptions = {
        currentTestRunId: testRunId,
        baselineTestRunId: params.baselineTestRunId,
        ...(reportId && { currentReportId: reportId }),
        significantChangeThreshold:
          params.options?.regressionThresholdPercent ??
          defaultComparisonOptions.regressionThresholdPercent,
      };

      return await compareTestRunAwrReports(requestOptions);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: awrAnalysisQueryKeys.all,
      });

      onSnackbar?.('Test run comparison completed successfully', 'success');
      onCompareSuccess?.(data);
    },
    onError: (error: Error) => {
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Test run comparison failed';
      onSnackbar?.(`Comparison failed: ${errorMessage}`, 'error');
      onCompareError?.(error);
    },
  });

  // Extract error messages safely per CLAUDE.md pattern
  const baselinesError = baselinesQuery.error && typeof baselinesQuery.error === 'object' &&
    'message' in baselinesQuery.error
    ? (baselinesQuery.error as Error).message
    : baselinesQuery.error
      ? 'Failed to fetch available baselines'
      : null;

  const comparisonError = comparisonMutation.error && typeof comparisonMutation.error === 'object' &&
    'message' in comparisonMutation.error
    ? (comparisonMutation.error as Error).message
    : testRunComparisonMutation.error &&
      typeof testRunComparisonMutation.error === 'object' &&
      'message' in testRunComparisonMutation.error
      ? (testRunComparisonMutation.error as Error).message
      : comparisonMutation.error || testRunComparisonMutation.error
        ? 'Comparison failed'
        : null;

  // Extract data
  const baselines = baselinesQuery.data?.baselines ?? [];
  const comparison = comparisonMutation.data ?? testRunComparisonMutation.data ?? null;
  const summary = summaryQuery.data ?? null;

  // Extract comparison details
  const sqlComparisons = comparison?.sqlComparison?.comparisons ?? [];
  const sqlRegressions = comparison?.sqlComparison?.regressions ?? [];
  const sqlImprovements = comparison?.sqlComparison?.improvements ?? [];
  const newSqlStatements = comparison?.sqlComparison?.newStatements ?? [];
  const waitEventComparisons = comparison?.waitEventComparison?.comparisons ?? [];
  const waitEventIncreases = comparison?.waitEventComparison?.increases ?? [];
  const waitEventDecreases = comparison?.waitEventComparison?.decreases ?? [];
  const loadProfileComparisons = comparison?.loadProfileComparison?.metrics ?? [];

  /**
   * Compare current report with selected baseline
   */
  const compare = useCallback(
    (comparisonOptions?: ComparisonOptions): void => {
      if (!selectedBaselineId) {
        onSnackbar?.('Please select a baseline for comparison', 'warning');
        return;
      }
      comparisonMutation.mutate({
        baselineId: selectedBaselineId,
        options: comparisonOptions,
      });
    },
    [selectedBaselineId, comparisonMutation, onSnackbar]
  );

  /**
   * Compare across test runs
   */
  const compareTestRuns = useCallback(
    (baselineTestRunId: string, comparisonOptions?: ComparisonOptions): void => {
      testRunComparisonMutation.mutate({
        baselineTestRunId,
        options: comparisonOptions,
      });
    },
    [testRunComparisonMutation]
  );

  /**
   * Refetch baselines
   */
  const refetchBaselines = useCallback(async (): Promise<void> => {
    await baselinesQuery.refetch();
  }, [baselinesQuery]);

  /**
   * Invalidate comparison cache
   */
  const invalidateComparison = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: awrComparisonQueryKeys.all,
    });
  }, [queryClient]);

  /**
   * Reset comparison state
   */
  const resetComparison = useCallback((): void => {
    comparisonMutation.reset();
    testRunComparisonMutation.reset();
  }, [comparisonMutation, testRunComparisonMutation]);

  /**
   * Filter SQL comparisons
   */
  const filterSqlComparisons = useCallback(
    (filters: SqlComparisonFilters): SqlComparisonItem[] => {
      return sqlComparisons.filter((item) => {
        // Filter by direction
        if (filters.direction) {
          const directions = Array.isArray(filters.direction)
            ? filters.direction
            : [filters.direction];
          if (!directions.includes(item.changeDirection)) {
            return false;
          }
        }

        // Filter significant regressions only
        if (filters.significantRegressionsOnly && !item.isSignificantRegression) {
          return false;
        }

        // Filter significant improvements only
        if (filters.significantImprovementsOnly && !item.isSignificantImprovement) {
          return false;
        }

        // Filter by minimum elapsed time change
        if (filters.minElapsedTimeChangePercent !== undefined) {
          const change = Math.abs(item.deltaPercent.elapsedTime ?? 0);
          if (change < filters.minElapsedTimeChangePercent) {
            return false;
          }
        }

        // Filter by SQL ID
        if (filters.sqlId && item.sqlId !== filters.sqlId) {
          return false;
        }

        return true;
      });
    },
    [sqlComparisons]
  );

  // Memoized computed values
  const hasComparison = useMemo(() => comparison !== null, [comparison]);

  const hasSignificantRegressions = useMemo(
    () => sqlRegressions.length > 0 || waitEventIncreases.length > 0,
    [sqlRegressions, waitEventIncreases]
  );

  const hasSignificantImprovements = useMemo(
    () => sqlImprovements.length > 0 || waitEventDecreases.length > 0,
    [sqlImprovements, waitEventDecreases]
  );

  const regressionCount = useMemo(
    () =>
      (comparison?.sqlComparison?.summary?.regressionCount ?? 0) +
      (comparison?.waitEventComparison?.increases?.length ?? 0),
    [comparison]
  );

  const improvementCount = useMemo(
    () =>
      (comparison?.sqlComparison?.summary?.improvementCount ?? 0) +
      (comparison?.waitEventComparison?.decreases?.length ?? 0),
    [comparison]
  );

  const overallStatus = useMemo((): 'improved' | 'regressed' | 'stable' | 'unknown' => {
    if (!hasComparison) return 'unknown';

    // Use summary if available
    if (summary?.overallStatus) return summary.overallStatus;

    // Calculate based on regression/improvement counts
    if (regressionCount > improvementCount) return 'regressed';
    if (improvementCount > regressionCount) return 'improved';
    return 'stable';
  }, [hasComparison, summary, regressionCount, improvementCount]);

  return {
    baselines,
    isLoadingBaselines: baselinesQuery.isLoading,
    baselinesError,
    selectedBaselineId,
    setSelectedBaselineId,
    comparison,
    summary,
    isComparing: comparisonMutation.isPending || testRunComparisonMutation.isPending,
    isLoadingSummary: summaryQuery.isLoading,
    comparisonError,
    compare,
    compareTestRuns,
    refetchBaselines,
    invalidateComparison,
    resetComparison,
    sqlComparisons,
    sqlRegressions,
    sqlImprovements,
    newSqlStatements,
    waitEventComparisons,
    waitEventIncreases,
    waitEventDecreases,
    loadProfileComparisons,
    filterSqlComparisons,
    overallStatus,
    hasComparison,
    hasSignificantRegressions,
    hasSignificantImprovements,
    regressionCount,
    improvementCount,
  };
}

/**
 * Hook for invalidating AWR comparison cache
 * Useful when you need to invalidate cache from a different component
 *
 * @returns Functions to invalidate AWR comparison cache
 */
export function useInvalidateAwrComparison() {
  const queryClient = useQueryClient();

  /**
   * Invalidate comparison cache for specific reports
   */
  const invalidateComparison = useCallback(
    async (currentId: string, baselineId: string): Promise<void> => {
      await queryClient.invalidateQueries({
        queryKey: awrComparisonQueryKeys.comparison(currentId, baselineId),
      });
      await queryClient.invalidateQueries({
        queryKey: awrComparisonQueryKeys.summary(currentId, baselineId),
      });
    },
    [queryClient]
  );

  /**
   * Invalidate baselines cache for a report
   */
  const invalidateBaselines = useCallback(
    async (reportId: string): Promise<void> => {
      await queryClient.invalidateQueries({
        queryKey: awrComparisonQueryKeys.baselines(reportId),
      });
    },
    [queryClient]
  );

  /**
   * Invalidate baselines cache for a test run
   */
  const invalidateTestRunBaselines = useCallback(
    async (testRunId: string): Promise<void> => {
      await queryClient.invalidateQueries({
        queryKey: awrComparisonQueryKeys.testRunBaselines(testRunId),
      });
    },
    [queryClient]
  );

  /**
   * Invalidate all comparison cache
   */
  const invalidateAll = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: awrComparisonQueryKeys.all,
    });
  }, [queryClient]);

  return {
    invalidateComparison,
    invalidateBaselines,
    invalidateTestRunBaselines,
    invalidateAll,
  };
}

/**
 * Hook for comparison statistics
 * Provides aggregated statistics from comparison results
 *
 * @param comparison - The comparison response to analyze
 * @returns Aggregated comparison statistics
 */
export function useComparisonStats(comparison: ComparisonResponse | null) {
  return useMemo(() => {
    if (!comparison) {
      return {
        totalSqlChanges: 0,
        totalWaitEventChanges: 0,
        totalLoadProfileChanges: 0,
        sqlSummary: null,
        waitEventsByClass: {} as Record<string, { total: number; increased: number }>,
        loadProfileHighlights: null,
        insightsBySeverity: { critical: 0, warning: 0, info: 0 },
        overallImpactScore: 0,
      };
    }

    // SQL summary
    const sqlSummary = comparison.sqlComparison?.summary ?? null;
    const totalSqlChanges = sqlSummary
      ? sqlSummary.regressionCount +
        sqlSummary.improvementCount +
        sqlSummary.newCount +
        sqlSummary.removedCount
      : 0;

    // Wait events by class
    const waitEventsByClass: Record<string, { total: number; increased: number }> = {};
    if (comparison.waitEventComparison?.byClass) {
      for (const [cls, data] of Object.entries(comparison.waitEventComparison.byClass)) {
        waitEventsByClass[cls] = {
          total: data.eventCount,
          increased: data.totalChange > 0 ? data.eventCount : 0,
        };
      }
    }

    // Wait event changes
    const totalWaitEventChanges =
      (comparison.waitEventComparison?.increases?.length ?? 0) +
      (comparison.waitEventComparison?.decreases?.length ?? 0) +
      (comparison.waitEventComparison?.newEvents?.length ?? 0) +
      (comparison.waitEventComparison?.removedEvents?.length ?? 0);

    // Load profile changes
    const loadProfileHighlights = comparison.loadProfileComparison?.highlights ?? null;
    const totalLoadProfileChanges = comparison.loadProfileComparison?.metrics?.length ?? 0;

    // Insights by severity
    const insightsBySeverity = {
      critical: comparison.severitySummary?.critical ?? 0,
      warning: comparison.severitySummary?.warning ?? 0,
      info: comparison.severitySummary?.info ?? 0,
    };

    // Calculate overall impact score
    const overallImpactScore =
      insightsBySeverity.critical * 30 +
      insightsBySeverity.warning * 10 +
      (sqlSummary?.regressionCount ?? 0) * 5;

    return {
      totalSqlChanges,
      totalWaitEventChanges,
      totalLoadProfileChanges,
      sqlSummary,
      waitEventsByClass,
      loadProfileHighlights,
      insightsBySeverity,
      overallImpactScore,
    };
  }, [comparison]);
}
