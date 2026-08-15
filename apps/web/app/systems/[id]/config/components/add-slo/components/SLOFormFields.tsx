'use client';
import { ApplicationDashboard, GrafanaPanel } from '@/lib/types';
import { DynatraceDashboard, DynatraceMetric } from '@/lib/dynatrace';

import React, { useMemo } from 'react';
import {
  Grid,
  Typography,
  Box,
  TextField,
  CircularProgress,
  Autocomplete,
  ListSubheader,
} from '@mui/material';
import { SLOFormData, ValidationErrors, DataSourceAvailability, SloDashboard, SloPanel, isDynatraceDashboard, isDynatraceMetric } from '../types';
import {} from '../utils/slo-formatters';
import { SOURCE_DISPLAY } from '@/lib/metrics-source-utils';

interface SLOFormFieldsProps {
  sloFormData: SLOFormData;
  setSloFormData: React.Dispatch<React.SetStateAction<SLOFormData>>;
  validationErrors: ValidationErrors;
  setValidationErrors: React.Dispatch<React.SetStateAction<ValidationErrors>>;
  dashboardsLoading: boolean;
  panelsLoading: boolean;
  availableDashboards: ApplicationDashboard[];
  availablePanels: GrafanaPanel[];
  availableDynatraceDashboards: DynatraceDashboard[];
  availableDynatraceMetrics: DynatraceMetric[];
  availablePerfMetricsDashboards: ApplicationDashboard[];
  availablePerfMetricsPanels: GrafanaPanel[];
  _dataSourceAvailability: DataSourceAvailability;
  systemName: string;
  environment: string;
  _workload: string;
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
  _dataSourceAvailability,
  systemName,
  environment,
  _workload,
  handleSourceChange,
  fetchDashboardPanels,
  fetchPerfMetricsPanels,
  fetchDynatraceMetricsForSlo,
}: SLOFormFieldsProps) {
  // The form holds whichever shape the chosen source produced. Narrow once here
  // so each source-specific picker below works with a concrete type.
  const sel = sloFormData.selectedDashboard;
  const selectedAppDashboard = sel && !isDynatraceDashboard(sel) ? sel : null;
  const selectedDynatraceDashboard = sel && isDynatraceDashboard(sel) ? sel : null;
  const selPanel = sloFormData.selectedPanel;
  const selectedGrafanaPanel = selPanel && !isDynatraceMetric(selPanel) ? selPanel : null;
  const selectedDynatraceMetric = selPanel && isDynatraceMetric(selPanel) ? selPanel : null;

  const clearValidationError = (field: string) => {
    if (validationErrors[field]) {
      setValidationErrors((prev) => {
        const { [field]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  // Merge all dashboards into a single grouped list
  type UnifiedDashboard = { id: string; label: string; sourceType: string; groupLabel: string; color: string; original: SloDashboard };
  const allDashboardsMerged = useMemo((): UnifiedDashboard[] => {
    const result: UnifiedDashboard[] = [];

    // Grafana dashboards
    for (const d of availableDashboards) {
      result.push({
        id: d.id || d.dashboard_uid,
        label: d.dashboard_label || d.dashboard_name,
        sourceType: 'grafana',
        groupLabel: SOURCE_DISPLAY.grafana.groupLabel,
        color: SOURCE_DISPLAY.grafana.color,
        original: d,
      });
    }

    // Performance test dashboards
    for (const d of availablePerfMetricsDashboards) {
      result.push({
        id: d.id || d.dashboard_uid || `perf-${d.dashboard_label}`,
        label: d.dashboard_label || d.dashboard_name,
        sourceType: 'performance_test',
        groupLabel: SOURCE_DISPLAY.performance_test.groupLabel,
        color: SOURCE_DISPLAY.performance_test.color,
        original: d,
      });
    }

    // Dynatrace dashboards
    for (const d of availableDynatraceDashboards) {
      result.push({
        id: `dynatrace-${d.dashboardLabel}`,
        label: d.dashboardLabel,
        sourceType: 'dynatrace',
        groupLabel: SOURCE_DISPLAY.dynatrace.groupLabel,
        color: SOURCE_DISPLAY.dynatrace.color,
        original: d,
      });
    }

    return result;
  }, [availableDashboards, availablePerfMetricsDashboards, availableDynatraceDashboards]);

  // Handle unified dashboard selection — route to correct source handler
  const handleUnifiedDashboardSelect = (_: unknown, newValue: UnifiedDashboard | null) => {
    if (!newValue) {
      setSloFormData((prev) => ({ ...prev, selectedDashboard: null, selectedPanel: null }));
      return;
    }

    // Set the source type
    const sourceMap: Record<string, string> = { grafana: 'grafana', dynatrace: 'dynatrace', performance_test: 'performance-metrics' };
    handleSourceChange(sourceMap[newValue.sourceType] || 'grafana');

    setSloFormData((prev) => ({ ...prev, selectedDashboard: newValue.original, selectedPanel: null }));
    clearValidationError('selectedDashboard');

    // Fetch panels/metrics based on source
    const original = newValue.original;
    if (newValue.sourceType === 'dynatrace') {
      if (isDynatraceDashboard(original) && original.dashboardLabel) {
        fetchDynatraceMetricsForSlo(original.dashboardLabel);
      }
    } else if (!isDynatraceDashboard(original)) {
      if (newValue.sourceType === 'grafana' && original.dashboard_uid) {
        fetchDashboardPanels(original.dashboard_uid);
      } else if (newValue.sourceType === 'performance_test' && original.id) {
        fetchPerfMetricsPanels(original.id);
      }
    }
  };

  return (
    <>
      {/* Unified Dashboard Selection — grouped by source type */}
      <Grid size={{ xs: 12 }}>
        <Autocomplete
          options={allDashboardsMerged}
          getOptionLabel={(option) => option.label}
          groupBy={(option) => option.groupLabel}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          value={allDashboardsMerged.find(d => {
            const sel = sloFormData.selectedDashboard;
            if (!sel) return false;
            return d.original === sel || d.label === (isDynatraceDashboard(sel) ? sel.dashboardLabel : sel.dashboard_label);
          }) || null}
          onChange={handleUnifiedDashboardSelect}
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
                  : `Select dashboard for ${systemName} - ${environment} (${allDashboardsMerged.length} available)`)
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
          renderGroup={(params) => (
            <li key={params.key}>
              <ListSubheader
                component="div"
                sx={{
                  fontWeight: 700,
                  color: allDashboardsMerged.find(d => d.groupLabel === params.group)?.color || '#9E9E9E',
                  backgroundColor: 'background.paper',
                  lineHeight: '36px',
                }}
              >
                {params.group}
              </ListSubheader>
              <ul style={{ padding: 0 }}>{params.children}</ul>
            </li>
          )}
          renderOption={(props, option) => {
            const { key: _key, ...otherProps } = props;
            return (
              <Box component="li" key={option.id} {...otherProps} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box aria-hidden="true" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: option.color, flexShrink: 0 }} />
                <Typography variant="body2">{option.label}</Typography>
              </Box>
            );
          }}
        />
      </Grid>

      {/* Grafana Panel Selection */}
      {sloFormData.source === 'grafana' && sloFormData.selectedDashboard && (
        <Grid size={{ xs: 12 }}>
          <Autocomplete
            options={availablePanels as SloPanel[]}
            getOptionLabel={(option) => option.title}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            value={selectedGrafanaPanel}
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
                  (panelsLoading ? 'Loading metrics...' : `Select metric from ${selectedAppDashboard?.dashboard_label}`)
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
              const { key: _key, ...otherProps } = props;
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

      {/* Dynatrace dashboard selection removed — unified dropdown above handles all sources */}

      {/* Dynatrace Metrics Selection */}
      {sloFormData.source === 'dynatrace' && sloFormData.selectedDashboard && (
        <Grid size={{ xs: 12 }}>
          <Autocomplete
            options={availableDynatraceMetrics as SloPanel[]}
            getOptionLabel={(option) => option.panelTitle}
            value={selectedDynatraceMetric}
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
                  (panelsLoading ? 'Loading metrics...' : `Select metric from ${selectedDynatraceDashboard?.dashboardLabel}`)
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
              const { key: _key, ...otherProps } = props;
              return (
                <Box component="li" key={`dynatrace-metric-${option.panelId}`} {...otherProps}>
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

      {/* Performance Metrics dashboard selection removed — unified dropdown above handles all sources */}

      {/* Performance Metrics Panel Selection */}
      {sloFormData.source === 'performance-metrics' && sloFormData.selectedDashboard && (
        <Grid size={{ xs: 12 }}>
          <Autocomplete
            options={availablePerfMetricsPanels as SloPanel[]}
            getOptionLabel={(option) => option.title || ''}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            value={selectedGrafanaPanel}
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
                  (panelsLoading ? 'Loading metrics...' : `Select metric from ${selectedAppDashboard?.dashboard_label}`)
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
              const { key: _key, ...otherProps } = props;
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
