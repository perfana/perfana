'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  DynatraceQuery,
  fetchDynatraceQueries,
  fetchDynatraceQueryById,
  createDynatraceQuery,
  updateDynatraceQuery,
  deleteDynatraceQuery,
  CreateDynatraceQueryDto,
  UpdateDynatraceQueryDto,
} from '@/lib/dynatrace';
import { DynatraceQueryLocal, UseDynatraceQueriesReturn } from '../types';

interface UseDynatraceQueriesProps {
  systemId: string;
  systemName: string;
  selectedEnvironment: string;
  selectedWorkload: string;
}

export function useDynatraceQueries({
  systemId,
  systemName,
  selectedEnvironment,
  selectedWorkload,
}: UseDynatraceQueriesProps): UseDynatraceQueriesReturn {
  // Core state
  const [queries, setQueries] = useState<DynatraceQueryLocal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingQuery, setDeletingQuery] = useState<DynatraceQueryLocal | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editingQuery, setEditingQuery] = useState<DynatraceQuery | null>(null);

  // Multi-select state
  const [selectedQueryIds, setSelectedQueryIds] = useState<Set<string>>(new Set());
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);

  // Fetch Dynatrace queries
  const fetchQueries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const apiQueries = await fetchDynatraceQueries(systemId, selectedEnvironment, selectedWorkload);

      const convertedQueries: DynatraceQueryLocal[] = apiQueries.map((query) => ({
        id: query.id,
        application: systemName,
        testEnvironment: query.testEnvironment,
        dashboardLabel: query.dashboardLabel,
        applicationDashboardId: query.applicationDashboardId,
        panelTitle: query.panelTitle,
        query: query.query,
        matchMetricPattern: query.matchMetricPattern,
        omitGroupByVariableFromMetricName: query.omitGroupByVariableFromMetricName,
        templateVariables: query.templateVariables,
        dynatraceConfigLabel: query.dynatraceConfig?.label,
        organizationId: query.organizationId,
        _permissions: query._permissions,
        createdAt: query.createdAt,
      }));

      setQueries(convertedQueries);
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to fetch Dynatrace queries'
      );
      setQueries([]);
    } finally {
      setLoading(false);
    }
  }, [systemId, systemName, selectedEnvironment, selectedWorkload]);

  // Effect to fetch queries when dependencies change
  useEffect(() => {
    if (systemId && selectedEnvironment && selectedWorkload) {
      fetchQueries();
    } else {
      setQueries([]);
    }
  }, [systemId, selectedEnvironment, selectedWorkload, fetchQueries]);

  // Add query handlers
  const handleAddQuery = useCallback(() => {
    setActionError(null);
    setAddDialogOpen(true);
  }, []);

  const handleAddQuerySubmit = useCallback(
    async (data: CreateDynatraceQueryDto) => {
      try {
        setAddLoading(true);
        setActionError(null);
        await createDynatraceQuery(data);
        await fetchQueries();
        setAddDialogOpen(false);
      } catch (err) {
        setActionError(
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to create Dynatrace query'
        );
      } finally {
        setAddLoading(false);
      }
    },
    [fetchQueries]
  );

  // Import handlers
  const handleImportDashboard = useCallback(() => {
    setActionError(null);
    setImportDialogOpen(true);
  }, []);

  const handleImportQueries = useCallback(
    async (
      tiles: { title: string; query: string }[],
      variableValues: Record<string, string>,
      dashboardName: string,
      metricUnit: string,
      dynatraceConfigId: string
    ) => {
      try {
        setImportLoading(true);
        setActionError(null);

        // Check for existing records with the same dashboard_label
        const existingQuery = queries.find(
          (query) =>
            query.dashboardLabel === dashboardName &&
            query.testEnvironment === selectedEnvironment &&
            query.application === systemName
        );

        // Use existing application_dashboard_id if found, otherwise generate new UUID
        const sharedApplicationDashboardId =
          existingQuery?.applicationDashboardId || crypto.randomUUID();

        // Create new queries via API
        for (const tile of tiles) {
          const createData: CreateDynatraceQueryDto = {
            dynatraceConfigId: dynatraceConfigId,
            systemUnderTestId: systemId,
            testEnvironment: selectedEnvironment,
            workload: selectedWorkload,
            dashboardLabel: dashboardName,
            applicationDashboardId: sharedApplicationDashboardId,
            panelTitle: tile.title,
            query: tile.query,
            omitGroupByVariableFromMetricName: [],
            templateVariables: variableValues,
            metricUnit: metricUnit,
          };

          await createDynatraceQuery(createData);
        }

        await fetchQueries();
        setImportDialogOpen(false);
      } catch (err) {
        setActionError(
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to import queries'
        );
      } finally {
        setImportLoading(false);
      }
    },
    [queries, selectedEnvironment, systemName, systemId, selectedWorkload, fetchQueries]
  );

  // Edit handlers
  const handleEditQuery = useCallback(async (query: DynatraceQueryLocal) => {
    try {
      setActionError(null);
      const fullQuery = await fetchDynatraceQueryById(query.id);
      setEditingQuery(fullQuery);
      setEditDialogOpen(true);
    } catch (err) {
      setError('Failed to load query details for editing');
    }
  }, []);

  const handleEditQuerySubmit = useCallback(
    async (id: string, data: UpdateDynatraceQueryDto) => {
      try {
        setEditLoading(true);
        setActionError(null);
        await updateDynatraceQuery(id, data);
        await fetchQueries();
        setEditDialogOpen(false);
        setEditingQuery(null);
      } catch (err) {
        setActionError(
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to update Dynatrace query'
        );
      } finally {
        setEditLoading(false);
      }
    },
    [fetchQueries]
  );

  // Delete handlers
  const handleDeleteQuery = useCallback((query: DynatraceQueryLocal) => {
    setActionError(null);
    setDeletingQuery(query);
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingQuery) return;

    try {
      setDeleteLoading(true);
      setActionError(null);
      await deleteDynatraceQuery(deletingQuery.id);
      await fetchQueries();
      setDeleteDialogOpen(false);
      setDeletingQuery(null);
    } catch (err) {
      setActionError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete Dynatrace query'
      );
    } finally {
      setDeleteLoading(false);
    }
  }, [deletingQuery, fetchQueries]);

  // Multi-select handlers
  const handleSelectAll = useCallback(() => {
    if (selectedQueryIds.size === queries.length) {
      setSelectedQueryIds(new Set());
    } else {
      setSelectedQueryIds(new Set(queries.map((q) => q.id)));
    }
  }, [selectedQueryIds.size, queries]);

  const handleSelectOne = useCallback((id: string) => {
    setSelectedQueryIds((prev) => {
      const newSelected = new Set(prev);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return newSelected;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedQueryIds(new Set());
  }, []);

  // Batch delete handlers
  const handleBatchDeleteClick = useCallback(() => {
    setActionError(null);
    setBatchDeleteDialogOpen(true);
  }, []);

  const handleBatchDeleteConfirm = useCallback(async () => {
    const idsToDelete = Array.from(selectedQueryIds);

    try {
      setDeleteLoading(true);
      setActionError(null);
      await Promise.all(idsToDelete.map((id) => deleteDynatraceQuery(id)));
      await fetchQueries();
      setBatchDeleteDialogOpen(false);
      handleClearSelection();
    } catch (err) {
      setActionError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete some Dynatrace queries'
      );
    } finally {
      setDeleteLoading(false);
    }
  }, [selectedQueryIds, fetchQueries, handleClearSelection]);

  const handleBatchDeleteCancel = useCallback(() => {
    setActionError(null);
    setBatchDeleteDialogOpen(false);
  }, []);

  // Dialog closers
  const closeDeleteDialog = useCallback(() => {
    setActionError(null);
    setDeleteDialogOpen(false);
  }, []);

  const closeImportDialog = useCallback(() => {
    setActionError(null);
    setImportDialogOpen(false);
  }, []);

  const closeAddDialog = useCallback(() => {
    setActionError(null);
    setAddDialogOpen(false);
  }, []);

  const closeEditDialog = useCallback(() => {
    setActionError(null);
    setEditDialogOpen(false);
    setEditingQuery(null);
  }, []);

  return {
    // State
    queries,
    loading,
    error,
    actionError,
    selectedQueryIds,

    // Dialog states
    deleteDialogOpen,
    deletingQuery,
    deleteLoading,
    importDialogOpen,
    importLoading,
    addDialogOpen,
    addLoading,
    editDialogOpen,
    editLoading,
    editingQuery,
    batchDeleteDialogOpen,

    // Handlers
    fetchQueries,
    handleAddQuery,
    handleAddQuerySubmit,
    handleImportDashboard,
    handleImportQueries,
    handleEditQuery,
    handleEditQuerySubmit,
    handleDeleteQuery,
    handleConfirmDelete,
    handleSelectAll,
    handleSelectOne,
    handleClearSelection,
    handleBatchDeleteClick,
    handleBatchDeleteConfirm,
    handleBatchDeleteCancel,

    // Dialog closers
    closeDeleteDialog,
    closeImportDialog,
    closeAddDialog,
    closeEditDialog,
  };
}
