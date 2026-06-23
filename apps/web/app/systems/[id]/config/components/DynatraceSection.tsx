'use client';

import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  Add as AddIcon,
  Upload as UploadIcon,
  Search as SearchIcon,
  Link as LinkIcon,
} from '@mui/icons-material';

// Types
import { DynatraceSectionProps } from './dynatrace-section/types';

// Hooks
import { useDynatraceQueries } from './dynatrace-section/hooks';

// Components
import { QueriesTable, QueriesToolbar } from './dynatrace-section/components';
import DeleteConfirmationDialog from './DeleteConfirmationDialog';
import ImportDashboardDialog from './ImportDashboardDialog';
import AddDynatraceQueryDialog from './AddDynatraceQueryDialog';
import EditDynatraceQueryDialog from './EditDynatraceQueryDialog';
import DynatraceDeeplinkSection from './DynatraceDeeplinkSection';

export default function DynatraceSection({
  systemId,
  systemName,
  selectedEnvironment,
  selectedWorkload,
}: DynatraceSectionProps) {
  const [activeSubTab, setActiveSubTab] = useState(0);

  // Use the custom hook for all query-related state and handlers
  const dynatraceQueries = useDynatraceQueries({
    systemId,
    systemName,
    selectedEnvironment,
    selectedWorkload,
  });

  if (!selectedEnvironment || !selectedWorkload) {
    return (
      <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
        <Typography variant="h6" gutterBottom>
          Dynatrace Queries
        </Typography>
        <Alert severity="info">
          Please select both environment and workload to configure Dynatrace queries.
        </Alert>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" gutterBottom>
            Dynatrace Configuration
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure Dynatrace settings for {systemName} - {selectedEnvironment} -{' '}
            {selectedWorkload}
          </Typography>
        </Box>
      </Box>

      {/* Subtabs for Queries and Entities */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs
          value={activeSubTab}
          onChange={(_, newValue) => setActiveSubTab(newValue)}
          aria-label="dynatrace configuration sections"
        >
          <Tab
            icon={<SearchIcon />}
            label="Queries"
            id="dynatrace-subtab-0"
            aria-controls="dynatrace-subtabpanel-0"
          />
          <Tab
            icon={<LinkIcon />}
            label="Entities"
            id="dynatrace-subtab-1"
            aria-controls="dynatrace-subtabpanel-1"
          />
        </Tabs>
      </Box>

      {/* Content for Queries Tab */}
      {activeSubTab === 0 && (
        <Box>
          <Box
            sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
          >
            <Box>
              <Typography variant="h6" gutterBottom>
                Queries
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Configure Dynatrace queries for metric retrieval
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                startIcon={<UploadIcon />}
                onClick={dynatraceQueries.handleImportDashboard}
                disabled={dynatraceQueries.loading}
              >
                Import Dashboard
              </Button>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={dynatraceQueries.handleAddQuery}
                disabled={dynatraceQueries.loading}
              >
                Add Query
              </Button>
            </Box>
          </Box>

          {dynatraceQueries.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {dynatraceQueries.error}
            </Alert>
          )}

          {dynatraceQueries.loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : dynatraceQueries.queries.length === 0 ? (
            <Alert severity="info">
              No Dynatrace queries configured for this environment and workload combination.
            </Alert>
          ) : (
            <>
              <QueriesToolbar
                selectedCount={dynatraceQueries.selectedQueryIds.size}
                onBatchDelete={dynatraceQueries.handleBatchDeleteClick}
                onClearSelection={dynatraceQueries.handleClearSelection}
              />

              <QueriesTable
                queries={dynatraceQueries.queries}
                selectedQueryIds={dynatraceQueries.selectedQueryIds}
                onSelectAll={dynatraceQueries.handleSelectAll}
                onSelectOne={dynatraceQueries.handleSelectOne}
                onEditQuery={dynatraceQueries.handleEditQuery}
                onDeleteQuery={dynatraceQueries.handleDeleteQuery}
              />
            </>
          )}

          {/* Batch Delete Confirmation Dialog */}
          <Dialog
            open={dynatraceQueries.batchDeleteDialogOpen}
            onClose={dynatraceQueries.handleBatchDeleteCancel}
          >
            <DialogTitle>Delete Multiple Dynatrace Queries</DialogTitle>
            <DialogContent>
              {dynatraceQueries.actionError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {dynatraceQueries.actionError}
                </Alert>
              )}
              <DialogContentText>
                Are you sure you want to delete {dynatraceQueries.selectedQueryIds.size} quer
                {dynatraceQueries.selectedQueryIds.size > 1 ? 'ies' : 'y'}? This action cannot be
                undone.
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={dynatraceQueries.handleBatchDeleteCancel}>Cancel</Button>
              <Button
                onClick={dynatraceQueries.handleBatchDeleteConfirm}
                color="error"
                variant="contained"
                disabled={dynatraceQueries.deleteLoading}
              >
                Delete {dynatraceQueries.selectedQueryIds.size} Quer
                {dynatraceQueries.selectedQueryIds.size > 1 ? 'ies' : 'y'}
              </Button>
            </DialogActions>
          </Dialog>

          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Dynatrace queries allow Perfana to retrieve specific metrics from your Dynatrace
              environment and correlate them with test runs.
            </Typography>
          </Box>
        </Box>
      )}

      {/* Content for Entities Tab */}
      {activeSubTab === 1 && (
        <DynatraceDeeplinkSection
          systemId={systemId}
          systemName={systemName}
          selectedEnvironment={selectedEnvironment}
          selectedWorkload={selectedWorkload}
          onHostQueriesCreated={dynatraceQueries.fetchQueries}
        />
      )}

      {/* Import Dashboard Dialog */}
      <ImportDashboardDialog
        open={dynatraceQueries.importDialogOpen}
        onClose={dynatraceQueries.closeImportDialog}
        onImport={dynatraceQueries.handleImportQueries}
        systemName={systemName}
        environment={selectedEnvironment}
        loading={dynatraceQueries.importLoading}
        submitError={dynatraceQueries.actionError}
      />

      {/* Add Query Dialog */}
      <AddDynatraceQueryDialog
        open={dynatraceQueries.addDialogOpen}
        onClose={dynatraceQueries.closeAddDialog}
        onAdd={dynatraceQueries.handleAddQuerySubmit}
        systemId={systemId}
        environment={selectedEnvironment}
        workload={selectedWorkload}
        loading={dynatraceQueries.addLoading}
        submitError={dynatraceQueries.actionError}
      />

      {/* Edit Query Dialog */}
      <EditDynatraceQueryDialog
        open={dynatraceQueries.editDialogOpen}
        onClose={dynatraceQueries.closeEditDialog}
        onEdit={dynatraceQueries.handleEditQuerySubmit}
        query={dynatraceQueries.editingQuery}
        loading={dynatraceQueries.editLoading}
        submitError={dynatraceQueries.actionError}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={dynatraceQueries.deleteDialogOpen}
        onClose={dynatraceQueries.closeDeleteDialog}
        onConfirm={dynatraceQueries.handleConfirmDelete}
        title="Delete Dynatrace Query"
        message="Are you sure you want to delete this Dynatrace query? This action cannot be undone."
        itemName={dynatraceQueries.deletingQuery?.panelTitle}
        loading={dynatraceQueries.deleteLoading}
        error={dynatraceQueries.actionError}
      />
    </Paper>
  );
}
