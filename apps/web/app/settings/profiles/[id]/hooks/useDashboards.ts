'use client';

import { useState, useCallback } from 'react';
import {
  fetchProfileDashboards,
  createProfileDashboard,
  updateProfileDashboard,
  deleteProfileDashboard,
  ProfileDashboard,
  CreateProfileDashboardData,
  UpdateProfileDashboardData,
} from '@/lib/profiles';
import { SnackbarState } from '../types';

interface UseDashboardsProps {
  profileId: string;
  onSnackbar: (state: SnackbarState) => void;
  loadGrafanaData: () => Promise<void>;
}

interface UseDashboardsReturn {
  // State
  dashboards: ProfileDashboard[];
  loading: boolean;
  error: string;
  selectedIds: Set<string>;
  formDialogOpen: boolean;
  formMode: 'create' | 'edit';
  editingDashboard: ProfileDashboard | undefined;
  batchDeleteDialogOpen: boolean;
  // Actions
  loadDashboards: () => Promise<void>;
  handleAdd: () => Promise<void>;
  handleEdit: (dashboard: ProfileDashboard) => Promise<void>;
  handleDelete: (dashboardId: string) => Promise<void>;
  handleFormSubmit: (data: CreateProfileDashboardData | UpdateProfileDashboardData) => Promise<void>;
  handleSelectAll: () => void;
  handleSelectOne: (id: string) => void;
  handleBatchDelete: () => Promise<void>;
  setFormDialogOpen: (open: boolean) => void;
  setBatchDeleteDialogOpen: (open: boolean) => void;
}

/**
 * Hook for managing dashboard CRUD operations and state
 */
export function useDashboards({
  profileId,
  onSnackbar,
  loadGrafanaData,
}: UseDashboardsProps): UseDashboardsReturn {
  const [dashboards, setDashboards] = useState<ProfileDashboard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingDashboard, setEditingDashboard] = useState<ProfileDashboard | undefined>();
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);

  const loadDashboards = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await fetchProfileDashboards(profileId);
      setDashboards(data);
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load dashboards'
      );
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  const handleAdd = useCallback(async () => {
    await loadGrafanaData();
    setFormMode('create');
    setEditingDashboard(undefined);
    setFormDialogOpen(true);
  }, [loadGrafanaData]);

  const handleEdit = useCallback(async (dashboard: ProfileDashboard) => {
    await loadGrafanaData();
    setFormMode('edit');
    setEditingDashboard(dashboard);
    setFormDialogOpen(true);
  }, [loadGrafanaData]);

  const handleDelete = useCallback(async (dashboardId: string) => {
    try {
      await deleteProfileDashboard(profileId, dashboardId);
      onSnackbar({
        open: true,
        message: 'Dashboard association deleted successfully',
        severity: 'success',
      });
      await loadDashboards();
    } catch (err) {
      onSnackbar({
        open: true,
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete dashboard',
        severity: 'error',
      });
    }
  }, [profileId, onSnackbar, loadDashboards]);

  const handleFormSubmit = useCallback(async (
    data: CreateProfileDashboardData | UpdateProfileDashboardData
  ) => {
    if (formMode === 'create') {
      await createProfileDashboard(profileId, data as CreateProfileDashboardData);
      onSnackbar({
        open: true,
        message: 'Dashboard added successfully',
        severity: 'success',
      });
    } else if (editingDashboard) {
      await updateProfileDashboard(profileId, editingDashboard.id, data as UpdateProfileDashboardData);
      onSnackbar({
        open: true,
        message: 'Dashboard updated successfully',
        severity: 'success',
      });
    }
    await loadDashboards();
  }, [profileId, formMode, editingDashboard, onSnackbar, loadDashboards]);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === dashboards.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(dashboards.map(d => d.id)));
    }
  }, [selectedIds.size, dashboards]);

  const handleSelectOne = useCallback((id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  }, [selectedIds]);

  const handleBatchDelete = useCallback(async () => {
    const idsToDelete = Array.from(selectedIds);
    try {
      await Promise.all(
        idsToDelete.map(id => deleteProfileDashboard(profileId, id))
      );
      onSnackbar({
        open: true,
        message: `${idsToDelete.length} dashboard${idsToDelete.length > 1 ? 's' : ''} deleted successfully`,
        severity: 'success',
      });
      await loadDashboards();
      setBatchDeleteDialogOpen(false);
      setSelectedIds(new Set());
    } catch (err) {
      onSnackbar({
        open: true,
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete some dashboards',
        severity: 'error',
      });
    }
  }, [selectedIds, profileId, onSnackbar, loadDashboards]);

  return {
    dashboards,
    loading,
    error,
    selectedIds,
    formDialogOpen,
    formMode,
    editingDashboard,
    batchDeleteDialogOpen,
    loadDashboards,
    handleAdd,
    handleEdit,
    handleDelete,
    handleFormSubmit,
    handleSelectAll,
    handleSelectOne,
    handleBatchDelete,
    setFormDialogOpen,
    setBatchDeleteDialogOpen,
  };
}
