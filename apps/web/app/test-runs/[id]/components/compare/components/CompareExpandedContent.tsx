'use client';

import React from 'react';
import {
  Box,
  Typography,
  CircularProgress,
} from '@mui/material';
import {
  ApplicationDashboard,
  Panel,
  CompareSeries,
  RelatedTestRun,
  MetricComparison,
  GraphData,
} from '../types';
import { DisplayConfig } from '../utils/compare-utils';
import type { SeriesPick } from './CompareSelectionPanel';
import type { PanelOption } from '../utils/metric-options';
import {
  CompareSelectionPanel,
  CompareDiffTable,
  AddedSeriesDisplay,
} from './index';
import ComparePresetsTable from '../ComparePresetsTable';
import { ComparePreset } from '../ComparePresetsTable';
import { TestRun } from '@/types/test-runs';

interface CompareExpandedContentProps {
  // Loading state
  loading: boolean;

  // Presets
  presets: ComparePreset[];
  presetsLoading: boolean;
  currentUserId?: string;
  onApplyPreset: (preset: ComparePreset) => void;
  onDeletePreset: (id: string) => void;
  onSavePresetClick: () => void;

  // Test runs
  relatedTestRuns: RelatedTestRun[];
  selectedTestRun: RelatedTestRun | null;
  onTestRunSelect: (testRun: RelatedTestRun | null) => void;

  // Dashboards — the cascade below picks dashboards, panels and series from these
  allDashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;

  /** First picked dashboard/panel, kept for preset saving. */
  selectedDashboard: ApplicationDashboard | null;
  selectedMetric: Panel | null;
  onPrimarySelectionChange: (dashboard: ApplicationDashboard | null, panel: PanelOption | null) => void;

  addedSeries: CompareSeries[];
  onAddSeries: (picks: SeriesPick[]) => void;
  onRemoveSeries: (id: string) => void;
  onClearAllSeries: () => void;

  // Metrics comparison
  metricComparisons: MetricComparison[];
  metricsLoading: boolean;
  seriesSearchText: string;
  onSeriesSearchChange: (text: string) => void;
  displayConfig: DisplayConfig;
  onDisplayConfigChange: (cfg: DisplayConfig) => void;

  // Graph state
  showGraphs: Record<string, boolean>;
  graphData: Record<string, GraphData>;
  graphLoading: Record<string, boolean>;
  onToggleGraph: (row: { dashboardId: string; panelId: number; metricName: string }) => void;

  // Test run context
  testRun: TestRun | null;
  testRunId: string;
  showToast: (message: string) => void;
}

export function CompareExpandedContent({
  loading,
  presets,
  presetsLoading,
  currentUserId,
  onApplyPreset,
  onDeletePreset,
  onSavePresetClick,
  relatedTestRuns,
  selectedTestRun,
  onTestRunSelect,
  allDashboards,
  dashboardsLoading,
  selectedDashboard,
  selectedMetric,
  onPrimarySelectionChange,
  addedSeries,
  onAddSeries,
  onRemoveSeries,
  onClearAllSeries,
  metricComparisons,
  metricsLoading,
  seriesSearchText,
  onSeriesSearchChange,
  displayConfig,
  onDisplayConfigChange,
  showGraphs,
  graphData,
  graphLoading,
  onToggleGraph,
  testRun,
  testRunId,
  showToast,
}: CompareExpandedContentProps) {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Saved Presets Section */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
          Saved Filter Presets
        </Typography>
        <ComparePresetsTable
          presets={presets}
          loading={presetsLoading}
          currentUserId={currentUserId}
          onSelectPreset={onApplyPreset}
          onDeletePreset={onDeletePreset}
        />
      </Box>

      {relatedTestRuns.length > 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Selection Panel */}
          <CompareSelectionPanel
            relatedTestRuns={relatedTestRuns}
            selectedTestRun={selectedTestRun}
            onTestRunSelect={onTestRunSelect}
            allDashboards={allDashboards}
            dashboardsLoading={dashboardsLoading}
            testRun={testRun}
            addedSeries={addedSeries}
            onAddSeries={onAddSeries}
            onPrimaryChange={onPrimarySelectionChange}
          />

          {/* Added Series Display */}
          <AddedSeriesDisplay
            addedSeries={addedSeries}
            onRemoveSeries={onRemoveSeries}
            onClearAll={onClearAllSeries}
          />

          {/* Prompt to add series */}
          {selectedTestRun && addedSeries.length === 0 && (
            <Box sx={{
              p: 3,
              border: '2px dashed',
              borderColor: 'primary.light',
              borderRadius: 2,
              backgroundColor: 'rgba(25, 118, 210, 0.02)',
              textAlign: 'center',
              mb: 2
            }}>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
                No series added yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Pick dashboards, panels and series above, then click &quot;Add series&quot; to start comparing metrics
              </Typography>
            </Box>
          )}

          {/* Selected Test Run Details */}
          {selectedTestRun && (
            <Box sx={{
              p: 2,
              border: '1px solid',
              borderColor: 'primary.main',
              borderRadius: 2,
              backgroundColor: 'rgba(25, 118, 210, 0.04)'
            }}>
              <Typography variant="subtitle2" sx={{ mb: 1, color: 'primary.main', fontWeight: 600 }}>
                Comparing With (Baseline)
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {selectedTestRun.test_run_id}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Started: {new Date(selectedTestRun.start_time || selectedTestRun.created_at).toLocaleString()}
              </Typography>
              {selectedTestRun.application_release && (
                <Typography variant="body2" color="text.secondary">
                  Version: {selectedTestRun.application_release}
                </Typography>
              )}
              {selectedTestRun.annotations && selectedTestRun.annotations.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  Annotations: {selectedTestRun.annotations.join(', ')}
                </Typography>
              )}
            </Box>
          )}

          {/* Metrics Comparison Table */}
          {selectedTestRun && addedSeries.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                Metrics Comparison ({addedSeries.length} series)
              </Typography>

              <CompareDiffTable
                metricComparisons={metricComparisons}
                addedSeries={addedSeries}
                metricsLoading={metricsLoading}
                seriesSearchText={seriesSearchText}
                onSeriesSearchChange={onSeriesSearchChange}
                displayConfig={displayConfig}
                onDisplayConfigChange={onDisplayConfigChange}
                selectedDashboard={selectedDashboard}
                selectedMetric={selectedMetric}
                onSavePresetClick={onSavePresetClick}
                showGraphs={showGraphs}
                graphData={graphData}
                graphLoading={graphLoading}
                onToggleGraph={onToggleGraph}
                testRun={testRun}
                testRunId={testRunId}
                selectedTestRun={selectedTestRun}
                relatedTestRuns={relatedTestRuns}
                showToast={showToast}
              />
            </Box>
          )}
        </Box>
      ) : (
        <Box sx={{ textAlign: 'center', py: 3 }}>
          <Typography variant="body2" color="text.secondary">
            No related test runs found for comparison
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Test runs must share the same system, environment, and workload to be comparable
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export default CompareExpandedContent;
