'use client';

import React from 'react';
import {
  Box,
  Typography,
  Autocomplete,
  TextField,
  CircularProgress,
  Button,
} from '@mui/material';
import { Add } from '@mui/icons-material';
import {
  ApplicationDashboard,
  Panel,
  DataSource,
} from '../types';

interface GraphsSelectionControlsProps {
  // Source selection
  selectedSource: DataSource;
  availableSources: DataSource[];
  onSourceSelect: (source: DataSource) => void;

  // Dashboard selection
  selectedDashboard: ApplicationDashboard | null;
  filteredDashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;
  dynatraceDashboardsLoading: boolean;
  onDashboardSelect: (dashboard: ApplicationDashboard | null, source?: DataSource) => void;

  // Panel selection
  selectedPanel: Panel | null;
  panels: Panel[];
  panelsLoading: boolean;
  onPanelSelect: (panel: Panel | null) => void;

  // Metric selection
  metrics: string[];
  metricsLoading: boolean;
  selectedMetrics: string[];
  setSelectedMetrics: (metrics: string[]) => void;

  // Add series
  onAddSeries: () => void;
}

export function GraphsSelectionControls({
  selectedSource,
  availableSources,
  onSourceSelect,
  selectedDashboard,
  filteredDashboards,
  dashboardsLoading,
  dynatraceDashboardsLoading,
  onDashboardSelect,
  selectedPanel,
  panels,
  panelsLoading,
  onPanelSelect,
  metrics,
  metricsLoading,
  selectedMetrics,
  setSelectedMetrics,
  onAddSeries,
}: GraphsSelectionControlsProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Source Selection - Show if multiple sources available */}
      {availableSources.length > 1 && (
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
          renderInput={(params) => (
            <TextField
              {...params}
              label="Source"
              variant="outlined"
              fullWidth
              helperText="Select data source for graphs"
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

      {/* Dashboard Selection */}
      <Autocomplete
        options={filteredDashboards}
        getOptionLabel={(option) => option.dashboard_label || ''}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        value={selectedDashboard}
        onChange={(_, newValue) => {
          onDashboardSelect(newValue, selectedSource);
        }}
        loading={selectedSource === 'dynatrace' ? dynatraceDashboardsLoading : dashboardsLoading}
        renderInput={(params) => {
          const filteredCount = filteredDashboards.length;
          const isLoading = selectedSource === 'dynatrace' ? dynatraceDashboardsLoading : dashboardsLoading;
          return (
            <TextField
              {...params}
              label="Dashboard"
              variant="outlined"
              fullWidth
              helperText={
                isLoading
                  ? 'Loading dashboards...'
                  : `Select dashboard (${filteredCount} available)`
              }
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {isLoading ? <CircularProgress size={20} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          );
        }}
        renderOption={(props, option) => {
          const { key, ...otherProps } = props;
          return (
            <Box component="li" key={option.id} {...otherProps}>
              <Typography variant="body1">{option.dashboard_label}</Typography>
            </Box>
          );
        }}
      />

      {/* Panel Selection */}
      <Autocomplete
        options={panels}
        getOptionLabel={(option) => option.title}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        value={selectedPanel}
        onChange={(_, newValue) => onPanelSelect(newValue)}
        loading={panelsLoading}
        disabled={!selectedDashboard}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Panel / Metric Group"
            variant="outlined"
            fullWidth
            helperText={
              !selectedDashboard
                ? 'Select a dashboard first'
                : panelsLoading
                  ? 'Loading panels...'
                  : selectedDashboard
                    ? `Select panel from ${selectedDashboard.dashboard_label}`
                    : 'Select panel'
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
            <Box component="li" key={option.id} {...otherProps}>
              <Typography variant="body1">{option.title}</Typography>
            </Box>
          );
        }}
      />

      {/* Metric Selection */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        <Autocomplete
          options={metrics}
          multiple
          getOptionLabel={(option) => option}
          value={selectedMetrics}
          onChange={(_, newValue) => setSelectedMetrics(newValue)}
          loading={metricsLoading}
          disabled={!selectedPanel}
          sx={{ flex: 1 }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Metric Series (Multiple)"
              variant="outlined"
              fullWidth
              helperText={
                !selectedPanel
                  ? 'Select a panel first'
                  : metricsLoading
                    ? 'Loading metrics...'
                    : selectedMetrics.length > 0
                      ? `${selectedMetrics.length} metric(s) selected`
                      : 'Select one or more metrics'
              }
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {metricsLoading ? <CircularProgress size={20} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
          renderOption={(props, option) => {
            const { key, ...otherProps } = props;
            return (
              <Box component="li" key={option} {...otherProps}>
                <Typography variant="body1">{option}</Typography>
              </Box>
            );
          }}
        />

        {/* Select All Button */}
        <Button
          size="small"
          variant="outlined"
          onClick={() => {
            if (selectedMetrics.length === metrics.length) {
              setSelectedMetrics([]);
            } else {
              setSelectedMetrics([...metrics]);
            }
          }}
          disabled={!selectedPanel || metrics.length === 0}
          sx={{ height: '56px', minWidth: '100px', flexShrink: 0 }}
        >
          {selectedMetrics.length === metrics.length && metrics.length > 0 ? 'Deselect All' : 'Select All'}
        </Button>

        {/* Add Series Button */}
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={onAddSeries}
          disabled={!selectedDashboard || !selectedPanel || selectedMetrics.length === 0}
          sx={{
            height: '56px',
            px: 3,
            whiteSpace: 'nowrap',
            minWidth: 'auto'
          }}
        >
          Add {selectedMetrics.length > 0 ? `(${selectedMetrics.length})` : 'Series'}
        </Button>
      </Box>
    </Box>
  );
}
