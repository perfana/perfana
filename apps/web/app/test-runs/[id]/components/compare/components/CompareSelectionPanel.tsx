'use client';

/**
 * Baseline run + the shared dashboards → panels → series cascade (MetricSeriesCascade),
 * the same shape the report's comparison section config uses (MetricSelectionCascade).
 *
 * The baseline can also be the run's control group — the earlier runs anomaly detection
 * judges it against — offered first in the list when the run has one, as the report's
 * baseline picker (`BaselineRunSelect`) offers it.
 */

import React from 'react';
import { Box, Typography, Autocomplete, TextField } from '@mui/material';
import {
  ApplicationDashboard,
  CompareSeries,
  RelatedTestRun,
} from '../types';
import { TestRun } from '@/types/test-runs';
import {
  controlGroupOption,
  getTestRunDisplayText,
  getTestRunSecondaryInfo,
  isControlGroupOption,
} from '../utils/compare-utils';
import {
  controlGroupRunCount,
  formatRunCount,
  summariseControlGroupRuns,
  type ControlGroup,
} from '@/lib/control-group-baseline';
import type { PanelOption, SeriesPick } from '../utils/metric-options';
import { SeriesCascadePanel } from '@/components/charts';
import type { AddedSeriesKey } from '../../shared/MetricSeriesCascade';

export type { SeriesPick };

interface CompareSelectionPanelProps {
  // Test Run Selection
  relatedTestRuns: RelatedTestRun[];
  /** The run's control group, offered as the first baseline option. Null when it has none. */
  controlGroup?: ControlGroup | null;
  selectedTestRun: RelatedTestRun | null;
  onTestRunSelect: (testRun: RelatedTestRun | null) => void;

  // Dashboards
  allDashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;

  /** Anchor run — the panel and series lists are what it recorded. */
  testRun: TestRun | null;

  addedSeries: CompareSeries[];
  onAddSeries: (picks: SeriesPick[]) => void;
  /** Only used to report a capped wildcard card-link; every other message is the card's. */
  showToast?: (message: string) => void;
  /** Takes the series' own id — the cascade speaks in dashboard/panel/metric, so adapt. */
  onRemoveSeries: (seriesId: string) => void;
  /**
   * The first picked dashboard/panel, mirrored up for preset saving — a preset stores one
   * application_dashboard_id/panel_id and names itself after them.
   */
  onPrimaryChange: (dashboard: ApplicationDashboard | null, panel: PanelOption | null) => void;
}

/** A bad timestamp renders as the literal string "Invalid Date", which survives filter(Boolean). */
export function formatStartedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

/** Autocomplete group headers — the control group is a different kind of thing from a run. */
const GROUP_CONTROL = 'Anomaly detection baseline';
const GROUP_RUNS = 'Test runs';

/** What the "Control group" option says about itself, in the list and under the field. */
export function controlGroupHint(group: ControlGroup): string {
  return `Pooled statistics of the ${formatRunCount(controlGroupRunCount(group))} anomaly detection compares this run with — the control values on the Anomaly Detection card`;
}

/** One caption line: a run with a dozen annotations would otherwise wrap into the row above. */
export function summariseAnnotations(annotations: string[] | null | undefined): string | null {
  if (!annotations?.length) return null;
  const [first, ...rest] = annotations;
  return rest.length > 0 ? `${first} (+${rest.length} more)` : first;
}

export function CompareSelectionPanel({
  relatedTestRuns,
  controlGroup = null,
  selectedTestRun,
  onTestRunSelect,
  allDashboards,
  dashboardsLoading,
  testRun,
  addedSeries,
  onAddSeries,
  onRemoveSeries,
  onPrimaryChange,
  showToast,
}: CompareSelectionPanelProps) {
  /**
   * The cascade identifies a series by what the user picked; the card identifies it by the
   * `id` it minted on add (which carries a `Date.now()` and so cannot be rederived). This
   * is the one place that knows both.
   */
  const removeByKey = ({ dashboardId, panelId, metricName }: AddedSeriesKey) => {
    const match = addedSeries.find(
      (s) => s.dashboardId === dashboardId && s.panelId === panelId && s.metricName === metricName,
    );
    if (match) onRemoveSeries(match.id);
  };

  const options = controlGroup ? [controlGroupOption(controlGroup), ...relatedTestRuns] : relatedTestRuns;
  const runCount = `${relatedTestRuns.length} comparable run${relatedTestRuns.length === 1 ? '' : 's'}`;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Test Run Selection */}
      <Autocomplete
        options={options}
        getOptionLabel={getTestRunDisplayText}
        // The option objects are rebuilt per render; identity is the id.
        isOptionEqualToValue={(option, value) => option.test_run_id === value.test_run_id}
        groupBy={controlGroup ? (option) => (isControlGroupOption(option) ? GROUP_CONTROL : GROUP_RUNS) : undefined}
        value={selectedTestRun}
        onChange={(_, newValue) => onTestRunSelect(newValue)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Select Test Run for Comparison"
            variant="outlined"
            fullWidth
            helperText={controlGroup ? `${runCount}, or the control group` : runCount}
          />
        )}
        renderOption={(props, option) => {
          const { key, ...otherProps } = props;
          if (isControlGroupOption(option) && option.control_group) {
            return (
              <Box component="li" key={key} {...otherProps}>
                <Box sx={{ width: '100%' }}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>
                    Control group
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {controlGroupHint(option.control_group)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {getTestRunSecondaryInfo(option)}
                  </Typography>
                </Box>
              </Box>
            );
          }
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

      {selectedTestRun && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1 }}>
          {isControlGroupOption(selectedTestRun)
            ? [
                'Baseline: control group',
                selectedTestRun.control_group
                  ? formatRunCount(controlGroupRunCount(selectedTestRun.control_group))
                  : null,
                selectedTestRun.control_group
                  ? summariseControlGroupRuns(selectedTestRun.control_group.test_runs)
                  : null,
              ].filter(Boolean).join('  ·  ')
            : [
                `Baseline: ${selectedTestRun.test_run_id}`,
                formatStartedAt(selectedTestRun.start_time || selectedTestRun.created_at),
                selectedTestRun.application_release,
                summariseAnnotations(selectedTestRun.annotations),
              ].filter(Boolean).join('  ·  ')}
        </Typography>
      )}

      <SeriesCascadePanel
        card="compare"
        showToast={showToast}
        allDashboards={allDashboards}
        dashboardsLoading={dashboardsLoading}
        testRun={testRun}
        addedSeries={addedSeries}
        onAddSeries={onAddSeries}
        // Present = instant mode: checking a series adds it, unchecking removes it.
        onRemoveSeries={removeByKey}
        onPrimaryChange={onPrimaryChange}
      />
    </Box>
  );
}

export default CompareSelectionPanel;
