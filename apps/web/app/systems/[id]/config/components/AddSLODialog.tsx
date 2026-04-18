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
import { AddSLODialogProps } from './add-slo/types';

// Hooks
import { useAddSLOForm, useAddSLOHandlers } from './add-slo/hooks';

// Components
import { SLOFormFields, SLOThresholdConfig } from './add-slo/components';

export default function AddSLODialog({
  open,
  onClose,
  systemId,
  systemName,
  environment,
  workload,
  onSLOCreated,
}: AddSLODialogProps) {
  // Form state hook
  const {
    sloFormData,
    setSloFormData,
    validationErrors,
    setValidationErrors,
    loadingStates,
    _setLoadingStates,
    availableOptions,
    dataSourceAvailability,
    fetchDashboardPanels,
    fetchPerfMetricsPanels,
    fetchDynatraceMetricsForSlo,
    handleSourceChange,
  } = useAddSLOForm({
    open,
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
    createSlo,
    isFormValid,
  } = useAddSLOHandlers({
    systemId,
    systemName,
    environment,
    workload,
    sloFormData,
    setValidationErrors,
    setSloFormLoading,
    onSLOCreated,
    onClose,
  });

  return (
    <Dialog open={open} onClose={handleCloseSloForm} maxWidth="md" fullWidth>
      <DialogTitle>
        Add Service Level Objective
        <Typography variant="body2" color="text.secondary">
          Create a new SLO for {systemName} - {environment} - {workload}
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
              availablePerfMetricsDashboards={availableOptions.availablePerfMetricsDashboards}
              availablePerfMetricsPanels={availableOptions.availablePerfMetricsPanels}
              dataSourceAvailability={dataSourceAvailability}
              systemName={systemName}
              environment={environment}
              workload={workload}
              handleSourceChange={handleSourceChange}
              fetchDashboardPanels={fetchDashboardPanels}
              fetchPerfMetricsPanels={fetchPerfMetricsPanels}
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
          onClick={createSlo}
          variant="contained"
          disabled={!isFormValid() || sloFormLoading}
          startIcon={sloFormLoading ? <CircularProgress size={16} /> : null}
        >
          {sloFormLoading ? 'Creating SLO...' : 'Create SLO'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
