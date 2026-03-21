'use client';

import { useState } from 'react';
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
import { DistributedTracingSectionProps, SnackbarState } from './types';
import { useDistributedTracingData } from './hooks';
import {
  TracingServicesTable,
  TracingServiceDialog,
  TracingDeleteDialog,
} from './components';

export default function DistributedTracingSection({
  systemId,
  systemName,
  selectedEnvironment,
  selectedWorkload,
}: DistributedTracingSectionProps) {
  // Snackbar state
  const [snackbar, setSnackbar] = useState<SnackbarState>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Hook for data and actions
  const {
    tracingServices,
    tracingInstances,
    loading,
    error,
    formData,
    saving,
    addDialogOpen,
    editDialogOpen,
    deleteDialogOpen,
    editingService,
    deletingService,
    availableEnvironments,
    availableWorkloads,
    handleFormChange,
    handleSave,
    handleDelete,
    openAddDialog,
    openEditDialog,
    openDeleteDialog,
    setAddDialogOpen,
    setEditDialogOpen,
    setDeleteDialogOpen,
  } = useDistributedTracingData({ systemId, onSnackbar: setSnackbar });

  // Loading state
  if (loading) {
    return (
      <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Distributed Tracing Configuration
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Configure distributed tracing (Tempo, Jaeger, Elastic APM) for {systemName}
        </Typography>
        {selectedEnvironment && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Viewing: {selectedEnvironment}
            {selectedWorkload && ` / ${selectedWorkload}`}
          </Typography>
        )}
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Add Button */}
      <Box sx={{ mb: 3 }}>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openAddDialog}
          disabled={saving}
        >
          Add Tracing Service
        </Button>
      </Box>

      {/* Empty State or Table */}
      {tracingServices.length === 0 ? (
        <Alert severity="info">
          No tracing services configured. Click &quot;Add Tracing Service&quot; to
          configure distributed tracing for this system.
        </Alert>
      ) : (
        <TracingServicesTable
          services={tracingServices}
          saving={saving}
          onEdit={openEditDialog}
          onDelete={openDeleteDialog}
        />
      )}

      {/* Add Dialog */}
      <TracingServiceDialog
        open={addDialogOpen}
        isEdit={false}
        formData={formData}
        saving={saving}
        tracingInstances={tracingInstances}
        availableEnvironments={availableEnvironments}
        availableWorkloads={availableWorkloads}
        onFormChange={handleFormChange}
        onClose={() => setAddDialogOpen(false)}
        onSubmit={handleSave}
      />

      {/* Edit Dialog */}
      <TracingServiceDialog
        open={editDialogOpen}
        isEdit={!!editingService}
        formData={formData}
        saving={saving}
        tracingInstances={tracingInstances}
        availableEnvironments={availableEnvironments}
        availableWorkloads={availableWorkloads}
        onFormChange={handleFormChange}
        onClose={() => setEditDialogOpen(false)}
        onSubmit={handleSave}
      />

      {/* Delete Confirmation Dialog */}
      <TracingDeleteDialog
        open={deleteDialogOpen}
        service={deletingService}
        saving={saving}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleDelete}
      />

      {/* Success/Error Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Paper>
  );
}
