'use client';

/**
 * Baseline run + a dashboards → panels → series cascade, the same shape the report's
 * comparison section config uses (MetricSelectionCascade): every level multi-select
 * with a select-all, panels grouped by their dashboard and series by dashboard/panel.
 *
 * One dashboard and one panel at a time was six trips through the dropdowns to compare
 * six panels, and each trip had to be finished with "Add series" before the next.
 */

import React, { useEffect, useMemo, useState } from 'react';
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
  CompareSeries,
  RelatedTestRun,
} from '../types';
import { TestRun } from '@/types/test-runs';
import { getTestRunDisplayText, getTestRunSecondaryInfo } from '../utils/compare-utils';
import { getSourceDisplayInfo } from '@/lib/metrics-source-utils';
import {
  PanelOption,
  SeriesOption,
  fetchPanelsForDashboards,
  fetchSeriesForPanels,
  panelKey,
  seriesKey,
} from '../utils/metric-options';

export interface SeriesPick {
  dashboard: ApplicationDashboard;
  panel: PanelOption;
  metricName: string;
}

interface CompareSelectionPanelProps {
  // Test Run Selection
  relatedTestRuns: RelatedTestRun[];
  selectedTestRun: RelatedTestRun | null;
  onTestRunSelect: (testRun: RelatedTestRun | null) => void;

  // Dashboards
  allDashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;

  /** Anchor run — the panel and series lists are what it recorded. */
  testRun: TestRun | null;

  addedSeries: CompareSeries[];
  onAddSeries: (picks: SeriesPick[]) => void;
  /**
   * The first picked dashboard/panel, mirrored up for preset saving — a preset stores one
   * application_dashboard_id/panel_id and names itself after them.
   */
  onPrimaryChange: (dashboard: ApplicationDashboard | null, panel: PanelOption | null) => void;
}

export function CompareSelectionPanel({
  relatedTestRuns,
  selectedTestRun,
  onTestRunSelect,
  allDashboards,
  dashboardsLoading,
  testRun,
  addedSeries,
  onAddSeries,
  onPrimaryChange,
}: CompareSelectionPanelProps) {
  const [selectedDashboards, setSelectedDashboards] = useState<ApplicationDashboard[]>([]);
  const [panelOptions, setPanelOptions] = useState<PanelOption[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const [selectedPanels, setSelectedPanels] = useState<PanelOption[]>([]);
  const [seriesOptions, setSeriesOptions] = useState<SeriesOption[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [selectedSeries, setSelectedSeries] = useState<SeriesOption[]>([]);

  // Effects key off the selection contents, not the array identity React keeps recreating.
  const dashboardsKey = selectedDashboards.map((d) => d.id).join('|');
  const panelsKey = selectedPanels.map(panelKey).join('|');

  // Load the panels of every selected dashboard.
  useEffect(() => {
    const picked = selectedDashboards;
    if (picked.length === 0) {
      setPanelOptions([]);
      return;
    }
    let cancelled = false;
    setPanelsLoading(true);
    fetchPanelsForDashboards(picked, testRun)
      .then((lists) => { if (!cancelled) setPanelOptions(lists.flat()); })
      .finally(() => { if (!cancelled) setPanelsLoading(false); });
    return () => { cancelled = true; };
    // selectedDashboards is read through dashboardsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardsKey, testRun]);

  // Load the series of every selected panel.
  useEffect(() => {
    const picked = selectedPanels;
    if (picked.length === 0) {
      setSeriesOptions([]);
      return;
    }
    let cancelled = false;
    setSeriesLoading(true);
    fetchSeriesForPanels(picked, testRun)
      .then((lists) => { if (!cancelled) setSeriesOptions(lists.flat()); })
      .finally(() => { if (!cancelled) setSeriesLoading(false); });
    return () => { cancelled = true; };
    // selectedPanels is read through panelsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelsKey, testRun]);

  // Dropping a dashboard drops the panels and series that hung off it, or a series would be
  // added for a dashboard the form no longer shows.
  const pickDashboards = (dashboards: ApplicationDashboard[]) => {
    const kept = new Set(dashboards.map((d) => d.id));
    setSelectedDashboards(dashboards);
    const panels = selectedPanels.filter((p) => kept.has(p.dashboard.id));
    setSelectedPanels(panels);
    setSelectedSeries(selectedSeries.filter((s) => kept.has(s.panel.dashboard.id)));
    onPrimaryChange(dashboards[0] ?? null, panels[0] ?? null);
  };

  const pickPanels = (panels: PanelOption[]) => {
    const kept = new Set(panels.map(panelKey));
    setSelectedPanels(panels);
    setSelectedSeries(selectedSeries.filter((s) => kept.has(panelKey(s.panel))));
    onPrimaryChange(selectedDashboards[0] ?? null, panels[0] ?? null);
  };

  const isAdded = (s: SeriesOption) => addedSeries.some((a) =>
    a.dashboardId === (s.panel.applicationDashboardId || s.panel.dashboard.id)
    && a.panelId === s.panel.id
    && a.metricName === s.metricName);

  const addPicked = () => {
    onAddSeries(selectedSeries.map((s) => ({
      dashboard: s.panel.dashboard,
      panel: s.panel,
      metricName: s.metricName,
    })));
    setSelectedSeries([]);
  };

  const allDashboardsPicked = selectedDashboards.length === allDashboards.length && allDashboards.length > 0;
  const allPanelsPicked = selectedPanels.length === panelOptions.length && panelOptions.length > 0;
  const allSeriesPicked = selectedSeries.length === seriesOptions.length && seriesOptions.length > 0;

  const dashboardCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of panelOptions) counts.set(p.dashboardLabel, (counts.get(p.dashboardLabel) ?? 0) + 1);
    return counts;
  }, [panelOptions]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Test Run Selection */}
      <Autocomplete
        size="small"
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
            helperText={`${relatedTestRuns.length} comparable run${relatedTestRuns.length === 1 ? '' : 's'}`}
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
      />

      {/* Builder row — dashboards, panels and series side by side, the way Trends and Graphs
          lay theirs out. Stacked full-width they pushed the added-series list and the
          comparison table below the fold before you had picked anything. */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flex: '2 1 260px' }}>
        <Autocomplete
          multiple
          // Picking dashboards/panels/series is almost never one choice, and a popup that
          // closes after each made "these six" six trips through the dropdown.
          disableCloseOnSelect
          limitTags={4}
          options={allDashboards}
          getOptionLabel={(option) => option.dashboard_label || ''}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          value={selectedDashboards}
          onChange={(_, newValue) => pickDashboards(newValue)}
          loading={dashboardsLoading}
          groupBy={(option) => getSourceDisplayInfo(option).groupLabel}
          size="small"
          sx={{ flex: 1 }}
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
              label="Dashboards"
              variant="outlined"
              fullWidth
              helperText={dashboardsLoading ? 'Loading dashboards…' : `${allDashboards.length} available`}
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
        <Button
          size="small"
          onClick={() => pickDashboards(allDashboardsPicked ? [] : [...allDashboards])}
          disabled={allDashboards.length === 0}
          variant="outlined"
          sx={{ height: 40, minWidth: 92, flexShrink: 0 }}
        >
          {allDashboardsPicked ? 'Clear' : 'Select all'}
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flex: '2 1 260px' }}>
        <Autocomplete
          multiple
          disableCloseOnSelect
          limitTags={4}
          options={panelOptions}
          groupBy={(o) => o.dashboardLabel}
          getOptionLabel={(o) => o.title}
          isOptionEqualToValue={(o, v) => panelKey(o) === panelKey(v)}
          value={selectedPanels}
          onChange={(_, newValue) => pickPanels(newValue)}
          disabled={selectedDashboards.length === 0}
          loading={panelsLoading}
          size="small"
          sx={{ flex: 1 }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Panels"
              variant="outlined"
              fullWidth
              helperText={
                selectedDashboards.length === 0
                  ? 'Select a dashboard to see its panels'
                  : panelsLoading
                    ? 'Loading panels…'
                    : `${panelOptions.length} available across ${dashboardCounts.size} dashboard${dashboardCounts.size === 1 ? '' : 's'}`
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
        />
        <Button
          size="small"
          onClick={() => pickPanels(allPanelsPicked ? [] : [...panelOptions])}
          disabled={panelOptions.length === 0}
          variant="outlined"
          sx={{ height: 40, minWidth: 92, flexShrink: 0 }}
        >
          {allPanelsPicked ? 'Clear' : 'Select all'}
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flex: '3 1 320px' }}>
        <Autocomplete
          multiple
          disableCloseOnSelect
          limitTags={8}
          options={seriesOptions}
          groupBy={(o) => `${o.panel.dashboardLabel} / ${o.panel.title}`}
          getOptionLabel={(o) => o.metricName}
          isOptionEqualToValue={(o, v) => seriesKey(o) === seriesKey(v)}
          value={selectedSeries}
          onChange={(_, newValue) => setSelectedSeries(newValue)}
          disabled={selectedPanels.length === 0}
          loading={seriesLoading}
          size="small"
          sx={{ flex: 1 }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Series"
              variant="outlined"
              fullWidth
              helperText={
                selectedPanels.length === 0
                  ? 'Select a panel to see its series'
                  : seriesLoading
                    ? 'Loading series…'
                    : `${seriesOptions.length} available from ${selectedPanels.length} panel${selectedPanels.length === 1 ? '' : 's'}`
              }
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {seriesLoading ? <CircularProgress size={20} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
          renderOption={(props, option) => {
            const { key, ...otherProps } = props;
            const already = isAdded(option);
            return (
              <Box component="li" key={key} {...otherProps} sx={{
                opacity: already ? 0.5 : 1,
                backgroundColor: already ? 'action.disabledBackground' : 'inherit'
              }}>
                <Typography variant="body2">
                  {option.metricName}
                  {already && (
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
                // Default chip: the gradient version hardcoded primary.dark on a translucent
                // blue, which is close to unreadable on the dark theme.
                <Chip
                  {...tagProps}
                  key={seriesKey(option)}
                  label={option.metricName}
                  size="small"
                />
              );
            })
          }
        />
        <Button
          size="small"
          onClick={() => setSelectedSeries(allSeriesPicked ? [] : [...seriesOptions])}
          disabled={seriesOptions.length === 0}
          variant="outlined"
          sx={{ height: 40, minWidth: 92, flexShrink: 0 }}
        >
          {allSeriesPicked ? 'Clear' : 'Select all'}
        </Button>
        <Button
          variant="contained"
          onClick={addPicked}
          disabled={selectedSeries.length === 0}
          sx={{ height: 40, px: 3, whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Add {selectedSeries.length > 0 ? `${selectedSeries.length} ` : ''}series
        </Button>
      </Box>
      </Box>
    </Box>
  );
}

export default CompareSelectionPanel;
