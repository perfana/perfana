'use client';

import { useState, useCallback } from 'react';
import {
  fetchProfileBenchmarks,
  createProfileBenchmark,
  updateProfileBenchmark,
  deleteProfileBenchmark,
  ProfileBenchmark,
  CreateProfileBenchmarkData,
  UpdateProfileBenchmarkData,
} from '@/lib/profile-benchmarks';
import { SnackbarState } from '../types';

interface UseBenchmarksProps {
  profileId: string;
  onSnackbar: (state: SnackbarState) => void;
}

interface UseBenchmarksReturn {
  // State
  benchmarks: ProfileBenchmark[];
  loading: boolean;
  error: string;
  selectedIds: Set<string>;
  formDialogOpen: boolean;
  formMode: 'create' | 'edit';
  editingBenchmark: ProfileBenchmark | undefined;
  batchDeleteDialogOpen: boolean;
  // Actions
  loadBenchmarks: () => Promise<void>;
  handleAdd: () => void;
  handleEdit: (benchmark: ProfileBenchmark) => void;
  handleDelete: (benchmarkId: string) => Promise<void>;
  handleFormSubmit: (data: CreateProfileBenchmarkData | UpdateProfileBenchmarkData) => Promise<void>;
  handleSelectAll: () => void;
  handleSelectOne: (id: string) => void;
  handleBatchDelete: () => Promise<void>;
  setFormDialogOpen: (open: boolean) => void;
  setBatchDeleteDialogOpen: (open: boolean) => void;
}

/**
 * Hook for managing benchmark CRUD operations and state
 */
export function useBenchmarks({
  profileId,
  onSnackbar,
}: UseBenchmarksProps): UseBenchmarksReturn {
  const [benchmarks, setBenchmarks] = useState<ProfileBenchmark[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingBenchmark, setEditingBenchmark] = useState<ProfileBenchmark | undefined>();
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);

  const loadBenchmarks = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await fetchProfileBenchmarks(profileId);
      setBenchmarks(data);
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load benchmarks'
      );
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  const handleAdd = useCallback(() => {
    setFormMode('create');
    setEditingBenchmark(undefined);
    setFormDialogOpen(true);
  }, []);

  const handleEdit = useCallback((benchmark: ProfileBenchmark) => {
    setFormMode('edit');
    setEditingBenchmark(benchmark);
    setFormDialogOpen(true);
  }, []);

  const handleDelete = useCallback(async (benchmarkId: string) => {
    try {
      await deleteProfileBenchmark(profileId, benchmarkId);
      onSnackbar({
        open: true,
        message: 'SLO deleted successfully',
        severity: 'success',
      });
      await loadBenchmarks();
    } catch (err) {
      onSnackbar({
        open: true,
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete SLO',
        severity: 'error',
      });
    }
  }, [profileId, onSnackbar, loadBenchmarks]);

  const handleFormSubmit = useCallback(async (
    data: CreateProfileBenchmarkData | UpdateProfileBenchmarkData
  ) => {
    if (formMode === 'create') {
      await createProfileBenchmark(profileId, data as CreateProfileBenchmarkData);
      onSnackbar({
        open: true,
        message: 'SLO created successfully',
        severity: 'success',
      });
    } else if (editingBenchmark) {
      await updateProfileBenchmark(profileId, editingBenchmark.id, data as UpdateProfileBenchmarkData);
      onSnackbar({
        open: true,
        message: 'SLO updated successfully',
        severity: 'success',
      });
    }
    await loadBenchmarks();
    setFormDialogOpen(false);
  }, [profileId, formMode, editingBenchmark, onSnackbar, loadBenchmarks]);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === benchmarks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(benchmarks.map(b => b.id)));
    }
  }, [selectedIds.size, benchmarks]);

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
        idsToDelete.map(id => deleteProfileBenchmark(profileId, id))
      );
      onSnackbar({
        open: true,
        message: `${idsToDelete.length} SLO${idsToDelete.length > 1 ? 's' : ''} deleted successfully`,
        severity: 'success',
      });
      await loadBenchmarks();
      setBatchDeleteDialogOpen(false);
      setSelectedIds(new Set());
    } catch (err) {
      onSnackbar({
        open: true,
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete some SLOs',
        severity: 'error',
      });
    }
  }, [selectedIds, profileId, onSnackbar, loadBenchmarks]);

  return {
    benchmarks,
    loading,
    error,
    selectedIds,
    formDialogOpen,
    formMode,
    editingBenchmark,
    batchDeleteDialogOpen,
    loadBenchmarks,
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
