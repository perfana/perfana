'use client';

import React from 'react';
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
import { BaselineApdexDialogProps } from './types';

// Hooks
import { useBaselineApdex } from './hooks';

// Components
import {
  TargetApdexInput,
  ScopeSelector,
  WorkloadSummaryCard,
  TransactionPreviewTable,
} from './components';

/**
 * Dialog for reverse-engineering Apdex thresholds from test run results.
 * Calculates what thresholds would achieve a target Apdex score.
 */
export default function BaselineApdexDialog({
  open,
  onClose,
  testRunId,
  onSuccess,
}: BaselineApdexDialogProps) {
  const {
    // Form state
    targetApdex,
    scope,

    // Test run details
    testRunDetails,
    loadingTestRun,

    // API state
    previewData,
    previewLoading,
    applyLoading,
    error,
    success,

    // Table state
    sortBy,
    sortDirection,

    // Computed values
    groupedItems,
    scenarioNames,

    // Handlers
    handleTargetApdexChange,
    handleScopeChange,
    handleCalculatePreview,
    handleApplyThresholds,
    handleSort,
    clearError,
  } = useBaselineApdex({
    open,
    testRunId,
    onSuccess,
    onClose,
  });

  const getSubtitle = () => {
    if (loadingTestRun) return 'Loading...';
    if (testRunDetails) {
      return `Reverse-engineer thresholds for ${testRunDetails.system_name} - ${testRunDetails.test_environment} - ${testRunDetails.workload}`;
    }
    return 'Reverse-engineer thresholds from test run results';
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        Set Baseline Apdex
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {getSubtitle()}
        </Typography>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ pt: 2 }}>
          {/* Error Alert */}
          {error && (
            <Alert severity="error" sx={{ mb: 3 }} onClose={clearError}>
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
          <TargetApdexInput
            targetApdex={targetApdex}
            onTargetApdexChange={handleTargetApdexChange}
          />

          {/* Scope Selection Section */}
          <ScopeSelector scope={scope} onScopeChange={handleScopeChange} />

          {/* Calculate Preview Button */}
          <Box sx={{ mb: 3 }}>
            <Button
              variant="contained"
              onClick={handleCalculatePreview}
              disabled={previewLoading || success}
              startIcon={previewLoading ? <CircularProgress size={20} /> : null}
              fullWidth
            >
              {previewLoading ? 'Calculating...' : 'Calculate Preview'}
            </Button>
          </Box>

          {/* Preview Results Section */}
          {previewData && (
            <Box>
              {/* Summary Card (Workload-level only) */}
              {previewData.scope === 'workload' && previewData.workload_summary && (
                <WorkloadSummaryCard summary={previewData.workload_summary} />
              )}

              {/* Preview Tables Grouped by Scenario */}
              <TransactionPreviewTable
                scenarioNames={scenarioNames}
                groupedItems={groupedItems}
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={applyLoading}>
          Cancel
        </Button>
        <Button
          onClick={handleApplyThresholds}
          variant="contained"
          disabled={!previewData || applyLoading || success}
          startIcon={applyLoading ? <CircularProgress size={16} /> : null}
        >
          {applyLoading ? 'Applying...' : 'Apply Thresholds'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
