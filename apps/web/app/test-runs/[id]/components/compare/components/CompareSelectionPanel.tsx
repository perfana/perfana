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
  ListSubheader,
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
import { getSourceDisplayInfo, getSourceType } from '@/lib/metrics-source-utils';

interface CompareSelectionPanelProps {
  // Test Run Selection
  relatedTestRuns: RelatedTestRun[];
  selectedTestRun: RelatedTestRun | null;
  onTestRunSelect: (testRun: RelatedTestRun | null) => void;

  // Dashboard selection
  selectedDashboard: ApplicationDashboard | null;
  allDashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;
  dynatraceDashboardsLoading: boolean;
  onDashboardSelect: (
    dashboard: ApplicationDashboard | null,
    dynatraceDashboardLabel?: string
  ) => void;

  // Determined source (auto-detected from selected dashboard)
  selectedSource: DataSource;

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
  selectedDashboard,
  allDashboards,
  dashboardsLoading,
  dynatraceDashboardsLoading,
  onDashboardSelect,
  selectedSource,
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
  const isLoading = dashboardsLoading || dynatraceDashboardsLoading;

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

      {/* Dashboard and Metric Selection Row */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        {/* Dashboard Selection - Grouped by source type */}
        <Autocomplete
          options={allDashboards}
          getOptionLabel={(option) => option.dashboard_label || ''}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          value={selectedDashboard}
          onChange={(_, newValue) => {
            if (newValue) {
              const srcType = getSourceType(newValue);
              const isDynatrace = srcType === 'dynatrace';
              onDashboardSelect(
                newValue,
                isDynatrace ? newValue.dashboard_label : undefined
              );
            } else {
              onDashboardSelect(null);
            }
          }}
          loading={isLoading}
          sx={{ flex: 1 }}
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
            const { key: _key, ...otherProps } = props;
            const { color } = getSourceDisplayInfo(option);
            return (
              <Box component="li" key={option.id} {...otherProps} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box aria-hidden="true" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
                <Typography variant="body2">{option.dashboard_label}</Typography>
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
              const { key: _key, ...otherProps } = props;
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
            limitTags={8}
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
