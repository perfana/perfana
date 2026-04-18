'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { ComparePresetsAPI, PresetType } from '@/lib/compare-presets';
import { ComparePreset } from '../ComparePresetsTable';
import { PresetFormData } from '../SavePresetModal';
import {
  ApplicationDashboard,
  Panel,
  CompareSeries,
  DataSource,
  RelatedTestRun,
} from '../types';
import { TestRun } from '@/types/test-runs';

interface UseComparePresetsProps {
  testRun: TestRun | null;
  testRunId: string;
  showToast: (message: string) => void;

  // Data hook state
  _selectedSource: DataSource;
  _addedSeries: CompareSeries[];
  dashboards: ApplicationDashboard[];
  relatedTestRuns: RelatedTestRun[];

  // State setters
  _setSelectedSource: (source: DataSource) => void;
  setSelectedDashboard: (dashboard: ApplicationDashboard | null) => void;
  setSelectedMetric: (metric: Panel | null) => void;
  setAddedSeries: (series: CompareSeries[] | ((prev: CompareSeries[]) => CompareSeries[])) => void;
  setSelectedTestRun: (testRun: RelatedTestRun | null) => void;
  setSeriesSearchText: (text: string) => void;
  setShowPercentiles: (show: boolean) => void;

  // Fetch functions
  fetchDashboardPanels: (uid: string) => Promise<Panel[]>;
}

export function useComparePresets({
  testRun,
  testRunId,
  showToast,
  _selectedSource,
  _addedSeries,
  dashboards,
  relatedTestRuns,
  _setSelectedSource,
  setSelectedDashboard,
  setSelectedMetric,
  setAddedSeries,
  setSelectedTestRun,
  setSeriesSearchText,
  setShowPercentiles,
  fetchDashboardPanels,
}: UseComparePresetsProps) {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const [presets, setPresets] = useState<ComparePreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [savePresetModalOpen, setSavePresetModalOpen] = useState(false);
  const [presetsSaving, setPresetsSaving] = useState(false);

  // Load presets
  const fetchPresets = useCallback(async () => {
    try {
      setPresetsLoading(true);
      const presetsData = await ComparePresetsAPI.getAll(testRun?.test_run_id || testRunId);
      setPresets(presetsData);
    } catch (error) {
      console.error('Error fetching presets:', error);
      showToast('Failed to load presets');
    } finally {
      setPresetsLoading(false);
    }
  }, [testRun, testRunId, showToast]);

  // Apply preset to current filter state
  const applyPreset = useCallback(async (preset: ComparePreset) => {
    try {
      // Apply basic filter settings first
      setSeriesSearchText(preset.series_search_text || '');
      setShowPercentiles(preset.show_percentiles);

      // Restore series from preset's series_config
      if (preset.series_config && preset.series_config.length > 0) {
        const restoredSeries: CompareSeries[] = preset.series_config.map((config, index) => ({
          id: `preset-${preset.id}-${config.dashboardId}-${config.panelId}-${config.metricName}-${index}`,
          dashboardId: config.dashboardId,
          dashboardLabel: config.dashboardLabel,
          panelId: config.panelId,
          panelTitle: config.panelTitle,
          metricName: config.metricName,
          source: config.source as DataSource,
          metricsSourceId: (config as unknown).metricsSourceId
        }));
        setAddedSeries(restoredSeries);
      }

      // For specific presets, also try to select the baseline test run
      if (preset.preset_type === PresetType.SPECIFIC && preset.baseline_test_run_id) {
        const baselineTestRun = relatedTestRuns.find(tr => tr.test_run_id === preset.baseline_test_run_id);
        if (baselineTestRun) {
          setSelectedTestRun(baselineTestRun);
        }
      }

      // Optionally restore dashboard/panel selection for UI context
      if (preset.application_dashboard_id) {
        const dashboard = dashboards.find(d => d.id === preset.application_dashboard_id);
        if (dashboard) {
          setSelectedDashboard(dashboard);

          if (preset.panel_id && preset.panel_title) {
            await fetchDashboardPanels(dashboard.dashboard_uid);

            setTimeout(() => {
              setSelectedMetric({
                id: preset.panel_id!,
                title: preset.panel_title!,
                type: 'graph'
              } as Panel);
            }, 100);
          }
        }
      }

      const seriesCount = preset.series_config?.length || 0;
      showToast(`Applied preset: ${preset.name}${seriesCount > 0 ? ` (${seriesCount} series)` : ''}`);
    } catch (error) {
      console.error('Error applying preset:', error);
      showToast('Failed to apply preset');
    }
  }, [
    relatedTestRuns, dashboards, showToast, setSeriesSearchText, setShowPercentiles,
    setAddedSeries, setSelectedTestRun, setSelectedDashboard, setSelectedMetric,
    fetchDashboardPanels
  ]);

  // Save preset
  const savePreset = useCallback(async (presetData: PresetFormData) => {
    try {
      setPresetsSaving(true);

      const createRequest = {
        name: presetData.name,
        description: presetData.description,
        preset_type: presetData.preset_type as PresetType,
        series_search_text: presetData.series_search_text || undefined,
        show_percentiles: presetData.show_percentiles,
        application_dashboard_id: presetData.application_dashboard_id,
        panel_id: presetData.panel_id,
        panel_title: presetData.panel_title,
        baseline_test_run_id: presetData.baseline_test_run_id,
        series_config: presetData.series_config,
        created_for_test_run_id: presetData.created_for_test_run_id,
        is_global: presetData.is_global
      };

      const newPreset = await ComparePresetsAPI.create(createRequest);
      await fetchPresets();
      showToast(`Preset "${newPreset.name}" saved successfully`);
    } catch (error) {
      console.error('Error saving preset:', error);
      showToast('Failed to save preset');
      throw error;
    } finally {
      setPresetsSaving(false);
    }
  }, [fetchPresets, showToast]);

  // Delete preset
  const deletePreset = useCallback(async (presetId: string) => {
    try {
      await ComparePresetsAPI.delete(presetId);
      setPresets(prev => prev.filter(p => p.id !== presetId));
      showToast('Preset deleted successfully');
    } catch (error) {
      console.error('Error deleting preset:', error);
      showToast('Failed to delete preset');
    }
  }, [showToast]);

  // Load presets when component mounts
  useEffect(() => {
    if ((testRun?.test_run_id || testRunId) && presets.length === 0) {
      fetchPresets();
    }
  }, [testRun, testRunId, presets.length, fetchPresets]);

  return {
    presets,
    presetsLoading,
    savePresetModalOpen,
    setSavePresetModalOpen,
    presetsSaving,
    currentUserId,
    fetchPresets,
    applyPreset,
    savePreset,
    deletePreset,
  };
}
