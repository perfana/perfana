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
  availableDashboards: unknown[];
  availablePanels: unknown[];
  availableDynatraceDashboards: unknown[];
  availableDynatraceMetrics: unknown[];
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
      <Grid size={{ xs: 12 }}>
        <Autocomplete
          options={(() => {
            const currentOption = getSourceOption(sloFormData.source);
            if (currentOption && !SOURCE_OPTIONS.find(o => o.value === currentOption.value)) {
              return [...SOURCE_OPTIONS, currentOption];
            }
            return SOURCE_OPTIONS;
          })()}
          getOptionLabel={(option) => option.label}
          isOptionEqualToValue={(option, value) => option.value === value?.value}
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
        <Grid size={{ xs: 12 }}>
          <Autocomplete
            options={availableDashboards.length > 0 ? availableDashboards : (sloFormData.selectedDashboard ? [sloFormData.selectedDashboard] : [])}
            getOptionLabel={(option) => option.dashboard_label || ''}
            isOptionEqualToValue={(option, value) => option.id === value?.id || option.dashboard_uid === value?.dashboard_uid}
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
        <Grid size={{ xs: 12 }}>
          <Autocomplete
            options={availableDynatraceDashboards.length > 0 ? availableDynatraceDashboards : (sloFormData.selectedDashboard ? [sloFormData.selectedDashboard] : [])}
            getOptionLabel={(option) => option.dashboardLabel || ''}
            isOptionEqualToValue={(option, value) => option.dashboardLabel === value?.dashboardLabel}
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
        <Grid size={{ xs: 12 }}>
          <Autocomplete
            options={availableDynatraceMetrics.length > 0 ? availableDynatraceMetrics : (sloFormData.selectedPanel ? [sloFormData.selectedPanel] : [])}
            getOptionLabel={(option) => option.panelTitle || ''}
            isOptionEqualToValue={(option, value) => option.panelTitle === value?.panelTitle}
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
        <Grid size={{ xs: 12 }}>
          <Autocomplete
            options={availablePanels.length > 0 ? availablePanels : (sloFormData.selectedPanel ? [sloFormData.selectedPanel] : [])}
            getOptionLabel={(option) => option.title || ''}
            isOptionEqualToValue={(option, value) => (option.id != null && value?.id != null) ? String(option.id) === String(value.id) : option.title === value?.title}
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

      {/* Generic Dashboard/Metric display for non-grafana/dynatrace sources */}
      {sloFormData.source !== 'grafana' && sloFormData.source !== 'dynatrace' && sloFormData.selectedDashboard && (
        <>
          <Grid size={{ xs: 12 }}>
            <TextField
              label="Dashboard"
              value={sloFormData.selectedDashboard?.dashboard_label || sloFormData.selectedDashboard?.dashboardLabel || ''}
              variant="outlined"
              fullWidth
              disabled={true}
              helperText="Dashboard cannot be changed when editing existing SLO"
            />
          </Grid>
          {sloFormData.selectedPanel && (
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Metric"
                value={sloFormData.selectedPanel?.title || sloFormData.selectedPanel?.panelTitle || ''}
                variant="outlined"
                fullWidth
                disabled={true}
                helperText="Metric cannot be changed when editing existing SLO"
              />
            </Grid>
          )}
        </>
      )}
    </>
  );
}
