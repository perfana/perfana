'use client';

import React from 'react';
import { Box, InputBase, Button, useTheme } from '@mui/material';
import { BookmarkBorder } from '@mui/icons-material';

import { SeriesConfig, ApplicationDashboard, MetricDataPoint } from '../types';
import type { TestRun } from '@/types/test-runs';
import type { PerfanaEvent } from '@/lib/events';
import type { GraphPreset } from '@/lib/graph-presets';
import type { SeriesPick } from '../../shared/metric-options';
import GraphsChart from '../GraphsChart';
import GraphPresetsTable from '../GraphPresetsTable';
import PresetsAccordion from '../../shared/PresetsAccordion';
import { SeriesCascadePanel, type AxisDisplayMode } from '@/components/charts';
import { SANS, SIZE, chartTheme } from '@/lib/charts';

interface GraphsExpandedContentProps {
  testRun: TestRun | null;
  // Presets
  presets: GraphPreset[];
  presetsLoading: boolean;
  currentUserId?: string;
  onLoadPreset: (preset: GraphPreset) => Promise<void>;
  onDeletePreset: (presetId: string) => void;
  onDeleteAllPresets: () => void;
  onOpenSavePresetModal: () => void;
  // Dashboards → panels → series cascade
  allDashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;
  onAddSeries: (picks: SeriesPick[]) => void;
  // Chart
  chartName: string;
  setChartName: (name: string) => void;
  addedSeries: SeriesConfig[];
  seriesData: Map<string, MetricDataPoint[]>;
  chartDataLoading: boolean;
  onRemoveSeries: (seriesId: string) => void;
  onUpdateSeriesUnit: (seriesId: string, unit: string) => void;
  onToggleSeriesVisibility: (seriesId: string) => void;
  axisMode: AxisDisplayMode;
  onAxisModeChange: (mode: AxisDisplayMode) => void;
  events?: PerfanaEvent[];
  showToast?: (message: string) => void;
}

/**
 * The expanded Graphs card is now one Analyst chart card: the cascade opens from
 * `+ add series` inside its header instead of standing permanently above the chart, and
 * the series list that used to sit underneath is the chart's own legend table.
 */
export function GraphsExpandedContent({
  testRun,
  presets,
  presetsLoading,
  currentUserId,
  onLoadPreset,
  onDeletePreset,
  onDeleteAllPresets,
  onOpenSavePresetModal,
  allDashboards,
  dashboardsLoading,
  onAddSeries,
  chartName,
  setChartName,
  addedSeries,
  seriesData,
  chartDataLoading,
  onRemoveSeries,
  onUpdateSeriesUnit,
  onToggleSeriesVisibility,
  axisMode,
  onAxisModeChange,
  events,
  showToast,
}: GraphsExpandedContentProps) {
  const mode = useTheme().palette.mode === 'dark' ? 'dark' : 'light';
  const theme = chartTheme(mode);

  return (
    <Box sx={{ py: 2, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <GraphsChart
        testRun={testRun}
        seriesData={seriesData}
        seriesConfig={addedSeries}
        loading={chartDataLoading}
        chartName={chartName}
        events={events}
        showToast={showToast}
        axisMode={axisMode}
        onAxisModeChange={onAxisModeChange}
        onRemoveSeries={onRemoveSeries}
        onUpdateSeriesUnit={onUpdateSeriesUnit}
        onToggleSeriesVisibility={onToggleSeriesVisibility}
        titleNode={
          <InputBase
            value={chartName}
            onChange={(e) => setChartName(e.target.value)}
            placeholder="Untitled graph"
            inputProps={{ 'aria-label': 'Graph name' }}
            sx={{
              width: 260,
              '& input': {
                p: 0,
                fontFamily: SANS,
                fontSize: `${SIZE.titleFont}px`,
                fontWeight: 600,
                color: theme.text,
              },
            }}
          />
        }
        actions={
          addedSeries.length > 0 ? (
            <Button
              size="small"
              variant="text"
              startIcon={<BookmarkBorder sx={{ fontSize: 14 }} />}
              onClick={onOpenSavePresetModal}
              sx={{ flexShrink: 0, textTransform: 'none', fontSize: 11 }}
            >
              Save as preset
            </Button>
          ) : undefined
        }
        cascade={(close) => (
          <SeriesCascadePanel
            card="graphs"
            mode={mode}
            allDashboards={allDashboards}
            dashboardsLoading={dashboardsLoading}
            testRun={testRun}
            addedSeries={addedSeries}
            onAddSeries={onAddSeries}
            // Every percentile panel is its own graph here, and the URL panels have no
            // time series to draw.
            panelListOptions={{ collapseRtPanels: false, includeUrlPanels: false }}
            onCancel={close}
          />
        )}
      />

      <PresetsAccordion count={presets.length} loading={presetsLoading}>
        <GraphPresetsTable
          presets={presets}
          loading={presetsLoading}
          currentUserId={currentUserId}
          onSelectPreset={onLoadPreset}
          onDeletePreset={onDeletePreset}
          onDeleteAllPresets={onDeleteAllPresets}
        />
      </PresetsAccordion>
    </Box>
  );
}
