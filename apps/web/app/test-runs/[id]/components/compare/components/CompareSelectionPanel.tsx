'use client';

import React from 'react';
import {
  Box,
  Typography,
  Autocomplete,
  TextField,
  CircularProgress,
  Button,
  Chip,
} from '@mui/material';
import {
  ApplicationDashboard,
  Panel,
  CompareSeries,
  DataSource,
  RelatedTestRun,
} from '../types';
import { DynatraceMetric } from '@/lib/dynatrace';
import { getTestRunDisplayText, getTestRunSecondaryInfo } from '../utils/compare-utils';

interface CompareSelectionPanelProps {
  // Test Run Selection
  relatedTestRuns: RelatedTestRun[];
  selectedTestRun: RelatedTestRun | null;
  onTestRunSelect: (testRun: RelatedTestRun | null) => void;

  // Source selection
  selectedSource: DataSource;
  availableSources: DataSource[];
  onSourceSelect: (source: DataSource) => void;

  // Dashboard selection
  selectedDashboard: ApplicationDashboard | null;
  filteredDashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;
  dynatraceDashboardsLoading: boolean;
  onDashboardSelect: (
    dashboard: ApplicationDashboard | null,
    dynatraceDashboardLabel?: string
  ) => void;

  // Panel selection
  selectedMetric: Panel | null;
  panels: Panel[];
  panelsLoading: boolean;
  dynatraceMetrics: DynatraceMetric[];
  dynatraceMetricsLoading: boolean;
  onMetricSelect: (metric: Panel | null) => void;

  // Series selection
  availableMetrics: string[];
  availableMetricsLoading: boolean;
  selectedMetricNames: string[];
  setSelectedMetricNames: (names: string[]) => void;
  addedSeries: CompareSeries[];
  onAddSeries: () => void;
}

export function CompareSelectionPanel({
  relatedTestRuns,
  selectedTestRun,
  onTestRunSelect,
  selectedSource,
  availableSources,
  onSourceSelect,
  selectedDashboard,
  filteredDashboards,
  dashboardsLoading,
  dynatraceDashboardsLoading,
  onDashboardSelect,
  selectedMetric,
  panels,
  panelsLoading,
  dynatraceMetrics,
  dynatraceMetricsLoading,
  onMetricSelect,
  availableMetrics,
  availableMetricsLoading,
  selectedMetricNames,
  setSelectedMetricNames,
  addedSeries,
  onAddSeries,
}: CompareSelectionPanelProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Test Run Selection */}
      <Autocomplete
        options={relatedTestRuns}
        getOptionLabel={getTestRunDisplayText}
        value={selectedTestRun}
        onChange={(_, newValue) => onTestRunSelect(newValue)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Select Test Run for Comparison"
            variant="outlined"
            fullWidth
            helperText={
              selectedTestRun
                ? `Comparing with: ${selectedTestRun.test_run_id}`
                : `Select from ${relatedTestRuns.length} available test runs`
            }
          />
        )}
        renderOption={(props, option) => {
          const { key, ...otherProps } = props;
          return (
            <Box component="li" key={key} {...otherProps}>
              <Box sx={{ width: '100%' }}>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  {option.test_run_id}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {new Date(option.start_time || option.created_at).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {getTestRunSecondaryInfo(option)}
                </Typography>
              </Box>
            </Box>
          );
        }}
        sx={{ mb: 2 }}
      />

      {/* Source Selection */}
      {availableSources.length > 0 && (
        <Autocomplete
          options={[
            { value: 'grafana' as const, label: 'Grafana' },
            { value: 'dynatrace' as const, label: 'Dynatrace' },
            { value: 'performance-metrics' as const, label: 'Performance Metrics' }
          ].filter(opt => availableSources.includes(opt.value))}
          getOptionLabel={(option) => option.label}
          value={{
            value: selectedSource,
            label: selectedSource === 'grafana' ? 'Grafana'
              : selectedSource === 'dynatrace' ? 'Dynatrace'
              : 'Performance Metrics'
          }}
          onChange={(_, newValue) => newValue && onSourceSelect(newValue.value)}
          sx={{ mb: 2 }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Source"
              variant="outlined"
              fullWidth
              helperText="Select data source for comparison"
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
      )}

      {/* Dashboard and Metric Selection Row */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        {/* Dashboard Selection */}
        <Autocomplete
          options={filteredDashboards}
          getOptionLabel={(option) => option.dashboard_label || ''}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          value={selectedDashboard}
          onChange={(_, newValue) => {
            if (selectedSource === 'dynatrace' && newValue) {
              onDashboardSelect(newValue, newValue.dashboard_label);
            } else {
              onDashboardSelect(newValue);
            }
          }}
          loading={selectedSource === 'dynatrace' ? dynatraceDashboardsLoading : dashboardsLoading}
          sx={{ flex: 1 }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Dashboard"
              variant="outlined"
              fullWidth
              helperText={
                selectedSource === 'dynatrace'
                  ? (dynatraceDashboardsLoading ? 'Loading dashboards...' : `Select dashboard (${filteredDashboards.length} available)`)
                  : (dashboardsLoading ? 'Loading dashboards...' : `Select dashboard (${filteredDashboards.length} available)`)
              }
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {(selectedSource === 'dynatrace' ? dynatraceDashboardsLoading : dashboardsLoading) ? <CircularProgress size={20} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
          renderOption={(props, option) => {
            const { key, ...otherProps } = props;
            return (
              <Box component="li" key={option.id} {...otherProps}>
                <Typography variant="body1">{option.dashboard_label}</Typography>
              </Box>
            );
          }}
        />

        {/* Metric/Panel Selection */}
        {selectedDashboard && (
          <Autocomplete
            options={selectedSource === 'dynatrace'
              ? dynatraceMetrics.map(m => ({
                  id: m.panelId,
                  title: m.panelTitle,
                  type: 'dynatrace',
                  applicationDashboardId: m.applicationDashboardId
                } as Panel))
              : panels
            }
            getOptionLabel={(option) => option.title}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            value={selectedMetric}
            onChange={(_, newValue) => onMetricSelect(newValue)}
            loading={selectedSource === 'dynatrace' ? dynatraceMetricsLoading : panelsLoading}
            sx={{ flex: 1 }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Panel"
                variant="outlined"
                fullWidth
                helperText={
                  selectedSource === 'dynatrace'
                    ? (dynatraceMetricsLoading ? 'Loading panels...' : `Select panel from ${selectedDashboard?.dashboard_label}`)
                    : (panelsLoading ? 'Loading panels...' : `Select panel from ${selectedDashboard?.dashboard_label}`)
                }
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {(selectedSource === 'dynatrace' ? dynatraceMetricsLoading : panelsLoading) ? <CircularProgress size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={option.id} {...otherProps}>
                  <Typography variant="body1">{option.title}</Typography>
                </Box>
              );
            }}
          />
        )}
      </Box>

      {/* Series Selection Row */}
      {selectedMetric && (
        <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'flex-end' }}>
          {/* Series Multi-Select */}
          <Autocomplete
            multiple
            options={availableMetrics}
            value={selectedMetricNames}
            onChange={(_, newValue) => setSelectedMetricNames(newValue)}
            loading={availableMetricsLoading}
            sx={{ flex: 1 }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select Series"
                variant="outlined"
                fullWidth
                helperText={
                  availableMetricsLoading
                    ? 'Loading available series...'
                    : `${availableMetrics.length} series available from ${selectedMetric.title}`
                }
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {availableMetricsLoading ? <CircularProgress size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              const isAlreadyAdded = addedSeries.some(
                s => s.dashboardId === (selectedMetric.applicationDashboardId || selectedDashboard?.id) &&
                     s.panelId === selectedMetric.id &&
                     s.metricName === option
              );
              return (
                <Box component="li" key={key} {...otherProps} sx={{
                  opacity: isAlreadyAdded ? 0.5 : 1,
                  backgroundColor: isAlreadyAdded ? 'action.disabledBackground' : 'inherit'
                }}>
                  <Typography variant="body1">
                    {option}
                    {isAlreadyAdded && (
                      <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                        (already added)
                      </Typography>
                    )}
                  </Typography>
                </Box>
              );
            }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => {
                const tagProps = getTagProps({ index });
                return (
                  <Chip
                    {...tagProps}
                    key={option}
                    label={option}
                    size="small"
                    sx={{
                      background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.1) 0%, rgba(30, 136, 229, 0.15) 100%)',
                      border: '1px solid rgba(25, 118, 210, 0.3)',
                      color: 'primary.dark'
                    }}
                  />
                );
              })
            }
          />

          {/* Select All Button */}
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              if (selectedMetricNames.length === availableMetrics.length) {
                setSelectedMetricNames([]);
              } else {
                setSelectedMetricNames([...availableMetrics]);
              }
            }}
            disabled={!selectedMetric || availableMetrics.length === 0}
            sx={{ height: '56px', minWidth: '100px', flexShrink: 0 }}
          >
            {selectedMetricNames.length === availableMetrics.length && availableMetrics.length > 0 ? 'Deselect All' : 'Select All'}
          </Button>

          {/* Add Series Button */}
          <Button
            variant="contained"
            onClick={onAddSeries}
            disabled={selectedMetricNames.length === 0}
            sx={{
              minWidth: 120,
              height: 56,
              background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
              boxShadow: '0 2px 8px rgba(25, 118, 210, 0.25)',
              '&:hover': {
                background: 'linear-gradient(135deg, #1565c0 0%, #0d47a1 100%)',
              },
              '&:disabled': {
                background: 'rgba(0, 0, 0, 0.12)',
              }
            }}
          >
            Add Series
          </Button>
        </Box>
      )}
    </Box>
  );
}

export default CompareSelectionPanel;
