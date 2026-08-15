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
import { BookmarkBorder } from '@mui/icons-material';
import {
  ApplicationDashboard,
  Panel,
  TrendsSeries,
  DataSource,
  TIME_RANGE_OPTIONS,
  EVALUATE_TYPE_OPTIONS,
} from '../types';
import { DynatraceMetric } from '@/lib/dynatrace';
import { getSourceDisplayInfo, getSourceType } from '@/lib/metrics-source-utils';

interface TrendsSelectionControlsProps {
  // Dashboard selection
  selectedDashboard: ApplicationDashboard | null;
  allDashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;
  dynatraceDashboardsLoading: boolean;
  onDashboardSelect: (
    dashboard: ApplicationDashboard | null,
    dynatraceDashboardLabel?: string,
    source?: DataSource
  ) => void;

  // Panel selection
  selectedMetric: Panel | null;
  panels: Panel[];
  panelsLoading: boolean;
  dynatraceMetrics: DynatraceMetric[];
  dynatraceMetricsLoading: boolean;
  onMetricSelect: (metric: Panel | null) => void;

  // Determined source (auto-detected from selected dashboard)
  selectedSource: DataSource;

  // Series selection
  availableMetrics: string[];
  availableMetricsLoading: boolean;
  selectedMetricNames: string[];
  setSelectedMetricNames: (names: string[]) => void;
  addedSeries: TrendsSeries[];
  onAddSeries: () => void;

  // Time range
  timeRange: (typeof TIME_RANGE_OPTIONS)[number];
  onTimeRangeChange: (range: (typeof TIME_RANGE_OPTIONS)[number]) => void;
  customTimeRange: { from: Date; to: Date };
  onCustomTimeRangeChange: (field: 'from' | 'to', date: Date | null) => void;

  // Evaluate type
  evaluateType: string;
  onEvaluateTypeChange: (type: string) => void;

  // Presets
  onSavePresetClick: () => void;
}

export function TrendsSelectionControls({
  selectedDashboard,
  allDashboards,
  dashboardsLoading,
  dynatraceDashboardsLoading,
  onDashboardSelect,
  selectedMetric,
  panels,
  panelsLoading,
  dynatraceMetrics,
  dynatraceMetricsLoading,
  onMetricSelect,
  selectedSource,
  availableMetrics,
  availableMetricsLoading,
  selectedMetricNames,
  setSelectedMetricNames,
  addedSeries,
  onAddSeries,
  timeRange,
  onTimeRangeChange,
  customTimeRange,
  onCustomTimeRangeChange,
  evaluateType,
  onEvaluateTypeChange,
  onSavePresetClick,
}: TrendsSelectionControlsProps) {
  const isLoading = dashboardsLoading || dynatraceDashboardsLoading;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
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
              isDynatrace ? newValue.dashboard_label : undefined,
              undefined
            );
          } else {
            onDashboardSelect(null);
          }
        }}
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

      {/* Panel Selection */}
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

      {/* Series Selection and Add Button */}
      {selectedMetric && (
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <Autocomplete
            multiple
            options={availableMetrics}
            getOptionLabel={(option) => option}
            value={selectedMetricNames}
            onChange={(_, newValue) => setSelectedMetricNames(newValue)}
            loading={availableMetricsLoading}
            sx={{ flex: 1 }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Series"
                variant="outlined"
                fullWidth
                helperText={
                  availableMetricsLoading
                    ? 'Loading available series...'
                    : `Select series to add (${availableMetrics.length} available)`
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
                <Box
                  component="li"
                  key={key}
                  {...otherProps}
                  sx={{
                    opacity: isAlreadyAdded ? 0.5 : 1,
                    '&::after': isAlreadyAdded ? {
                      content: '"(added)"',
                      marginLeft: 1,
                      fontSize: '0.75rem',
                      color: 'text.secondary'
                    } : undefined
                  }}
                >
                  <Typography variant="body1">{option}</Typography>
                </Box>
              );
            }}
          />
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
          <Button
            variant="contained"
            onClick={onAddSeries}
            disabled={selectedMetricNames.length === 0}
            sx={{
              height: '56px',
              minWidth: '120px',
              flexShrink: 0
            }}
          >
            Add Series
          </Button>
        </Box>
      )}

      {/* Time Range and Evaluate Type Row */}
      {addedSeries.length > 0 && (
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
          {/* Time Range Selection */}
          <Autocomplete
            options={[...TIME_RANGE_OPTIONS]}
            getOptionLabel={(option) => option.label}
            value={timeRange}
            onChange={(_, newValue) => newValue && onTimeRangeChange(newValue)}
            isOptionEqualToValue={(option, value) => option.value === value.value}
            sx={{ flex: 1 }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Time Range"
                variant="outlined"
                fullWidth
              />
            )}
          />

          {/* Evaluate Type Selection */}
          <Autocomplete
            options={[...EVALUATE_TYPE_OPTIONS]}
            getOptionLabel={(option) => option.label}
            value={EVALUATE_TYPE_OPTIONS.find(option => option.value === evaluateType)}
            onChange={(_, newValue) => newValue && onEvaluateTypeChange(newValue.value)}
            sx={{ flex: 1 }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Aggregation"
                variant="outlined"
                fullWidth
              />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={key} {...otherProps}>
                  <Box>
                    <Typography variant="body1">{option.label}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {option.description}
                    </Typography>
                  </Box>
                </Box>
              );
            }}
          />

          {/* Save Preset Button */}
          <Box sx={{ flexShrink: 0 }}>
            <Button
              variant="outlined"
              size="medium"
              startIcon={<BookmarkBorder />}
              onClick={onSavePresetClick}
              disabled={!selectedDashboard || !selectedMetric}
              sx={{
                height: '56px',
                borderColor: 'primary.main',
                color: 'primary.main',
                transition: 'all 0.2s ease',
                '&:hover': {
                  transform: 'translateY(-1px)',
                  borderColor: 'primary.dark',
                  backgroundColor: 'primary.main',
                  color: 'primary.contrastText'
                }
              }}
            >
              Save Preset
            </Button>
          </Box>
        </Box>
      )}

      {/* Custom Time Range Pickers */}
      {timeRange.value === 'custom' && (
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            label="From"
            type="datetime-local"
            value={customTimeRange.from.toISOString().slice(0, 16)}
            onChange={(e) => onCustomTimeRangeChange('from', new Date(e.target.value))}
            variant="outlined"
            fullWidth
            InputLabelProps={{
              shrink: true,
            }}
          />
          <TextField
            label="To"
            type="datetime-local"
            value={customTimeRange.to.toISOString().slice(0, 16)}
            onChange={(e) => onCustomTimeRangeChange('to', new Date(e.target.value))}
            variant="outlined"
            fullWidth
            InputLabelProps={{
              shrink: true,
            }}
          />
        </Box>
      )}
    </Box>
  );
}
