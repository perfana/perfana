'use client';

import React, { useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  IconButton,
  Collapse,
  Divider,
} from '@mui/material';
import { ExpandMore, ExpandLess } from '@mui/icons-material';

// Types
import { CompareCardProps } from './types';

// Hooks
import { useCompareData, useCompareHandlers, useComparePresets } from './hooks';

// Components
import { CompareCollapsedView, CompareExpandedContent } from './components';
import SavePresetModal from './SavePresetModal';

// Utils
import {} from './utils/compare-utils';

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
    selectedSource: compareData.selectedSource,
    selectedDashboard: compareData.selectedDashboard,
    selectedMetric: compareData.selectedMetric,
    selectedMetricNames: compareData.selectedMetricNames,
    addedSeries: compareData.addedSeries,
    selectedTestRun: compareData.selectedTestRun,
    showGraphs: compareData.showGraphs,
    setSelectedSource: compareData.setSelectedSource,
    setSelectedDashboard: compareData.setSelectedDashboard,
    setSelectedMetric: compareData.setSelectedMetric,
    setPanels: compareData.setPanels,
    setDynatraceMetrics: compareData.setDynatraceMetrics,
    setAvailableMetrics: compareData.setAvailableMetrics,
    setSelectedMetricNames: compareData.setSelectedMetricNames,
    setAddedSeries: compareData.setAddedSeries,
    setMetricComparisons: compareData.setMetricComparisons,
    setCurrentMetrics: compareData.setCurrentMetrics,
    setSelectedMetrics: compareData.setSelectedMetrics,
    setShowGraphs: compareData.setShowGraphs,
    setGraphData: compareData.setGraphData,
    setGraphLoading: compareData.setGraphLoading,
    fetchDashboardPanels: compareData.fetchDashboardPanels,
    fetchDynatraceMetricsList: compareData.fetchDynatraceMetricsList,
    fetchPanelMetrics: compareData.fetchPanelMetrics,
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
    fetchDashboardPanels: compareData.fetchDashboardPanels,
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
          outline: 'none',
          '&:focus': { boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}33` },
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
                bgcolor: 'background.paper',
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:hover': { backgroundColor: 'action.hover' }
              }}
              onClick={handleCompareExpand}
            >
              <Box textAlign="center">
                <Typography variant="h5" component="h2" sx={{
                  fontWeight: 600, color: 'text.primary', fontSize: '1.25rem', lineHeight: 1.2
                }}>
                  Compare
                </Typography>
                <Typography variant="body2" color="text.secondary">Click to collapse</Typography>
              </Box>
              <IconButton
                onClick={(e) => { e.stopPropagation(); handleCompareExpand(); }}
                size="medium"
                sx={{
                  position: 'absolute', right: 0, backgroundColor: 'action.hover',
                  '&:hover': { backgroundColor: 'primary.main', color: 'primary.contrastText' },
                  transition: 'all 0.2s ease'
                }}
              >
                <ExpandLess />
              </IconButton>
            </Box>
          ) : (
            <Box display="flex" justifyContent="center" alignItems="center" mb={2} position="relative">
              <Typography variant="subtitle1" component="h2" sx={{
                fontWeight: 600, color: 'text.secondary', fontSize: '0.875rem',
                letterSpacing: '0.01em', textTransform: 'uppercase', textAlign: 'center',
              }}>
                Compare
              </Typography>
              <IconButton
                onClick={(e) => { e.stopPropagation(); handleCompareExpand(); }}
                size="small"
                sx={{
                  position: 'absolute', right: 0, width: 32, height: 32, color: 'text.secondary',
                  '&:hover': { backgroundColor: (theme) => `${theme.palette.primary.main}15`, color: 'primary.main' },
                  transition: 'all 0.2s ease',
                }}
              >
                <ExpandMore />
              </IconButton>
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
          <Collapse in={compareExpanded}>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ py: 2 }}>
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
                selectedSource={compareData.selectedSource}
                selectedDashboard={compareData.selectedDashboard}
                allDashboards={compareData.getAllDashboardsMerged()}
                dashboardsLoading={compareData.dashboardsLoading}
                dynatraceDashboardsLoading={compareData.dynatraceDashboardsLoading}
                onDashboardSelect={compareHandlers.handleDashboardSelect}
                selectedMetric={compareData.selectedMetric}
                panels={compareData.panels}
                panelsLoading={compareData.panelsLoading}
                dynatraceMetrics={compareData.dynatraceMetrics}
                dynatraceMetricsLoading={compareData.dynatraceMetricsLoading}
                onMetricSelect={compareHandlers.handleMetricSelect}
                availableMetrics={compareData.availableMetrics}
                availableMetricsLoading={compareData.availableMetricsLoading}
                selectedMetricNames={compareData.selectedMetricNames}
                setSelectedMetricNames={compareData.setSelectedMetricNames}
                addedSeries={compareData.addedSeries}
                onAddSeries={compareHandlers.handleAddSeries}
                onRemoveSeries={compareHandlers.handleRemoveSeries}
                onClearAllSeries={compareHandlers.handleClearAllSeries}
                metricComparisons={compareData.metricComparisons}
                metricsLoading={compareData.metricsLoading}
                seriesSearchText={compareData.seriesSearchText}
                onSeriesSearchChange={compareData.setSeriesSearchText}
                showPercentiles={compareData.showPercentiles}
                onShowPercentilesChange={compareData.setShowPercentiles}
                showGraphs={compareData.showGraphs}
                graphData={compareData.graphData}
                graphLoading={compareData.graphLoading}
                onToggleGraph={compareHandlers.toggleGraph}
                onShowGraphsChange={compareData.setShowGraphs}
                onGraphDataChange={compareData.setGraphData}
                onGraphLoadingChange={compareData.setGraphLoading}
                testRun={testRun}
                testRunId={testRunId}
                showToast={showToast}
              />
            </Box>
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
          addedSeries: compareData.addedSeries
        }}
      />
    </Box>
  );
}
