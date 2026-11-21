'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Card, CardContent, Collapse } from '@mui/material';

// Types
import { GraphsCardProps } from './types';

// Hooks
import { useGraphsData, useGraphsPresets } from './hooks';

// Components
import { GraphsCollapsedView, GraphsExpandedContent } from './components';
import SaveGraphPresetModal from './SaveGraphPresetModal';
import ExpandableCardHeader, { kickPlotlyResize } from '../shared/ExpandableCardHeader';
import type { SeriesPick } from '../shared/metric-options';
import { useComments, useGraphMarkers } from '../comments/CommentsContext';
import { convertFromAPISeriesConfig, convertToSeriesConfigDto } from './utils/graph-formatters';
import { viewOf, type MarkerChartContext } from '@/lib/test-run-comments';

/** Most series a marker records (the API's MARKER_MAX_SERIES, the card links' wildcard cap). */
const MARKER_MAX_SERIES = 50;

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
    axisMode: graphsData.axisMode,
    setAxisMode: graphsData.setAxisMode,
    chartName: graphsData.chartName,
    setChartName: graphsData.setChartName,
    setAddedSeries: graphsData.setAddedSeries,
    setSeriesData: graphsData.setSeriesData,
    setChartDataLoading: graphsData.setChartDataLoading,
    fetchSeriesData: graphsData.fetchSeriesData,
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
  const handleAddSeries = (picks: SeriesPick[]) => {
    graphsData.handleAddSeries(picks, showToast);
  };

  // Handle removing series with toast notification
  const handleRemoveSeries = (seriesId: string) => {
    graphsData.handleRemoveSeries(seriesId, showToast);
  };

  const handleClearAllSeries = () => {
    graphsData.handleClearAllSeries(showToast);
  };

  // ── Comment markers (design: docs/designs/test-run-comments.md, PR2) ──
  const comments = useComments();
  const markers = useGraphMarkers(graphsExpanded);
  const latest = useRef(graphsData);
  latest.current = graphsData;

  /** The view a marker records: the chart as it is when the marker is posted. */
  const captureView = useCallback((): MarkerChartContext => {
    const g = latest.current;
    if (g.addedSeries.length > MARKER_MAX_SERIES) {
      showToast(`Only the first ${MARKER_MAX_SERIES} of ${g.addedSeries.length} series are recorded with this comment`);
    }
    return {
      // The API's series shape requires both strings; a missing one would refuse the whole view.
      series: g.addedSeries.slice(0, MARKER_MAX_SERIES).map((s) => {
        const dto = convertToSeriesConfigDto(s);
        return { ...dto, panelTitle: dto.panelTitle ?? '', dashboardLabel: dto.dashboardLabel ?? '' };
      }),
      ...(g.zoomRange ? { xRange: [g.zoomRange.from, g.zoomRange.to] as [string, string] } : {}),
      axisMode: g.axisMode,
      ...(g.customChartName ? { title: g.customChartName.slice(0, 255) } : {}),
    };
  }, [showToast]);

  // A plain Graphs comment records the same view a marker does (design PR2).
  const registerViewCapture = comments?.registerViewCapture;
  // An empty chart records nothing: the API refuses a view with no series.
  useEffect(
    () => registerViewCapture?.('graphs', () => (latest.current.addedSeries.length > 0 ? captureView() : null)),
    [registerViewCapture, captureView],
  );

  const startMarker = comments?.startMarker;
  const onStartMarker = useCallback(
    (steps: string[], initial: string) => startMarker?.({ time: initial, steps, capture: captureView }),
    [startMarker, captureView],
  );

  // "Restore view" and the ?comment= deep link: REPLACE the chart with the comment's view, once
  // per request key, with an Undo. Card links ("Open in Graphs") add series and never reach here.
  const consumedViews = useRef(new Set<string>());
  const viewRequest = comments?.viewRequest?.card === 'graphs' ? comments.viewRequest : null;
  useEffect(() => {
    const ctx = viewRequest ? viewOf(viewRequest.comment, 'graphs') : null;
    if (!viewRequest || !ctx || consumedViews.current.has(viewRequest.key)) return;
    consumedViews.current.add(viewRequest.key);
    const g = latest.current;
    const previous = {
      series: g.addedSeries,
      range: g.zoomRange,
      axisMode: g.axisMode,
      title: g.customChartName,
    };
    const seq = viewRequest.comment.markerSeq;
    const undo = { label: 'Undo', onClick: () => void latest.current.loadView(previous) };
    g.loadView({
      series: ctx.series.map(convertFromAPISeriesConfig),
      range: ctx.xRange ? { from: ctx.xRange[0], to: ctx.xRange[1] } : null,
      axisMode: ctx.axisMode === 'split' ? 'split' : 'overlay',
      title: ctx.title ?? null,
    })
      .then((missing) => {
        // A story walk (silent) shows no per-step Undo; its Exit restores the whole walk.
        if (viewRequest.silent) return;
        const lost = missing > 0 ? ` · ${missing} of ${ctx.series.length} series have no data in this window` : '';
        showToast(`Showing ${seq != null ? `marker ${seq}'s` : "the comment's"} view${lost}`, undo);
      })
      // loadView already replaced the chart before the fetch failed, so the way back matters most here.
      .catch(() => (viewRequest.silent ? showToast('That view could not be loaded') : showToast('That view could not be loaded', undo)));
  }, [viewRequest, showToast]);

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
          <ExpandableCardHeader title="Graphs" expanded={graphsExpanded} onToggle={handleGraphsExpand} />

          {/* Collapsed View Content */}
          {!graphsExpanded && (
            <GraphsCollapsedView
              presets={graphsPresets.presets}
              presetsLoading={graphsPresets.presetsLoading}
              dashboards={graphsData.dashboards}
              dashboardsLoading={graphsData.dashboardsLoading}
              addedSeries={graphsData.addedSeries}
            />
          )}

          {/* Expandable detailed content */}
          <Collapse in={graphsExpanded} onEntered={kickPlotlyResize}>
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
              allDashboards={graphsData.getAllDashboardsMerged()}
              dashboardsLoading={graphsData.dashboardsLoading || graphsData.dynatraceDashboardsLoading}
              onAddSeries={handleAddSeries}
              chartName={graphsData.chartName}
              setChartName={graphsData.setChartName}
              addedSeries={graphsData.addedSeries}
              seriesData={graphsData.seriesData}
              chartDataLoading={graphsData.chartDataLoading}
              onRemoveSeries={handleRemoveSeries}
              onUpdateSeriesUnit={graphsData.handleUpdateSeriesUnit}
              onToggleSeriesVisibility={graphsData.handleToggleSeriesVisibility}
              onClearAllSeries={handleClearAllSeries}
              axisMode={graphsData.axisMode}
              onAxisModeChange={graphsData.setAxisMode}
              events={events}
              showToast={showToast}
              onZoomRange={graphsData.applyZoomRange}
              zoomed={graphsData.zoomRange !== null}
              markers={markers}
              selectedMarkerId={comments?.openCard === 'graphs' ? comments.activeThreadId : null}
              markerDraftTime={comments?.markerDraft?.time ?? null}
              onStartMarker={comments ? onStartMarker : undefined}
              onPlaceMarker={comments?.moveMarker}
              onMarkerClick={comments ? (id) => comments.openDrawer('graphs', id) : undefined}
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
