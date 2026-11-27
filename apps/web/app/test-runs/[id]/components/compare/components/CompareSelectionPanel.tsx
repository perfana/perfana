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
import { Box } from '@mui/material';
import {
  ApplicationDashboard,
  CompareSeries,
  RelatedTestRun,
} from '../types';
import { TestRun } from '@/types/test-runs';
import type { ControlGroup } from '@/lib/control-group-baseline';
import { BaselineTestRunSelect } from '../../shared/BaselineTestRunSelect';
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

export { formatStartedAt, controlGroupHint, summariseAnnotations } from '../../shared/BaselineTestRunSelect';

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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Test Run Selection */}
      <BaselineTestRunSelect
        relatedTestRuns={relatedTestRuns}
        controlGroup={controlGroup}
        value={selectedTestRun}
        onChange={onTestRunSelect}
      />

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
