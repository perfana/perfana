'use client';

import { DynatraceQuery, CreateDynatraceQueryDto, UpdateDynatraceQueryDto } from '@/lib/dynatrace';

/**
 * Local representation of a Dynatrace query for display
 */
export interface DynatraceQueryLocal {
  id: string;
  application: string;
  testEnvironment: string;
  dashboardLabel: string;
  applicationDashboardId: string;
  panelTitle: string;
  query: string;
  matchMetricPattern?: string;
  omitGroupByVariableFromMetricName?: string[];
  templateVariables?: Record<string, string>;
  dynatraceConfigLabel?: string;
  /** False parks the query: no collection path executes it, nothing lands in ds_metrics. */
  enabled: boolean;
  organizationId?: string;
  /**
   * Per-resource capability hint carried over from the API's DynatraceQuery.
   * The backend 403s a non-admin on PATCH/DELETE; the table reads this to
   * disable the buttons instead of letting the user find out by clicking.
   */
  _permissions?: { update: boolean; delete: boolean };
  createdAt?: string;
}

/**
 * Props for the main DynatraceSection component
 */
export interface DynatraceSectionProps {
  systemId: string;
  systemName: string;
  selectedEnvironment: string;
  selectedWorkload: string;
}

/**
 * Props for the QueriesTable component
 */
export interface QueriesTableProps {
  queries: DynatraceQueryLocal[];
  selectedQueryIds: Set<string>;
  /** Receives the currently visible (filtered) ids — select-all must not reach past the filter. */
  onSelectAll: (visibleIds: string[]) => void;
  onSelectOne: (id: string) => void;
  onEditQuery: (query: DynatraceQueryLocal) => void;
  onDeleteQuery: (query: DynatraceQueryLocal) => void;
  onToggleEnabled: (query: DynatraceQueryLocal) => void;
}

/**
 * Props for the QueriesToolbar component
 */
export interface QueriesToolbarProps {
  selectedCount: number;
  onBatchDelete: () => void;
  onBatchSetEnabled: (enabled: boolean) => void;
  onClearSelection: () => void;
}

/**
 * Hook return type for useDynatraceQueries
 */
export interface UseDynatraceQueriesReturn {
  // State
  queries: DynatraceQueryLocal[];
  loading: boolean;
  error: string | null;
  actionError: string | null;
  selectedQueryIds: Set<string>;

  // Dialog states
  deleteDialogOpen: boolean;
  deletingQuery: DynatraceQueryLocal | null;
  deleteLoading: boolean;
  importDialogOpen: boolean;
  importLoading: boolean;
  addDialogOpen: boolean;
  addLoading: boolean;
  editDialogOpen: boolean;
  editLoading: boolean;
  editingQuery: DynatraceQuery | null;
  batchDeleteDialogOpen: boolean;

  // Handlers
  fetchQueries: () => Promise<void>;
  handleAddQuery: () => void;
  handleAddQuerySubmit: (data: CreateDynatraceQueryDto) => Promise<void>;
  handleImportDashboard: () => void;
  handleImportQueries: (
    tiles: { title: string; query: string }[],
    variableValues: Record<string, string>,
    dashboardName: string,
    metricUnit: string,
    dynatraceConfigId: string
  ) => Promise<void>;
  handleEditQuery: (query: DynatraceQueryLocal) => Promise<void>;
  handleEditQuerySubmit: (id: string, data: UpdateDynatraceQueryDto) => Promise<void>;
  handleDeleteQuery: (query: DynatraceQueryLocal) => void;
  handleToggleEnabled: (query: DynatraceQueryLocal) => Promise<void>;
  handleBatchSetEnabled: (enabled: boolean) => Promise<void>;
  handleConfirmDelete: () => Promise<void>;
  handleSelectAll: (visibleIds: string[]) => void;
  handleSelectOne: (id: string) => void;
  handleClearSelection: () => void;
  handleBatchDeleteClick: () => void;
  handleBatchDeleteConfirm: () => Promise<void>;
  handleBatchDeleteCancel: () => void;

  // Dialog closers
  closeDeleteDialog: () => void;
  closeImportDialog: () => void;
  closeAddDialog: () => void;
  closeEditDialog: () => void;
}

// Re-export types from lib for convenience
export type { DynatraceQuery, CreateDynatraceQueryDto, UpdateDynatraceQueryDto };
