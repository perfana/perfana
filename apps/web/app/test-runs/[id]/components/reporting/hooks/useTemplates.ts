'use client';

/**
 * React Hooks for Report Template Management
 *
 * This module provides hooks for fetching and managing report templates
 * using TanStack React Query. It provides access to templates scoped by
 * system, test environment, and workload with full CRUD operations.
 *
 * Features:
 * - Fetch templates list with filtering by scope
 * - Get template summaries for dropdowns
 * - Get single template details
 * - Create, update, delete templates
 * - Duplicate templates
 * - Set default template
 * - Section management (add, remove, reorder)
 * - Automatic cache invalidation
 * - Loading and error states
 *
 * @example
 * ```tsx
 * function TemplateSelector({ systemId, testEnv, workload }: Props) {
 *   const {
 *     templates,
 *     loading,
 *     error,
 *   } = useTemplates({
 *     system_id: systemId,
 *     test_environment: testEnv,
 *     workload: workload,
 *   });
 *
 *   if (loading) return <Loading />;
 *   if (error) return <Error message={error} />;
 *
 *   return <TemplateList templates={templates} />;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Get summaries for dropdown
 * const { summaries, loading } = useTemplateSummaries(systemId, testEnv, workload);
 *
 * return (
 *   <Select>
 *     {summaries.map(t => (
 *       <MenuItem key={t.id} value={t.id}>
 *         {t.name} {t.is_default && '(Default)'}
 *       </MenuItem>
 *     ))}
 *   </Select>
 * );
 * ```
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listTemplates,
  getTemplateSummaries,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  setDefaultTemplate,
  addTemplateSection,
  removeTemplateSection,
  reorderTemplateSections,
  type TemplateListItem,
  type TemplateListResponse,
  type TemplateSummary,
  type TemplateDetail,
  type ListTemplatesOptions,
  type CreateTemplateRequest,
  type UpdateTemplateRequest,
  type DuplicateTemplateRequest,
  type ReportSectionConfig,
} from '@/lib/api/reports';

/**
 * Query key factory for templates queries
 * Provides consistent query keys for cache management
 */
export const templatesQueryKeys = {
  /** Base key for all templates queries */
  all: ['report-templates'] as const,

  /** Key for templates list */
  list: () => [...templatesQueryKeys.all, 'list'] as const,

  /** Key for templates list with filters */
  listFiltered: (filters: ListTemplatesOptions) =>
    [...templatesQueryKeys.list(), filters] as const,

  /** Key for templates by scope */
  byScope: (systemId: string, testEnvironment: string, workload: string) =>
    [...templatesQueryKeys.all, 'scope', systemId, testEnvironment, workload] as const,

  /** Key for template summaries */
  summaries: (systemId: string, testEnvironment: string, workload: string) =>
    [...templatesQueryKeys.all, 'summaries', systemId, testEnvironment, workload] as const,

  /** Key for single template detail */
  detail: (templateId: string) =>
    [...templatesQueryKeys.all, 'detail', templateId] as const,
};

/**
 * Options for useTemplates hook
 */
export interface UseTemplatesOptions extends ListTemplatesOptions {
  /**
   * Enable/disable the query
   * @default true
   */
  enabled?: boolean;

  /**
   * Stale time in milliseconds
   * @default 60000 (1 minute) - templates don't change often
   */
  staleTime?: number;
}

/**
 * Return value from useTemplates hook
 */
export interface UseTemplatesReturn {
  /** Templates list */
  templates: TemplateListItem[];

  /** Total count of templates (for pagination) */
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

  /** Invalidate all templates cache */
  invalidateCache: () => Promise<void>;

  /** Whether there are more pages to fetch */
  hasNextPage: boolean;

  /** Whether there are previous pages */
  hasPreviousPage: boolean;

  /** Check if any templates exist */
  hasTemplates: boolean;

  /** Default template (if any) */
  defaultTemplate: TemplateListItem | undefined;
}

/**
 * Hook for fetching templates with optional filtering
 *
 * @param options - Optional configuration for the query
 * @returns Templates data, loading state, error, and refetch functions
 */
export function useTemplates(
  options: UseTemplatesOptions = {}
): UseTemplatesReturn {
  const {
    system_id,
    test_environment,
    workload,
    default_only,
    search,
    limit = 50,
    offset = 0,
    sortBy = 'created_at',
    sortOrder = 'desc',
    enabled = true,
    staleTime = 60000,
  } = options;

  const queryClient = useQueryClient();

  // Build filter options for the API call
  const filterOptions: ListTemplatesOptions = {
    ...(system_id && { system_id }),
    ...(test_environment && { test_environment }),
    ...(workload && { workload }),
    ...(default_only !== undefined && { default_only }),
    ...(search && { search }),
    limit,
    offset,
    sortBy,
    sortOrder,
  };

  // Create the query
  const query = useQuery({
    queryKey: templatesQueryKeys.listFiltered(filterOptions),
    queryFn: async (): Promise<TemplateListResponse> => {
      const response = await listTemplates(filterOptions);
      return response;
    },
    enabled,
    staleTime,
  });

  // Extract error message safely per CLAUDE.md pattern
  const errorMessage = query.error && typeof query.error === 'object' && 'message' in query.error
    ? (query.error as Error).message
    : query.error
      ? 'Failed to fetch templates'
      : null;

  /**
   * Refetch the current query
   */
  const refetch = async (): Promise<void> => {
    await query.refetch();
  };

  /**
   * Invalidate all templates cache
   */
  const invalidateCache = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: templatesQueryKeys.all,
    });
  };

  // Extract data with defaults
  const data = query.data;
  const templates = data?.items ?? [];
  const total = data?.total ?? 0;
  const currentOffset = data?.offset ?? offset;
  const currentLimit = data?.limit ?? limit;

  // Calculate flags
  const hasNextPage = currentOffset + currentLimit < total;
  const hasPreviousPage = currentOffset > 0;
  const hasTemplates = total > 0;
  const defaultTemplate = templates.find(t => t.is_default);

  return {
    templates,
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
    hasTemplates,
    defaultTemplate,
  };
}

/**
 * Options for useTemplateSummaries hook
 */
export interface UseTemplateSummariesOptions {
  /**
   * Enable/disable the query
   * @default true (when all scope params are provided)
   */
  enabled?: boolean;

  /**
   * Stale time in milliseconds
   * @default 60000 (1 minute)
   */
  staleTime?: number;
}

/**
 * Return value from useTemplateSummaries hook
 */
export interface UseTemplateSummariesReturn {
  /** Template summaries */
  summaries: TemplateSummary[];

  /** Whether the query is loading */
  loading: boolean;

  /** Whether the query is fetching */
  isFetching: boolean;

  /** Error message if query failed */
  error: string | null;

  /** Refetch the data */
  refetch: () => Promise<void>;

  /** Default template (if any) */
  defaultTemplate: TemplateSummary | undefined;

  /** Whether any templates exist */
  hasTemplates: boolean;
}

/**
 * Hook for fetching template summaries for dropdown/selection
 *
 * @param systemId - System under test ID
 * @param testEnvironment - Test environment
 * @param workload - Workload
 * @param options - Optional configuration for the query
 * @returns Template summaries, loading state, error, and refetch functions
 */
export function useTemplateSummaries(
  systemId: string,
  testEnvironment: string,
  workload: string,
  options: UseTemplateSummariesOptions = {}
): UseTemplateSummariesReturn {
  const {
    enabled = true,
    staleTime = 60000,
  } = options;

  const query = useQuery({
    queryKey: templatesQueryKeys.summaries(systemId, testEnvironment, workload),
    queryFn: async (): Promise<TemplateSummary[]> => {
      const response = await getTemplateSummaries(systemId, testEnvironment, workload);
      return response;
    },
    enabled: enabled && !!systemId && !!testEnvironment && !!workload,
    staleTime,
  });

  // Extract error message safely
  const errorMessage = query.error && typeof query.error === 'object' && 'message' in query.error
    ? (query.error as Error).message
    : query.error
      ? 'Failed to fetch template summaries'
      : null;

  const refetch = async (): Promise<void> => {
    await query.refetch();
  };

  const summaries = query.data ?? [];
  const defaultTemplate = summaries.find(t => t.is_default);

  return {
    summaries,
    loading: query.isLoading,
    isFetching: query.isFetching,
    error: errorMessage,
    refetch,
    defaultTemplate,
    hasTemplates: summaries.length > 0,
  };
}

/**
 * Options for useTemplateDetail hook
 */
export interface UseTemplateDetailOptions {
  /**
   * Enable/disable the query
   * @default true (when templateId is provided)
   */
  enabled?: boolean;

  /**
   * Stale time in milliseconds
   * @default 60000 (1 minute)
   */
  staleTime?: number;
}

/**
 * Return value from useTemplateDetail hook
 */
export interface UseTemplateDetailReturn {
  /** Template detail data */
  template: TemplateDetail | null;

  /** Whether the query is loading */
  loading: boolean;

  /** Whether the query is fetching */
  isFetching: boolean;

  /** Error message if query failed */
  error: string | null;

  /** Refetch the data */
  refetch: () => Promise<void>;
}

/**
 * Hook for fetching a single template detail
 *
 * @param templateId - The template ID to fetch
 * @param options - Optional configuration for the query
 * @returns Template detail data, loading state, error, and refetch functions
 */
export function useTemplateDetail(
  templateId: string,
  options: UseTemplateDetailOptions = {}
): UseTemplateDetailReturn {
  const {
    enabled = true,
    staleTime = 60000,
  } = options;

  const query = useQuery({
    queryKey: templatesQueryKeys.detail(templateId),
    queryFn: async (): Promise<TemplateDetail> => {
      const response = await getTemplate(templateId);
      return response;
    },
    enabled: enabled && !!templateId,
    staleTime,
  });

  // Extract error message safely
  const errorMessage = query.error && typeof query.error === 'object' && 'message' in query.error
    ? (query.error as Error).message
    : query.error
      ? 'Failed to fetch template'
      : null;

  const refetch = async (): Promise<void> => {
    await query.refetch();
  };

  return {
    template: query.data ?? null,
    loading: query.isLoading,
    isFetching: query.isFetching,
    error: errorMessage,
    refetch,
  };
}

/**
 * Callback type for mutation success/error handling
 */
export type SnackbarCallback = (message: string, severity: 'success' | 'error' | 'warning' | 'info') => void;

/**
 * Options for useTemplateActions hook
 */
export interface UseTemplateActionsOptions {
  /**
   * Callback for showing notifications
   */
  onNotify?: SnackbarCallback;
}

/**
 * Return value from useTemplateActions hook
 */
export interface UseTemplateActionsReturn {
  /** Create a new template */
  createTemplate: (request: CreateTemplateRequest) => Promise<TemplateDetail>;

  /** Update an existing template */
  updateTemplate: (templateId: string, request: UpdateTemplateRequest) => Promise<TemplateDetail>;

  /** Delete a template */
  deleteTemplate: (templateId: string) => Promise<void>;

  /** Duplicate a template */
  duplicateTemplate: (templateId: string, request: DuplicateTemplateRequest) => Promise<TemplateDetail>;

  /** Set a template as default */
  setDefault: (templateId: string) => Promise<TemplateDetail>;

  /** Add a section to a template */
  addSection: (templateId: string, section: ReportSectionConfig) => Promise<TemplateDetail>;

  /** Remove a section from a template */
  removeSection: (templateId: string, sectionIndex: number) => Promise<TemplateDetail>;

  /** Reorder sections in a template */
  reorderSections: (templateId: string, sectionOrders: number[]) => Promise<TemplateDetail>;

  /** Whether any action is pending */
  isPending: boolean;

  /** Current action type being processed */
  pendingAction: 'create' | 'update' | 'delete' | 'duplicate' | 'setDefault' | 'addSection' | 'removeSection' | 'reorder' | null;

  /** Error from the last action */
  error: string | null;

  /** Reset error state */
  resetError: () => void;
}

/**
 * Hook for template CRUD and section management actions
 *
 * @param options - Optional configuration
 * @returns Action functions for managing templates
 */
export function useTemplateActions(
  options: UseTemplateActionsOptions = {}
): UseTemplateActionsReturn {
  const { onNotify } = options;
  const queryClient = useQueryClient();

  // Helper to invalidate caches
  const invalidateCaches = async (templateId?: string) => {
    await queryClient.invalidateQueries({
      queryKey: templatesQueryKeys.all,
    });
    if (templateId) {
      await queryClient.invalidateQueries({
        queryKey: templatesQueryKeys.detail(templateId),
      });
    }
  };

  // Create mutation
  const createMutation = useMutation({
    mutationFn: createTemplate,
    onSuccess: async (data) => {
      onNotify?.('Template created successfully', 'success');
      await invalidateCaches(data.id);
    },
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to create template';
      onNotify?.(message, 'error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ templateId, request }: { templateId: string; request: UpdateTemplateRequest }) =>
      updateTemplate(templateId, request),
    onSuccess: async (data) => {
      onNotify?.('Template updated successfully', 'success');
      await invalidateCaches(data.id);
    },
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to update template';
      onNotify?.(message, 'error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: async () => {
      onNotify?.('Template deleted successfully', 'success');
      await invalidateCaches();
    },
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to delete template';
      onNotify?.(message, 'error');
    },
  });

  // Duplicate mutation
  const duplicateMutation = useMutation({
    mutationFn: ({ templateId, request }: { templateId: string; request: DuplicateTemplateRequest }) =>
      duplicateTemplate(templateId, request),
    onSuccess: async (data) => {
      onNotify?.('Template duplicated successfully', 'success');
      await invalidateCaches(data.id);
    },
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to duplicate template';
      onNotify?.(message, 'error');
    },
  });

  // Set default mutation
  const setDefaultMutation = useMutation({
    mutationFn: setDefaultTemplate,
    onSuccess: async (data) => {
      onNotify?.('Default template set successfully', 'success');
      await invalidateCaches(data.id);
    },
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to set default template';
      onNotify?.(message, 'error');
    },
  });

  // Add section mutation
  const addSectionMutation = useMutation({
    mutationFn: ({ templateId, section }: { templateId: string; section: ReportSectionConfig }) =>
      addTemplateSection(templateId, section),
    onSuccess: async (data) => {
      onNotify?.('Section added successfully', 'success');
      await invalidateCaches(data.id);
    },
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to add section';
      onNotify?.(message, 'error');
    },
  });

  // Remove section mutation
  const removeSectionMutation = useMutation({
    mutationFn: ({ templateId, sectionIndex }: { templateId: string; sectionIndex: number }) =>
      removeTemplateSection(templateId, sectionIndex),
    onSuccess: async (data) => {
      onNotify?.('Section removed successfully', 'success');
      await invalidateCaches(data.id);
    },
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to remove section';
      onNotify?.(message, 'error');
    },
  });

  // Reorder sections mutation
  const reorderMutation = useMutation({
    mutationFn: ({ templateId, sectionOrders }: { templateId: string; sectionOrders: number[] }) =>
      reorderTemplateSections(templateId, sectionOrders),
    onSuccess: async (data) => {
      onNotify?.('Sections reordered successfully', 'success');
      await invalidateCaches(data.id);
    },
    onError: (error) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Failed to reorder sections';
      onNotify?.(message, 'error');
    },
  });

  // Determine pending action
  let pendingAction: UseTemplateActionsReturn['pendingAction'] = null;
  if (createMutation.isPending) pendingAction = 'create';
  else if (updateMutation.isPending) pendingAction = 'update';
  else if (deleteMutation.isPending) pendingAction = 'delete';
  else if (duplicateMutation.isPending) pendingAction = 'duplicate';
  else if (setDefaultMutation.isPending) pendingAction = 'setDefault';
  else if (addSectionMutation.isPending) pendingAction = 'addSection';
  else if (removeSectionMutation.isPending) pendingAction = 'removeSection';
  else if (reorderMutation.isPending) pendingAction = 'reorder';

  // Combine errors
  const error = createMutation.error || updateMutation.error || deleteMutation.error ||
    duplicateMutation.error || setDefaultMutation.error || addSectionMutation.error ||
    removeSectionMutation.error || reorderMutation.error;

  const errorMessage = error && typeof error === 'object' && 'message' in error
    ? (error as Error).message
    : error
      ? 'Template action failed'
      : null;

  const resetError = () => {
    createMutation.reset();
    updateMutation.reset();
    deleteMutation.reset();
    duplicateMutation.reset();
    setDefaultMutation.reset();
    addSectionMutation.reset();
    removeSectionMutation.reset();
    reorderMutation.reset();
  };

  return {
    createTemplate: createMutation.mutateAsync,
    updateTemplate: async (templateId: string, request: UpdateTemplateRequest) => {
      return updateMutation.mutateAsync({ templateId, request });
    },
    deleteTemplate: async (templateId: string) => {
      await deleteMutation.mutateAsync(templateId);
    },
    duplicateTemplate: async (templateId: string, request: DuplicateTemplateRequest) => {
      return duplicateMutation.mutateAsync({ templateId, request });
    },
    setDefault: setDefaultMutation.mutateAsync,
    addSection: async (templateId: string, section: ReportSectionConfig) => {
      return addSectionMutation.mutateAsync({ templateId, section });
    },
    removeSection: async (templateId: string, sectionIndex: number) => {
      return removeSectionMutation.mutateAsync({ templateId, sectionIndex });
    },
    reorderSections: async (templateId: string, sectionOrders: number[]) => {
      return reorderMutation.mutateAsync({ templateId, sectionOrders });
    },
    isPending: pendingAction !== null,
    pendingAction,
    error: errorMessage,
    resetError,
  };
}

/**
 * Hook for invalidating templates cache
 * Useful when you need to invalidate cache from a different component
 *
 * @returns Function to invalidate templates cache
 */
export function useInvalidateTemplates() {
  const queryClient = useQueryClient();

  /**
   * Invalidate all templates cache
   */
  const invalidateAll = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: templatesQueryKeys.all,
    });
  };

  /**
   * Invalidate templates for a specific scope
   */
  const invalidateScope = async (
    systemId: string,
    testEnvironment: string,
    workload: string
  ): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: templatesQueryKeys.byScope(systemId, testEnvironment, workload),
    });
    await queryClient.invalidateQueries({
      queryKey: templatesQueryKeys.summaries(systemId, testEnvironment, workload),
    });
  };

  /**
   * Invalidate a specific template's cache
   */
  const invalidateTemplate = async (templateId: string): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: templatesQueryKeys.detail(templateId),
    });
  };

  return {
    invalidateAll,
    invalidateScope,
    invalidateTemplate,
  };
}
