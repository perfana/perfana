'use client';

import React from 'react';
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
  Alert,
} from '@mui/material';

// Types
import { BenchmarkFormDialogProps } from './types';

// Hooks
import { useBenchmarkForm } from './hooks';

// Components
import {
  DashboardSelectField,
  PanelSelectField,
  SloConfigFields,
  MetadataFields,
  AdvancedOptionsFields,
} from './components';

/**
 * Form dialog for creating or editing profile benchmarks (SLOs)
 * Follows comprehensive patterns from system-under-test SLO dialogs with:
 * - Detailed evaluation type and operator options
 * - Value parsing with unit detection
 * - Panel selection from dashboards
 * - Comprehensive validation
 * - Loading states and error handling
 */
export default function BenchmarkFormDialog({
  open,
  mode,
  benchmark,
  profileDashboards,
  loading: externalLoading,
  onClose,
  onSubmit,
}: BenchmarkFormDialogProps) {
  const {
    formData,
    formLoading,
    panelsLoading,
    availablePanels,
    validationErrors,
    error,
    isFormValid,
    updateFormField,
    handleDashboardSelect,
    handlePanelSelect,
    handleSubmit,
    handleCancel,
  } = useBenchmarkForm({
    mode,
    benchmark,
    profileDashboards,
    open,
    onSubmit,
    onClose,
  });

  return (
    <Dialog open={open} onClose={handleCancel} maxWidth="md" fullWidth>
      <DialogTitle>
        {mode === 'create' ? 'Add Service Level Objective' : 'Edit Service Level Objective'}
        <Typography variant="body2" color="text.secondary">
          {mode === 'create'
            ? 'Create a new SLO for this profile'
            : 'Update the SLO configuration'}
        </Typography>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ pt: 2 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Grid container spacing={3}>
            {/* Section 1: Dashboard & Panel Selection */}
            <DashboardSelectField
              profileDashboards={profileDashboards}
              selectedDashboard={formData.selectedDashboard}
              onSelect={handleDashboardSelect}
              loading={externalLoading}
              error={validationErrors.selectedDashboard}
            />

            {formData.selectedDashboard && (
              <PanelSelectField
                panels={availablePanels}
                selectedPanel={formData.selectedPanel}
                onSelect={handlePanelSelect}
                loading={panelsLoading}
                error={validationErrors.selectedPanel}
                dashboardName={formData.selectedDashboard.dashboardName}
              />
            )}

            {/* Section 2: SLO Configuration */}
            {formData.selectedPanel && (
              <>
                <SloConfigFields
                  evaluateType={formData.evaluateType}
                  requirementOperator={formData.requirementOperator}
                  requirementValue={formData.requirementValue}
                  selectedPanel={formData.selectedPanel}
                  validationErrors={validationErrors}
                  onEvaluateTypeChange={(value) => updateFormField('evaluateType', value)}
                  onOperatorChange={(value) => updateFormField('requirementOperator', value)}
                  onValueChange={(value) => updateFormField('requirementValue', value)}
                />

                {/* Section 3: Metadata */}
                <MetadataFields
                  workloadPattern={formData.workloadPattern}
                  tags={formData.tags}
                  onWorkloadPatternChange={(value) => updateFormField('workloadPattern', value)}
                  onTagsChange={(tags) => updateFormField('tags', tags)}
                />

                {/* Section 4: Advanced Options */}
                <AdvancedOptionsFields
                  excludeRampUpTime={formData.excludeRampUpTime}
                  averageAll={formData.averageAll}
                  matchPattern={formData.matchPattern}
                  validateWithDefaultIfNoData={formData.validateWithDefaultIfNoData}
                  validateWithDefaultIfNoDataValue={formData.validateWithDefaultIfNoDataValue}
                  selectedPanel={formData.selectedPanel}
                  validationErrors={validationErrors}
                  onExcludeRampUpTimeChange={(value) => updateFormField('excludeRampUpTime', value)}
                  onAverageAllChange={(value) => updateFormField('averageAll', value)}
                  onMatchPatternChange={(value) => updateFormField('matchPattern', value)}
                  onValidateWithDefaultChange={(value) => updateFormField('validateWithDefaultIfNoData', value)}
                  onDefaultValueChange={(value) => updateFormField('validateWithDefaultIfNoDataValue', value)}
                />
              </>
            )}
          </Grid>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleCancel} disabled={formLoading}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!isFormValid() || formLoading}
          startIcon={formLoading ? <CircularProgress size={16} /> : null}
        >
          {formLoading
            ? (mode === 'create' ? 'Creating SLO...' : 'Updating SLO...')
            : (mode === 'create' ? 'Create SLO' : 'Update SLO')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
