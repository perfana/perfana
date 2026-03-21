'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { DeepLink, DeepLinkFormData, UseDeepLinksSectionReturn } from '../types';

interface UseDeepLinksSectionProps {
  systemId: string;
  selectedEnvironment: string;
  selectedWorkload: string;
}

export function useDeepLinksSection({
  systemId,
  selectedEnvironment,
  selectedWorkload,
}: UseDeepLinksSectionProps): UseDeepLinksSectionReturn {
  // Data state
  const [deepLinks, setDeepLinks] = useState<DeepLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingDeepLink, setEditingDeepLink] = useState<DeepLink | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingDeepLink, setDeletingDeepLink] = useState<DeepLink | null>(null);
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);

  // Loading states
  const [submitting, setSubmitting] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Selection state
  const [selectedDeepLinkIds, setSelectedDeepLinkIds] = useState<Set<string>>(new Set());

  // Fetch deep links
  const fetchDeepLinks = useCallback(async () => {
    if (!systemId || !selectedEnvironment || !selectedWorkload) {
      setDeepLinks([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await authenticatedFetch(
        `/deep-links?systemUnderTestId=${systemId}&testEnvironment=${encodeURIComponent(selectedEnvironment)}&workload=${encodeURIComponent(selectedWorkload)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch deep links');
      }

      const data = await response.json();
      setDeepLinks(data || []);
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to fetch deep links';
      setError(errorMessage);
      setDeepLinks([]);
    } finally {
      setLoading(false);
    }
  }, [systemId, selectedEnvironment, selectedWorkload]);

  // Fetch deep links when environment/workload changes
  useEffect(() => {
    if (systemId && selectedEnvironment && selectedWorkload) {
      fetchDeepLinks();
    } else {
      setDeepLinks([]);
    }
  }, [systemId, selectedEnvironment, selectedWorkload, fetchDeepLinks]);

  // Create deep link handler
  const handleCreateDeepLink = useCallback(async (deepLinkData: DeepLinkFormData) => {
    try {
      setSubmitting(true);
      setError(null);

      const response = await authenticatedFetch('/deep-links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(deepLinkData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create deep link');
      }

      await fetchDeepLinks();
      setAddDialogOpen(false);
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to create deep link';
      setError(errorMessage);
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, [fetchDeepLinks]);

  // Update deep link handler
  const handleUpdateDeepLink = useCallback(async (id: string, deepLinkData: DeepLinkFormData) => {
    try {
      setSubmitting(true);
      setError(null);

      const response = await authenticatedFetch(`/deep-links/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(deepLinkData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update deep link');
      }

      await fetchDeepLinks();
      setEditDialogOpen(false);
      setEditingDeepLink(null);
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to update deep link';
      setError(errorMessage);
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, [fetchDeepLinks]);

  // Delete deep link handler (open dialog)
  const handleDeleteDeepLink = useCallback((deepLink: DeepLink) => {
    setDeletingDeepLink(deepLink);
    setDeleteDialogOpen(true);
  }, []);

  // Confirm delete handler
  const handleConfirmDelete = useCallback(async () => {
    if (!deletingDeepLink) return;

    try {
      setDeleteLoading(true);
      setError(null);

      const response = await authenticatedFetch(`/deep-links/${deletingDeepLink.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete deep link');
      }

      await fetchDeepLinks();
      setDeleteDialogOpen(false);
      setDeletingDeepLink(null);
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete deep link';
      setError(errorMessage);
    } finally {
      setDeleteLoading(false);
    }
  }, [deletingDeepLink, fetchDeepLinks]);

  // Selection handlers
  const handleSelectAll = useCallback(() => {
    if (selectedDeepLinkIds.size === deepLinks.length) {
      setSelectedDeepLinkIds(new Set());
    } else {
      setSelectedDeepLinkIds(new Set(deepLinks.map(dl => dl.id)));
    }
  }, [selectedDeepLinkIds.size, deepLinks]);

  const handleSelectOne = useCallback((id: string) => {
    setSelectedDeepLinkIds(prev => {
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
    setSelectedDeepLinkIds(new Set());
  }, []);

  // Batch delete handlers
  const handleBatchDeleteClick = useCallback(() => {
    setBatchDeleteDialogOpen(true);
  }, []);

  const handleBatchDeleteConfirm = useCallback(async () => {
    const idsToDelete = Array.from(selectedDeepLinkIds);

    try {
      setDeleteLoading(true);
      setError(null);

      await Promise.all(
        idsToDelete.map(id =>
          authenticatedFetch(`/deep-links/${id}`, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
          })
        )
      );

      await fetchDeepLinks();
      setBatchDeleteDialogOpen(false);
      handleClearSelection();
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete some deep links';
      setError(errorMessage);
    } finally {
      setDeleteLoading(false);
    }
  }, [selectedDeepLinkIds, fetchDeepLinks, handleClearSelection]);

  const handleBatchDeleteCancel = useCallback(() => {
    setBatchDeleteDialogOpen(false);
  }, []);

  return {
    // Data state
    deepLinks,
    loading,
    error,

    // Dialog state
    addDialogOpen,
    editDialogOpen,
    editingDeepLink,
    deleteDialogOpen,
    deletingDeepLink,
    batchDeleteDialogOpen,

    // Loading states
    submitting,
    deleteLoading,

    // Selection state
    selectedDeepLinkIds,

    // Dialog actions
    setAddDialogOpen,
    setEditDialogOpen,
    setEditingDeepLink,
    setDeleteDialogOpen,
    setBatchDeleteDialogOpen,

    // Data handlers
    handleCreateDeepLink,
    handleUpdateDeepLink,
    handleDeleteDeepLink,
    handleConfirmDelete,

    // Selection handlers
    handleSelectAll,
    handleSelectOne,
    handleClearSelection,

    // Batch handlers
    handleBatchDeleteClick,
    handleBatchDeleteConfirm,
    handleBatchDeleteCancel,
  };
}
