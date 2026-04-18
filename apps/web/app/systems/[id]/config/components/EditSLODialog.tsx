'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Grid,
  Typography,
  Box,
  CircularProgress,
} from '@mui/material';

// Types
import { EditSLODialogProps } from './edit-slo/types';

// Hooks
import { useEditSLOForm, useEditSLOHandlers } from './edit-slo/hooks';

// Components
import { SLOFormFields, SLOThresholdConfig, SLOSaveDialog } from './edit-slo/components';

export default function EditSLODialog({
  open,
  onClose,
  benchmark,
  systemId,
  systemName,
  environment,
  workload,
  onSLOUpdated,
}: EditSLODialogProps) {
  // Form state hook
  const {
    sloFormData,
    setSloFormData,
    validationErrors,
    setValidationErrors,
    loadingStates,
    availableOptions,
    showSaveDialog,
    setShowSaveDialog,
    saveDialogOption,
    setSaveDialogOption,
    fetchDashboardPanels,
    fetchSloApplicationDashboards,
    fetchDynatraceDashboardsForSlo,
    fetchDynatraceMetricsForSlo,
  } = useEditSLOForm({
    open,
    benchmark,
    systemId,
    systemName,
    environment,
    workload,
  });

  // Local loading state for form submission
  const [sloFormLoading, setSloFormLoading] = useState(false);

  // Handlers hook
  const {
    handleCloseSloForm,
    handleSaveClick,
    handleSaveDialogConfirm,
    isFormValid,
  } = useEditSLOHandlers({
    benchmark,
    systemId,
    environment,
    workload,
    sloFormData,
    setSloFormData,
    validationErrors,
    setValidationErrors,
    setSloFormLoading,
    setShowSaveDialog,
    saveDialogOption,
    setSaveDialogOption,
    onSLOUpdated,
    onClose,
  });

  if (!benchmark) return null;

  return (
    <Dialog open={open} onClose={handleCloseSloForm} maxWidth="md" fullWidth>
      <DialogTitle>
        Edit Service Level Objective
        <Typography variant="body2" color="text.secondary">
          Edit SLO for {systemName} - {environment} - {workload}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 2 }}>
          <Grid container spacing={3}>
            {/* Source, Dashboard, Panel Selection */}
            <SLOFormFields
              sloFormData={sloFormData}
              setSloFormData={setSloFormData}
              validationErrors={validationErrors}
              setValidationErrors={setValidationErrors}
              dashboardsLoading={loadingStates.dashboardsLoading}
              panelsLoading={loadingStates.panelsLoading}
              availableDashboards={availableOptions.availableDashboards}
              availablePanels={availableOptions.availablePanels}
              availableDynatraceDashboards={availableOptions.availableDynatraceDashboards}
              availableDynatraceMetrics={availableOptions.availableDynatraceMetrics}
              fetchSloApplicationDashboards={fetchSloApplicationDashboards}
              fetchDynatraceDashboardsForSlo={fetchDynatraceDashboardsForSlo}
              fetchDashboardPanels={fetchDashboardPanels}
              fetchDynatraceMetricsForSlo={fetchDynatraceMetricsForSlo}
            />

            {/* Threshold Configuration */}
            <SLOThresholdConfig
              sloFormData={sloFormData}
              setSloFormData={setSloFormData}
              validationErrors={validationErrors}
              setValidationErrors={setValidationErrors}
            />
          </Grid>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCloseSloForm}>Cancel</Button>
        <Button
          onClick={handleSaveClick}
          variant="contained"
          disabled={!isFormValid() || sloFormLoading}
          startIcon={sloFormLoading ? <CircularProgress size={16} /> : null}
        >
          {sloFormLoading ? 'Updating SLO...' : 'Update SLO'}
        </Button>
      </DialogActions>

      {/* Save Configuration Dialog */}
      <SLOSaveDialog
        open={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        onConfirm={handleSaveDialogConfirm}
        selectedOption={saveDialogOption}
        onOptionChange={setSaveDialogOption}
        loading={sloFormLoading}
      />
    </Dialog>
  );
}
