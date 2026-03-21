'use client';

import React from 'react';
import {
  Grid,
  Typography,
  Box,
  TextField,
  CircularProgress,
  Autocomplete,
} from '@mui/material';
import { SLOFormData, ValidationErrors } from '../types';
import { SOURCE_OPTIONS, getSourceOption } from '../utils/slo-formatters';

interface SLOFormFieldsProps {
  sloFormData: SLOFormData;
  setSloFormData: React.Dispatch<React.SetStateAction<SLOFormData>>;
  validationErrors: ValidationErrors;
  setValidationErrors: React.Dispatch<React.SetStateAction<ValidationErrors>>;
  dashboardsLoading: boolean;
  panelsLoading: boolean;
  availableDashboards: any[];
  availablePanels: any[];
  availableDynatraceDashboards: any[];
  availableDynatraceMetrics: any[];
  fetchSloApplicationDashboards: () => Promise<void>;
  fetchDynatraceDashboardsForSlo: () => Promise<void>;
  fetchDashboardPanels: (dashboardUid: string) => Promise<void>;
  fetchDynatraceMetricsForSlo: (dashboardLabel: string) => Promise<void>;
}

export function SLOFormFields({
  sloFormData,
  setSloFormData,
  validationErrors,
  setValidationErrors,
  dashboardsLoading,
  panelsLoading,
  availableDashboards,
  availablePanels,
  availableDynatraceDashboards,
  availableDynatraceMetrics,
  fetchSloApplicationDashboards,
  fetchDynatraceDashboardsForSlo,
  fetchDashboardPanels,
  fetchDynatraceMetricsForSlo,
}: SLOFormFieldsProps) {
  const clearValidationError = (field: string) => {
    if (validationErrors[field]) {
      setValidationErrors((prev) => {
        const { [field]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  return (
    <>
      {/* Source Selection */}
      <Grid item xs={12}>
        <Autocomplete
          options={SOURCE_OPTIONS}
          getOptionLabel={(option) => option.label}
          value={getSourceOption(sloFormData.source)}
          onChange={(_, newValue) => {
            const sourceValue = newValue?.value || '';
            setSloFormData((prev) => ({
              ...prev,
              source: sourceValue,
              selectedDashboard: null,
              selectedPanel: null,
            }));
            if (sourceValue === 'grafana') {
              fetchSloApplicationDashboards();
            } else if (sourceValue === 'dynatrace') {
              fetchDynatraceDashboardsForSlo();
            }
          }}
          disabled={true} // Always disabled in edit mode
          renderInput={(params) => (
            <TextField
              {...params}
              label="Source"
              variant="outlined"
              fullWidth
              required
              disabled={true}
              helperText="Source cannot be changed when editing existing SLO"
            />
          )}
          renderOption={(props, option) => {
            const { key, ...otherProps } = props;
            return (
              <Box component="li" key={key} {...otherProps}>
                <Typography variant="body1">{option.label}</Typography>
              </Box>
            );
          }}
        />
      </Grid>

      {/* Grafana Dashboard Selection */}
      {sloFormData.source === 'grafana' && (
        <Grid item xs={12}>
          <Autocomplete
            options={availableDashboards}
            getOptionLabel={(option) => option.dashboard_label || ''}
            value={sloFormData.selectedDashboard}
            onChange={(_, newValue) => {
              setSloFormData((prev) => ({
                ...prev,
                selectedDashboard: newValue,
                selectedPanel: null,
              }));
              if (newValue?.dashboard_uid) {
                fetchDashboardPanels(newValue.dashboard_uid);
              }
              clearValidationError('selectedDashboard');
            }}
            loading={dashboardsLoading}
            disabled={true} // Always disabled in edit mode
            renderInput={(params) => (
              <TextField
                {...params}
                label="Dashboard"
                variant="outlined"
                fullWidth
                required
                disabled={true}
                error={!!validationErrors.selectedDashboard}
                helperText={
                  validationErrors.selectedDashboard ||
                  'Dashboard cannot be changed when editing existing SLO'
                }
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {dashboardsLoading ? <CircularProgress size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={key} {...otherProps}>
                  <Box>
                    <Typography variant="body1">{option.dashboard_label}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {option.dashboard_name} - UID: {option.dashboard_uid}
                    </Typography>
                  </Box>
                </Box>
              );
            }}
          />
        </Grid>
      )}

      {/* Dynatrace Dashboard Selection */}
      {sloFormData.source === 'dynatrace' && (
        <Grid item xs={12}>
          <Autocomplete
            options={availableDynatraceDashboards}
            getOptionLabel={(option) => option.dashboardLabel || ''}
            value={sloFormData.selectedDashboard}
            onChange={(_, newValue) => {
              setSloFormData((prev) => ({
                ...prev,
                selectedDashboard: newValue,
                selectedPanel: null,
              }));
              if (newValue?.dashboardLabel) {
                fetchDynatraceMetricsForSlo(newValue.dashboardLabel);
              }
              clearValidationError('selectedDashboard');
            }}
            loading={dashboardsLoading}
            disabled={true} // Always disabled in edit mode
            renderInput={(params) => (
              <TextField
                {...params}
                label="Dashboard"
                variant="outlined"
                fullWidth
                required
                disabled={true}
                error={!!validationErrors.selectedDashboard}
                helperText={
                  validationErrors.selectedDashboard ||
                  'Dashboard cannot be changed when editing existing SLO'
                }
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {dashboardsLoading ? <CircularProgress size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={key} {...otherProps}>
                  <Box>
                    <Typography variant="body1">{option.dashboardLabel}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Dynatrace DQL Dashboard
                    </Typography>
                  </Box>
                </Box>
              );
            }}
          />
        </Grid>
      )}

      {/* Dynatrace Metrics Selection */}
      {sloFormData.source === 'dynatrace' && sloFormData.selectedDashboard && (
        <Grid item xs={12}>
          <Autocomplete
            options={availableDynatraceMetrics}
            getOptionLabel={(option) => option.panelTitle}
            value={sloFormData.selectedPanel}
            onChange={(_, newValue) => {
              setSloFormData((prev) => ({
                ...prev,
                selectedPanel: newValue,
              }));
              clearValidationError('selectedPanel');
            }}
            loading={panelsLoading}
            disabled={true} // Always disabled in edit mode
            renderInput={(params) => (
              <TextField
                {...params}
                label="Metric"
                variant="outlined"
                fullWidth
                required
                disabled={true}
                error={!!validationErrors.selectedPanel}
                helperText={
                  validationErrors.selectedPanel || 'Metric cannot be changed when editing existing SLO'
                }
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {panelsLoading ? <CircularProgress size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={key} {...otherProps}>
                  <Box>
                    <Typography variant="body1">{option.panelTitle}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Dynatrace DQL Metric
                    </Typography>
                  </Box>
                </Box>
              );
            }}
          />
        </Grid>
      )}

      {/* Grafana Panel Selection */}
      {sloFormData.source === 'grafana' && sloFormData.selectedDashboard && (
        <Grid item xs={12}>
          <Autocomplete
            options={availablePanels}
            getOptionLabel={(option) => option.title}
            value={sloFormData.selectedPanel}
            onChange={(_, newValue) => {
              setSloFormData((prev) => ({
                ...prev,
                selectedPanel: newValue,
              }));
              clearValidationError('selectedPanel');
            }}
            loading={panelsLoading}
            disabled={true} // Always disabled in edit mode
            renderInput={(params) => (
              <TextField
                {...params}
                label="Metric"
                variant="outlined"
                fullWidth
                required
                disabled={true}
                error={!!validationErrors.selectedPanel}
                helperText={
                  validationErrors.selectedPanel || 'Metric cannot be changed when editing existing SLO'
                }
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {panelsLoading ? <CircularProgress size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={key} {...otherProps}>
                  <Box>
                    <Typography variant="body1">{option.title}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Type: {option.type} - ID: {option.id}
                    </Typography>
                  </Box>
                </Box>
              );
            }}
          />
        </Grid>
      )}
    </>
  );
}
