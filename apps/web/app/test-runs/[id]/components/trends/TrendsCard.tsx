'use client';

import React, { useRef, useState } from 'react';
import { Box, Typography, Card, CardContent, Collapse, CircularProgress } from '@mui/material';

// Types
import { TrendsCardProps } from './types';

// Hooks
import { useTrendsData, useTrendsPresets, useTrendsPlot } from './hooks';

// Components
import { TrendsCollapsedView, TrendsSelectionControls, TrendsChart } from './components';
import TrendsPresetsTable from './TrendsPresetsTable';
import SaveTrendsPresetModal from './SaveTrendsPresetModal';
import ExpandableCardHeader, { kickPlotlyResize } from '../shared/ExpandableCardHeader';
import PresetsAccordion from '../shared/PresetsAccordion';
import type { SeriesPick } from '../shared/metric-options';
import { SeriesCascadePanel } from '@/components/charts';

export default function TrendsCard({
  testRun,
  testRunId,
  trendsExpanded,
  onTrendsExpand,
  showToast
}: TrendsCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Which run the cursor is on. Lives here because both the chart (hover) and the plot
  // hook (the table's cursor column) need it.
  const [cursorIndex, setCursorIndex] = useState<number | null>(null);

  // Data hook
  const trendsData = useTrendsData({
    testRun,
    testRunId,
    trendsExpanded,
  });

  // Presets hook
  const trendsPresets = useTrendsPresets({
    testRun,
    testRunId,
    showToast,
    selectedSource: trendsData.selectedSource,
    addedSeries: trendsData.addedSeries,
    dashboards: trendsData.dashboards,
    fetchApplicationDashboards: trendsData.fetchApplicationDashboards,
    setSelectedSource: trendsData.setSelectedSource,
    setSelectedDashboard: trendsData.setSelectedDashboard,
    setSelectedMetric: trendsData.setSelectedMetric,
    setEvaluateType: trendsData.setEvaluateType,
    setAddedSeries: trendsData.setAddedSeries,
  });

  // Plot hook
  const trendsPlot = useTrendsPlot({
    metricsData: trendsData.metricsData,
    trendsExpanded,
    addedSeries: trendsData.addedSeries,
    showToast,
    cursorIndex,
  });

  const first = trendsData.addedSeries[0];

  // Handle expand/collapse
  const handleTrendsExpand = () => {
    const wasCollapsed = !trendsExpanded;
    onTrendsExpand();

    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector('[data-testid="trends-card-expanded"]');
        if (expandedCard) {
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }
  };

  // Handle adding series with toast notification
  const handleAddSeries = (picks: SeriesPick[]) => {
    const count = trendsData.handleAddSeries(picks);
    if (count > 0) {
      showToast(`Added ${count} series to chart`);
    } else {
      showToast('Series already added to chart');
    }
  };

  return (
    <Box sx={{
      ...(trendsExpanded ? {
        flex: '1 1 100% !important',
        minWidth: 'unset'
      } : {})
    }}>
      <Card
        ref={cardRef}
        tabIndex={-1}
        data-testid={trendsExpanded ? 'trends-card-expanded' : 'trends-card-collapsed'}
        elevation={0}
        sx={{
          cursor: trendsExpanded ? 'default' : 'pointer',
          height: trendsExpanded ? 'auto' : '293px',
          borderRadius: 3,
          bgcolor: 'background.paper',
          border: 'none',
          borderTop: trendsExpanded ? 'none' : '3px solid',
          borderTopColor: trendsExpanded ? undefined : 'primary.main',
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
            : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          overflow: trendsExpanded ? 'visible' : 'hidden',
          '&:hover': trendsExpanded ? {} : {
            transform: 'translateY(-4px)',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 4px 12px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3)'
              : '0 4px 12px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.08)',
          }
        }}
        onClick={trendsExpanded ? undefined : handleTrendsExpand}
      >
        <CardContent sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          p: trendsExpanded ? 2 : 3.5,
          pt: trendsExpanded ? 2 : 4,
          '&:last-child': { pb: trendsExpanded ? 2 : 3.5 }
        }}>
          {/* Header Section */}
          <ExpandableCardHeader title="Trends" expanded={trendsExpanded} onToggle={handleTrendsExpand} />

          {/* Collapsed View */}
          {!trendsExpanded && (
            <TrendsCollapsedView
              presets={trendsPresets.presets}
              presetsLoading={trendsPresets.presetsLoading}
            />
          )}

          {/* Expanded Content */}
          <Collapse in={trendsExpanded} onEntered={kickPlotlyResize}>
            <Box sx={{ py: 2, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Builder row, then the view controls that sit right above the chart */}
              <TrendsSelectionControls
                addedSeries={trendsData.addedSeries}
                selectedDashboard={trendsData.selectedDashboard}
                selectedMetric={trendsData.selectedMetric}
                timeRange={trendsData.timeRange}
                onTimeRangeChange={trendsData.handleTimeRangeChange}
                customTimeRange={trendsData.customTimeRange}
                onCustomTimeRangeChange={trendsData.handleCustomTimeRangeChange}
                evaluateType={trendsData.evaluateType}
                onEvaluateTypeChange={trendsData.handleEvaluateTypeChange}
                onSavePresetClick={() => trendsPresets.setSavePresetModalOpen(true)}
              />

              {/* Chart, with the series table as its legend */}
              <TrendsChart
                title={`Trends (${trendsData.evaluateType})`}
                addedSeries={trendsData.addedSeries}
                metricsLoading={trendsData.metricsLoading}
                plotData={trendsPlot.plotData}
                plotLayout={trendsPlot.plotLayout}
                plotConfig={trendsPlot.plotConfig}
                rows={trendsPlot.rows}
                runIds={trendsPlot.runIds}
                traceIndexOf={trendsPlot.traceIndexOf}
                runMeta={trendsPlot.runMeta}
                lanesNote={trendsPlot.lanesNote}
                cursorIndex={cursorIndex}
                onCursorChange={setCursorIndex}
                onRemoveSeries={trendsData.handleRemoveSeries}
                onClearAllSeries={trendsData.handleClearAllSeries}
                onUpdateSeriesUnit={trendsData.handleUpdateSeriesUnit}
                onToggleSeriesVisibility={trendsData.handleToggleSeriesVisibility}
                cascade={(close) => (
                  <SeriesCascadePanel
                    card="trends"
                    showToast={showToast}
                    allDashboards={trendsData.getAllDashboardsMerged()}
                    dashboardsLoading={trendsData.dashboardsLoading || trendsData.dynatraceDashboardsLoading}
                    testRun={testRun}
                    addedSeries={trendsData.addedSeries}
                    onAddSeries={handleAddSeries}
                    onPrimaryChange={trendsData.handlePrimaryChange}
                    // Every percentile panel is its own trend here, and the URL panels have
                    // no per-run statistics to trend.
                    panelListOptions={{ collapseRtPanels: false, includeUrlPanels: false }}
                    onCancel={close}
                  />
                )}
              />

              <PresetsAccordion
                count={trendsPresets.presets.length}
                loading={trendsPresets.presetsLoading}
              >
                {trendsPresets.applyingPreset && (
                  <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={16} />
                    <Typography variant="body2" color="text.secondary">
                      Applying preset…
                    </Typography>
                  </Box>
                )}
                <TrendsPresetsTable
                  presets={trendsPresets.presets}
                  loading={trendsPresets.presetsLoading}
                  currentUserId={trendsPresets.currentUserId}
                  onSelectPreset={trendsPresets.applyPreset}
                  onDeletePreset={trendsPresets.deletePreset}
                />
              </PresetsAccordion>
            </Box>
          </Collapse>
        </CardContent>
      </Card>

      {/* Save Preset Modal */}
      <SaveTrendsPresetModal
        open={trendsPresets.savePresetModalOpen}
        onClose={() => trendsPresets.setSavePresetModalOpen(false)}
        onSave={trendsPresets.savePreset}
        loading={trendsPresets.presetsSaving}
        currentTestRunId={testRun?.test_run_id || testRunId}
        currentFilters={{
          // The cascade's first pick, or — once the pickers have been cleared — the first
          // series on the chart, so a chart with series can always be saved.
          selectedDashboard: trendsData.selectedDashboard ?? (first ? {
            id: first.dashboardId, dashboard_label: first.dashboardLabel, dashboard_name: first.dashboardLabel, dashboard_uid: '',
          } : null),
          selectedMetric: trendsData.selectedMetric ?? (first ? {
            id: first.panelId, title: first.panelTitle, type: 'graph', applicationDashboardId: first.dashboardId,
          } : null),
          evaluateType: trendsData.evaluateType,
          source: trendsData.selectedDashboard ? trendsData.selectedSource : (first?.source ?? trendsData.selectedSource)
        }}
      />
    </Box>
  );
}
