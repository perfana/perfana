'use client';

import React from 'react';
import {
  Box, Typography, TextField, IconButton, Button, CircularProgress,
  Popover, FormControlLabel, Checkbox, Stack, Divider, Tooltip,
} from '@mui/material';
import { Close, BookmarkBorder, Tune } from '@mui/icons-material';
import {
  MetricComparison, ApplicationDashboard, Panel, CompareSeries, GraphData, RelatedTestRun,
} from '../types';
import { DisplayConfig } from '../utils/compare-utils';
import { MetricsComparisonTable } from './index';
import { TestRun } from '@/types/test-runs';

interface CompareDiffTableProps {
  metricComparisons: MetricComparison[];
  addedSeries: CompareSeries[];
  metricsLoading: boolean;
  seriesSearchText: string;
  onSeriesSearchChange: (text: string) => void;
  displayConfig: DisplayConfig;
  onDisplayConfigChange: (cfg: DisplayConfig) => void;
  selectedDashboard: ApplicationDashboard | null;
  selectedMetric: Panel | null;
  onSavePresetClick: () => void;
  showGraphs: Record<string, boolean>;
  graphData: Record<string, GraphData>;
  graphLoading: Record<string, boolean>;
  onToggleGraph: (row: { dashboardId: string; panelId: number; metricName: string }) => void;
  testRun: TestRun | null;
  testRunId: string;
  selectedTestRun: RelatedTestRun;
  relatedTestRuns: RelatedTestRun[];
  showToast: (message: string) => void;
}

export function CompareDiffTable({
  metricComparisons, addedSeries, metricsLoading, seriesSearchText, onSeriesSearchChange,
  displayConfig, onDisplayConfigChange, selectedDashboard, selectedMetric, onSavePresetClick,
  showGraphs, graphData, graphLoading, onToggleGraph, testRun, testRunId, selectedTestRun,
  relatedTestRuns, showToast,
}: CompareDiffTableProps) {
  const [cfgAnchor, setCfgAnchor] = React.useState<HTMLElement | null>(null);
  const [useRegex, setUseRegex] = React.useState(false);
  const uniqueSeriesNames = Array.from(new Set(metricComparisons.map(m => m.metric_name)));
  const shouldShowSeriesSearch = uniqueSeriesNames.length > 1;

  const regexError = useRegex && seriesSearchText.trim().length > 0 &&
    (() => { try { new RegExp(seriesSearchText); return false; } catch { return true; } })();

  const setPct = (key: 'p90' | 'p95' | 'p99', v: boolean) =>
    onDisplayConfigChange({ ...displayConfig, percentiles: { ...displayConfig.percentiles, [key]: v } });
  const setNum = (key: 'warningThreshold' | 'regressionThreshold' | 'minAbsolute', v: number) =>
    onDisplayConfigChange({ ...displayConfig, [key]: Number.isFinite(v) && v >= 0 ? v : 0 });

  if (metricsLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>Loading metrics comparison...</Typography>
      </Box>
    );
  }
  if (metricComparisons.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 3 }}>
        <Typography variant="body2" color="text.secondary">No metrics data available for the selected combination</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: shouldShowSeriesSearch ? 'flex-end' : 'center', gap: 2, mb: 3 }}>
        {shouldShowSeriesSearch && (
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>Search Series</Typography>
            <TextField fullWidth size="small"
              placeholder={useRegex ? 'Filter by regex, e.g. ^(GET|POST) …' : 'Search series by metric name...'}
              value={seriesSearchText} onChange={(e) => onSeriesSearchChange(e.target.value)}
              error={!!regexError}
              helperText={regexError ? 'Invalid regular expression' : undefined}
              InputProps={{ endAdornment: (
                <Box sx={{ display: 'flex', alignItems: 'center', mr: -1 }}>
                  <Tooltip title={useRegex ? 'Regex filtering on' : 'Filter with a regular expression'} arrow>
                    <IconButton size="small" onClick={() => setUseRegex(v => !v)}
                      aria-label="Toggle regex filtering" aria-pressed={useRegex}
                      color={useRegex ? 'primary' : 'default'}>
                      <Box component="span" sx={{ fontSize: '0.8rem', fontWeight: 700, fontFamily: 'monospace' }}>.*</Box>
                    </IconButton>
                  </Tooltip>
                  {seriesSearchText && (
                    <IconButton size="small" onClick={() => onSeriesSearchChange('')} aria-label="Clear search">
                      <Close fontSize="small" />
                    </IconButton>
                  )}
                </Box>) }} />
          </Box>
        )}
        <Button variant="outlined" size="small" startIcon={<Tune />} onClick={(e) => setCfgAnchor(e.currentTarget)}
          sx={{ height: 32, flexShrink: 0 }}>
          Columns & thresholds
        </Button>
        <Button variant="outlined" size="small" startIcon={<BookmarkBorder />} onClick={onSavePresetClick}
          disabled={!selectedDashboard || !selectedMetric} sx={{ height: 32, flexShrink: 0 }}>
          Save Preset
        </Button>
      </Box>

      <Popover open={!!cfgAnchor} anchorEl={cfgAnchor} onClose={() => setCfgAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ p: 2, width: 260 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>Percentile columns</Typography>
          <Stack>
            <FormControlLabel control={<Checkbox size="small" checked={displayConfig.percentiles.p90} onChange={(e) => setPct('p90', e.target.checked)} />} label="P90" />
            <FormControlLabel control={<Checkbox size="small" checked={displayConfig.percentiles.p95} onChange={(e) => setPct('p95', e.target.checked)} />} label="P95" />
            <FormControlLabel control={<Checkbox size="small" checked={displayConfig.percentiles.p99} onChange={(e) => setPct('p99', e.target.checked)} />} label="P99" />
          </Stack>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary' }}>Thresholds</Typography>
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <TextField size="small" type="number" label="Warning threshold (%)" value={displayConfig.warningThreshold}
              onChange={(e) => setNum('warningThreshold', Number(e.target.value))} />
            <TextField size="small" type="number" label="Regression threshold (%)" value={displayConfig.regressionThreshold}
              onChange={(e) => setNum('regressionThreshold', Number(e.target.value))} />
            <TextField size="small" type="number" label="Absolute threshold (min change)" value={displayConfig.minAbsolute}
              onChange={(e) => setNum('minAbsolute', Number(e.target.value))} helperText="0 = off" />
          </Stack>
        </Box>
      </Popover>

      <MetricsComparisonTable
        metricComparisons={metricComparisons}
        selectedTestRun={selectedTestRun}
        testRunId={testRunId}
        displayConfig={displayConfig}
        seriesSearchText={seriesSearchText}
        seriesSearchRegex={useRegex}
        selectedMetric={selectedMetric}
        selectedDashboard={selectedDashboard}
        showGraphs={showGraphs}
        graphData={graphData}
        graphLoading={graphLoading}
        onToggleGraph={onToggleGraph}
        testRun={testRun}
        relatedTestRuns={relatedTestRuns}
        showToast={showToast}
        addedSeries={addedSeries}
      />
    </Box>
  );
}

export default CompareDiffTable;
