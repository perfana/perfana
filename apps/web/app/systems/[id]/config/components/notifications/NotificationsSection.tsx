'use client';

import { useState, useEffect } from 'react';
import { authenticatedFetch } from '@/lib/api';
import {
  Box,
  Paper,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Snackbar,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { NotificationsSectionProps, SnackbarState } from './types';
import { useNotificationsData } from './hooks';
import {
  NotificationChannelDialog,
  DeleteChannelDialog,
  ChannelsTable,
} from './components';

export default function NotificationsSection({
  systemId,
}: NotificationsSectionProps) {
  // Snackbar state
  const [snackbar, setSnackbar] = useState<SnackbarState>({
    open: false,
    message: '',
    severity: 'success',
  });

  const [proxyConfigured, setProxyConfigured] = useState(false);

  useEffect(() => {
    authenticatedFetch('/proxy').then(r => r.ok ? r.json() : null).then(data => {
      setProxyConfigured(data != null);
    }).catch(() => setProxyConfigured(false));
  }, []);

  // Hook for data and actions
  const {
    channels,
    loading,
    error,
    formData,
    saving,
    testing,
    addDialogOpen,
    editDialogOpen,
    deleteDialogOpen,
    deletingChannel,
    setFormData,
    handleAddChannel,
    handleEditChannel,
    handleDeleteChannel,
    handleTestChannel,
    openAddDialog,
    openEditDialog,
    openDeleteDialog,
    setAddDialogOpen,
    setEditDialogOpen,
    setDeleteDialogOpen,
  } = useNotificationsData({ systemId, onSnackbar: setSnackbar });

  // Loading state
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" gutterBottom>
            Notification Channels
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure Slack or Microsoft Teams notifications for test run completions
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openAddDialog}
        >
          Add Channel
        </Button>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Empty State */}
      {channels.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No notification channels configured yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Add a Slack or Teams channel to receive notifications when test runs complete
          </Typography>
        </Paper>
      ) : (
        <ChannelsTable
          channels={channels}
          testing={testing}
          onTest={handleTestChannel}
          onEdit={openEditDialog}
          onDelete={openDeleteDialog}
        />
      )}

      {/* Add Channel Dialog */}
      <NotificationChannelDialog
        open={addDialogOpen}
        mode="add"
        formData={formData}
        saving={saving}
        proxyConfigured={proxyConfigured}
        onFormChange={setFormData}
        onClose={() => setAddDialogOpen(false)}
        onSubmit={handleAddChannel}
      />

      {/* Edit Channel Dialog */}
      <NotificationChannelDialog
        open={editDialogOpen}
        mode="edit"
        formData={formData}
        saving={saving}
        proxyConfigured={proxyConfigured}
        onFormChange={setFormData}
        onClose={() => setEditDialogOpen(false)}
        onSubmit={handleEditChannel}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteChannelDialog
        open={deleteDialogOpen}
        channel={deletingChannel}
        saving={saving}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDeleteChannel}
      />

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
