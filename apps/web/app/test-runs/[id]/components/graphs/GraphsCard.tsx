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
import { GraphsCardProps } from './types';

// Hooks
import { useGraphsData, useGraphsPresets } from './hooks';

// Components
import { GraphsCollapsedView, GraphsExpandedContent } from './components';
import SaveGraphPresetModal from './SaveGraphPresetModal';

export default function GraphsCard({
  testRun,
  testRunId,
  graphsExpanded,
  onGraphsExpand,
  showToast,
  events,
}: GraphsCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Data hook
  const graphsData = useGraphsData({
    testRun,
    testRunId,
    graphsExpanded,
  });

  // Presets hook
  const graphsPresets = useGraphsPresets({
    testRun,
    testRunId,
    showToast,
    addedSeries: graphsData.addedSeries,
    dashboards: graphsData.dashboards,
    setAddedSeries: graphsData.setAddedSeries,
    setSeriesData: graphsData.setSeriesData,
    setChartDataLoading: graphsData.setChartDataLoading,
    fetchSeriesData: graphsData.fetchSeriesData,
    fetchApplicationDashboards: graphsData.fetchApplicationDashboards,
    fetchDashboardPanels: graphsData.fetchDashboardPanels,
    fetchPanelMetrics: graphsData.fetchPanelMetrics,
    setSelectedSource: graphsData.setSelectedSource,
    setSelectedDashboard: graphsData.setSelectedDashboard,
    setSelectedPanel: graphsData.setSelectedPanel,
  });

  // Handle expand/collapse with auto-focus
  const handleGraphsExpand = () => {
    const wasCollapsed = !graphsExpanded;
    onGraphsExpand();

    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector('[data-testid="graphs-card-expanded"]');
        if (expandedCard) {
          expandedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }
  };

  // Handle adding series with toast notification
  const handleAddSeries = () => {
    graphsData.handleAddSeries(showToast);
  };

  // Handle removing series with toast notification
  const handleRemoveSeries = (seriesId: string) => {
    graphsData.handleRemoveSeries(seriesId, showToast);
  };

  return (
    <Box sx={{
      ...(graphsExpanded ? {
        flex: '1 1 100% !important',
        minWidth: 'unset'
      } : {})
    }}>
      <Card
        ref={cardRef}
        tabIndex={-1}
        elevation={0}
        data-testid={graphsExpanded ? 'graphs-card-expanded' : 'graphs-card-collapsed'}
        sx={{
          cursor: graphsExpanded ? 'default' : 'pointer',
          height: graphsExpanded ? 'auto' : '293px',
          borderRadius: 3,
          bgcolor: 'background.paper',
          border: 'none',
          borderTop: graphsExpanded ? 'none' : '3px solid',
          borderTopColor: graphsExpanded ? 'transparent' : 'primary.main',
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
            : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          overflow: graphsExpanded ? 'visible' : 'hidden',
          outline: 'none',
          '&:focus': {
            boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}33`
          },
          '&:hover': graphsExpanded ? {} : {
            transform: 'translateY(-4px)',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 4px 12px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3)'
              : '0 4px 12px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.08)'
          }
        }}
        onClick={graphsExpanded ? undefined : handleGraphsExpand}
      >
        <CardContent sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          p: graphsExpanded ? 2 : 3.5,
          pt: graphsExpanded ? 2 : 4,
          gap: graphsExpanded ? 3 : 0,
          '&:last-child': { pb: graphsExpanded ? 2 : 3.5 }
        }}>
          {/* Header Section */}
          {graphsExpanded ? (
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              sx={{
                cursor: 'pointer',
                py: 1,
                px: 1.25,
                mx: -1.25,
                borderRadius: 2,
                transition: 'background-color 0.2s ease',
                position: 'sticky',
                top: 0,
                zIndex: 10,
                bgcolor: 'background.paper',
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:hover': {
                  backgroundColor: 'action.hover'
                }
              }}
              onClick={handleGraphsExpand}
            >
              <Box textAlign="center">
                <Typography
                  variant="h5"
                  component="h2"
                  sx={{
                    fontWeight: 600,
                    color: 'text.primary',
                    fontSize: '1.25rem',
                    lineHeight: 1.2
                  }}
                >
                  Graphs
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Click to collapse
                </Typography>
              </Box>
              <IconButton
                onClick={(e) => {
                  e.stopPropagation();
                  handleGraphsExpand();
                }}
                size="medium"
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
            </Box>
          ) : (
            <>
              {/* Collapsed Header */}
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
                  Graphs
                </Typography>
                <IconButton
                  onClick={(e) => {
                    e.stopPropagation();
                    handleGraphsExpand();
                  }}
                  size="small"
                  sx={{
                    position: 'absolute',
                    right: 0,
                    width: 32,
                    height: 32,
                    color: 'text.secondary',
                    '&:hover': {
                      backgroundColor: (theme) => `${theme.palette.primary.main}26`,
                      color: 'primary.main',
                    },
                    transition: 'all 0.2s ease',
                  }}
                >
                  <ExpandMore />
                </IconButton>
              </Box>

              {/* Collapsed View Content */}
              <GraphsCollapsedView
                presets={graphsPresets.presets}
                presetsLoading={graphsPresets.presetsLoading}
                dashboards={graphsData.dashboards}
                dashboardsLoading={graphsData.dashboardsLoading}
                addedSeries={graphsData.addedSeries}
              />
            </>
          )}

          {/* Expandable detailed content */}
          <Collapse in={graphsExpanded}>
            <Divider sx={{ my: 2 }} />

            {/* Expanded Content */}
            <GraphsExpandedContent
              testRun={testRun}
              presets={graphsPresets.presets}
              presetsLoading={graphsPresets.presetsLoading}
              currentUserId={graphsPresets.currentUserId}
              onLoadPreset={graphsPresets.handleLoadPreset}
              onDeletePreset={graphsPresets.handleDeletePreset}
              onDeleteAllPresets={graphsPresets.handleDeleteAllPresets}
              onOpenSavePresetModal={() => graphsPresets.setSavePresetModalOpen(true)}
              selectedDashboard={graphsData.selectedDashboard}
              allDashboards={graphsData.getAllDashboardsMerged()}
              dashboardsLoading={graphsData.dashboardsLoading}
              dynatraceDashboardsLoading={graphsData.dynatraceDashboardsLoading}
              onDashboardSelect={graphsData.handleDashboardSelect}
              selectedPanel={graphsData.selectedPanel}
              panels={graphsData.panels}
              panelsLoading={graphsData.panelsLoading}
              onPanelSelect={graphsData.handlePanelSelect}
              metrics={graphsData.metrics}
              metricsLoading={graphsData.metricsLoading}
              selectedMetrics={graphsData.selectedMetrics}
              setSelectedMetrics={graphsData.setSelectedMetrics}
              onAddSeries={handleAddSeries}
              chartName={graphsData.chartName}
              setChartName={graphsData.setChartName}
              addedSeries={graphsData.addedSeries}
              seriesData={graphsData.seriesData}
              chartDataLoading={graphsData.chartDataLoading}
              onRemoveSeries={handleRemoveSeries}
              onUpdateSeriesUnit={graphsData.handleUpdateSeriesUnit}
              events={events}
            />
          </Collapse>

          {/* Save Preset Modal */}
          <SaveGraphPresetModal
            open={graphsPresets.savePresetModalOpen}
            onClose={() => graphsPresets.setSavePresetModalOpen(false)}
            onSave={graphsPresets.handleSavePreset}
            currentTestRunId={testRunId}
            currentSeriesConfig={graphsData.addedSeries}
            loading={graphsPresets.presetSaving}
            defaultName={graphsData.chartName}
          />
        </CardContent>
      </Card>
    </Box>
  );
}
