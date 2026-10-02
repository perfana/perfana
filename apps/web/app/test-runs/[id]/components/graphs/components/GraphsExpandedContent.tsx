'use client';

import React, { useState, useEffect } from 'react';
import { Box, InputBase, Button, useTheme } from '@mui/material';
import { BookmarkBorder, DeleteSweepOutlined } from '@mui/icons-material';

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
  onClearAllSeries?: () => void;
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
  onClearAllSeries,
  axisMode,
  onAxisModeChange,
  events,
  showToast,
}: GraphsExpandedContentProps) {
  const mode = useTheme().palette.mode === 'dark' ? 'dark' : 'light';
  const [confirmClear, setConfirmClear] = useState(false);

  // Disarm the Clear-all confirm by itself, so an armed button cannot sit waiting for a
  // stray click minutes later. Cleared on unmount: the card lives in a Collapse and gets
  // torn down, and a pending timer would set state on a dead component.
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);
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
            // `title` so the full name is readable when it does not fit: a composed name
            // (`dashboard · panel · metric`) runs well past 260px on a Grafana dashboard
            // whose label carries a host name.
            inputProps={{ 'aria-label': 'Graph name', title: chartName }}
            sx={{
              width: 520,
              // Clip rather than push the header's actions off a narrow viewport. The
              // parent Typography is `minWidth: 0` + `noWrap`, so this shrinks safely.
              maxWidth: '100%',
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
            <>
              <Button
                size="small"
                variant="text"
                startIcon={<BookmarkBorder sx={{ fontSize: 14 }} />}
                onClick={onOpenSavePresetModal}
                sx={{ flexShrink: 0, textTransform: 'none', fontSize: 11 }}
              >
                Save as preset
              </Button>
              {/* Two clicks, not a modal: assembling 17 series is real work to lose, but
                  it is re-addable, so a dialog would cost more than the mistake. The armed
                  state disarms itself after 3s so it cannot sit waiting for a stray click. */}
              <Button
                size="small"
                variant="text"
                startIcon={<DeleteSweepOutlined sx={{ fontSize: 14 }} />}
                onClick={() => {
                  if (confirmClear) {
                    onClearAllSeries?.();
                    setConfirmClear(false);
                  } else {
                    setConfirmClear(true);
                  }
                }}
                onBlur={() => setConfirmClear(false)}
                sx={{
                  flexShrink: 0,
                  textTransform: 'none',
                  fontSize: 11,
                  color: confirmClear ? theme.error : undefined,
                }}
              >
                {confirmClear ? `Clear ${addedSeries.length}?` : 'Clear all'}
              </Button>
            </>
          ) : undefined
        }
        cascade={(close) => (
          <SeriesCascadePanel
            card="graphs"
            showToast={showToast}
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
