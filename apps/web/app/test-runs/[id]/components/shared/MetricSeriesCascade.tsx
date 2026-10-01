'use client';

/**
 * Dashboards → panels → series cascade shared by the Compare, Trends and Graphs cards:
 * every level multi-select with a select-all, panels grouped by their dashboard and
 * series by dashboard/panel.
 *
 * One dashboard and one panel at a time was six trips through the dropdowns to plot
 * six panels, and each trip had to be finished with "Add series" before the next.
 *
 * Presentation is the Analyst standard's `SeriesCascadePanel`: three inline scrolling
 * columns instead of three Autocomplete popups. The popups hid the levels behind each
 * other — you could not see which panels a dashboard had while choosing the dashboard —
 * and each one closed over the chart it was feeding. Every behaviour below is unchanged:
 * the fetches, the card-link preselect and its once-per-page-load consumption, dropping
 * child selections when a parent is unpicked, the already-added greying, and the counts.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Box, Typography, Checkbox, CircularProgress, Button } from '@mui/material';
import { TestRun } from '@/types/test-runs';
import { getSourceDisplayInfo } from '@/lib/metrics-source-utils';
import { MONO, SIZE, chartTheme, unitText, type ChartMode } from '@/lib/charts';
import { ALL_AGGREGATED_OPTION, buildAggregatedMetricName, isAllAggregatedDashboard, rtKeeperPanelId } from '@/lib/aggregated-perf-series';
import HostLabelChips from '@/components/HostLabelChips';
import {
  ApplicationDashboard,
  PERFORMANCE_METRICS_PANEL_UNITS,
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
  /** Closes the panel without adding. Omitted where the cascade is always on screen. */
  onCancel?: () => void;
  mode?: ChartMode;
}

// ponytail: a link is applied once per page load, not once per mount. The card unmounts on
// every tab switch and collapse while the URL keeps its params, so without this the picks
// the user cleared come back on re-expand. Module state resets on reload, which re-applies.
const consumedLinks = new Set<string>();

const COLUMN_HEIGHT = 208;

const plural = (n: number, word: string) => `${word}${n === 1 ? '' : 's'}`;

export function MetricSeriesCascade({
  allDashboards,
  dashboardsLoading,
  testRun,
  addedSeries,
  onAddSeries,
  onPrimaryChange,
  panelListOptions,
  card,
  onCancel,
  mode = 'light',
}: MetricSeriesCascadeProps) {
  const theme = chartTheme(mode);
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
    onCancel?.();
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
    // A dashboard-only link (a Dynatrace host) names no panel: take them all.
    if (want.panelId === undefined) {
      if (panelOptions.length > 0) pickPanels([...panelOptions]);
      else disarm();
      return;
    }
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
    if (want.metricName === undefined) {
      setSelectedSeries([...seriesOptions]);
    } else {
      const series = seriesOptions.find((s) => s.metricName === want.metricName);
      if (series) setSelectedSeries([series]);
    }
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

  const pickedDashboardIds = new Set(selectedDashboards.map((d) => d.id));
  const pickedPanelKeys = new Set(selectedPanels.map(panelKey));
  const pickedSeriesKeys = new Set(selectedSeries.map(seriesKey));

  const toggleDashboard = (dashboard: ApplicationDashboard) => {
    disarm();
    pickDashboards(
      pickedDashboardIds.has(dashboard.id)
        ? selectedDashboards.filter((d) => d.id !== dashboard.id)
        : [...selectedDashboards, dashboard],
    );
  };
  const togglePanel = (panel: PanelOption) => {
    disarm();
    pickPanels(
      pickedPanelKeys.has(panelKey(panel))
        ? selectedPanels.filter((p) => panelKey(p) !== panelKey(panel))
        : [...selectedPanels, panel],
    );
  };
  const toggleSeries = (series: SeriesOption) => {
    disarm();
    setSelectedSeries(
      pickedSeriesKeys.has(seriesKey(series))
        ? selectedSeries.filter((s) => seriesKey(s) !== seriesKey(series))
        : [...selectedSeries, series],
    );
  };

  // Dashboards by source (Grafana / Dynatrace / Performance test), panels by dashboard,
  // series by dashboard/panel — the same grouping the Autocompletes used.
  const dashboardGroups = groupBy(allDashboards, (d) => getSourceDisplayInfo(d).groupLabel);
  const panelGroups = groupBy(panelOptions, (p) => p.dashboardLabel);
  const seriesGroups = groupBy(seriesOptions, (s) => `${s.panel.dashboardLabel} / ${s.panel.title}`);

  const panelUnitOf = (panel: PanelOption) =>
    unitText(
      panel.yAxesFormat
      ?? (panel.source === 'performance-metrics' ? PERFORMANCE_METRICS_PANEL_UNITS[panel.id] : undefined),
    );

  return (
    <Box
      sx={{
        border: `1px solid ${theme.divider}`,
        borderRadius: `${SIZE.radius}px`,
        overflow: 'hidden',
        bgcolor: theme.paper,
      }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.15fr' }}>
        <Column
          theme={theme}
          label="Dashboards"
          heading={`dashboards ${allDashboards.length}`}
          caption={dashboardsLoading ? 'Loading dashboards…' : `${allDashboards.length} available`}
          allPicked={allDashboardsPicked}
          onToggleAll={() => { disarm(); pickDashboards(allDashboardsPicked ? [] : [...allDashboards]); }}
          toggleDisabled={allDashboards.length === 0}
          divider
        >
          {dashboardGroups.map(([group, dashboards]) => (
            <Group key={group} label={group} color={getSourceDisplayInfo(dashboards[0]).color}>
              {dashboards.map((dashboard) => (
                <Row
                  key={dashboard.id}
                  theme={theme}
                  checked={pickedDashboardIds.has(dashboard.id)}
                  onToggle={() => toggleDashboard(dashboard)}
                  label={dashboard.dashboard_label}
                  trailing={
                    <>
                      <HostLabelChips labels={dashboard.hostLabels} />
                      {dashboardCounts.has(dashboard.dashboard_label) && (
                        <Hint theme={theme}>{dashboardCounts.get(dashboard.dashboard_label)}</Hint>
                      )}
                    </>
                  }
                />
              ))}
            </Group>
          ))}
        </Column>

        <Column
          theme={theme}
          label="Panels"
          heading={`panels ${panelOptions.length}`}
          caption={
            selectedDashboards.length === 0
              ? 'Select a dashboard to see its panels'
              : panelsLoading
                ? 'Loading panels…'
                : `${panelOptions.length} available across ${dashboardCounts.size} ${plural(dashboardCounts.size, 'dashboard')}`
          }
          allPicked={allPanelsPicked}
          onToggleAll={() => { disarm(); pickPanels(allPanelsPicked ? [] : [...panelOptions]); }}
          toggleDisabled={panelOptions.length === 0}
          loading={panelsLoading}
          empty={selectedDashboards.length === 0}
          divider
        >
          {panelGroups.map(([group, panels]) => (
            <Group key={group} label={group} color={theme.faint}>
              {panels.map((panel) => (
                <Row
                  key={panelKey(panel)}
                  theme={theme}
                  checked={pickedPanelKeys.has(panelKey(panel))}
                  onToggle={() => togglePanel(panel)}
                  label={panel.title}
                  trailing={panelUnitOf(panel) ? <Hint theme={theme}>{panelUnitOf(panel)}</Hint> : null}
                />
              ))}
            </Group>
          ))}
        </Column>

        <Column
          theme={theme}
          label="Series"
          heading={`series ${seriesOptions.length}`}
          caption={
            selectedPanels.length === 0
              ? 'Select a panel to see its series'
              : seriesLoading
                ? 'Loading series…'
                : `${seriesOptions.length} available from ${selectedPanels.length} ${plural(selectedPanels.length, 'panel')}`
          }
          allPicked={allSeriesPicked}
          onToggleAll={() => { disarm(); setSelectedSeries(allSeriesPicked ? [] : [...seriesOptions]); }}
          toggleDisabled={seriesOptions.length === 0}
          loading={seriesLoading}
          empty={selectedPanels.length === 0}
        >
          {seriesGroups.map(([group, options]) => (
            <Group key={group} label={group} color={theme.faint}>
              {options.map((option) => {
                const already = isAdded(option);
                return (
                  <Row
                    key={seriesKey(option)}
                    theme={theme}
                    checked={pickedSeriesKeys.has(seriesKey(option))}
                    onToggle={() => toggleSeries(option)}
                    disabled={already}
                    label={option.metricName}
                    trailing={already ? <Hint theme={theme}>added</Hint> : null}
                  />
                );
              })}
            </Group>
          ))}
        </Column>
      </Box>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 1.25,
          py: 0.75,
          bgcolor: theme.plotBg,
          borderTop: `1px solid ${theme.divider}`,
        }}
      >
        <Typography sx={{ flex: 1, fontFamily: MONO, fontSize: 10, color: theme.faint }} noWrap>
          {selectedDashboards.length} dashboards · {selectedPanels.length} panels ·{' '}
          {selectedSeries.length} series selected
        </Typography>
        {onCancel && (
          <Box
            component="button"
            type="button"
            onClick={onCancel}
            sx={{
              border: 0,
              bgcolor: 'transparent',
              p: 0,
              cursor: 'pointer',
              fontFamily: MONO,
              fontSize: 11,
              color: theme.faint,
              '&:hover': { color: theme.muted },
            }}
          >
            cancel
          </Box>
        )}
        <Box
          component="button"
          type="button"
          onClick={addPicked}
          disabled={selectedSeries.length === 0}
          sx={{
            height: 24,
            px: 1.25,
            borderRadius: '4px',
            border: `1px solid ${selectedSeries.length === 0 ? theme.divider : theme.selectedBorder}`,
            bgcolor: selectedSeries.length === 0 ? 'transparent' : theme.selectedBg,
            cursor: selectedSeries.length === 0 ? 'default' : 'pointer',
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 600,
            color: selectedSeries.length === 0 ? theme.faint : theme.primary,
          }}
        >
          Add {selectedSeries.length > 0 ? `${selectedSeries.length} ` : ''}series
        </Box>
      </Box>
    </Box>
  );
}

type Theme = ReturnType<typeof chartTheme>;

function groupBy<T>(items: T[], key: (item: T) => string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = groups.get(k);
    if (bucket) bucket.push(item);
    else groups.set(k, [item]);
  }
  return Array.from(groups.entries());
}

function Column({
  theme,
  label,
  heading,
  caption,
  allPicked,
  onToggleAll,
  toggleDisabled,
  loading,
  empty,
  divider,
  children,
}: {
  theme: Theme;
  label: string;
  heading: string;
  caption: string;
  allPicked: boolean;
  onToggleAll: () => void;
  toggleDisabled: boolean;
  loading?: boolean;
  empty?: boolean;
  divider?: boolean;
  children: React.ReactNode;
}) {
  return (
    // The aria-label is the handle every test and screen reader reaches this level by.
    <Box
      role="group"
      aria-label={label}
      sx={{
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: divider ? `1px solid ${theme.divider}` : 'none',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, pt: 0.75 }}>
        <Typography sx={{ flex: 1, fontFamily: MONO, fontSize: 10, fontWeight: 600, color: theme.muted }} noWrap>
          {heading}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          onClick={onToggleAll}
          disabled={toggleDisabled}
          sx={{
            minWidth: 0,
            px: 0.75,
            py: 0,
            border: 0,
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'none',
            color: theme.primary,
            '&:hover': { border: 0, bgcolor: theme.hover },
          }}
        >
          {allPicked ? 'Clear' : 'Select all'}
        </Button>
      </Box>
      <Typography sx={{ px: 1.25, pb: 0.5, fontFamily: MONO, fontSize: 10, color: theme.faint }} noWrap>
        {caption}
      </Typography>
      <Box sx={{ height: COLUMN_HEIGHT, overflowY: 'auto', overflowX: 'hidden', px: 0.5, pb: 0.5 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 2 }}>
            <CircularProgress size={16} />
          </Box>
        ) : empty ? null : (
          children
        )}
      </Box>
    </Box>
  );
}

function Group({
  label,
  color,
  children,
}: {
  label: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ mb: 0.5 }}>
      <Typography
        sx={{
          px: 0.75,
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color,
        }}
        noWrap
        title={label}
      >
        {label}
      </Typography>
      {children}
    </Box>
  );
}

function Row({
  theme,
  checked,
  onToggle,
  label,
  trailing,
  disabled,
}: {
  theme: Theme;
  checked: boolean;
  onToggle: () => void;
  label: string;
  trailing?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.5,
        borderRadius: '3px',
        opacity: disabled ? 0.45 : 1,
        '&:hover': { bgcolor: disabled ? 'transparent' : theme.hover },
      }}
    >
      <Checkbox
        size="small"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        inputProps={{ 'aria-label': label }}
        sx={{ p: 0.25, color: theme.faint, '&.Mui-checked': { color: theme.primary } }}
      />
      <Typography
        onClick={disabled ? undefined : onToggle}
        sx={{
          flex: 1,
          minWidth: 0,
          fontFamily: MONO,
          fontSize: 11,
          color: theme.text,
          cursor: disabled ? 'default' : 'pointer',
        }}
        noWrap
        title={label}
      >
        {label}
      </Typography>
      {trailing}
    </Box>
  );
}

function Hint({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return (
    <Typography
      component="span"
      sx={{ flexShrink: 0, fontFamily: MONO, fontSize: 9, color: theme.faint }}
    >
      {children}
    </Typography>
  );
}

/** The Analyst standard's name for the same component. */
export const SeriesCascadePanel = MetricSeriesCascade;

export default MetricSeriesCascade;
