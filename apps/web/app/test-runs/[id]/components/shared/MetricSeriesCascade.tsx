'use client';

/**
 * Dashboards → panels → series cascade shared by the Compare, Trends and Graphs cards:
 * every level multi-select with a select-all, panels grouped by their dashboard and
 * series by dashboard/panel.
 *
 * One dashboard and one panel at a time was six trips through the dropdowns to plot
 * six panels, and each trip had to be finished with "Add series" before the next.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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
import { TestRun } from '@/types/test-runs';
import { getSourceDisplayInfo } from '@/lib/metrics-source-utils';
import { ALL_AGGREGATED_OPTION, buildAggregatedMetricName, isAllAggregatedDashboard, rtKeeperPanelId } from '@/lib/aggregated-perf-series';
import HostLabelChips from '@/components/HostLabelChips';
import {
  ApplicationDashboard,
  PanelListOptions,
  PanelOption,
  SeriesOption,
  SeriesPick,
  fetchPanelsForDashboards,
  fetchSeriesForPanels,
  panelKey,
  seriesKey,
} from './metric-options';
import { LinkableCard, readCardLinkPreselect } from './metric-card-links';

/** The identity every card's added-series list carries, used to grey out picked series. */
export interface AddedSeriesKey {
  dashboardId: string;
  panelId: number;
  metricName: string;
}

interface MetricSeriesCascadeProps {
  allDashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;
  /** Anchor run — the panel and series lists are what it recorded. */
  testRun: TestRun | null;
  addedSeries: AddedSeriesKey[];
  onAddSeries: (picks: SeriesPick[]) => void;
  /**
   * The first picked dashboard/panel, mirrored up for preset saving — a preset stores one
   * application_dashboard_id/panel_id and names itself after them.
   */
  onPrimaryChange?: (dashboard: ApplicationDashboard | null, panel: PanelOption | null) => void;
  /** Which per-card extras the panel list gets; see PanelListOptions. */
  panelListOptions?: PanelListOptions;
  /** Which card this is, so a `?card=…&dashboard=…&panel=…&metric=…` link preselects it. */
  card: LinkableCard;
}

// Trends/Graphs use default-size inputs with 56px buttons; 92 stops "Select all" from
// resizing when it toggles to "Clear".
const PICKER_BUTTON_SX = { height: '56px', minWidth: 92, flexShrink: 0 } as const;

// ponytail: a link is applied once per page load, not once per mount. The card unmounts on
// every tab switch and collapse while the URL keeps its params, so without this the picks
// the user cleared come back on re-expand. Module state resets on reload, which re-applies.
const consumedLinks = new Set<string>();

export function MetricSeriesCascade({
  allDashboards,
  dashboardsLoading,
  testRun,
  addedSeries,
  onAddSeries,
  onPrimaryChange,
  panelListOptions,
  card,
}: MetricSeriesCascadeProps) {
  const [selectedDashboards, setSelectedDashboards] = useState<ApplicationDashboard[]>([]);
  const [panelOptions, setPanelOptions] = useState<PanelOption[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const [selectedPanels, setSelectedPanels] = useState<PanelOption[]>([]);
  const [seriesOptions, setSeriesOptions] = useState<SeriesOption[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [selectedSeries, setSelectedSeries] = useState<SeriesOption[]>([]);

  // Effects key off the selection contents, not the array identity React keeps recreating —
  // and off the run's identity, not the run object, which the page replaces on every
  // refresh (a tag edit, a job completing) and would otherwise reload every picker.
  const dashboardsKey = selectedDashboards.map((d) => d.id).join('|');
  const panelsKey = selectedPanels.map(panelKey).join('|');
  const runKey = testRun ? `${testRun.test_run_id}|${testRun.system_under_test_id}|${testRun.test_environment}|${testRun.workload}` : '';
  // Which selection the current option lists belong to: an empty list for a selection that
  // has not loaded yet is not an empty result.
  const panelsFor = useRef('');
  const seriesFor = useRef('');

  // Load the panels of every selected dashboard.
  useEffect(() => {
    const picked = selectedDashboards;
    if (picked.length === 0) {
      setPanelOptions([]);
      return;
    }
    let cancelled = false;
    setPanelsLoading(true);
    fetchPanelsForDashboards(picked, testRun, panelListOptions)
      .then((lists) => { if (!cancelled) { panelsFor.current = dashboardsKey; setPanelOptions(lists.flat()); } })
      .finally(() => { if (!cancelled) setPanelsLoading(false); });
    return () => { cancelled = true; };
    // selectedDashboards is read through dashboardsKey, testRun through runKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardsKey, runKey]);

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
      .then((lists) => { if (!cancelled) { seriesFor.current = panelsKey; setSeriesOptions(lists.flat()); } })
      .finally(() => { if (!cancelled) setSeriesLoading(false); });
    return () => { cancelled = true; };
    // selectedPanels is read through panelsKey, testRun through runKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelsKey, runKey]);

  // Dropping a dashboard drops the panels and series that hung off it, or a series would be
  // added for a dashboard the form no longer shows.
  const pickDashboards = (dashboards: ApplicationDashboard[]) => {
    const kept = new Set(dashboards.map((d) => d.id));
    setSelectedDashboards(dashboards);
    const panels = selectedPanels.filter((p) => kept.has(p.dashboard.id));
    setSelectedPanels(panels);
    setSelectedSeries(selectedSeries.filter((s) => kept.has(s.panel.dashboard.id)));
    onPrimaryChange?.(dashboards[0] ?? null, panels[0] ?? null);
  };

  const pickPanels = (panels: PanelOption[]) => {
    const kept = new Set(panels.map(panelKey));
    setSelectedPanels(panels);
    setSelectedSeries(selectedSeries.filter((s) => kept.has(panelKey(s.panel))));
    onPrimaryChange?.(selectedDashboards[0] ?? null, panels[0] ?? null);
  };

  // The cards store the synthetic run-wide aggregate under its composed name; compare
  // against that, or the option never greys out once added.
  const storedName = (s: SeriesOption) =>
    s.metricName === ALL_AGGREGATED_OPTION && !isAllAggregatedDashboard(s.panel.dashboardLabel)
      ? buildAggregatedMetricName(s.panel.title)
      : s.metricName;
  const isAdded = (s: SeriesOption) => addedSeries.some((a) =>
    a.dashboardId === (s.panel.applicationDashboardId || s.panel.dashboard.id)
    && a.panelId === s.panel.id
    && a.metricName === storedName(s));

  const addPicked = () => {
    onAddSeries(selectedSeries.map((s) => ({
      dashboard: s.panel.dashboard,
      panel: s.panel,
      metricName: s.metricName,
    })));
    setSelectedSeries([]);
  };

  // Preselect from a row's "Open in …" link: one step per level, each as its options land,
  // then never again — the user can clear what the link picked. The ref is disarmed the
  // moment a level cannot be satisfied (option missing, or the list loaded empty), or the
  // user picks by hand; an armed ref would otherwise hijack the next manual pick.
  const searchParams = useSearchParams();
  const linkKey = `${card}?${searchParams.toString()}`;
  const preselect = useRef(consumedLinks.has(linkKey) ? null : readCardLinkPreselect(searchParams, card));
  const disarm = () => { preselect.current = null; consumedLinks.add(linkKey); };
  useEffect(() => {
    const want = preselect.current;
    if (!want || selectedDashboards.length > 0 || dashboardsLoading) return;
    const dashboard = allDashboards.find((d) => d.dashboard_label === want.dashboardLabel);
    if (dashboard) pickDashboards([dashboard]);
    else if (allDashboards.length > 0) disarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDashboards, dashboardsLoading]);
  useEffect(() => {
    const want = preselect.current;
    if (!want || selectedPanels.length > 0 || selectedDashboards.length === 0 || panelsFor.current !== dashboardsKey) return;
    // Compare folds the percentile RT panels onto the Avg one (collapsePerfRtPanels) —
    // a perf-test rule, so a Grafana panel that happens to be numbered 101 must not match.
    const keeper = rtKeeperPanelId(want.panelId);
    const panel = panelOptions.find((p) => p.id === want.panelId)
      ?? panelOptions.find((p) => p.id === keeper && p.source === 'performance-metrics');
    if (panel) pickPanels([panel]);
    else disarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOptions]);
  useEffect(() => {
    const want = preselect.current;
    if (!want || selectedPanels.length === 0 || seriesFor.current !== panelsKey) return;
    const series = seriesOptions.find((s) => s.metricName === want.metricName);
    if (series) setSelectedSeries([series]);
    disarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesOptions]);

  const allDashboardsPicked = selectedDashboards.length === allDashboards.length && allDashboards.length > 0;
  const allPanelsPicked = selectedPanels.length === panelOptions.length && panelOptions.length > 0;
  const allSeriesPicked = selectedSeries.length === seriesOptions.length && seriesOptions.length > 0;

  const dashboardCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of panelOptions) counts.set(p.dashboardLabel, (counts.get(p.dashboardLabel) ?? 0) + 1);
    return counts;
  }, [panelOptions]);

  return (
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
          onChange={(_, newValue) => { disarm(); pickDashboards(newValue); }}
          loading={dashboardsLoading}
          groupBy={(option) => getSourceDisplayInfo(option).groupLabel}
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
                <HostLabelChips labels={option.hostLabels} />
              </Box>
            );
          }}
        />
        <Button
          size="small"
          onClick={() => pickDashboards(allDashboardsPicked ? [] : [...allDashboards])}
          disabled={allDashboards.length === 0}
          variant="outlined"
          sx={PICKER_BUTTON_SX}
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
          onChange={(_, newValue) => { disarm(); pickPanels(newValue); }}
          disabled={selectedDashboards.length === 0}
          loading={panelsLoading}
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
          sx={PICKER_BUTTON_SX}
        >
          {allPanelsPicked ? 'Clear' : 'Select all'}
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flex: '3 1 480px' }}>
        <Autocomplete
          multiple
          disableCloseOnSelect
          limitTags={8}
          options={seriesOptions}
          groupBy={(o) => `${o.panel.dashboardLabel} / ${o.panel.title}`}
          getOptionLabel={(o) => o.metricName}
          isOptionEqualToValue={(o, v) => seriesKey(o) === seriesKey(v)}
          value={selectedSeries}
          onChange={(_, newValue) => { disarm(); setSelectedSeries(newValue); }}
          disabled={selectedPanels.length === 0}
          loading={seriesLoading}
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
          sx={PICKER_BUTTON_SX}
        >
          {allSeriesPicked ? 'Clear' : 'Select all'}
        </Button>
        <Button
          variant="contained"
          onClick={addPicked}
          disabled={selectedSeries.length === 0}
          sx={{ height: '56px', px: 3, whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Add {selectedSeries.length > 0 ? `${selectedSeries.length} ` : ''}series
        </Button>
      </Box>
    </Box>
  );
}

export default MetricSeriesCascade;
