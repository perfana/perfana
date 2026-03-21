'use client';

/**
 * React Hooks for Custom Report Management
 *
 * This module provides hooks for fetching and managing custom performance reports
 * using TanStack React Query. It provides paginated access to reports for a test run
 * with filtering, status polling, and cache management.
 *
 * Features:
 * - Fetch reports list for a test run
 * - Get report summary for card view
 * - Report status filtering (pending, processing, html_complete, etc.)
 * - Pagination support (limit, offset)
 * - Automatic stale data handling (30s stale time)
 * - Auto-polling for in-progress reports
 * - Cache invalidation helpers
 * - Loading and error states
 * - Mutation hooks for report generation and actions
 *
 * @example
 * ```tsx
 * function ReportsList({ testRunId }: { testRunId: string }) {
 *   const {
 *     reports,
 *     total,
 *     loading,
 *     error,
 *     refetch,
 *   } = useReports(testRunId);
 *
 *   if (loading) return <Loading />;
 *   if (error) return <Error message={error} />;
 *
 *   return <ReportList reports={reports} total={total} />;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With filtering and pagination
 * const { reports, total } = useReports(testRunId, {
 *   status: 'html_complete',
 *   limit: 10,
 *   offset: 0,
 * });
 * ```
 *
 * @example
 * ```tsx
 * // Generate a report from template
 * const { generateFromTemplate, isGenerating } = useGenerateReport();
 *
 * const handleGenerate = async () => {
 *   await generateFromTemplate({
 *     test_run_id: testRunId,
 *     template_id: selectedTemplateId,
 *     name: 'Performance Report',
 *   });
 * };
 * ```
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listReports,
  getReportSummary,
  getReport,
  getReportHtml,
  generateReportFromTemplate,
  generateAdHocReport,
  deleteReport,
  retryReport,
  generatePdf,
  downloadPdf,
  updateShareSettings,
  enableSharing,
  disableSharing,
  getShareSettings,
  type ReportListItem,
  type ReportListResponse,
  type ReportSummary,
  type ReportDetail,
  type ReportStatus,
  type ListReportsOptions,
  type GenerateReportFromTemplateRequest,
  type GenerateAdHocReportRequest,
  type GenerateReportResponse,
  type GeneratePdfRequest,
  type GeneratePdfResponse,
  type UpdateShareSettingsRequest,
  type ShareSettingsResponse,
  isProcessingStatus,
} from '@/lib/api/reports';

/**
 * Query key factory for reports queries
 * Provides consistent query keys for cache management
 */
export const reportsQueryKeys = {
  /** Base key for all reports queries */
  all: ['reports'] as const,

  /** Key for reports list by test run */
  list: (testRunId: string) =>
    [...reportsQueryKeys.all, 'list', testRunId] as const,

  /** Key for reports list with filters */
  listFiltered: (testRunId: string, filters: ListReportsOptions) =>
    [...reportsQueryKeys.list(testRunId), filters] as const,

  /** Key for report summary by test run */
  summary: (testRunId: string) =>
    [...reportsQueryKeys.all, 'summary', testRunId] as const,

  /** Key for single report detail */
  detail: (reportId: string) =>
    [...reportsQueryKeys.all, 'detail', reportId] as const,

  /** Key for report HTML content */
  html: (reportId: string) =>
    [...reportsQueryKeys.all, 'html', reportId] as const,

  /** Key for share settings */
  share: (reportId: string) =>
    [...reportsQueryKeys.all, 'share', reportId] as const,
};

/**
 * Options for useReports hook
 */
export interface UseReportsOptions {
  /**
   * Filter by report status
   * @example 'html_complete' | 'pending' | 'processing' | 'failed'
   */
  status?: ReportStatus;

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
   * Sort field
   * @default 'created_at'
   */
  sortBy?: 'created_at' | 'name' | 'status' | 'completed_at';

  /**
   * Sort order
   * @default 'desc'
   */
  sortOrder?: 'asc' | 'desc';

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
   * Enable auto-polling for in-progress reports
   * @default true
   */
  enablePolling?: boolean;

  /**
   * Polling interval in milliseconds when reports are processing
   * @default 5000 (5 seconds)
   */
  pollingInterval?: number;
}

/**
 * Return value from useReports hook
 */
export interface UseReportsReturn {
  /** Reports list */
  reports: ReportListItem[];

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

  /** Invalidate all reports cache for this test run */
  invalidateCache: () => Promise<void>;

  /** Whether there are more pages to fetch */
  hasNextPage: boolean;

  /** Whether there are previous pages */
  hasPreviousPage: boolean;

  /** Check if any reports exist (regardless of filters) */
  hasReports: boolean;

  /** Whether any reports are currently processing */
  hasProcessingReports: boolean;
}

/**
 * Hook for fetching reports for a test run
 *
 * @param testRunId - The test run ID to fetch reports for
 * @param options - Optional configuration for the query
 * @returns Reports data, loading state, error, and refetch functions
 */
export function useReports(
  testRunId: string,
  options: UseReportsOptions = {}
): UseReportsReturn {
  const {
    status,
    limit = 20,
    offset = 0,
    sortBy = 'created_at',
    sortOrder = 'desc',
    enabled = true,
    staleTime = 30000,
    enablePolling = true,
    pollingInterval = 5000,
  } = options;

  const queryClient = useQueryClient();

  // Build filter options for the API call
  const filterOptions: ListReportsOptions = {
    ...(status && { status }),
    limit,
    offset,
    sortBy,
    sortOrder,
  };

  // Create the query
  const query = useQuery({
    queryKey: reportsQueryKeys.listFiltered(testRunId, filterOptions),
    queryFn: async (): Promise<ReportListResponse> => {
      const response = await listReports(testRunId, filterOptions);
      return response;
    },
    enabled: enabled && !!testRunId,
    staleTime,
    // Enable polling only when there are processing reports
    refetchInterval: (query) => {
      if (!enablePolling) return false;
      const data = query.state.data;
      if (!data) return false;
      const hasProcessing = data.items.some(r => isProcessingStatus(r.status));
      return hasProcessing ? pollingInterval : false;
    },
  });

  // Extract error message safely per CLAUDE.md pattern
  const errorMessage = query.error && typeof query.error === 'object' && 'message' in query.error
    ? (query.error as Error).message
    : query.error
      ? 'Failed to fetch reports'
      : null;

  /**
   * Refetch the current query
   */
  const refetch = async (): Promise<void> => {
    await query.refetch();
  };

  /**
   * Invalidate all reports cache for this test run
   * This will cause all queries for this test run to refetch
   */
  const invalidateCache = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: reportsQueryKeys.list(testRunId),
    });
    // Also invalidate summary
    await queryClient.invalidateQueries({
      queryKey: reportsQueryKeys.summary(testRunId),
    });
  };

  // Extract data with defaults
  const data = query.data;
  const reports = data?.items ?? [];
  const total = data?.total ?? 0;
  const currentOffset = data?.offset ?? offset;
  const currentLimit = data?.limit ?? limit;

  // Calculate flags
  const hasNextPage = currentOffset + currentLimit < total;
  const hasPreviousPage = currentOffset > 0;
  const hasReports = total > 0;
  const hasProcessingReports = reports.some(r => isProcessingStatus(r.status));

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
    hasProcessingReports,
  };
}

/**
 * Options for useReportSummary hook
 */
export interface UseReportSummaryOptions {
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
}

/**
 * Return value from useReportSummary hook
 */
export interface UseReportSummaryReturn {
  /** Report summary data */
  summary: ReportSummary | null;

  /** Whether the query is loading */
  loading: boolean;

  /** Whether the query is fetching */
  isFetching: boolean;

  /** Error message if query failed */
  error: string | null;

  /** Refetch the data */
  refetch: () => Promise<void>;

  /** Invalidate cache */
  invalidateCache: () => Promise<void>;
}

/**
 * Hook for fetching report summary for a test run (for card view)
 *
 * @param testRunId - The test run ID to fetch summary for
 * @param options - Optional configuration for the query
 * @returns Report summary data, loading state, error, and refetch functions
 */
export function useReportSummary(
  testRunId: string,
  options: UseReportSummaryOptions = {}
): UseReportSummaryReturn {
  const {
    enabled = true,
    staleTime = 30000,
  } = options;

  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: reportsQueryKeys.summary(testRunId),
    queryFn: async (): Promise<ReportSummary> => {
      const response = await getReportSummary(testRunId);
      return response;
    },
    enabled: enabled && !!testRunId,
    staleTime,
  });

  // Extract error message safely
  const errorMessage = query.error && typeof query.error === 'object' && 'message' in query.error
    ? (query.error as Error).message
    : query.error
      ? 'Failed to fetch report summary'
      : null;

  const refetch = async (): Promise<void> => {
    await query.refetch();
  };

  const invalidateCache = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: reportsQueryKeys.summary(testRunId),
    });
  };

  return {
    summary: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    error: errorMessage,
    refetch,
    invalidateCache,
  };
}

/**
 * Options for useReportDetail hook
 */
export interface UseReportDetailOptions {
  /**
   * Enable/disable the query
   * @default true (when reportId is provided)
   */
  enabled?: boolean;

  /**
   * Stale time in milliseconds
   * @default 30000 (30 seconds)
   */
  staleTime?: number;

  /**
   * Enable auto-polling for processing reports
   * @default true
   */
  enablePolling?: boolean;

  /**
   * Polling interval in milliseconds
   * @default 3000 (3 seconds)
   */
  pollingInterval?: number;
}

/**
 * Return value from useReportDetail hook
 */
export interface UseReportDetailReturn {
  /** Report detail data */
  report: ReportDetail | null;

  /** Whether the query is loading */
  loading: boolean;

  /** Whether the query is fetching */
  isFetching: boolean;

  /** Error message if query failed */
  error: string | null;

  /** Refetch the data */
  refetch: () => Promise<void>;

  /** Whether the report is processing */
  isProcessing: boolean;
}

/**
 * Hook for fetching a single report detail
 *
 * @param reportId - The report ID to fetch
 * @param options - Optional configuration for the query
 * @returns Report detail data, loading state, error, and refetch functions
 */
export function useReportDetail(
  reportId: string,
  options: UseReportDetailOptions = {}
): UseReportDetailReturn {
  const {
    enabled = true,
    staleTime = 30000,
    enablePolling = true,
    pollingInterval = 3000,
  } = options;

  const query = useQuery({
    queryKey: reportsQueryKeys.detail(reportId),
    queryFn: async (): Promise<ReportDetail> => {
      const response = await getReport(reportId);
      return response;
    },
    enabled: enabled && !!reportId,
    staleTime,
    refetchInterval: (query) => {
      if (!enablePolling) return false;
      const data = query.state.data;
      if (!data) return false;
      return isProcessingStatus(data.status) ? pollingInterval : false;
    },
  });

  // Extract error message safely
  const errorMessage = query.error && typeof query.error === 'object' && 'message' in query.error
    ? (query.error as Error).message
    : query.error
      ? 'Failed to fetch report'
      : null;

  const refetch = async (): Promise<void> => {
    await query.refetch();
  };

  const isProcessing = query.data ? isProcessingStatus(query.data.status) : false;

  return {
    report: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    error: errorMessage,
    refetch,
    isProcessing,
  };
}

/**
 * Options for useReportHtml hook
 */
export interface UseReportHtmlOptions {
  /**
   * Enable/disable the query
   * @default true (when reportId is provided)
   */
  enabled?: boolean;

  /**
   * Stale time in milliseconds
   * @default 60000 (1 minute) - HTML content is stable after generation
   */
  staleTime?: number;
}

/**
 * Return value from useReportHtml hook
 */
export interface UseReportHtmlReturn {
  /** HTML content */
  html: string | null;

  /** Whether the query is loading */
  loading: boolean;

  /** Error message if query failed */
  error: string | null;

  /** Refetch the data */
  refetch: () => Promise<void>;
}

/**
 * Hook for fetching report HTML content
 *
 * @param reportId - The report ID to fetch HTML for
 * @param options - Optional configuration for the query
 * @returns HTML content, loading state, error, and refetch functions
 */
export function useReportHtml(
  reportId: string,
  options: UseReportHtmlOptions = {}
): UseReportHtmlReturn {
  const {
    enabled = true,
    staleTime = 60000,
  } = options;

  const query = useQuery({
    queryKey: reportsQueryKeys.html(reportId),
    queryFn: async (): Promise<string> => {
      const response = await getReportHtml(reportId);
      return response;
    },
    enabled: enabled && !!reportId,
    staleTime,
  });

  // Extract error message safely
  const errorMessage = query.error && typeof query.error === 'object' && 'message' in query.error
    ? (query.error as Error).message
    : query.error
      ? 'Failed to fetch report HTML'
      : null;

  const refetch = async (): Promise<void> => {
    await query.refetch();
  };

  return {
    html: query.data ?? null,
    loading: query.isLoading,
    error: errorMessage,
    refetch,
  };
}

/**
 * Callback type for mutation success/error handling
 */
export type SnackbarCallback = (message: string, severity: 'success' | 'error' | 'warning' | 'info') => void;

/**
 * Options for useGenerateReport hook
 */
export interface UseGenerateReportOptions {
  /**
   * Test run ID for cache invalidation
   */
  testRunId?: string;

  /**
   * Callback for showing notifications
   */
  onNotify?: SnackbarCallback;
}

/**
 * Return value from useGenerateReport hook
 */
export interface UseGenerateReportReturn {
  /** Generate report from template */
  generateFromTemplate: (request: GenerateReportFromTemplateRequest) => Promise<GenerateReportResponse>;

  /** Generate ad-hoc report */
  generateAdHoc: (request: GenerateAdHocReportRequest) => Promise<GenerateReportResponse>;

  /** Whether a generation is in progress */
  isGenerating: boolean;

  /** Error from the last generation attempt */
  error: string | null;

  /** Reset error state */
  resetError: () => void;
}

/**
 * Hook for generating reports (template or ad-hoc)
 *
 * @param options - Optional configuration
 * @returns Mutation functions for generating reports
 */
export function useGenerateReport(
  options: UseGenerateReportOptions = {}
): UseGenerateReportReturn {
  const { testRunId, onNotify } = options;
  const queryClient = useQueryClient();

  // Template generation mutation
  const templateMutation = useMutation({
    mutationFn: generateReportFromTemplate,
    onSuccess: async (data) => {
      onNotify?.('Report generation started', 'success');
      if (testRunId) {
        await queryClient.invalidateQueries({
          queryKey: reportsQueryKeys.list(testRunId),
        });
        await queryClient.invalidateQueries({
          queryKey: reportsQueryKeys.summary(testRunId),
        });
      }
    },
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to generate report';
      onNotify?.(message, 'error');
    },
  });

  // Ad-hoc generation mutation
  const adHocMutation = useMutation({
    mutationFn: generateAdHocReport,
    onSuccess: async (data) => {
      onNotify?.('Ad-hoc report generation started', 'success');
      if (testRunId) {
        await queryClient.invalidateQueries({
          queryKey: reportsQueryKeys.list(testRunId),
        });
        await queryClient.invalidateQueries({
          queryKey: reportsQueryKeys.summary(testRunId),
        });
      }
    },
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to generate ad-hoc report';
      onNotify?.(message, 'error');
    },
  });

  // Combine error state
  const error = templateMutation.error || adHocMutation.error;
  const errorMessage = error && typeof error === 'object' && 'message' in error
    ? (error as Error).message
    : error
      ? 'Failed to generate report'
      : null;

  const resetError = () => {
    templateMutation.reset();
    adHocMutation.reset();
  };

  return {
    generateFromTemplate: templateMutation.mutateAsync,
    generateAdHoc: adHocMutation.mutateAsync,
    isGenerating: templateMutation.isPending || adHocMutation.isPending,
    error: errorMessage,
    resetError,
  };
}

/**
 * Options for useReportActions hook
 */
export interface UseReportActionsOptions {
  /**
   * Test run ID for cache invalidation
   */
  testRunId?: string;

  /**
   * Callback for showing notifications
   */
  onNotify?: SnackbarCallback;
}

/**
 * Return value from useReportActions hook
 */
export interface UseReportActionsReturn {
  /** Delete a report */
  deleteReport: (reportId: string) => Promise<void>;

  /** Retry failed report generation */
  retryReport: (reportId: string) => Promise<GenerateReportResponse>;

  /** Generate PDF from HTML report */
  generatePdf: (reportId: string, options?: GeneratePdfRequest) => Promise<GeneratePdfResponse>;

  /** Download PDF blob */
  downloadPdf: (reportId: string) => Promise<Blob>;

  /** Update share settings */
  updateShare: (reportId: string, settings: UpdateShareSettingsRequest) => Promise<ShareSettingsResponse>;

  /** Enable sharing */
  enableSharing: (reportId: string, expiresAt?: string) => Promise<ShareSettingsResponse>;

  /** Disable sharing */
  disableSharing: (reportId: string) => Promise<ShareSettingsResponse>;

  /** Whether any action is pending */
  isPending: boolean;

  /** Current action type being processed */
  pendingAction: 'delete' | 'retry' | 'pdf' | 'download' | 'share' | null;
}

/**
 * Hook for report actions (delete, retry, PDF, sharing)
 *
 * @param options - Optional configuration
 * @returns Action functions for managing reports
 */
export function useReportActions(
  options: UseReportActionsOptions = {}
): UseReportActionsReturn {
  const { testRunId, onNotify } = options;
  const queryClient = useQueryClient();

  // Helper to invalidate caches
  const invalidateCaches = async (reportId?: string) => {
    if (testRunId) {
      await queryClient.invalidateQueries({
        queryKey: reportsQueryKeys.list(testRunId),
      });
      await queryClient.invalidateQueries({
        queryKey: reportsQueryKeys.summary(testRunId),
      });
    }
    if (reportId) {
      await queryClient.invalidateQueries({
        queryKey: reportsQueryKeys.detail(reportId),
      });
    }
  };

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteReport,
    onSuccess: async () => {
      onNotify?.('Report deleted successfully', 'success');
      await invalidateCaches();
    },
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to delete report';
      onNotify?.(message, 'error');
    },
  });

  // Retry mutation
  const retryMutation = useMutation({
    mutationFn: retryReport,
    onSuccess: async (data) => {
      onNotify?.('Report generation retry started', 'success');
      await invalidateCaches(data.report_id);
    },
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to retry report generation';
      onNotify?.(message, 'error');
    },
  });

  // PDF generation mutation
  const pdfMutation = useMutation({
    mutationFn: ({ reportId, options }: { reportId: string; options?: GeneratePdfRequest }) =>
      generatePdf(reportId, options),
    onSuccess: async (data) => {
      onNotify?.('PDF generation started', 'success');
      await invalidateCaches(data.report_id);
    },
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to generate PDF';
      onNotify?.(message, 'error');
    },
  });

  // PDF download mutation
  const downloadMutation = useMutation({
    mutationFn: downloadPdf,
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to download PDF';
      onNotify?.(message, 'error');
    },
  });

  // Share settings mutation
  const shareMutation = useMutation({
    mutationFn: ({ reportId, settings }: { reportId: string; settings: UpdateShareSettingsRequest }) =>
      updateShareSettings(reportId, settings),
    onSuccess: async (data) => {
      const action = data.share_enabled ? 'enabled' : 'disabled';
      onNotify?.(`Sharing ${action} successfully`, 'success');
    },
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to update share settings';
      onNotify?.(message, 'error');
    },
  });

  // Determine pending action
  let pendingAction: 'delete' | 'retry' | 'pdf' | 'download' | 'share' | null = null;
  if (deleteMutation.isPending) pendingAction = 'delete';
  else if (retryMutation.isPending) pendingAction = 'retry';
  else if (pdfMutation.isPending) pendingAction = 'pdf';
  else if (downloadMutation.isPending) pendingAction = 'download';
  else if (shareMutation.isPending) pendingAction = 'share';

  return {
    deleteReport: async (reportId: string) => {
      await deleteMutation.mutateAsync(reportId);
    },
    retryReport: retryMutation.mutateAsync,
    generatePdf: async (reportId: string, pdfOptions?: GeneratePdfRequest) => {
      return pdfMutation.mutateAsync({ reportId, options: pdfOptions });
    },
    downloadPdf: downloadMutation.mutateAsync,
    updateShare: async (reportId: string, settings: UpdateShareSettingsRequest) => {
      return shareMutation.mutateAsync({ reportId, settings });
    },
    enableSharing: async (reportId: string, expiresAt?: string) => {
      return shareMutation.mutateAsync({
        reportId,
        settings: { share_enabled: true, expires_at: expiresAt },
      });
    },
    disableSharing: async (reportId: string) => {
      return shareMutation.mutateAsync({
        reportId,
        settings: { share_enabled: false },
      });
    },
    isPending: pendingAction !== null,
    pendingAction,
  };
}

/**
 * Hook for invalidating reports cache
 * Useful when you need to invalidate cache from a different component
 *
 * @returns Function to invalidate reports cache
 */
export function useInvalidateReports() {
  const queryClient = useQueryClient();

  /**
   * Invalidate reports cache for a specific test run
   * @param testRunId - The test run ID to invalidate cache for
   */
  const invalidate = async (testRunId: string): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: reportsQueryKeys.list(testRunId),
    });
    await queryClient.invalidateQueries({
      queryKey: reportsQueryKeys.summary(testRunId),
    });
  };

  /**
   * Invalidate a specific report's cache
   * @param reportId - The report ID to invalidate
   */
  const invalidateReport = async (reportId: string): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: reportsQueryKeys.detail(reportId),
    });
    await queryClient.invalidateQueries({
      queryKey: reportsQueryKeys.html(reportId),
    });
  };

  /**
   * Invalidate all reports cache
   */
  const invalidateAll = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: reportsQueryKeys.all,
    });
  };

  return {
    invalidate,
    invalidateReport,
    invalidateAll,
  };
}
