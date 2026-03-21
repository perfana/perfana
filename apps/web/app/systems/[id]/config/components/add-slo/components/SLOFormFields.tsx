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
import { SLOFormData, ValidationErrors, DataSourceAvailability } from '../types';
import { getSourceOptions, getSourceOption } from '../utils/slo-formatters';

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
  availablePerfMetricsDashboards: any[];
  availablePerfMetricsPanels: any[];
  dataSourceAvailability: DataSourceAvailability;
  systemName: string;
  environment: string;
  workload: string;
  handleSourceChange: (sourceValue: string) => void;
  fetchDashboardPanels: (dashboardUid: string) => Promise<void>;
  fetchPerfMetricsPanels: (dashboardUid: string) => Promise<void>;
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
  availablePerfMetricsDashboards,
  availablePerfMetricsPanels,
  dataSourceAvailability,
  systemName,
  environment,
  workload,
  handleSourceChange,
  fetchDashboardPanels,
  fetchPerfMetricsPanels,
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

  const sourceOptions = getSourceOptions(dataSourceAvailability);

  return (
    <>
      {/* Source Selection */}
      <Grid item xs={12}>
        <Autocomplete
          options={sourceOptions}
          getOptionLabel={(option) => option.label}
          value={getSourceOption(sloFormData.source)}
          onChange={(_, newValue) => {
            handleSourceChange(newValue?.value || '');
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Source"
              variant="outlined"
              fullWidth
              required
              helperText="Select the data source for this SLO"
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
            renderInput={(params) => (
              <TextField
                {...params}
                label="Dashboard"
                variant="outlined"
                fullWidth
                required
                error={!!validationErrors.selectedDashboard}
                helperText={
                  validationErrors.selectedDashboard ||
                  (dashboardsLoading
                    ? 'Loading dashboards...'
                    : `Select dashboard for ${systemName} - ${environment} (${availableDashboards.length} available)`)
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

      {/* Grafana Panel Selection */}
      {sloFormData.source === 'grafana' && sloFormData.selectedDashboard && (
        <Grid item xs={12}>
          <Autocomplete
            options={availablePanels}
            getOptionLabel={(option) => option.title}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            value={sloFormData.selectedPanel}
            onChange={(_, newValue) => {
              setSloFormData((prev) => ({
                ...prev,
                selectedPanel: newValue,
              }));
              clearValidationError('selectedPanel');
            }}
            loading={panelsLoading}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Metric"
                variant="outlined"
                fullWidth
                required
                error={!!validationErrors.selectedPanel}
                helperText={
                  validationErrors.selectedPanel ||
                  (panelsLoading ? 'Loading metrics...' : `Select metric from ${sloFormData.selectedDashboard?.dashboard_label}`)
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
                <Box component="li" key={`panel-${option.id}`} {...otherProps}>
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

      {/* Dynatrace Dashboard Selection */}
      {sloFormData.source === 'dynatrace' && (
        <Grid item xs={12}>
          <Autocomplete
            options={availableDynatraceDashboards}
            getOptionLabel={(option) => option.dashboardLabel}
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
            renderInput={(params) => (
              <TextField
                {...params}
                label="Dashboard"
                variant="outlined"
                fullWidth
                required
                error={!!validationErrors.selectedDashboard}
                helperText={
                  validationErrors.selectedDashboard ||
                  (dashboardsLoading
                    ? 'Loading dashboards...'
                    : `Select Dynatrace dashboard for ${systemName} - ${environment} - ${workload} (${availableDynatraceDashboards.length} available)`)
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
            renderInput={(params) => (
              <TextField
                {...params}
                label="Metric"
                variant="outlined"
                fullWidth
                required
                error={!!validationErrors.selectedPanel}
                helperText={
                  validationErrors.selectedPanel ||
                  (panelsLoading ? 'Loading metrics...' : `Select metric from ${sloFormData.selectedDashboard?.dashboardLabel}`)
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

      {/* Performance Metrics Dashboard Selection */}
      {sloFormData.source === 'performance-metrics' && (
        <Grid item xs={12}>
          <Autocomplete
            options={availablePerfMetricsDashboards}
            getOptionLabel={(option) => option.dashboard_label || ''}
            value={sloFormData.selectedDashboard}
            onChange={(_, newValue) => {
              setSloFormData((prev) => ({
                ...prev,
                selectedDashboard: newValue,
                selectedPanel: null,
              }));
              if (newValue?.dashboard_uid) {
                fetchPerfMetricsPanels(newValue.dashboard_uid);
              }
              clearValidationError('selectedDashboard');
            }}
            loading={dashboardsLoading}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Dashboard"
                variant="outlined"
                fullWidth
                required
                error={!!validationErrors.selectedDashboard}
                helperText={
                  validationErrors.selectedDashboard ||
                  (dashboardsLoading
                    ? 'Loading dashboards...'
                    : `Select Performance metrics dashboard for ${systemName} - ${environment} (${availablePerfMetricsDashboards.length} available)`)
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

      {/* Performance Metrics Panel Selection */}
      {sloFormData.source === 'performance-metrics' && sloFormData.selectedDashboard && (
        <Grid item xs={12}>
          <Autocomplete
            options={availablePerfMetricsPanels}
            getOptionLabel={(option) => option.title || ''}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            value={sloFormData.selectedPanel}
            onChange={(_, newValue) => {
              setSloFormData((prev) => ({
                ...prev,
                selectedPanel: newValue,
              }));
              clearValidationError('selectedPanel');
            }}
            loading={panelsLoading}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Metric"
                variant="outlined"
                fullWidth
                required
                error={!!validationErrors.selectedPanel}
                helperText={
                  validationErrors.selectedPanel ||
                  (panelsLoading ? 'Loading metrics...' : `Select metric from ${sloFormData.selectedDashboard?.dashboard_label}`)
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
                <Box component="li" key={`perf-panel-${option.id}`} {...otherProps}>
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
