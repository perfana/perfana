'use client';

import React, { useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  IconButton,
  Collapse,
  Tooltip,
  alpha,
} from '@mui/material';
import { ExpandMore, ExpandLess } from '@mui/icons-material';

// Types
import { CompareCardProps } from './types';

// Hooks
import { useCompareData, useCompareHandlers, useComparePresets } from './hooks';

// Components
import { CompareCollapsedView, CompareExpandedContent } from './components';
import SavePresetModal from './SavePresetModal';


export default function CompareCard({
  testRun,
  testRunId,
  compareExpanded,
  onCompareExpand,
  showToast
}: CompareCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Data hook
  const compareData = useCompareData({
    testRun,
    testRunId,
    compareExpanded,
  });

  // Handlers hook
  const compareHandlers = useCompareHandlers({
    testRun,
    testRunId,
    showToast,
    addedSeries: compareData.addedSeries,
    selectedTestRun: compareData.selectedTestRun,
    showGraphs: compareData.showGraphs,
    setAddedSeries: compareData.setAddedSeries,
    setMetricComparisons: compareData.setMetricComparisons,
    setCurrentMetrics: compareData.setCurrentMetrics,
    setSelectedMetrics: compareData.setSelectedMetrics,
    setShowGraphs: compareData.setShowGraphs,
    setGraphData: compareData.setGraphData,
    setGraphLoading: compareData.setGraphLoading,
  });

  // Presets hook
  const comparePresets = useComparePresets({
    testRun,
    testRunId,
    showToast,
    selectedSource: compareData.selectedSource,
    addedSeries: compareData.addedSeries,
    dashboards: compareData.dashboards,
    relatedTestRuns: compareData.relatedTestRuns,
    setSelectedSource: compareData.setSelectedSource,
    setSelectedDashboard: compareData.setSelectedDashboard,
    setSelectedMetric: compareData.setSelectedMetric,
    setAddedSeries: compareData.setAddedSeries,
    setSelectedTestRun: compareData.setSelectedTestRun,
    setSeriesSearchText: compareData.setSeriesSearchText,
    setShowPercentiles: compareData.setShowPercentiles,
    setDisplayConfig: compareData.setDisplayConfig,
  });

  // Handle expand/collapse
  const handleCompareExpand = () => {
    const wasCollapsed = !compareExpanded;
    onCompareExpand();

    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector('[data-testid="compare-card-expanded"]');
        if (expandedCard) {
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }
  };

  return (
    <Box sx={{
      ...(compareExpanded ? { flex: '1 1 100% !important', minWidth: 'unset' } : {})
    }}>
      <Card
        ref={cardRef}
        tabIndex={-1}
        elevation={0}
        data-testid={compareExpanded ? 'compare-card-expanded' : 'compare-card-collapsed'}
        sx={{
          cursor: compareExpanded ? 'default' : 'pointer',
          height: compareExpanded ? 'auto' : '293px',
          borderRadius: 3,
          bgcolor: 'background.paper',
          border: 'none',
          borderTop: compareExpanded ? 'none' : '3px solid',
          borderTopColor: compareExpanded ? 'transparent' : 'primary.main',
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
            : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          overflow: compareExpanded ? 'visible' : 'hidden',
          '&:hover': compareExpanded ? {} : {
            transform: 'translateY(-4px)',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 4px 12px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3)'
              : '0 4px 12px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.08)'
          }
        }}
        onClick={compareExpanded ? undefined : handleCompareExpand}
      >
        <CardContent sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          p: compareExpanded ? 2 : 3.5,
          pt: compareExpanded ? 2 : 4,
          gap: compareExpanded ? 3 : 0,
          '&:last-child': { pb: compareExpanded ? 2 : 3.5 }
        }}>
          {/* Header Section */}
          {compareExpanded ? (
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              sx={{
                cursor: 'pointer',
                py: 1, px: 1.25, mx: -1.25,
                borderRadius: 2,
                transition: 'background-color 0.2s ease',
                position: 'sticky',
                top: 0,
                zIndex: 10,
                // ponytail: translucent + short so it reads as chrome floating over the
                // chart rather than a solid strip cut out of it while scrolling
                bgcolor: (theme) => alpha(theme.palette.background.paper, 0.85),
                backdropFilter: 'blur(8px)',
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:hover': { backgroundColor: 'action.hover' }
              }}
              onClick={handleCompareExpand}
            >
              <Typography variant="h6" component="h2" sx={{
                fontWeight: 600, color: 'text.primary', fontSize: '1rem', lineHeight: 1.4
              }}>
                Compare
              </Typography>
              <Tooltip title="Collapse">
                <IconButton
                  aria-label="Collapse compare"
                  onClick={(e) => { e.stopPropagation(); handleCompareExpand(); }}
                  size="small"
                  sx={{
                    position: 'absolute', right: 0, backgroundColor: 'action.hover',
                    '&:hover': { backgroundColor: 'primary.main', color: 'primary.contrastText' },
                    transition: 'all 0.2s ease'
                  }}
                >
                  <ExpandLess />
                </IconButton>
              </Tooltip>
            </Box>
          ) : (
            <Box display="flex" justifyContent="center" alignItems="center" mb={2} position="relative">
              <Typography variant="subtitle1" component="h2" sx={{
                fontWeight: 600, color: 'text.secondary', fontSize: '0.875rem',
                letterSpacing: '0.01em', textTransform: 'uppercase', textAlign: 'center',
              }}>
                Compare
              </Typography>
              <Tooltip title="Expand">
                <IconButton
                  aria-label="Expand compare"
                  onClick={(e) => { e.stopPropagation(); handleCompareExpand(); }}
                  size="small"
                  sx={{
                    position: 'absolute', right: 0, width: 32, height: 32, color: 'text.secondary',
                    // action.selected rather than a hardcoded primary+alpha: it tracks the theme in
                    // dark mode, and at 15 the hover tint was almost invisible. Matches Trends.
                    '&:hover': { backgroundColor: 'action.selected', color: 'primary.main' },
                    transition: 'all 0.2s ease',
                  }}
                >
                  <ExpandMore />
                </IconButton>
              </Tooltip>
            </Box>
          )}

          {/* Collapsed View */}
          {!compareExpanded && (
            <CompareCollapsedView
              presets={comparePresets.presets}
              presetsLoading={comparePresets.presetsLoading}
              loading={compareData.loading}
              availableSources={compareData.availableSources}
              relatedTestRuns={compareData.relatedTestRuns}
            />
          )}

          {/* Expanded Content */}
          {/* Kick a window resize once the Collapse settles: the Plotly comparison charts
              measure their geometry mid-animation and useResizeHandler only listens to window
              resize, so without this their hover tooltips stay misaligned. Same fix Trends and
              Graphs already carry. */}
          <Collapse in={compareExpanded} onEntered={() => window.dispatchEvent(new Event('resize'))}>
            <CompareExpandedContent
              loading={compareData.loading}
              presets={comparePresets.presets}
              presetsLoading={comparePresets.presetsLoading}
              currentUserId={comparePresets.currentUserId}
              onApplyPreset={comparePresets.applyPreset}
              onDeletePreset={comparePresets.deletePreset}
              onSavePresetClick={() => comparePresets.setSavePresetModalOpen(true)}
              relatedTestRuns={compareData.relatedTestRuns}
              selectedTestRun={compareData.selectedTestRun}
              onTestRunSelect={compareData.setSelectedTestRun}
              allDashboards={compareData.getAllDashboardsMerged()}
              dashboardsLoading={compareData.dashboardsLoading || compareData.dynatraceDashboardsLoading}
              selectedDashboard={compareData.selectedDashboard}
              selectedMetric={compareData.selectedMetric}
              onPrimarySelectionChange={(dashboard, panel) => {
                // A preset stores one dashboard/panel; the cascade's first pick is it.
                compareData.setSelectedDashboard(dashboard);
                compareData.setSelectedMetric(panel);
                if (panel) compareData.setSelectedSource(panel.source);
              }}
              addedSeries={compareData.addedSeries}
              onAddSeries={compareHandlers.handleAddSeries}
              onRemoveSeries={compareHandlers.handleRemoveSeries}
              onClearAllSeries={compareHandlers.handleClearAllSeries}
              metricComparisons={compareData.metricComparisons}
              metricsLoading={compareData.metricsLoading}
              seriesSearchText={compareData.seriesSearchText}
              onSeriesSearchChange={compareData.setSeriesSearchText}
              displayConfig={compareData.displayConfig}
              onDisplayConfigChange={compareData.setDisplayConfig}
              showGraphs={compareData.showGraphs}
              graphData={compareData.graphData}
              graphLoading={compareData.graphLoading}
              onToggleGraph={compareHandlers.toggleGraph}
              testRun={testRun}
              testRunId={testRunId}
              showToast={showToast}
            />
          </Collapse>
        </CardContent>
      </Card>

      {/* Save Preset Modal */}
      <SavePresetModal
        open={comparePresets.savePresetModalOpen}
        onClose={() => comparePresets.setSavePresetModalOpen(false)}
        onSave={comparePresets.savePreset}
        loading={comparePresets.presetsSaving}
        currentTestRunId={testRun?.test_run_id || testRunId}
        currentFilters={{
          selectedTestRun: compareData.selectedTestRun,
          selectedDashboard: compareData.selectedDashboard,
          selectedMetric: compareData.selectedMetric,
          seriesSearchText: compareData.seriesSearchText,
          showPercentiles: compareData.showPercentiles,
          source: compareData.selectedSource,
          addedSeries: compareData.addedSeries,
          displayConfig: compareData.displayConfig
        }}
      />
    </Box>
  );
}
