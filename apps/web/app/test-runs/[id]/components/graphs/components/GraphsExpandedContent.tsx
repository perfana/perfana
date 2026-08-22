'use client';

import React from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import { BookmarkBorder, ExpandMore } from '@mui/icons-material';

import { SeriesConfig, ApplicationDashboard, Panel, MetricDataPoint, DataSource } from '../types';
import type { TestRun } from '@/types/test-runs';
import type { PerfanaEvent } from '@/lib/events';
import type { GraphPreset } from '@/lib/graph-presets';
import { GraphsSeriesList } from './GraphsSeriesList';
import { GraphsSelectionControls } from './GraphsSelectionControls';
import GraphsChart from '../GraphsChart';
import GraphPresetsTable from '../GraphPresetsTable';

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
  // Selection controls
  selectedDashboard: ApplicationDashboard | null;
  allDashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;
  dynatraceDashboardsLoading: boolean;
  onDashboardSelect: (dashboard: ApplicationDashboard | null, source?: DataSource) => void;
  selectedPanel: Panel | null;
  panels: Panel[];
  panelsLoading: boolean;
  onPanelSelect: (panel: Panel | null) => void;
  metrics: string[];
  metricsLoading: boolean;
  selectedMetrics: string[];
  setSelectedMetrics: (metrics: string[]) => void;
  onAddSeries: () => void;
  // Chart
  chartName: string;
  setChartName: (name: string) => void;
  addedSeries: SeriesConfig[];
  seriesData: Map<string, MetricDataPoint[]>;
  chartDataLoading: boolean;
  onRemoveSeries: (seriesId: string) => void;
  /** null clears the unit — GraphsSeriesList's Autocomplete allows deselection. */
  onUpdateSeriesUnit: (seriesId: string, unit: string | null) => void;
  events?: PerfanaEvent[];
}

export function GraphsExpandedContent({
  testRun,
  presets,
  presetsLoading,
  currentUserId,
  onLoadPreset,
  onDeletePreset,
  onDeleteAllPresets,
  onOpenSavePresetModal,
  selectedDashboard,
  allDashboards,
  dashboardsLoading,
  dynatraceDashboardsLoading,
  onDashboardSelect,
  selectedPanel,
  panels,
  panelsLoading,
  onPanelSelect,
  metrics,
  metricsLoading,
  selectedMetrics,
  setSelectedMetrics,
  onAddSeries,
  chartName,
  setChartName,
  addedSeries,
  seriesData,
  chartDataLoading,
  onRemoveSeries,
  onUpdateSeriesUnit,
  events,
}: GraphsExpandedContentProps) {
  const chartSeries = addedSeries;
  const chartData = seriesData;

  return (
    <Box sx={{ py: 2, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Builder row — pick what to plot */}
      <GraphsSelectionControls
        selectedDashboard={selectedDashboard}
        allDashboards={allDashboards}
        dashboardsLoading={dashboardsLoading}
        dynatraceDashboardsLoading={dynatraceDashboardsLoading}
        onDashboardSelect={onDashboardSelect}
        selectedPanel={selectedPanel}
        panels={panels}
        panelsLoading={panelsLoading}
        onPanelSelect={onPanelSelect}
        metrics={metrics}
        metricsLoading={metricsLoading}
        selectedMetrics={selectedMetrics}
        setSelectedMetrics={setSelectedMetrics}
        onAddSeries={onAddSeries}
      />

      {/* Chart title + save, then the chart itself — the result stays in view */}
      {chartSeries.length > 0 && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
            <TextField
              value={chartName}
              onChange={(e) => setChartName(e.target.value)}
              variant="standard"
              placeholder="Untitled graph"
              aria-label="Graph name"
              sx={{
                flex: 1,
                '& .MuiInput-input': { fontSize: '1.125rem', fontWeight: 600, py: 0.5 },
              }}
            />
            <Button
              variant="outlined"
              startIcon={<BookmarkBorder />}
              onClick={onOpenSavePresetModal}
              sx={{ flexShrink: 0 }}
            >
              Save as preset
            </Button>
          </Box>

          {chartDataLoading ? (
            <Box sx={{
              p: 4,
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 2,
              textAlign: 'center',
              minHeight: 400,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <CircularProgress />
                <Typography variant="body2" color="text.secondary">
                  Loading chart data…
                </Typography>
              </Box>
            </Box>
          ) : (
            <GraphsChart
              testRun={testRun}
              seriesData={chartData}
              seriesConfig={chartSeries}
              loading={chartDataLoading}
              chartName={chartName}
              events={events}
            />
          )}
        </Box>
      )}

      {/* Legend / series controls, directly under the chart they describe */}
      <Box>
        {addedSeries.length > 0 && (
          <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Series ({addedSeries.length})
          </Typography>
        )}
        <GraphsSeriesList
          addedSeries={addedSeries}
          onRemoveSeries={onRemoveSeries}
          onUpdateSeriesUnit={onUpdateSeriesUnit}
        />
      </Box>

      {/* Presets — out of the way until you want one */}
      <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Saved presets{presetsLoading ? '' : ` (${presets.length})`}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <GraphPresetsTable
            presets={presets}
            loading={presetsLoading}
            currentUserId={currentUserId}
            onSelectPreset={onLoadPreset}
            onDeletePreset={onDeletePreset}
            onDeleteAllPresets={onDeleteAllPresets}
          />
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
