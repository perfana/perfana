'use client';

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  FormControlLabel,
  Checkbox,
  Alert,
  CircularProgress,
} from '@mui/material';

// Types
import { DashboardFormDialogProps } from './types';

// Hooks
import { useDashboardForm } from './hooks';

// Components
import {
  GrafanaInstanceSelect,
  DashboardSelect,
  VariablesInfoBox,
  SeparateDashboardField,
  HardcodedVariablesSection,
  RegexRulesSection,
} from './components';

/**
 * Form dialog for creating or editing profile dashboard associations
 * Follows Material-UI design patterns with proper validation and error handling
 */
export default function DashboardFormDialog({
  open,
  mode,
  dashboard,
  availableDashboards,
  availableInstances,
  loading: externalLoading,
  onClose,
  onSubmit,
}: DashboardFormDialogProps) {
  const {
    // State
    formData,
    submitting,
    error,
    currentInputValues,

    // Derived data
    filteredDashboards,
    selectedDashboard,
    availableVariableNames,
    isFormValid,

    // Form field handlers
    updateGrafanaLabel,
    updateDashboardUid,
    updateSeparateDashboardVariable,
    updateReadOnly,

    // Hardcoded variables handlers
    handleAddHardcodedVariable,
    handleRemoveHardcodedVariable,
    handleHardcodedVariableChange,
    handleAddPendingValueOnBlur,
    updateCurrentInputValue,
    clearCurrentInputValue,

    // Regex rules handlers
    handleAddRegexRule,
    handleRemoveRegexRule,
    handleRegexRuleChange,

    // Form actions
    handleSubmit,
    handleClose,
  } = useDashboardForm({
    mode,
    dashboard,
    availableDashboards,
    availableInstances,
    open,
    onSubmit,
    onClose,
  });

  const isDisabled = submitting || externalLoading;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {mode === 'create' ? 'Add Dashboard to Profile' : 'Edit Dashboard Configuration'}
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2 }}>
          {/* Grafana Instance Selection */}
          <GrafanaInstanceSelect
            value={formData.grafanaLabel}
            instances={availableInstances}
            disabled={isDisabled}
            onChange={updateGrafanaLabel}
          />

          {/* Dashboard Selection */}
          <DashboardSelect
            dashboards={filteredDashboards}
            selectedDashboard={selectedDashboard}
            grafanaLabel={formData.grafanaLabel}
            loading={externalLoading}
            disabled={isDisabled}
            onChange={updateDashboardUid}
          />

          {/* Dashboard Variables Info Box */}
          {selectedDashboard && (
            <VariablesInfoBox variables={availableVariableNames} />
          )}

          {/* Separate Dashboard For Variable */}
          <SeparateDashboardField
            value={formData.createSeparateDashboardForVariable}
            variables={availableVariableNames}
            selectedDashboard={selectedDashboard}
            disabled={submitting}
            onChange={updateSeparateDashboardVariable}
          />

          {/* Hardcoded Variables */}
          <HardcodedVariablesSection
            variables={formData.hardcodedVariables}
            availableVariableNames={availableVariableNames}
            selectedDashboard={selectedDashboard}
            currentInputValues={currentInputValues}
            disabled={submitting}
            onAdd={handleAddHardcodedVariable}
            onRemove={handleRemoveHardcodedVariable}
            onChange={handleHardcodedVariableChange}
            onBlur={handleAddPendingValueOnBlur}
            onInputChange={updateCurrentInputValue}
            onClearInput={clearCurrentInputValue}
          />

          {/* Regex Rules */}
          <RegexRulesSection
            rules={formData.regexRules}
            availableVariableNames={availableVariableNames}
            selectedDashboard={selectedDashboard}
            disabled={submitting}
            onAdd={handleAddRegexRule}
            onRemove={handleRemoveRegexRule}
            onChange={handleRegexRuleChange}
          />

          {/* Read-only Checkbox */}
          <FormControlLabel
            control={
              <Checkbox
                checked={formData.readOnly}
                onChange={(e) => updateReadOnly(e.target.checked)}
                disabled={submitting}
              />
            }
            label="Read-only configuration"
          />
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={submitting || !isFormValid}
        >
          {submitting ? (
            <CircularProgress size={24} />
          ) : mode === 'create' ? (
            'Add Dashboard'
          ) : (
            'Save Changes'
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
