'use client';

import React from 'react';
import {
  Box,
  Typography,
  TextField,
  IconButton,
  FormControlLabel,
  Switch,
  Button,
  CircularProgress,
} from '@mui/material';
import { Close, BookmarkBorder } from '@mui/icons-material';
import {
  MetricComparison,
  ApplicationDashboard,
  Panel,
  CompareSeries,
  GraphData,
  RelatedTestRun,
} from '../types';
import { MetricsComparisonTable } from './index';
import { TestRun } from '@/types/test-runs';

interface CompareDiffTableProps {
  // Metrics data
  metricComparisons: MetricComparison[];
  addedSeries: CompareSeries[];
  metricsLoading: boolean;

  // Filter state
  seriesSearchText: string;
  onSeriesSearchChange: (text: string) => void;
  showPercentiles: boolean;
  onShowPercentilesChange: (show: boolean) => void;

  // Preset
  selectedDashboard: ApplicationDashboard | null;
  selectedMetric: Panel | null;
  onSavePresetClick: () => void;

  // Graph state
  showGraphs: Record<string, boolean>;
  graphData: Record<string, GraphData>;
  graphLoading: Record<string, boolean>;
  onToggleGraph: (metricName: string) => void;
  onShowGraphsChange: (update: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  onGraphDataChange: (update: (prev: Record<string, GraphData>) => Record<string, GraphData>) => void;
  onGraphLoadingChange: (update: (prev: Record<string, boolean>) => Record<string, boolean>) => void;

  // Test run context
  testRun: TestRun | null;
  testRunId: string;
  selectedTestRun: RelatedTestRun;
  relatedTestRuns: RelatedTestRun[];
  showToast: (message: string) => void;
}

export function CompareDiffTable({
  metricComparisons,
  addedSeries,
  metricsLoading,
  seriesSearchText,
  onSeriesSearchChange,
  showPercentiles,
  onShowPercentilesChange,
  selectedDashboard,
  selectedMetric,
  onSavePresetClick,
  showGraphs,
  graphData,
  graphLoading,
  onToggleGraph,
  onShowGraphsChange,
  onGraphDataChange,
  onGraphLoadingChange,
  testRun,
  testRunId,
  selectedTestRun,
  relatedTestRuns,
  showToast,
}: CompareDiffTableProps) {
  const uniqueSeriesNames = Array.from(new Set(metricComparisons.map(m => m.metric_name)));
  const shouldShowSeriesSearch = uniqueSeriesNames.length > 1;

  if (metricsLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
          Loading metrics comparison...
        </Typography>
      </Box>
    );
  }

  if (metricComparisons.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">
          No metrics data available for the selected combination
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Series Search and Percentile Toggle */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{
          display: 'flex',
          alignItems: shouldShowSeriesSearch ? 'flex-end' : 'center',
          gap: 3,
          mb: shouldShowSeriesSearch && seriesSearchText ? 1 : 0
        }}>
          {shouldShowSeriesSearch && (
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
                Search Series
              </Typography>
              <TextField
                fullWidth
                size="small"
                placeholder="Search series by metric name..."
                value={seriesSearchText}
                onChange={(e) => onSeriesSearchChange(e.target.value)}
                InputProps={{
                  endAdornment: seriesSearchText && (
                    <IconButton
                      size="small"
                      onClick={() => onSeriesSearchChange('')}
                      sx={{ mr: -1 }}
                    >
                      <Close fontSize="small" />
                    </IconButton>
                  )
                }}
              />
            </Box>
          )}
          <Box sx={{ flexShrink: 0 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={showPercentiles}
                  onChange={(event) => onShowPercentilesChange(event.target.checked)}
                  size="small"
                />
              }
              label={
                <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                  Show Percentiles
                </Typography>
              }
            />
          </Box>

          {/* Save Preset Button */}
          <Box sx={{ flexShrink: 0 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<BookmarkBorder />}
              onClick={onSavePresetClick}
              disabled={!selectedDashboard || !selectedMetric}
              sx={{
                height: '32px',
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
        {shouldShowSeriesSearch && seriesSearchText.length > 0 && (() => {
          const filteredSeries = uniqueSeriesNames.filter(series =>
            series.toLowerCase().includes(seriesSearchText.toLowerCase())
          );
          return (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Showing {filteredSeries.length} of {uniqueSeriesNames.length} series
              {seriesSearchText && ` matching "${seriesSearchText}"`}
            </Typography>
          );
        })()}
      </Box>

      {/* Metrics Comparison Table */}
      <MetricsComparisonTable
        metricComparisons={metricComparisons}
        selectedTestRun={selectedTestRun}
        testRunId={testRunId}
        showPercentiles={showPercentiles}
        seriesSearchText={seriesSearchText}
        selectedMetric={selectedMetric}
        selectedDashboard={selectedDashboard}
        showGraphs={showGraphs}
        graphData={graphData}
        graphLoading={graphLoading}
        onToggleGraph={onToggleGraph}
        onShowGraphsChange={onShowGraphsChange}
        onGraphDataChange={onGraphDataChange}
        onGraphLoadingChange={onGraphLoadingChange}
        testRun={testRun}
        relatedTestRuns={relatedTestRuns}
        showToast={showToast}
        addedSeries={addedSeries}
      />
    </Box>
  );
}

export default CompareDiffTable;
