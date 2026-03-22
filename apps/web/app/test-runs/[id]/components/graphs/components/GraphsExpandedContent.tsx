'use client';

import React from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  CircularProgress,
} from '@mui/material';
import { BookmarkBorder } from '@mui/icons-material';

import { SeriesConfig } from '../types';
import type { TestRun } from '@/types/test-runs';
import type { PerfanaEvent } from '@/lib/events';
import { GraphsSeriesList } from './GraphsSeriesList';
import { GraphsSelectionControls } from './GraphsSelectionControls';
import GraphsChart from '../GraphsChart';
import GraphPresetsTable from '../GraphPresetsTable';

interface GraphsExpandedContentProps {
  testRun: TestRun;
  // Presets
  presets: unknown[];
  presetsLoading: boolean;
  currentUserId?: string;
  onLoadPreset: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  onDeleteAllPresets: () => void;
  onOpenSavePresetModal: () => void;
  // Selection controls
  selectedDashboard: string;
  allDashboards: unknown[];
  dashboardsLoading: boolean;
  dynatraceDashboardsLoading: boolean;
  onDashboardSelect: (dashboardId: string) => void;
  selectedPanel: string;
  panels: unknown[];
  panelsLoading: boolean;
  onPanelSelect: (panelId: string) => void;
  metrics: unknown[];
  metricsLoading: boolean;
  selectedMetrics: string[];
  setSelectedMetrics: (metrics: string[]) => void;
  onAddSeries: () => void;
  // Chart
  chartName: string;
  setChartName: (name: string) => void;
  addedSeries: SeriesConfig[];
  seriesData: Record<string, unknown>;
  chartDataLoading: boolean;
  onRemoveSeries: (seriesId: string) => void;
  onUpdateSeriesUnit: (seriesId: string, unit: string) => void;
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
  return (
    <Box sx={{ py: 2 }}>
      {/* Saved Presets Table */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
          Saved Graph Presets
        </Typography>
        <GraphPresetsTable
          presets={presets}
          loading={presetsLoading}
          currentUserId={currentUserId}
          onSelectPreset={onLoadPreset}
          onDeletePreset={onDeletePreset}
          onDeleteAllPresets={onDeleteAllPresets}
        />
      </Box>

      {/* Add Series Controls */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
          Add Series to Graph
        </Typography>
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
      </Box>

      {/* Chart Name */}
      {addedSeries.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            Chart Name
          </Typography>
          <TextField
            fullWidth
            label="Chart Name"
            value={chartName}
            onChange={(e) => setChartName(e.target.value)}
            variant="outlined"
            helperText="This name will be used as the default preset name when saving"
            placeholder="Enter a descriptive name for this chart"
          />
        </Box>
      )}

      {/* Added Series List */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
          Added Series ({addedSeries.length})
        </Typography>
        <GraphsSeriesList
          addedSeries={addedSeries}
          onRemoveSeries={onRemoveSeries}
          onUpdateSeriesUnit={onUpdateSeriesUnit}
        />
      </Box>

      {/* Chart Visualization */}
      {addedSeries.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            Graph Visualization
          </Typography>
          {chartDataLoading ? (
            <Box sx={{
              p: 4,
              border: '2px dashed',
              borderColor: 'divider',
              borderRadius: 2,
              backgroundColor: 'action.hover',
              textAlign: 'center',
              minHeight: 400,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <CircularProgress />
                <Typography variant="body2" color="text.secondary">
                  Loading chart data...
                </Typography>
              </Box>
            </Box>
          ) : (
            <GraphsChart
              testRun={testRun}
              seriesData={seriesData}
              seriesConfig={addedSeries}
              loading={chartDataLoading}
              chartName={chartName}
              events={events}
            />
          )}
        </Box>
      )}

      {/* Save as Preset Button */}
      {addedSeries.length > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="outlined"
            startIcon={<BookmarkBorder />}
            onClick={onOpenSavePresetModal}
            sx={{
              borderColor: 'primary.main',
              color: 'primary.main',
              px: 3,
              transition: 'all 0.2s ease',
              '&:hover': {
                transform: 'translateY(-1px)',
                borderColor: 'primary.dark',
                backgroundColor: 'primary.main',
                color: 'primary.contrastText',
                boxShadow: '0 4px 12px rgba(25, 118, 210, 0.3)'
              }
            }}
          >
            Save as Preset
          </Button>
        </Box>
      )}
    </Box>
  );
}
