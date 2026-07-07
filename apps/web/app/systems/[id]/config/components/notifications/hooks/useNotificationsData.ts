'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import {
  NotificationChannel,
  NotificationChannelFormData,
  UseNotificationsDataProps,
  INITIAL_FORM_DATA,
} from '../types';

export function useNotificationsData({
  systemId,
  onSnackbar,
}: UseNotificationsDataProps) {
  // State
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [formData, setFormData] = useState<NotificationChannelFormData>(INITIAL_FORM_DATA);
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
  const [deletingChannel, setDeletingChannel] = useState<NotificationChannel | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  // Load notification channels
  const loadChannels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await authenticatedFetch(
        `/notifications/channels?systemId=${systemId}`
      );

      if (!response.ok) {
        throw new Error('Failed to load notification channels');
      }

      const data = await response.json();
      setChannels(data || []);
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load notification channels';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  // Add channel
  const handleAddChannel = async () => {
    try {
      setSaving(true);

      const response = await authenticatedFetch('/notifications/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemUnderTestId: systemId,
          ...formData,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to create notification channel');
      }

      onSnackbar({
        open: true,
        message: 'Notification channel created successfully',
        severity: 'success',
      });
      setAddDialogOpen(false);
      setFormData(INITIAL_FORM_DATA);
      await loadChannels();
    } catch (err) {
      onSnackbar({
        open: true,
        message:
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to create notification channel',
        severity: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  // Edit channel
  const handleEditChannel = async () => {
    if (!editingChannel) return;

    try {
      setSaving(true);

      const response = await authenticatedFetch(
        `/notifications/channels/${editingChannel.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to update notification channel');
      }

      onSnackbar({
        open: true,
        message: 'Notification channel updated successfully',
        severity: 'success',
      });
      setEditDialogOpen(false);
      setEditingChannel(null);
      setFormData(INITIAL_FORM_DATA);
      await loadChannels();
    } catch (err) {
      onSnackbar({
        open: true,
        message:
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to update notification channel',
        severity: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  // Delete channel
  const handleDeleteChannel = async () => {
    if (!deletingChannel) return;

    try {
      setSaving(true);

      const response = await authenticatedFetch(
        `/notifications/channels/${deletingChannel.id}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error('Failed to delete notification channel');
      }

      onSnackbar({
        open: true,
        message: 'Notification channel deleted successfully',
        severity: 'success',
      });
      setDeleteDialogOpen(false);
      setDeletingChannel(null);
      await loadChannels();
    } catch (err) {
      onSnackbar({
        open: true,
        message:
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to delete notification channel',
        severity: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  // Test channel
  const handleTestChannel = async (channel: NotificationChannel) => {
    try {
      setTesting(channel.id);

      const response = await authenticatedFetch(
        `/notifications/channels/${channel.id}/test`,
        { method: 'POST' }
      );

      const result = await response.json();

      if (result.success) {
        onSnackbar({
          open: true,
          message: 'Test notification sent successfully',
          severity: 'success',
        });
      } else {
        onSnackbar({
          open: true,
          message: result.message || 'Failed to send test notification',
          severity: 'error',
        });
      }
    } catch (err) {
      onSnackbar({
        open: true,
        message:
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to send test notification',
        severity: 'error',
      });
    } finally {
      setTesting(null);
    }
  };

  // Open edit dialog
  const openEditDialog = (channel: NotificationChannel) => {
    setEditingChannel(channel);
    setFormData({
      type: channel.type,
      name: channel.name,
      webhookUrl: channel.webhookUrl,
      notifyOnFailedOnly: channel.notifyOnFailedOnly,
      enabled: channel.enabled,
      useProxy: channel.useProxy ?? false,
    });
    setEditDialogOpen(true);
  };

  // Open delete dialog
  const openDeleteDialog = (channel: NotificationChannel) => {
    setDeletingChannel(channel);
    setDeleteDialogOpen(true);
  };

  // Open add dialog
  const openAddDialog = () => {
    setFormData(INITIAL_FORM_DATA);
    setAddDialogOpen(true);
  };

  // Close dialogs
  const closeDialogs = () => {
    setAddDialogOpen(false);
    setEditDialogOpen(false);
    setDeleteDialogOpen(false);
    setEditingChannel(null);
    setDeletingChannel(null);
    setFormData(INITIAL_FORM_DATA);
  };

  return {
    // State
    channels,
    loading,
    error,
    formData,
    saving,
    testing,
    addDialogOpen,
    editDialogOpen,
    deleteDialogOpen,
    editingChannel,
    deletingChannel,
    // Actions
    setFormData,
    handleAddChannel,
    handleEditChannel,
    handleDeleteChannel,
    handleTestChannel,
    openAddDialog,
    openEditDialog,
    openDeleteDialog,
    closeDialogs,
    setAddDialogOpen,
    setEditDialogOpen,
    setDeleteDialogOpen,
  };
}
