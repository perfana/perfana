'use client';

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';

// Types
import { ApdexThresholdsManagementDialogProps } from './types/apdex-thresholds.types';

// Hooks
import { useApdexThresholdsManagement } from './hooks';

// Components
import {
  ApdexTargetSelector,
  ApdexScopeSelector,
  ApdexWorkloadSummary,
  ApdexTransactionTable,
} from './components';
import { SLOSaveDialog } from '@/app/systems/[id]/config/components/edit-slo/components';

export default function ApdexThresholdsManagementDialog({
  open,
  onClose,
  testRunId,
  apdexCheckResult,
  onSuccess,
}: ApdexThresholdsManagementDialogProps) {
  const {
    // Form state
    targetApdex,
    setTargetApdex,
    scope,
    handleScopeChange,

    // Test run details
    testRunDetails,
    loadingTestRun,

    // API state
    previewData,
    previewLoading,
    applyLoading,
    error,
    setError,
    success,

    // Threshold overrides
    thresholdOverrides,
    workloadThresholdOverride,
    handleThresholdOverride,
    handleWorkloadThresholdOverride,

    // Re-evaluation
    reEvaluateOption,
    setReEvaluateOption,

    // Sorting
    sortBy,
    sortDirection,
    handleSort,

    // Actions
    handleCalculatePreview,
    handleApplyThresholds,
    saveDialogOpen,
    handleOpenSaveDialog,
    handleCloseSaveDialog,

    // Utilities
    getGroupedItems,
    getScenarioNames,
    hasAnyOverrides,
  } = useApdexThresholdsManagement({
    open,
    testRunId,
    apdexCheckResult,
    onSuccess,
    onClose,
  });

  // Handler to clear preview data (passed to target selector)
  const handlePreviewDataClear = () => {
    // The hook already handles clearing preview data when target changes
  };

  return (
    <>
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        Configure Apdex Thresholds
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {loadingTestRun ? 'Loading...' : testRunDetails
            ? `Set thresholds for ${testRunDetails.system_name} - ${testRunDetails.test_environment} - ${testRunDetails.workload}`
            : 'Set response time thresholds based on target Apdex score'}
        </Typography>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ pt: 2 }}>
          {/* Error Alert */}
          {error && (
            <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Success Alert */}
          {success && (
            <Alert severity="success" sx={{ mb: 3 }}>
              Thresholds applied successfully!
            </Alert>
          )}

          {/* Target Apdex Score Section */}
          <ApdexTargetSelector
            targetApdex={targetApdex}
            onTargetApdexChange={setTargetApdex}
            onPreviewDataClear={handlePreviewDataClear}
          />

          {/* Scope Selection */}
          <ApdexScopeSelector
            scope={scope}
            onScopeChange={handleScopeChange}
          />

          {/* Calculate Preview Button */}
          <Box sx={{ mb: 3 }}>
            <Button
              variant="contained"
              onClick={handleCalculatePreview}
              disabled={previewLoading || success}
              startIcon={previewLoading ? <CircularProgress size={20} /> : null}
              fullWidth
            >
              {previewLoading ? 'Calculating...' : 'Calculate Thresholds'}
            </Button>
          </Box>

          {/* Preview Results */}
          {previewData && (
            <Box>
              {/* Workload Summary Card */}
              {previewData.workload_summary && (
                <ApdexWorkloadSummary
                  summary={previewData.workload_summary}
                  scope={scope}
                  workloadThresholdOverride={workloadThresholdOverride}
                  onWorkloadThresholdOverride={handleWorkloadThresholdOverride}
                />
              )}

              {/* Transaction Details Table */}
              <ApdexTransactionTable
                items={previewData.items}
                scope={scope}
                sortBy={sortBy}
                sortDirection={sortDirection}
                thresholdOverrides={thresholdOverrides}
                onSort={handleSort}
                onThresholdOverride={handleThresholdOverride}
                getGroupedItems={getGroupedItems}
                getScenarioNames={getScenarioNames}
              />
            </Box>
          )}

          {/* Manual Override Indicator */}
          {previewData && hasAnyOverrides && (
            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="body2">
                You have manually modified {scope === 'workload' && workloadThresholdOverride !== null
                  ? 'the workload threshold'
                  : `${Object.keys(thresholdOverrides).length} transaction threshold${Object.keys(thresholdOverrides).length !== 1 ? 's' : ''}`
                }. These custom values will be applied instead of the calculated values.
              </Typography>
            </Alert>
          )}

        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={applyLoading}>
          Cancel
        </Button>
        <Button
          onClick={handleOpenSaveDialog}
          variant="contained"
          color={hasAnyOverrides ? 'warning' : 'primary'}
          disabled={!previewData || applyLoading || success}
          startIcon={applyLoading ? <CircularProgress size={16} /> : null}
        >
          {applyLoading
            ? 'Applying...'
            : hasAnyOverrides
              ? 'Apply Custom Thresholds'
              : 'Apply Thresholds'}
        </Button>
      </DialogActions>
    </Dialog>

    {/* Applying thresholds invalidates existing analysis — same choice the SLO editor offers. */}
    <SLOSaveDialog
      open={saveDialogOpen}
      onClose={handleCloseSaveDialog}
      onConfirm={handleApplyThresholds}
      selectedOption={reEvaluateOption}
      onOptionChange={setReEvaluateOption}
      loading={applyLoading}
    />
    </>
  );
}
