'use client';

import React from 'react';
import {
  Box,
  Typography,
  Autocomplete,
  TextField,
  CircularProgress,
  Button,
  ListSubheader,
} from '@mui/material';
import { Add } from '@mui/icons-material';
import {
  ApplicationDashboard,
  Panel,
} from '../types';
import { getSourceDisplayInfo } from '@/lib/metrics-source-utils';

interface GraphsSelectionControlsProps {
  // Dashboard selection
  selectedDashboard: ApplicationDashboard | null;
  allDashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;
  dynatraceDashboardsLoading: boolean;
  onDashboardSelect: (dashboard: ApplicationDashboard | null) => void;

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
  selectedDashboard,
  allDashboards,
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
  const isLoading = dashboardsLoading || dynatraceDashboardsLoading;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Dashboard Selection - Grouped by source type */}
      <Autocomplete
        options={allDashboards}
        getOptionLabel={(option) => option.dashboard_label || ''}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        value={selectedDashboard}
        onChange={(_, newValue) => onDashboardSelect(newValue)}
        loading={isLoading}
        groupBy={(option) => getSourceDisplayInfo(option).groupLabel}
        renderGroup={(params) => {
          const dashboardInGroup = allDashboards.find(
            d => getSourceDisplayInfo(d).groupLabel === params.group
          );
          const color = dashboardInGroup
            ? getSourceDisplayInfo(dashboardInGroup).color
            : '#9E9E9E';
          return (
            <li key={params.key}>
              <ListSubheader
                component="div"
                sx={{
                  fontWeight: 700,
                  color,
                  backgroundColor: 'background.paper',
                  lineHeight: '36px',
                }}
              >
                {params.group}
              </ListSubheader>
              <ul style={{ padding: 0 }}>{params.children}</ul>
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Dashboard"
            variant="outlined"
            fullWidth
            helperText={
              isLoading
                ? 'Loading dashboards...'
                : `Select dashboard (${allDashboards.length} available)`
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
        )}
        renderOption={(props, option) => {
          const { key, ...otherProps } = props;
          const { color } = getSourceDisplayInfo(option);
          return (
            <Box component="li" key={option.id} {...otherProps} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box aria-hidden="true" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
              <Typography variant="body2">{option.dashboard_label}</Typography>
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
