'use client';

import { useState, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { Benchmark } from '../components/types';

interface UseSLOManagementReturn {
  // State
  benchmarks: Benchmark[];
  benchmarksLoading: boolean;

  // Filter state
  sloSearchText: string;
  selectedSloTags: string[];

  // Dialog state
  addSloOpen: boolean;
  editSloOpen: boolean;
  deleteSloOpen: boolean;
  editingSlo: Benchmark | null;
  deletingSlo: Benchmark | null;

  // Loading states
  deleteSloLoading: boolean;
  deleteSloError: string | null;

  // Actions
  fetchBenchmarks: (systemId: string, environment: string, workload: string) => Promise<void>;
  handleAddSLO: () => void;
  handleSLOCreated: (newSLO: Benchmark, systemId: string, environment: string, workload: string) => void;
  handleSLOUpdated: (updatedSLO: Benchmark, systemId: string, environment: string, workload: string) => void;
  handleEditSLO: (benchmark: Benchmark) => void;
  handleDeleteSLO: (benchmark: Benchmark) => void;
  handleConfirmDeleteSLO: (systemId: string, environment: string, workload: string) => Promise<{ error?: string }>;
  handleBatchDeleteSLOs: (ids: string[], systemId: string, environment: string, workload: string) => Promise<void>;
  handleViewSLO: (benchmark: Benchmark) => void;

  // Filter actions
  setSloSearchText: (text: string) => void;
  handleSloTagToggle: (tag: string) => void;
  clearSloTags: () => void;

  // Dialog actions
  setAddSloOpen: (open: boolean) => void;
  closeEditSloDialog: () => void;
  setDeleteSloOpen: (open: boolean) => void;
  clearBenchmarks: () => void;
}

export function useSLOManagement(): UseSLOManagementReturn {
  // State
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [benchmarksLoading, setBenchmarksLoading] = useState(false);

  // Filter state
  const [sloSearchText, setSloSearchText] = useState('');
  const [selectedSloTags, setSelectedSloTags] = useState<string[]>([]);

  // Dialog state
  const [addSloOpen, setAddSloOpen] = useState(false);
  const [editSloOpen, setEditSloOpen] = useState(false);
  const [editingSlo, setEditingSlo] = useState<Benchmark | null>(null);
  const [deleteSloOpen, setDeleteSloOpen] = useState(false);
  const [deletingSlo, setDeletingSlo] = useState<Benchmark | null>(null);

  // Loading states
  const [deleteSloLoading, setDeleteSloLoading] = useState(false);
  const [deleteSloError, setDeleteSloError] = useState<string | null>(null);

  // Fetch benchmarks
  const fetchBenchmarks = useCallback(async (systemId: string, environment: string, workload: string) => {
    if (!environment || !workload) return;

    try {
      setBenchmarksLoading(true);
      const response = await authenticatedFetch(
        `/benchmarks?systemId=${systemId}&testEnvironment=${encodeURIComponent(environment)}&workload=${encodeURIComponent(workload)}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch benchmarks');
      }

      const data = await response.json();
      setBenchmarks(data || []);
    } catch (err) {
      setBenchmarks([]);
    } finally {
      setBenchmarksLoading(false);
    }
  }, []);

  // Handle add SLO
  const handleAddSLO = useCallback(() => {
    setAddSloOpen(true);
  }, []);

  // Handle SLO created
  const handleSLOCreated = useCallback((
    newSLO: Benchmark,
    systemId: string,
    environment: string,
    workload: string
  ) => {
    setBenchmarks(prev => [...prev, newSLO]);
    // Refresh the list from server to ensure consistency
    if (environment && workload) {
      fetchBenchmarks(systemId, environment, workload);
    }
  }, [fetchBenchmarks]);

  // Handle SLO updated
  const handleSLOUpdated = useCallback((
    updatedSLO: Benchmark,
    systemId: string,
    environment: string,
    workload: string
  ) => {
    setBenchmarks(prev =>
      prev.map(slo => slo.id === updatedSLO.id ? updatedSLO : slo)
    );
    // Refresh the list from server to ensure consistency
    if (environment && workload) {
      fetchBenchmarks(systemId, environment, workload);
    }
  }, [fetchBenchmarks]);

  // Handle edit SLO
  const handleEditSLO = useCallback((benchmark: Benchmark) => {
    setEditingSlo(benchmark);
    setEditSloOpen(true);
  }, []);

  // Handle delete SLO
  const handleDeleteSLO = useCallback((benchmark: Benchmark) => {
    setDeletingSlo(benchmark);
    setDeleteSloError(null);
    setDeleteSloOpen(true);
  }, []);

  // Confirm delete SLO
  const handleConfirmDeleteSLO = useCallback(async (
    systemId: string,
    environment: string,
    workload: string
  ): Promise<{ error?: string }> => {
    if (!deletingSlo) return {};

    try {
      setDeleteSloLoading(true);
      setDeleteSloError(null);
      const response = await authenticatedFetch(
        `/benchmarks/${deletingSlo.id}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.message
          ?? body?.error
          ?? `Failed to delete SLO (${response.status} ${response.statusText})`;
        setDeleteSloError(message);
        return { error: message };
      }

      // Refresh benchmarks list
      if (environment && workload) {
        await fetchBenchmarks(systemId, environment, workload);
      }

      setDeleteSloOpen(false);
      setDeletingSlo(null);
      return {};
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to delete SLO';
      setDeleteSloError(message);
      return { error: message };
    } finally {
      setDeleteSloLoading(false);
    }
  }, [deletingSlo, fetchBenchmarks]);

  // Batch delete SLOs
  const handleBatchDeleteSLOs = useCallback(async (
    ids: string[],
    systemId: string,
    environment: string,
    workload: string
  ) => {
    await Promise.all(
      ids.map(id =>
        authenticatedFetch(`/benchmarks/${id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    if (environment && workload) {
      await fetchBenchmarks(systemId, environment, workload);
    }
  }, [fetchBenchmarks]);

  // Handle view SLO
  const handleViewSLO = useCallback((_benchmark: Benchmark) => {
    // TODO: Implement View SLO details
    alert('View SLO functionality is not yet implemented in the refactored version. Please use the original page for now.');
  }, []);

  // Handle SLO tag toggle
  const handleSloTagToggle = useCallback((tag: string) => {
    setSelectedSloTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  }, []);

  // Clear SLO tags
  const clearSloTags = useCallback(() => {
    setSelectedSloTags([]);
  }, []);

  // Close edit SLO dialog
  const closeEditSloDialog = useCallback(() => {
    setEditSloOpen(false);
    setEditingSlo(null);
  }, []);

  // Clear benchmarks (when environment/workload changes)
  const clearBenchmarks = useCallback(() => {
    setBenchmarks([]);
  }, []);

  return {
    // State
    benchmarks,
    benchmarksLoading,

    // Filter state
    sloSearchText,
    selectedSloTags,

    // Dialog state
    addSloOpen,
    editSloOpen,
    deleteSloOpen,
    editingSlo,
    deletingSlo,

    // Loading states
    deleteSloLoading,
    deleteSloError,

    // Actions
    fetchBenchmarks,
    handleAddSLO,
    handleSLOCreated,
    handleSLOUpdated,
    handleEditSLO,
    handleDeleteSLO,
    handleConfirmDeleteSLO,
    handleBatchDeleteSLOs,
    handleViewSLO,

    // Filter actions
    setSloSearchText,
    handleSloTagToggle,
    clearSloTags,

    // Dialog actions
    setAddSloOpen,
    closeEditSloDialog,
    setDeleteSloOpen,
    clearBenchmarks,
  };
}
