'use client';

import React, { useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  IconButton,
  Collapse,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
  alpha,
} from '@mui/material';
import {
  ExpandMore,
  ExpandLess,
} from '@mui/icons-material';

// Types
import { TrendsCardProps } from './types';

// Hooks
import { useTrendsData, useTrendsPresets, useTrendsPlot } from './hooks';

// Components
import { TrendsCollapsedView, TrendsSelectionControls, TrendsChart } from './components';
import TrendsPresetsTable from './TrendsPresetsTable';
import SaveTrendsPresetModal from './SaveTrendsPresetModal';

export default function TrendsCard({
  testRun,
  testRunId,
  trendsExpanded,
  onTrendsExpand,
  showToast
}: TrendsCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

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
    fetchDashboardPanels: trendsData.fetchDashboardPanels,
    fetchPanelMetrics: trendsData.fetchPanelMetrics,
    fetchDynatraceMetricsList: trendsData.fetchDynatraceMetricsList,
    setSelectedSource: trendsData.setSelectedSource,
    setSelectedDashboard: trendsData.setSelectedDashboard,
    setSelectedMetric: trendsData.setSelectedMetric,
    setEvaluateType: trendsData.setEvaluateType,
    setAddedSeries: trendsData.setAddedSeries,
    setDynatraceMetrics: trendsData.setDynatraceMetrics,
  });

  // Plot hook
  const trendsPlot = useTrendsPlot({
    metricsData: trendsData.metricsData,
    selectedSeriesNames: trendsData.selectedSeriesNames,
    selectedMetric: trendsData.selectedMetric,
    evaluateType: trendsData.evaluateType,
    trendsExpanded,
    addedSeries: trendsData.addedSeries,
    showToast,
  });

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
  const handleAddSeries = () => {
    const count = trendsData.handleAddSeries();
    if (count && count > 0) {
      showToast(`Added ${count} series to chart`);
    } else if (count === 0) {
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
          {!trendsExpanded ? (
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              mb={2}
              position="relative"
            >
              <Typography
                variant="subtitle1"
                component="h2"
                sx={{
                  fontWeight: 600,
                  color: 'text.secondary',
                  fontSize: '0.875rem',
                  letterSpacing: '0.01em',
                  textTransform: 'uppercase',
                  textAlign: 'center',
                }}
              >
                Trends
              </Typography>
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  handleTrendsExpand();
                }}
                size="small"
                sx={{
                  position: 'absolute',
                  right: 0,
                  width: 32,
                  height: 32,
                  color: 'text.secondary',
                  '&:hover': {
                    backgroundColor: 'action.selected',
                    color: 'primary.main',
                  },
                  transition: 'all 0.2s ease',
                }}
              >
                <ExpandMore />
              </IconButton>
            </Box>
          ) : (
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              sx={{
                cursor: 'pointer',
                py: 1,
                px: 1,
                mx: -1,
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
                '&:hover': {
                  backgroundColor: 'action.hover'
                }
              }}
              onClick={handleTrendsExpand}
            >
              <Typography
                variant="h6"
                component="h2"
                sx={{
                  fontWeight: 600,
                  color: 'text.primary',
                  fontSize: '1rem',
                  lineHeight: 1.4
                }}
              >
                Trends
              </Typography>
              <Tooltip title="Collapse">
                <IconButton
                  aria-label="Collapse trends"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTrendsExpand();
                  }}
                  size="small"
                  sx={{
                    position: 'absolute',
                    right: 0,
                    backgroundColor: 'action.hover',
                    '&:hover': {
                      backgroundColor: 'primary.main',
                      color: 'primary.contrastText',
                    },
                    transition: 'all 0.2s ease'
                  }}
                >
                  <ExpandLess />
                </IconButton>
              </Tooltip>
            </Box>
          )}

          {/* Collapsed View */}
          {!trendsExpanded && (
            <TrendsCollapsedView
              presets={trendsPresets.presets}
              presetsLoading={trendsPresets.presetsLoading}
            />
          )}

          {/* Expanded Content */}
          {/* Kick a window resize once the Collapse settles: the Plotly chart inside
              measures its geometry mid-animation and useResizeHandler only listens to
              window resize, so without this the hover tooltip stays misaligned. */}
          <Collapse in={trendsExpanded} onEntered={() => window.dispatchEvent(new Event('resize'))}>
            <Box sx={{ py: 2, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Builder row, then the view controls that sit right above the chart */}
              <TrendsSelectionControls
                selectedDashboard={trendsData.selectedDashboard}
                allDashboards={trendsData.getAllDashboardsMerged()}
                dashboardsLoading={trendsData.dashboardsLoading}
                dynatraceDashboardsLoading={trendsData.dynatraceDashboardsLoading}
                onDashboardSelect={trendsData.handleDashboardSelect}
                selectedSource={trendsData.selectedSource}
                selectedMetric={trendsData.selectedMetric}
                panels={trendsData.panels}
                panelsLoading={trendsData.panelsLoading}
                dynatraceMetrics={trendsData.dynatraceMetrics}
                dynatraceMetricsLoading={trendsData.dynatraceMetricsLoading}
                onMetricSelect={trendsData.handleMetricSelect}
                availableMetrics={trendsData.availableMetrics}
                availableMetricsLoading={trendsData.availableMetricsLoading}
                selectedMetricNames={trendsData.selectedMetricNames}
                setSelectedMetricNames={trendsData.setSelectedMetricNames}
                addedSeries={trendsData.addedSeries}
                onAddSeries={handleAddSeries}
                timeRange={trendsData.timeRange}
                onTimeRangeChange={trendsData.handleTimeRangeChange}
                customTimeRange={trendsData.customTimeRange}
                onCustomTimeRangeChange={trendsData.handleCustomTimeRangeChange}
                evaluateType={trendsData.evaluateType}
                onEvaluateTypeChange={trendsData.handleEvaluateTypeChange}
                onSavePresetClick={() => trendsPresets.setSavePresetModalOpen(true)}
              />

              {trendsData.addedSeries.length === 0 && (
                <Box sx={{
                  p: 3,
                  border: '1px dashed',
                  borderColor: 'divider',
                  borderRadius: 2,
                  textAlign: 'center',
                }}>
                  <Typography variant="body2" color="text.secondary">
                    Pick a dashboard, panel and series above, then add them to plot a trend.
                  </Typography>
                </Box>
              )}

              {/* Chart, with the series list directly under it */}
              <TrendsChart
                addedSeries={trendsData.addedSeries}
                metricsData={trendsData.metricsData}
                metricsLoading={trendsData.metricsLoading}
                plotData={trendsPlot.plotData}
                plotLayout={trendsPlot.plotLayout}
                plotConfig={trendsPlot.plotConfig}
                onRemoveSeries={trendsData.handleRemoveSeries}
                onClearAllSeries={trendsData.handleClearAllSeries}
                onUpdateSeriesUnit={trendsData.handleUpdateSeriesUnit}
              />

              {/* Presets — out of the way until you want one */}
              <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, '&:before': { display: 'none' } }}>
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Saved presets{trendsPresets.presetsLoading ? '' : ` (${trendsPresets.presets.length})`}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
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
                </AccordionDetails>
              </Accordion>
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
          selectedDashboard: trendsData.selectedDashboard,
          selectedMetric: trendsData.selectedMetric,
          evaluateType: trendsData.evaluateType,
          source: trendsData.selectedSource
        }}
      />
    </Box>
  );
}
