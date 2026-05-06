'use client';

import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Add as AddIcon, ContentCopy as CopyIcon } from '@mui/icons-material';
import AddDeepLinkDialog from '../AddDeepLinkDialog';
import EditDeepLinkDialog from '../EditDeepLinkDialog';
import DeleteConfirmationDialog from '../DeleteConfirmationDialog';
import { CopyToScopeDialog, type CopyTarget } from '../shared/CopyToScopeDialog';
import { copyDeepLinks } from '@/lib/api/config-copy';
import { DeepLinksSectionProps } from './types';
import { useDeepLinksSection } from './hooks';
import {
  BatchActionsToolbar,
  DeepLinksTable,
  BatchDeleteDialog,
} from './components';

export default function DeepLinksSection({
  systemId,
  systemName,
  selectedEnvironment,
  selectedWorkload,
}: DeepLinksSectionProps) {
  const {
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
    deleteError,

    // Selection state
    selectedDeepLinkIds,

    // Dialog actions
    setAddDialogOpen,
    setEditDialogOpen,
    setEditingDeepLink,
    setDeleteDialogOpen,

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
  } = useDeepLinksSection({
    systemId,
    selectedEnvironment,
    selectedWorkload,
  });

  // Copy dialog state
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  const handleCopy = async (target: CopyTarget) => {
    const result = await copyDeepLinks({
      sourceSystemUnderTestId: systemId,
      sourceTestEnvironment: selectedEnvironment,
      sourceWorkload: selectedWorkload,
      targetSystemUnderTestId: target.systemUnderTestId,
      targetTestEnvironment: target.testEnvironment,
      targetWorkload: target.workload || selectedWorkload,
      conflictStrategy: target.conflictStrategy,
      ids: selectedDeepLinkIds.size > 0 ? Array.from(selectedDeepLinkIds) : undefined,
    });
    setCopySuccess(`Copied ${result.copied} deep link${result.copied !== 1 ? 's' : ''}${result.skipped > 0 ? `, skipped ${result.skipped} duplicate${result.skipped !== 1 ? 's' : ''}` : ''}`);
  };

  // Early return for missing selection
  if (!selectedEnvironment || !selectedWorkload) {
    return (
      <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
        <Typography variant="h6" gutterBottom>
          Deep Links Configuration
        </Typography>
        <Alert severity="info">
          Please select both environment and workload to configure deep links.
        </Alert>
      </Paper>
    );
  }

  const handleEditDeepLink = (deepLink: typeof editingDeepLink) => {
    if (deepLink) {
      setEditingDeepLink(deepLink);
      setEditDialogOpen(true);
    }
  };

  const handleAddDeepLink = () => {
    setAddDialogOpen(true);
  };

  return (
    <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" gutterBottom>
            Deep Links Configuration
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Custom URL links for {systemName} - {selectedEnvironment} - {selectedWorkload}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {deepLinks.length > 0 && (
            <Button
              variant="outlined"
              startIcon={<CopyIcon />}
              onClick={() => setCopyDialogOpen(true)}
              disabled={loading || submitting}
            >
              {selectedDeepLinkIds.size > 0 ? `Copy ${selectedDeepLinkIds.size} to...` : 'Copy to...'}
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddDeepLink}
            disabled={loading || submitting}
          >
            Add Deep Link
          </Button>
        </Box>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Content */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : deepLinks.length === 0 ? (
        <Alert severity="info">
          No deep links configured for this environment and workload combination.
        </Alert>
      ) : (
        <>
          {/* Batch Actions Toolbar */}
          <BatchActionsToolbar
            selectedCount={selectedDeepLinkIds.size}
            onBatchDelete={handleBatchDeleteClick}
            onClearSelection={handleClearSelection}
          />

          {/* Deep Links Table */}
          <DeepLinksTable
            deepLinks={deepLinks}
            selectedDeepLinkIds={selectedDeepLinkIds}
            onSelectAll={handleSelectAll}
            onSelectOne={handleSelectOne}
            onEdit={handleEditDeepLink}
            onDelete={handleDeleteDeepLink}
          />
        </>
      )}

      {/* Batch Delete Confirmation Dialog */}
      <BatchDeleteDialog
        open={batchDeleteDialogOpen}
        selectedCount={selectedDeepLinkIds.size}
        loading={deleteLoading}
        onConfirm={handleBatchDeleteConfirm}
        onCancel={handleBatchDeleteCancel}
      />

      {/* Copy Success Alert */}
      {copySuccess && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setCopySuccess(null)}>
          {copySuccess}
        </Alert>
      )}

      {/* Variable Substitution Help Text */}
      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Deep links support variable substitution using placeholders like {'{perfana-test-run-id}'}, {'{perfana-start-epoch-milliseconds}'}, etc.
        </Typography>
      </Box>

      {/* Add Deep Link Dialog */}
      <AddDeepLinkDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onSubmit={handleCreateDeepLink}
        systemId={systemId}
        systemName={systemName}
        testEnvironment={selectedEnvironment}
        workload={selectedWorkload}
        loading={submitting}
      />

      {/* Edit Deep Link Dialog */}
      <EditDeepLinkDialog
        open={editDialogOpen}
        onClose={() => {
          setEditDialogOpen(false);
          setEditingDeepLink(null);
        }}
        onSubmit={handleUpdateDeepLink}
        deepLink={editingDeepLink}
        systemName={systemName}
        loading={submitting}
      />

      {/* Copy to Scope Dialog */}
      <CopyToScopeDialog
        open={copyDialogOpen}
        onClose={() => setCopyDialogOpen(false)}
        onCopy={handleCopy}
        currentScope={{
          systemId,
          systemName,
          environment: selectedEnvironment,
          workload: selectedWorkload,
        }}
        itemCount={deepLinks.length}
        selectedCount={selectedDeepLinkIds.size > 0 ? selectedDeepLinkIds.size : undefined}
        itemType="deep links"
        supportsWorkload={true}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Deep Link"
        message="Are you sure you want to delete this deep link? This action cannot be undone."
        itemName={deletingDeepLink?.name}
        loading={deleteLoading}
        error={deleteError}
      />
    </Paper>
  );
}

// Re-export types for consumers
export type { DeepLink, DeepLinkFormData, DeepLinksSectionProps } from './types';
