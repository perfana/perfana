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
  DataSource,
  RelatedTestRun,
  MetricComparison,
  GraphData,
} from '../types';
import { DynatraceMetric } from '@/lib/dynatrace';
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

  // Source selection (auto-detected from dashboard)
  selectedSource: DataSource;

  // Dashboard selection
  selectedDashboard: ApplicationDashboard | null;
  allDashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;
  dynatraceDashboardsLoading: boolean;
  onDashboardSelect: (dashboard: ApplicationDashboard | null, label?: string) => void;

  // Panel selection
  selectedMetric: Panel | null;
  panels: Panel[];
  panelsLoading: boolean;
  dynatraceMetrics: DynatraceMetric[];
  dynatraceMetricsLoading: boolean;
  onMetricSelect: (metric: Panel | null) => void;

  // Series selection
  availableMetrics: string[];
  availableMetricsLoading: boolean;
  selectedMetricNames: string[];
  setSelectedMetricNames: (names: string[]) => void;
  addedSeries: CompareSeries[];
  onAddSeries: () => void;
  onRemoveSeries: (id: string) => void;
  onClearAllSeries: () => void;

  // Metrics comparison
  metricComparisons: MetricComparison[];
  metricsLoading: boolean;
  seriesSearchText: string;
  onSeriesSearchChange: (text: string) => void;
  showPercentiles: boolean;
  onShowPercentilesChange: (show: boolean) => void;

  // Graph state
  showGraphs: Record<string, boolean>;
  graphData: Record<string, GraphData>;
  graphLoading: Record<string, boolean>;
  onToggleGraph: (name: string) => void;
  onShowGraphsChange: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  onGraphDataChange: (fn: (prev: Record<string, GraphData>) => Record<string, GraphData>) => void;
  onGraphLoadingChange: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;

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
  selectedSource,
  selectedDashboard,
  allDashboards,
  dashboardsLoading,
  dynatraceDashboardsLoading,
  onDashboardSelect,
  selectedMetric,
  panels,
  panelsLoading,
  dynatraceMetrics,
  dynatraceMetricsLoading,
  onMetricSelect,
  availableMetrics,
  availableMetricsLoading,
  selectedMetricNames,
  setSelectedMetricNames,
  addedSeries,
  onAddSeries,
  onRemoveSeries,
  onClearAllSeries,
  metricComparisons,
  metricsLoading,
  seriesSearchText,
  onSeriesSearchChange,
  showPercentiles,
  onShowPercentilesChange,
  showGraphs,
  graphData,
  graphLoading,
  onToggleGraph,
  onShowGraphsChange,
  onGraphDataChange,
  onGraphLoadingChange,
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
            selectedDashboard={selectedDashboard}
            allDashboards={allDashboards}
            dashboardsLoading={dashboardsLoading}
            dynatraceDashboardsLoading={dynatraceDashboardsLoading}
            onDashboardSelect={onDashboardSelect}
            selectedSource={selectedSource}
            selectedMetric={selectedMetric}
            panels={panels}
            panelsLoading={panelsLoading}
            dynatraceMetrics={dynatraceMetrics}
            dynatraceMetricsLoading={dynatraceMetricsLoading}
            onMetricSelect={onMetricSelect}
            availableMetrics={availableMetrics}
            availableMetricsLoading={availableMetricsLoading}
            selectedMetricNames={selectedMetricNames}
            setSelectedMetricNames={setSelectedMetricNames}
            addedSeries={addedSeries}
            onAddSeries={onAddSeries}
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
                Select a dashboard, panel, and series above, then click &quot;Add Series&quot; to start comparing metrics
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
                showPercentiles={showPercentiles}
                onShowPercentilesChange={onShowPercentilesChange}
                selectedDashboard={selectedDashboard}
                selectedMetric={selectedMetric}
                onSavePresetClick={onSavePresetClick}
                showGraphs={showGraphs}
                graphData={graphData}
                graphLoading={graphLoading}
                onToggleGraph={onToggleGraph}
                onShowGraphsChange={onShowGraphsChange}
                onGraphDataChange={onGraphDataChange}
                onGraphLoadingChange={onGraphLoadingChange}
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
