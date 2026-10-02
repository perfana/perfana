'use client';

/**
 * Baseline run + the shared dashboards → panels → series cascade (MetricSeriesCascade),
 * the same shape the report's comparison section config uses (MetricSelectionCascade).
 */

import React from 'react';
import { Box, Typography, Autocomplete, TextField } from '@mui/material';
import {
  ApplicationDashboard,
  CompareSeries,
  RelatedTestRun,
} from '../types';
import { TestRun } from '@/types/test-runs';
import { getTestRunDisplayText, getTestRunSecondaryInfo } from '../utils/compare-utils';
import type { PanelOption, SeriesPick } from '../utils/metric-options';
import { SeriesCascadePanel } from '@/components/charts';
import type { AddedSeriesKey } from '../../shared/MetricSeriesCascade';

export type { SeriesPick };

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

/** One caption line: a run with a dozen annotations would otherwise wrap into the row above. */
export function summariseAnnotations(annotations: string[] | null | undefined): string | null {
  if (!annotations?.length) return null;
  const [first, ...rest] = annotations;
  return rest.length > 0 ? `${first} (+${rest.length} more)` : first;
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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

      {selectedTestRun && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -1 }}>
          {[
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
