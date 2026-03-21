'use client';

/**
 * React Hook for fetching AWR Analysis Results
 *
 * This hook manages AWR analysis data fetching using TanStack React Query.
 * It provides access to analysis results including insights, severity summaries,
 * and supports re-analysis functionality.
 *
 * Features:
 * - Fetch analysis results for an AWR report
 * - Automatic analysis trigger if not yet analyzed
 * - Re-analysis support with mutation
 * - Cache invalidation helpers
 * - Loading and error states
 * - Insights filtering by severity and category
 *
 * @example
 * ```tsx
 * function AwrInsightsPanel({ reportId }: { reportId: string }) {
 *   const {
 *     analysis,
 *     insights,
 *     severitySummary,
 *     loading,
 *     error,
 *     refetch,
 *   } = useAwrAnalysis(reportId);
 *
 *   if (loading) return <Loading />;
 *   if (error) return <Error message={error} />;
 *
 *   return <InsightsList insights={insights} summary={severitySummary} />;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With re-analysis support
 * function AwrAnalysisCard({ reportId }: { reportId: string }) {
 *   const { analysis, reanalyze, isReanalyzing } = useAwrAnalysis(reportId);
 *
 *   return (
 *     <div>
 *       <AnalysisDisplay analysis={analysis} />
 *       <Button onClick={reanalyze} disabled={isReanalyzing}>
 *         {isReanalyzing ? 'Re-analyzing...' : 'Re-analyze'}
 *       </Button>
 *     </div>
 *   );
 * }
 * ```
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import {
  getAwrAnalysis,
  reanalyzeAwrReport,
  AwrAnalysis,
  AwrInsight,
  SeveritySummary,
  InsightSeverity,
  InsightCategory,
} from '@/lib/api/awr-reports';
import { awrReportsQueryKeys } from './useAwrReports';

/**
 * Query key factory for AWR analysis queries
 * Provides consistent query keys for cache management
 */
export const awrAnalysisQueryKeys = {
  /** Base key for all AWR analysis queries */
  all: ['awr-analysis'] as const,

  /** Key for a specific report's analysis */
  byReport: (reportId: string) =>
    [...awrAnalysisQueryKeys.all, 'report', reportId] as const,
};

/**
 * Options for useAwrAnalysis hook
 */
export interface UseAwrAnalysisOptions {
  /**
   * Enable/disable the query
   * @default true (when reportId is provided)
   */
  enabled?: boolean;

  /**
   * Stale time in milliseconds
   * @default 60000 (1 minute - analysis doesn't change unless re-triggered)
   */
  staleTime?: number;

  /**
   * Refetch interval in milliseconds (0 to disable)
   * @default 0 (disabled)
   */
  refetchInterval?: number;

  /**
   * Callback when re-analysis succeeds
   */
  onReanalyzeSuccess?: (analysis: AwrAnalysis) => void;

  /**
   * Callback when re-analysis fails
   */
  onReanalyzeError?: (error: Error) => void;

  /**
   * Snackbar notification callback (MUI Snackbar pattern)
   */
  onSnackbar?: (message: string, severity?: 'success' | 'error' | 'info') => void;
}

/**
 * Filter options for insights
 */
export interface InsightFilters {
  /** Filter by severity levels */
  severities?: InsightSeverity[];

  /** Filter by categories */
  categories?: InsightCategory[];

  /** Filter by SQL ID (for SQL-related insights) */
  sqlId?: string;

  /** Only show comparison-related insights */
  comparisonOnly?: boolean;

  /** Minimum impact score (0-100) */
  minImpactScore?: number;
}

/**
 * Return value from useAwrAnalysis hook
 */
export interface UseAwrAnalysisReturn {
  /** Full analysis data */
  analysis: AwrAnalysis | null;

  /** All insights from the analysis */
  insights: AwrInsight[];

  /** Severity summary (critical, warning, info counts) */
  severitySummary: SeveritySummary | null;

  /** Analysis ID */
  analysisId: string | null;

  /** Analysis timestamp */
  analyzedAt: string | null;

  /** Whether the query is loading */
  loading: boolean;

  /** Whether the query is fetching (including background refetch) */
  isFetching: boolean;

  /** Error message if query failed */
  error: string | null;

  /** Refetch the analysis data */
  refetch: () => Promise<void>;

  /** Invalidate analysis cache for this report */
  invalidateCache: () => Promise<void>;

  /** Trigger re-analysis of the report */
  reanalyze: () => void;

  /** Whether re-analysis is in progress */
  isReanalyzing: boolean;

  /** Critical insights count */
  criticalCount: number;

  /** Warning insights count */
  warningCount: number;

  /** Info insights count */
  infoCount: number;

  /** Total insights count */
  totalInsights: number;

  /** Filter insights by criteria */
  filterInsights: (filters: InsightFilters) => AwrInsight[];

  /** Get insights by severity */
  getInsightsBySeverity: (severity: InsightSeverity) => AwrInsight[];

  /** Get insights by category */
  getInsightsByCategory: (category: InsightCategory) => AwrInsight[];

  /** Check if there are any critical issues */
  hasCriticalIssues: boolean;

  /** Check if analysis exists */
  hasAnalysis: boolean;
}

/**
 * Hook for fetching AWR analysis results for a report
 *
 * @param reportId - The AWR report ID to fetch analysis for
 * @param options - Optional configuration for the query
 * @returns Analysis data, loading state, error, and utility functions
 */
export function useAwrAnalysis(
  reportId: string,
  options: UseAwrAnalysisOptions = {}
): UseAwrAnalysisReturn {
  const {
    enabled = true,
    staleTime = 60000, // 1 minute - analysis doesn't change unless re-triggered
    refetchInterval = 0,
    onReanalyzeSuccess,
    onReanalyzeError,
    onSnackbar,
  } = options;

  const queryClient = useQueryClient();

  // Create the analysis query
  const query = useQuery({
    queryKey: awrAnalysisQueryKeys.byReport(reportId),
    queryFn: async (): Promise<AwrAnalysis> => {
      const analysis = await getAwrAnalysis(reportId);
      return analysis;
    },
    enabled: enabled && !!reportId,
    staleTime,
    refetchInterval: refetchInterval > 0 ? refetchInterval : undefined,
  });

  // Create the re-analysis mutation
  const reanalyzeMutation = useMutation({
    mutationFn: async (): Promise<AwrAnalysis> => {
      return await reanalyzeAwrReport(reportId);
    },
    onSuccess: (data) => {
      // Update the query cache with new analysis
      queryClient.setQueryData(awrAnalysisQueryKeys.byReport(reportId), data);

      // Also invalidate AWR reports list to update severity badges
      queryClient.invalidateQueries({
        queryKey: awrReportsQueryKeys.all,
      });

      onSnackbar?.('Analysis completed successfully', 'success');
      onReanalyzeSuccess?.(data);
    },
    onError: (error: Error) => {
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Re-analysis failed';
      onSnackbar?.(`Re-analysis failed: ${errorMessage}`, 'error');
      onReanalyzeError?.(error);
    },
  });

  // Extract error message safely per CLAUDE.md pattern
  const errorMessage = query.error && typeof query.error === 'object' && 'message' in query.error
    ? (query.error as Error).message
    : query.error
      ? 'Failed to fetch AWR analysis'
      : null;

  // Extract data with defaults
  const analysis = query.data ?? null;
  const insights = analysis?.insights ?? [];
  const severitySummary = analysis?.severitySummary ?? null;

  // Calculate severity counts
  const criticalCount = severitySummary?.critical ?? 0;
  const warningCount = severitySummary?.warning ?? 0;
  const infoCount = severitySummary?.info ?? 0;
  const totalInsights = severitySummary?.total ?? insights.length;

  /**
   * Refetch the analysis data
   */
  const refetch = useCallback(async (): Promise<void> => {
    await query.refetch();
  }, [query]);

  /**
   * Invalidate analysis cache for this report
   */
  const invalidateCache = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: awrAnalysisQueryKeys.byReport(reportId),
    });
  }, [queryClient, reportId]);

  /**
   * Trigger re-analysis
   */
  const reanalyze = useCallback((): void => {
    reanalyzeMutation.mutate();
  }, [reanalyzeMutation]);

  /**
   * Filter insights by criteria
   */
  const filterInsights = useCallback((filters: InsightFilters): AwrInsight[] => {
    return insights.filter((insight) => {
      // Filter by severity
      if (filters.severities && filters.severities.length > 0) {
        if (!filters.severities.includes(insight.severity)) {
          return false;
        }
      }

      // Filter by category
      if (filters.categories && filters.categories.length > 0) {
        if (!filters.categories.includes(insight.category)) {
          return false;
        }
      }

      // Filter by SQL ID
      if (filters.sqlId && insight.sqlId !== filters.sqlId) {
        return false;
      }

      // Filter comparison-only insights
      if (filters.comparisonOnly && !insight.isComparison) {
        return false;
      }

      // Filter by minimum impact score
      if (filters.minImpactScore !== undefined) {
        const score = insight.impactScore ?? 0;
        if (score < filters.minImpactScore) {
          return false;
        }
      }

      return true;
    });
  }, [insights]);

  /**
   * Get insights by severity level
   */
  const getInsightsBySeverity = useCallback(
    (severity: InsightSeverity): AwrInsight[] => {
      return insights.filter((insight) => insight.severity === severity);
    },
    [insights]
  );

  /**
   * Get insights by category
   */
  const getInsightsByCategory = useCallback(
    (category: InsightCategory): AwrInsight[] => {
      return insights.filter((insight) => insight.category === category);
    },
    [insights]
  );

  // Memoized computed values
  const hasCriticalIssues = useMemo(() => criticalCount > 0, [criticalCount]);
  const hasAnalysis = useMemo(() => analysis !== null, [analysis]);

  return {
    analysis,
    insights,
    severitySummary,
    analysisId: analysis?.id ?? null,
    analyzedAt: analysis?.analyzedAt ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    error: errorMessage,
    refetch,
    invalidateCache,
    reanalyze,
    isReanalyzing: reanalyzeMutation.isPending,
    criticalCount,
    warningCount,
    infoCount,
    totalInsights,
    filterInsights,
    getInsightsBySeverity,
    getInsightsByCategory,
    hasCriticalIssues,
    hasAnalysis,
  };
}

/**
 * Hook for invalidating AWR analysis cache
 * Useful when you need to invalidate cache from a different component
 *
 * @returns Functions to invalidate AWR analysis cache
 */
export function useInvalidateAwrAnalysis() {
  const queryClient = useQueryClient();

  /**
   * Invalidate analysis cache for a specific report
   * @param reportId - The report ID to invalidate cache for
   */
  const invalidate = useCallback(
    async (reportId: string): Promise<void> => {
      await queryClient.invalidateQueries({
        queryKey: awrAnalysisQueryKeys.byReport(reportId),
      });
    },
    [queryClient]
  );

  /**
   * Invalidate all AWR analysis cache
   */
  const invalidateAll = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: awrAnalysisQueryKeys.all,
    });
  }, [queryClient]);

  return {
    invalidate,
    invalidateAll,
  };
}

/**
 * Hook for insights summary calculations
 * Provides aggregated statistics from analysis insights
 *
 * @param insights - Array of insights to analyze
 * @returns Aggregated insight statistics
 */
export function useInsightsSummary(insights: AwrInsight[]) {
  return useMemo(() => {
    const bySeverity: Record<InsightSeverity, number> = {
      critical: 0,
      warning: 0,
      info: 0,
    };

    const byCategory: Partial<Record<InsightCategory, number>> = {};
    const sqlRelated: AwrInsight[] = [];
    const waitEventRelated: AwrInsight[] = [];
    let totalImpactScore = 0;

    for (const insight of insights) {
      // Count by severity
      bySeverity[insight.severity]++;

      // Count by category
      byCategory[insight.category] = (byCategory[insight.category] ?? 0) + 1;

      // Collect SQL-related insights
      if (insight.sqlId) {
        sqlRelated.push(insight);
      }

      // Collect wait event-related insights
      if (insight.waitEvent || insight.waitClass) {
        waitEventRelated.push(insight);
      }

      // Sum impact scores
      totalImpactScore += insight.impactScore ?? 0;
    }

    const avgImpactScore = insights.length > 0
      ? totalImpactScore / insights.length
      : 0;

    // Find top categories
    const topCategories = Object.entries(byCategory)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([category, count]) => ({ category: category as InsightCategory, count }));

    return {
      bySeverity,
      byCategory,
      sqlRelated,
      waitEventRelated,
      totalImpactScore,
      avgImpactScore,
      topCategories,
      totalCount: insights.length,
      criticalCount: bySeverity.critical,
      warningCount: bySeverity.warning,
      infoCount: bySeverity.info,
      hasCritical: bySeverity.critical > 0,
      hasWarning: bySeverity.warning > 0,
    };
  }, [insights]);
}
