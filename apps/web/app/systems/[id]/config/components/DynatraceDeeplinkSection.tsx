'use client';

import { useMemo, useState } from 'react';
import {
  Autocomplete,
  TextField,
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Paper,
  Toolbar,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Close as CloseIcon,
} from '@mui/icons-material';

// Types
import { DynatraceDeeplinkSectionProps } from './dynatrace-deeplinks/types';

// Hooks
import { useDynatraceEntityMappings } from './dynatrace-deeplinks/hooks';

// Components
import { EntityMappingsTable, AddEntityDialog, EditLabelsDialog } from './dynatrace-deeplinks/components';
import DeleteConfirmationDialog from './DeleteConfirmationDialog';
import { DynatraceEntityMapping } from './dynatrace-deeplinks/types';

export default function DynatraceDeeplinkSection({
  systemId,
  systemName: _systemName,
  selectedEnvironment,
  selectedWorkload,
  onHostQueriesCreated,
}: DynatraceDeeplinkSectionProps) {
  const {
    // Dynatrace instances
    dynatraceInstances,
    selectedInstance,
    setSelectedInstance,

    // Entity mappings
    filteredMappings,
    loading,
    error,

    // Entities for autocomplete
    entities,
    entitiesLoading,

    // Dialog state
    addDialogOpen,
    addLoading,

    // Multi-select + delete confirmation
    selectedMappingIds,
    handleSelectAll,
    handleSelectOne,
    handleClearSelection,
    deleteDialogOpen,
    deletingMapping,
    deleteLoading,
    closeDeleteDialog,
    handleConfirmDelete,
    batchDeleteDialogOpen,
    handleBatchDeleteClick,
    handleBatchDeleteConfirm,
    handleBatchDeleteCancel,

    // Form state
    selectedLevel,
    setSelectedLevel,
    selectedEntityType,
    setSelectedEntityType,
    selectedEntity,
    setSelectedEntity,
    searchInput,
    setSearchInput,

    // HOST multi-select via tag filter
    selectedTagKey,
    setSelectedTagKey,
    selectedTagValue,
    setSelectedTagValue,
    selectedHosts,
    setSelectedHosts,
    newHostLabels,
    setNewHostLabels,

    // Actions
    fetchDynatraceEntities,
    handleAddEntity,
    handleSubmitEntity,
    handleDeleteEntity,
    handleInputChange,
    resetDialogState,
    applyLabels,
  } = useDynatraceEntityMappings({
    systemId,
    selectedEnvironment,
    selectedWorkload,
    onHostQueriesCreated,
  });

  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [editingLabelsFor, setEditingLabelsFor] = useState<DynatraceEntityMapping | null>(null);

  // Every label in play, so the filter offers only labels that would match something.
  const labelOptions = useMemo(
    () => Array.from(new Set(filteredMappings.flatMap((m) => m.labels ?? []))).sort(),
    [filteredMappings],
  );

  // AND across the chosen labels — narrowing, which is what a multi-select filter reads as.
  const visibleMappings = useMemo(
    () =>
      labelFilter.length === 0
        ? filteredMappings
        : filteredMappings.filter((m) => labelFilter.every((l) => (m.labels ?? []).includes(l))),
    [filteredMappings, labelFilter],
  );

  // Changing the data source invalidates any in-progress entity/host selection —
  // clear it so a selection made against instance A can't be submitted to instance B.
  const clearEntitySelection = () => {
    setSelectedEntity(null);
    setSelectedTagKey('');
    setSelectedTagValue('');
    setSelectedHosts([]);
    setSearchInput('');
  };

  const handleInstanceChange = (instanceId: string) => {
    setSelectedInstance(instanceId);
    setSelectedEntityType('');
    clearEntitySelection();
  };

  const handleEntityTypeChange = (type: string) => {
    setSelectedEntityType(type);
    clearEntitySelection();
  };

  const handleTagKeyChange = (key: string) => {
    setSelectedTagKey(key);
    setSelectedTagValue('');
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" gutterBottom>
            Dynatrace Entities
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure Dynatrace entities at different levels
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleAddEntity}
          disabled={loading}
        >
          Add Entity
        </Button>
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
      ) : filteredMappings.length === 0 ? (
        <Alert severity="info">
          No Dynatrace entities configured for the current context.
        </Alert>
      ) : (
        <>
          {selectedMappingIds.size > 0 && (
            <Paper sx={{ mb: 2 }}>
              <Toolbar
                sx={{
                  pl: { sm: 2 },
                  pr: { xs: 1, sm: 1 },
                  bgcolor: (theme) =>
                    theme.palette.mode === 'dark' ? 'rgba(56, 142, 232, 0.15)' : 'rgba(25, 118, 210, 0.08)',
                }}
              >
                <Typography sx={{ flex: '1 1 100%' }} color="primary" variant="subtitle1" component="div">
                  {selectedMappingIds.size} entit{selectedMappingIds.size > 1 ? 'ies' : 'y'} selected
                </Typography>
                <Tooltip title="Delete selected">
                  <IconButton onClick={handleBatchDeleteClick} color="error">
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Clear selection">
                  <IconButton onClick={handleClearSelection}>
                    <CloseIcon />
                  </IconButton>
                </Tooltip>
              </Toolbar>
            </Paper>
          )}

          {labelOptions.length > 0 && (
            <Autocomplete
              multiple
              size="small"
              options={labelOptions}
              value={labelFilter}
              onChange={(_event, value) => setLabelFilter(value)}
              renderInput={(params) => <TextField {...params} label="Filter by label" />}
              sx={{ mb: 2, maxWidth: 480 }}
            />
          )}

          <EntityMappingsTable
            mappings={visibleMappings}
            selectedMappingIds={selectedMappingIds}
            onSelectAll={handleSelectAll}
            onSelectOne={handleSelectOne}
            onDelete={handleDeleteEntity}
            onEditLabels={setEditingLabelsFor}
          />
        </>
      )}

      <EditLabelsDialog
        mapping={editingLabelsFor}
        onClose={() => setEditingLabelsFor(null)}
        onSaved={applyLabels}
      />

      {/* Batch Delete Confirmation Dialog */}
      <Dialog open={batchDeleteDialogOpen} onClose={handleBatchDeleteCancel}>
        <DialogTitle>Delete Multiple Dynatrace Entities</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <DialogContentText>
            Are you sure you want to delete {selectedMappingIds.size} entit
            {selectedMappingIds.size > 1 ? 'ies' : 'y'}? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleBatchDeleteCancel}>Cancel</Button>
          <Button onClick={handleBatchDeleteConfirm} color="error" variant="contained" disabled={deleteLoading}>
            Delete {selectedMappingIds.size} Entit{selectedMappingIds.size > 1 ? 'ies' : 'y'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Single Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onClose={closeDeleteDialog}
        onConfirm={handleConfirmDelete}
        title="Delete Dynatrace Entity"
        message="Are you sure you want to delete this Dynatrace entity? This action cannot be undone."
        itemName={deletingMapping?.entityDisplayName}
        loading={deleteLoading}
        error={error}
      />

      {/* Footer Help Text */}
      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Entity mappings enable Perfana to create deeplinks to specific Dynatrace entities based on your system configuration hierarchy.
        </Typography>
      </Box>

      {/* Add Entity Dialog */}
      <AddEntityDialog
        open={addDialogOpen}
        onClose={resetDialogState}
        onSubmit={handleSubmitEntity}
        loading={addLoading}
        dynatraceInstances={dynatraceInstances}
        selectedInstance={selectedInstance}
        onInstanceChange={handleInstanceChange}
        selectedLevel={selectedLevel}
        onLevelChange={setSelectedLevel}
        selectedEntityType={selectedEntityType}
        onEntityTypeChange={handleEntityTypeChange}
        entities={entities}
        entitiesLoading={entitiesLoading}
        selectedEntity={selectedEntity}
        onEntityChange={setSelectedEntity}
        searchInput={searchInput}
        onInputChange={handleInputChange}
        onSearchInputChange={setSearchInput}
        onFetchEntities={fetchDynatraceEntities}
        selectedTagKey={selectedTagKey}
        onTagKeyChange={handleTagKeyChange}
        selectedTagValue={selectedTagValue}
        onTagValueChange={setSelectedTagValue}
        selectedHosts={selectedHosts}
        onSelectedHostsChange={setSelectedHosts}
        hostLabels={newHostLabels}
        onHostLabelsChange={setNewHostLabels}
      />
    </Box>
  );
}
