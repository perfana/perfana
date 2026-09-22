'use client';

import React from 'react';
import {
  Box,
  Typography,
  Autocomplete,
  TextField,
  Button,
} from '@mui/material';
import { BookmarkBorder } from '@mui/icons-material';
import {
  ApplicationDashboard,
  Panel,
  TrendsSeries,
  TIME_RANGE_OPTIONS,
  EVALUATE_TYPE_OPTIONS,
} from '../types';
import { TestRun } from '@/types/test-runs';
import MetricSeriesCascade from '../../shared/MetricSeriesCascade';
import type { SeriesPick } from '../../shared/metric-options';

interface TrendsSelectionControlsProps {
  // Dashboards → panels → series cascade
  allDashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;
  testRun: TestRun | null;
  addedSeries: TrendsSeries[];
  onAddSeries: (picks: SeriesPick[]) => void;
  /** First picked dashboard/panel, kept for preset saving. */
  selectedDashboard: ApplicationDashboard | null;
  selectedMetric: Panel | null;
  onPrimaryChange: (dashboard: ApplicationDashboard | null, panel: Panel | null) => void;

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
  allDashboards,
  dashboardsLoading,
  testRun,
  addedSeries,
  onAddSeries,
  selectedDashboard,
  selectedMetric,
  onPrimaryChange,
  timeRange,
  onTimeRangeChange,
  customTimeRange,
  onCustomTimeRangeChange,
  evaluateType,
  onEvaluateTypeChange,
  onSavePresetClick,
}: TrendsSelectionControlsProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <MetricSeriesCascade
        card="trends"
        allDashboards={allDashboards}
        dashboardsLoading={dashboardsLoading}
        testRun={testRun}
        addedSeries={addedSeries}
        onAddSeries={onAddSeries}
        onPrimaryChange={onPrimaryChange}
        // Every percentile panel is its own trend here, and the URL panels have no
        // per-run statistics to trend.
        panelListOptions={{ collapseRtPanels: false, includeUrlPanels: false }}
      />

      {/* Time Range and Evaluate Type Row */}
      {addedSeries.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-start' }}>
          {/* Time Range Selection */}
          <Autocomplete
            options={[...TIME_RANGE_OPTIONS]}
            getOptionLabel={(option) => option.label}
            value={timeRange}
            onChange={(_, newValue) => newValue && onTimeRangeChange(newValue)}
            isOptionEqualToValue={(option, value) => option.value === value.value}
            sx={{ flex: '1 1 200px' }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Time range"
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
            sx={{ flex: '1 1 200px' }}
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
              disabled={addedSeries.length === 0 && (!selectedDashboard || !selectedMetric)}
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
              Save as preset
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
