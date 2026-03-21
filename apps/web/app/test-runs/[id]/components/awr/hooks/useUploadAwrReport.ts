'use client';

/**
 * React Hook for uploading AWR (Automatic Workload Repository) Reports
 *
 * This hook provides mutation functionality for uploading AWR report files
 * using TanStack React Query. It supports both file upload and URL-based upload
 * with MUI Snackbar callback pattern for notifications.
 *
 * Features:
 * - File upload via drag & drop or file selection
 * - URL-based upload for remote AWR reports
 * - Automatic cache invalidation on success
 * - MUI Snackbar callback pattern for notifications
 * - Progress tracking for uploads
 * - Error handling with meaningful messages
 *
 * @example
 * ```tsx
 * function AwrUploadZone({ testRunId }: { testRunId: string }) {
 *   const {
 *     uploadFile,
 *     isUploading,
 *     uploadError,
 *     reset,
 *   } = useUploadAwrReport(testRunId, {
 *     onSnackbar: (message, severity) => showSnackbar(message, severity),
 *   });
 *
 *   const handleDrop = (file: File) => {
 *     uploadFile(file);
 *   };
 *
 *   return (
 *     <DropZone onDrop={handleDrop} disabled={isUploading} />
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With URL upload support
 * function AwrUrlUpload({ testRunId }: { testRunId: string }) {
 *   const { uploadByUrl, isUploadingByUrl } = useUploadAwrReport(testRunId, {
 *     onSuccess: (response) => console.log('Uploaded:', response.id),
 *     onSnackbar: (message, severity) => showSnackbar(message, severity),
 *   });
 *
 *   return (
 *     <TextField
 *       label="AWR Report URL"
 *       onBlur={(e) => uploadByUrl(e.target.value)}
 *       disabled={isUploadingByUrl}
 *     />
 *   );
 * }
 * ```
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  uploadAwrReport,
  uploadAwrReportByUrl,
  UploadAwrReportResponse,
} from '@/lib/api/awr-reports';
import { awrReportsQueryKeys } from './useAwrReports';

/**
 * Snackbar severity levels for MUI integration
 */
export type SnackbarSeverity = 'success' | 'error' | 'info' | 'warning';

/**
 * Options for useUploadAwrReport hook
 */
export interface UseUploadAwrReportOptions {
  /**
   * Callback when upload succeeds
   */
  onSuccess?: (response: UploadAwrReportResponse) => void;

  /**
   * Callback when upload fails
   */
  onError?: (error: Error) => void;

  /**
   * Snackbar notification callback (MUI Snackbar pattern)
   * @param message - The message to display
   * @param severity - The severity level for styling
   */
  onSnackbar?: (message: string, severity?: SnackbarSeverity) => void;

  /**
   * Callback when upload starts
   */
  onUploadStart?: (file: File | string) => void;

  /**
   * Custom success message (default: 'AWR report uploaded successfully')
   */
  successMessage?: string;

  /**
   * Custom error message prefix (default: 'Upload failed')
   */
  errorMessagePrefix?: string;

  /**
   * Whether to automatically invalidate cache on success
   * @default true
   */
  invalidateOnSuccess?: boolean;
}

/**
 * Return value from useUploadAwrReport hook
 */
export interface UseUploadAwrReportReturn {
  /** Upload a file directly */
  uploadFile: (file: File) => void;

  /** Upload from a URL */
  uploadByUrl: (url: string) => void;

  /** Whether file upload is in progress */
  isUploading: boolean;

  /** Whether URL upload is in progress */
  isUploadingByUrl: boolean;

  /** Whether any upload is in progress */
  isAnyUploading: boolean;

  /** Error from file upload (if any) */
  uploadError: Error | null;

  /** Error from URL upload (if any) */
  uploadByUrlError: Error | null;

  /** Last successful upload response */
  lastUploadResponse: UploadAwrReportResponse | null;

  /** Reset the mutation state */
  reset: () => void;

  /** Reset the URL mutation state */
  resetUrlMutation: () => void;

  /** Reset all mutation states */
  resetAll: () => void;

  /** Invalidate AWR reports cache for this test run */
  invalidateCache: () => Promise<void>;
}

/**
 * Accepted file types for AWR report uploads
 */
export const ACCEPTED_AWR_FILE_TYPES = [
  '.html',
  '.htm',
  'text/html',
  'application/xhtml+xml',
] as const;

/**
 * Maximum file size for AWR reports (50MB)
 */
export const MAX_AWR_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Validate file before upload
 */
export function validateAwrFile(file: File): { valid: boolean; error?: string } {
  // Check file size
  if (file.size > MAX_AWR_FILE_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size is ${MAX_AWR_FILE_SIZE / 1024 / 1024}MB`,
    };
  }

  // Check file type
  const fileExtension = `.${file.name.split('.').pop()?.toLowerCase()}`;
  const isValidType = ACCEPTED_AWR_FILE_TYPES.some(
    (type) => type === fileExtension || type === file.type
  );

  if (!isValidType) {
    return {
      valid: false,
      error: 'Invalid file type. Please upload an HTML AWR report.',
    };
  }

  return { valid: true };
}

/**
 * Validate URL before upload
 */
export function validateAwrUrl(url: string): { valid: boolean; error?: string } {
  if (!url || url.trim().length === 0) {
    return { valid: false, error: 'URL is required' };
  }

  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { valid: false, error: 'URL must use HTTP or HTTPS protocol' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Hook for uploading AWR reports
 *
 * @param testRunId - The test run ID to upload reports to
 * @param options - Optional configuration for the upload
 * @returns Upload functions, loading states, and error handling
 */
export function useUploadAwrReport(
  testRunId: string,
  options: UseUploadAwrReportOptions = {}
): UseUploadAwrReportReturn {
  const {
    onSuccess,
    onError,
    onSnackbar,
    onUploadStart,
    successMessage = 'AWR report uploaded successfully',
    errorMessagePrefix = 'Upload failed',
    invalidateOnSuccess = true,
  } = options;

  const queryClient = useQueryClient();

  /**
   * Invalidate AWR reports cache for this test run
   */
  const invalidateCache = useCallback(async (): Promise<void> => {
    // React Query v5 syntax - must use object with queryKey
    await queryClient.invalidateQueries({
      queryKey: awrReportsQueryKeys.list(testRunId),
    });
  }, [queryClient, testRunId]);

  /**
   * File upload mutation
   */
  const fileUploadMutation = useMutation({
    mutationFn: async (file: File): Promise<UploadAwrReportResponse> => {
      // Validate file before upload
      const validation = validateAwrFile(file);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      return await uploadAwrReport(testRunId, file);
    },
    onMutate: (file) => {
      onUploadStart?.(file);
    },
    onSuccess: (data) => {
      // Invalidate cache to refresh the reports list
      if (invalidateOnSuccess) {
        queryClient.invalidateQueries({
          queryKey: awrReportsQueryKeys.list(testRunId),
        });
      }

      // Show success notification
      onSnackbar?.(successMessage, 'success');

      // Call success callback
      onSuccess?.(data);
    },
    onError: (error: Error) => {
      // Extract error message safely per CLAUDE.md pattern
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'An unexpected error occurred';

      // Show error notification
      onSnackbar?.(`${errorMessagePrefix}: ${errorMessage}`, 'error');

      // Call error callback
      onError?.(error);
    },
  });

  /**
   * URL upload mutation
   */
  const urlUploadMutation = useMutation({
    mutationFn: async (url: string): Promise<UploadAwrReportResponse> => {
      // Validate URL before upload
      const validation = validateAwrUrl(url);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      return await uploadAwrReportByUrl(testRunId, url);
    },
    onMutate: (url) => {
      onUploadStart?.(url);
    },
    onSuccess: (data) => {
      // Invalidate cache to refresh the reports list
      if (invalidateOnSuccess) {
        queryClient.invalidateQueries({
          queryKey: awrReportsQueryKeys.list(testRunId),
        });
      }

      // Show success notification
      onSnackbar?.(successMessage, 'success');

      // Call success callback
      onSuccess?.(data);
    },
    onError: (error: Error) => {
      // Extract error message safely per CLAUDE.md pattern
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'An unexpected error occurred';

      // Show error notification
      onSnackbar?.(`${errorMessagePrefix}: ${errorMessage}`, 'error');

      // Call error callback
      onError?.(error);
    },
  });

  /**
   * Upload a file
   */
  const uploadFile = useCallback(
    (file: File): void => {
      fileUploadMutation.mutate(file);
    },
    [fileUploadMutation]
  );

  /**
   * Upload from URL
   */
  const uploadByUrl = useCallback(
    (url: string): void => {
      urlUploadMutation.mutate(url);
    },
    [urlUploadMutation]
  );

  /**
   * Reset file upload mutation state
   */
  const reset = useCallback((): void => {
    fileUploadMutation.reset();
  }, [fileUploadMutation]);

  /**
   * Reset URL upload mutation state
   */
  const resetUrlMutation = useCallback((): void => {
    urlUploadMutation.reset();
  }, [urlUploadMutation]);

  /**
   * Reset all mutation states
   */
  const resetAll = useCallback((): void => {
    fileUploadMutation.reset();
    urlUploadMutation.reset();
  }, [fileUploadMutation, urlUploadMutation]);

  return {
    uploadFile,
    uploadByUrl,
    isUploading: fileUploadMutation.isPending,
    isUploadingByUrl: urlUploadMutation.isPending,
    isAnyUploading: fileUploadMutation.isPending || urlUploadMutation.isPending,
    uploadError: fileUploadMutation.error,
    uploadByUrlError: urlUploadMutation.error,
    lastUploadResponse: fileUploadMutation.data ?? urlUploadMutation.data ?? null,
    reset,
    resetUrlMutation,
    resetAll,
    invalidateCache,
  };
}

/**
 * Hook for invalidating AWR upload cache
 * Useful when you need to invalidate cache from a different component
 *
 * @returns Function to invalidate AWR reports cache
 */
export function useInvalidateAwrUpload() {
  const queryClient = useQueryClient();

  /**
   * Invalidate AWR reports cache for a specific test run
   * @param testRunId - The test run ID to invalidate cache for
   */
  const invalidate = useCallback(
    async (testRunId: string): Promise<void> => {
      await queryClient.invalidateQueries({
        queryKey: awrReportsQueryKeys.list(testRunId),
      });
    },
    [queryClient]
  );

  /**
   * Invalidate all AWR reports cache
   */
  const invalidateAll = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: awrReportsQueryKeys.all,
    });
  }, [queryClient]);

  return {
    invalidate,
    invalidateAll,
  };
}
