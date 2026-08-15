'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Snackbar,
} from '@mui/material';
import { Share, Business, CloudUpload } from '@mui/icons-material';
import { RefreshMissingDataDialog } from '@/components/dialogs/RefreshSourcesDialog';
import { JtlUploadDialog } from '@/components/dialogs/JtlUploadDialog';
import { useOrganizationContext } from '@/lib/contexts/organization-context';
import { NoOrganizationMembership } from '@/components/NoOrganizationMembership';
import { NoOrganizationsExist } from '@/components/NoOrganizationsExist';

// Types
import { SnackbarState } from './types';

// Hooks
import {
  useTestRunsData,
  useTestRunsFilters,
  useTestRunsHandlers,
} from './hooks';

// Utils
import { separateTestRuns } from './utils/test-runs-filters';

// Components
import {
  JobProgressBanner,
  TestRunsFilters,
  TestRunsTable,
  TestRunsEmptyState,
  BatchActionsToolbar,
} from './components';

export default function TestRunsPage() {
  const [snackbar, setSnackbar] = useState<SnackbarState>({ open: false, message: '' });
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const { currentOrganizationId, isReady, isSelectorReadOnly, hasNoOrganizations, isAdmin, organizations } = useOrganizationContext();

  const handleSnackbar = useCallback((state: SnackbarState) => setSnackbar(state), []);

  // Filters hook
  const {
    systemFilter,
    setSystemFilter,
    environmentFilter,
    setEnvironmentFilter,
    workloadFilter,
    setWorkloadFilter,
    filterOptions,
    hasActiveFilters,
    resetFilters,
    shareFilters,
    setFiltersFromTestRun,
  } = useTestRunsFilters({ organizationId: currentOrganizationId });

  // Server-side filters derived from filter state
  const serverFilters = useMemo(() => ({
    system: systemFilter || undefined,
    environment: environmentFilter || undefined,
    workload: workloadFilter || undefined,
  }), [systemFilter, environmentFilter, workloadFilter]);

  // Data hook with server-side pagination and filtering
  const {
    testRuns,
    loading,
    pageLoading,
    error,
    currentTime,
    pagination,
    setPage,
    setPageSize,
    loadTestRuns,
    monitorJobAndRefresh,
  } = useTestRunsData({ onSnackbar: handleSnackbar, organizationId: currentOrganizationId, serverFilters });

  // Split current page data into running and completed
  const { running: runningTestRuns, completed: completedTestRuns } = useMemo(
    () => separateTestRuns(testRuns),
    [testRuns]
  );

  // Handlers hook
  const {
    selectedTestRunIds,
    batchDeleteDialogOpen,
    refreshDialogOpen,
    availableSources,
    handleSelectAll,
    handleSelectOne,
    handleClearSelection,
    handleBatchReEvaluate,
    handleBatchRefreshClick,
    handleBatchRefreshConfirm,
    handleBatchDeleteClick,
    handleBatchDeleteConfirm,
    handleBatchDeleteCancel,
    handleBatchMarkAsChangepoint,
    handleBatchRemoveChangepoint,
    closeRefreshDialog,
  } = useTestRunsHandlers({
    testRuns,
    onSnackbar: handleSnackbar,
    onLoadTestRuns: loadTestRuns,
    onMonitorJob: async (jobId: string) => { monitorJobAndRefresh(jobId); },
    onSetFiltersFromTestRun: setFiltersFromTestRun,
  });

  const handleShareFilters = async () => {
    const success = await shareFilters();
    handleSnackbar({
      open: true,
      message: success ? 'Filter link copied to clipboard!' : 'Failed to copy link',
    });
  };

  const selectedTestRuns = testRuns.filter(run => selectedTestRunIds.has(run.id));

  if (hasNoOrganizations) {
    return <NoOrganizationMembership />;
  }

  if (isAdmin && !isReady && organizations.length === 0) {
    return <NoOrganizationsExist />;
  }

  // Show prompt if org selection is required but not yet made
  // (read-only users are auto-selected, so they skip this)
  if (!isSelectorReadOnly && !isReady) {
    return (
      <Box sx={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center' }}>
        <Box sx={{ textAlign: 'center' }}>
          <Business sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            Select an organization
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Choose an organization from the sidebar to view test runs.
          </Typography>
        </Box>
      </Box>
    );
  }

  // Loading or error state
  if (loading || error) {
    return <TestRunsEmptyState loading={loading} error={error} />;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} flexShrink={0}>
        <Typography variant="h4" component="h1">
          Test Runs
        </Typography>
        <Box display="flex" gap={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            startIcon={<CloudUpload />}
            onClick={() => setUploadDialogOpen(true)}
          >
            Upload JTL
          </Button>
          {hasActiveFilters && (
            <Tooltip title="Share filtered view">
              <IconButton onClick={handleShareFilters}>
                <Share />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Filters */}
      <TestRunsFilters
        systemFilter={systemFilter}
        environmentFilter={environmentFilter}
        workloadFilter={workloadFilter}
        filterOptions={filterOptions}
        hasActiveFilters={hasActiveFilters}
        onSystemChange={setSystemFilter}
        onEnvironmentChange={setEnvironmentFilter}
        onWorkloadChange={setWorkloadFilter}
        onResetFilters={resetFilters}
      />

      {/* Job Progress Banner */}
      <Box sx={{ flexShrink: 0 }}>
        <JobProgressBanner
          systemFilter={systemFilter}
          environmentFilter={environmentFilter}
          workloadFilter={workloadFilter}
          filteredTestRuns={testRuns}
          onCompleted={loadTestRuns}
          onFailed={(err: string) => handleSnackbar({ open: true, message: `Job failed: ${err}` })}
        />
      </Box>

      {/* Batch Actions Toolbar */}
      {selectedTestRunIds.size > 0 && (
        <BatchActionsToolbar
          selectedCount={selectedTestRunIds.size}
          selectedTestRuns={selectedTestRuns}
          onReEvaluate={handleBatchReEvaluate}
          onRefresh={handleBatchRefreshClick}
          onMarkChangepoint={handleBatchMarkAsChangepoint}
          onRemoveChangepoint={handleBatchRemoveChangepoint}
          onDelete={handleBatchDeleteClick}
          onClearSelection={handleClearSelection}
        />
      )}

      {/* Running Tests Section */}
      {runningTestRuns.length > 0 && (
        <TestRunsTable
          testRuns={runningTestRuns}
          selectedTestRunIds={selectedTestRunIds}
          currentTime={currentTime}
          systemFilter={systemFilter}
          environmentFilter={environmentFilter}
          workloadFilter={workloadFilter}
          variant="running"
          onSelectAll={() => handleSelectAll(testRuns)}
          onSelectOne={handleSelectOne}
          showToast={(msg) => handleSnackbar({ open: true, message: msg })}
          onRefresh={loadTestRuns}
        />
      )}

      {/* Completed Tests Section */}
      <TestRunsTable
        testRuns={completedTestRuns}
        selectedTestRunIds={selectedTestRunIds}
        currentTime={currentTime}
        systemFilter={systemFilter}
        environmentFilter={environmentFilter}
        workloadFilter={workloadFilter}
        variant="completed"
        onSelectAll={() => handleSelectAll(testRuns)}
        onSelectOne={handleSelectOne}
        pagination={pagination}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        pageLoading={pageLoading}
      />

      {/* Toast Notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />

      {/* Batch Delete Confirmation Dialog */}
      <Dialog open={batchDeleteDialogOpen} onClose={handleBatchDeleteCancel}>
        <DialogTitle>Delete Multiple Test Runs</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete {selectedTestRunIds.size} test run{selectedTestRunIds.size > 1 ? 's' : ''}? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleBatchDeleteCancel}>Cancel</Button>
          <Button onClick={handleBatchDeleteConfirm} color="error" variant="contained">
            Delete {selectedTestRunIds.size} Test Run{selectedTestRunIds.size > 1 ? 's' : ''}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Refresh Missing Data Dialog */}
      <RefreshMissingDataDialog
        open={refreshDialogOpen}
        onClose={closeRefreshDialog}
        onConfirm={(sources) => {
          handleBatchRefreshConfirm(sources);
        }}
        title={selectedTestRunIds.size > 1
          ? `Re-fetch Missing Data (${selectedTestRunIds.size} test runs)`
          : 'Re-fetch Missing Data'}
        availableSources={availableSources}
      />

      {/* JTL Upload Dialog */}
      <JtlUploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        onSuccess={loadTestRuns}
        filterOptions={filterOptions}
      />
    </Box>
  );
}
