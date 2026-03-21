'use client';

import { useState, useCallback } from 'react';
import { ProfileDashboard } from '@/lib/profiles';

interface UseDeleteDialogProps {
  onDelete: (dashboardId: string) => void;
}

interface UseDeleteDialogResult {
  deleteDialogOpen: boolean;
  dashboardToDelete: ProfileDashboard | null;
  handleDeleteClick: (dashboard: ProfileDashboard) => void;
  handleDeleteConfirm: () => void;
  handleDeleteCancel: () => void;
}

/**
 * Hook for managing delete confirmation dialog state and handlers
 */
export function useDeleteDialog({ onDelete }: UseDeleteDialogProps): UseDeleteDialogResult {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [dashboardToDelete, setDashboardToDelete] = useState<ProfileDashboard | null>(null);

  const handleDeleteClick = useCallback((dashboard: ProfileDashboard) => {
    setDashboardToDelete(dashboard);
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (dashboardToDelete) {
      onDelete(dashboardToDelete.id);
      setDeleteDialogOpen(false);
      setDashboardToDelete(null);
    }
  }, [dashboardToDelete, onDelete]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteDialogOpen(false);
    setDashboardToDelete(null);
  }, []);

  return {
    deleteDialogOpen,
    dashboardToDelete,
    handleDeleteClick,
    handleDeleteConfirm,
    handleDeleteCancel,
  };
}
