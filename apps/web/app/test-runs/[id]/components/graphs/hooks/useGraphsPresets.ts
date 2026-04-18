'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { GraphPresetsAPI, GraphPreset } from '@/lib/graph-presets';
import { GraphPresetFormData } from '../SaveGraphPresetModal';
import { SeriesConfig, MetricDataPoint } from '../types';
import { convertToSeriesConfigDto, convertFromAPISeriesConfig, extractYAxisFormat } from '../utils';
import { TestRun } from '@/types/test-runs';

interface ApplicationDashboard {
  id: string;
  dashboard_label: string;
  dashboard_name: string;
  dashboard_uid: string;
  grafanaInstance?: { label: string };
}

interface Panel {
  id: number;
  title: string;
  type: string;
  yAxesFormat?: string;
  applicationDashboardId?: string;
}

type DataSource = 'grafana' | 'dynatrace' | 'performance-metrics';

interface UseGraphsPresetsProps {
  testRun: TestRun | null;
  testRunId: string;
  showToast: (message: string) => void;
  addedSeries: SeriesConfig[];
  dashboards: ApplicationDashboard[];
  setAddedSeries: (series: SeriesConfig[] | ((prev: SeriesConfig[]) => SeriesConfig[])) => void;
  setSeriesData: (data: Map<string, MetricDataPoint[]> | ((prev: Map<string, MetricDataPoint[]>) => Map<string, MetricDataPoint[]>)) => void;
  setChartDataLoading: (loading: boolean) => void;
  fetchSeriesData: (series: SeriesConfig) => Promise<MetricDataPoint[]>;
  fetchApplicationDashboards: () => Promise<ApplicationDashboard[]>;
  fetchDashboardPanels: (uid: string, dashboard?: ApplicationDashboard) => Promise<Panel[]>;
  fetchPanelMetrics: (dashboardId: string, panelId: number) => Promise<void>;
  setSelectedSource: (source: DataSource) => void;
  setSelectedDashboard: (dashboard: ApplicationDashboard | null) => void;
  setSelectedPanel: (panel: Panel | null) => void;
}

export function useGraphsPresets({
  testRun,
  testRunId,
  showToast,
  addedSeries,
  dashboards,
  setAddedSeries,
  setSeriesData,
  setChartDataLoading,
  fetchSeriesData,
  fetchApplicationDashboards,
  fetchDashboardPanels,
  fetchPanelMetrics,
  setSelectedSource,
  setSelectedDashboard,
  setSelectedPanel,
}: UseGraphsPresetsProps) {
  const [presets, setPresets] = useState<GraphPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [savePresetModalOpen, setSavePresetModalOpen] = useState(false);
  const [presetSaving, setPresetSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);

  // Extract current user ID from JWT token (stored in sessionStorage by keycloak-auth)
  useEffect(() => {
    const token = sessionStorage.getItem('perfana_access_token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setCurrentUserId(payload.sub || payload.id);
      } catch (error) {
        console.error('Failed to parse user ID from token:', error);
      }
    }
  }, []);

  /**
   * Fetch presets for this test run
   */
  const fetchPresets = useCallback(async () => {
    try {
      setPresetsLoading(true);
      const fetchedPresets = await GraphPresetsAPI.getAll(testRunId);
      setPresets(fetchedPresets);
    } catch (error) {
      console.error('Error fetching graph presets:', error);
      showToast('Failed to load graph presets');
    } finally {
      setPresetsLoading(false);
    }
  }, [testRunId, showToast]);

  /**
   * Enrich series with yAxisFormat by fetching from dashboard panels if missing
   */
  const enrichSeriesWithFormat = useCallback(async (series: SeriesConfig): Promise<SeriesConfig> => {
    // If yAxisFormat already exists, return as-is
    if (series.yAxisFormat) {
      return series;
    }

    try {
      // Fetch the dashboard to get panel information
      const response = await authenticatedFetch(
        `/grafana/dashboards?uid=${encodeURIComponent(series.dashboardId)}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.warn(`Failed to fetch dashboard for enrichment: ${series.dashboardId}`);
        return series;
      }

      const dashboardData = await response.json();
      const dashboard = Array.isArray(dashboardData) ? dashboardData[0] : dashboardData;

      // Find the matching panel
      const panel = dashboard?.panels?.find((p: { id: number }) => p.id === series.panelId);

      if (!panel) {
        console.warn(`Panel ${series.panelId} not found in dashboard ${series.dashboardId}`);
        return series;
      }

      const yAxisFormat = extractYAxisFormat(panel);

      return {
        ...series,
        yAxisFormat
      };
    } catch (error) {
      console.error('Error enriching series with format:', error);
      return series;
    }
  }, []);

  /**
   * Handle loading a preset
   */
  const handleLoadPreset = useCallback(async (preset: GraphPreset) => {
    try {
      // Convert API series config to internal format
      const loadedSeries = preset.seriesConfig.map(convertFromAPISeriesConfig);

      // Enrich series with yAxisFormat if missing (for backward compatibility with old presets)
      const enrichedSeries = await Promise.all(
        loadedSeries.map(series => enrichSeriesWithFormat(series))
      );

      // Set the series
      setAddedSeries(enrichedSeries);

      // Restore dropdown selections from the first series
      if (enrichedSeries.length > 0) {
        const firstSeries = enrichedSeries[0];

        // Set source dropdown
        setSelectedSource(firstSeries.source);

        // Find and set dashboard dropdown
        let currentDashboards = dashboards;
        if (currentDashboards.length === 0) {
          currentDashboards = await fetchApplicationDashboards();
        }

        const dashboard = currentDashboards.find(d => d.id === firstSeries.dashboardId)
          || currentDashboards.find(d => d.dashboard_label === firstSeries.dashboardLabel);

        if (dashboard) {
          setSelectedDashboard(dashboard);

          // Load panels and set panel dropdown
          const panelsData = await fetchDashboardPanels(dashboard.dashboard_uid, dashboard);
          const panel = panelsData.find(p => p.id === firstSeries.panelId);
          if (panel) {
            setSelectedPanel(panel);
            // Populate the metrics dropdown
            const appDashboardId = panel.applicationDashboardId || dashboard.id;
            fetchPanelMetrics(appDashboardId, panel.id);
          }
        }
      }

      // Fetch data for all series
      setChartDataLoading(true);
      const newSeriesData = new Map<string, MetricDataPoint[]>();

      await Promise.all(
        enrichedSeries.map(async (series) => {
          const data = await fetchSeriesData(series);
          newSeriesData.set(series.id, data);
        })
      );

      setSeriesData(newSeriesData);
      showToast(`Loaded preset: ${preset.name}`);
    } catch (error) {
      console.error('Error loading preset:', error);
      showToast('Failed to load preset');
    } finally {
      setChartDataLoading(false);
    }
  }, [enrichSeriesWithFormat, setAddedSeries, setChartDataLoading, fetchSeriesData, setSeriesData, showToast, dashboards, fetchApplicationDashboards, fetchDashboardPanels, fetchPanelMetrics, setSelectedSource, setSelectedDashboard, setSelectedPanel]);

  /**
   * Handle saving a preset (with upsert logic)
   */
  const handleSavePreset = useCallback(async (formData: GraphPresetFormData) => {
    try {
      setPresetSaving(true);

      // Convert series config to DTO format (camelCase for API validation)
      const seriesConfigDto = addedSeries.map(convertToSeriesConfigDto);

      // Check if a preset with the same name and scope already exists
      const existingPreset = presets.find(p =>
        p.name === formData.name &&
        p.isGlobal === formData.is_global &&
        (formData.is_global || p.testRunId === formData.test_run_id)
      );

      let response: Response;
      let isUpdate = false;

      if (existingPreset) {
        // Update existing preset
        isUpdate = true;
        response = await authenticatedFetch(`/graph-presets/${existingPreset.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: formData.name,
            description: formData.description,
            seriesConfig: seriesConfigDto,
            testRunId: formData.test_run_id,
            isGlobal: formData.is_global
          }),
        });
      } else {
        // Create new preset
        response = await authenticatedFetch('/graph-presets', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: formData.name,
            description: formData.description,
            seriesConfig: seriesConfigDto,
            testRunId: formData.test_run_id,
            isGlobal: formData.is_global
          }),
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to ${isUpdate ? 'update' : 'create'} graph preset: ${errorText}`);
      }

      showToast(`Graph preset ${isUpdate ? 'updated' : 'saved'} successfully`);
      setSavePresetModalOpen(false);

      // Reload presets
      await fetchPresets();
    } catch (error) {
      console.error('Error saving preset:', error);
      showToast('Failed to save graph preset');
    } finally {
      setPresetSaving(false);
    }
  }, [addedSeries, presets, showToast, fetchPresets]);

  /**
   * Handle deleting a preset
   */
  const handleDeletePreset = useCallback(async (presetId: string) => {
    try {
      await GraphPresetsAPI.delete(presetId);
      showToast('Graph preset deleted');

      // Reload presets
      await fetchPresets();
    } catch (error) {
      console.error('Error deleting preset:', error);
      showToast('Failed to delete preset');
    }
  }, [showToast, fetchPresets]);

  /**
   * Handle deleting all presets owned by the current user
   */
  const handleDeleteAllPresets = useCallback(async () => {
    try {
      if (!currentUserId) {
        showToast('Unable to determine current user');
        return;
      }

      // Filter presets owned by current user
      const userPresets = presets.filter(p => p.userId === currentUserId);

      if (userPresets.length === 0) {
        showToast('No presets to delete');
        return;
      }

      // Delete all user presets
      await Promise.all(
        userPresets.map(preset => GraphPresetsAPI.delete(preset.id))
      );

      showToast(`Deleted ${userPresets.length} preset${userPresets.length === 1 ? '' : 's'}`);

      // Reload presets
      await fetchPresets();
    } catch (error) {
      console.error('Error deleting all presets:', error);
      showToast('Failed to delete all presets');
    }
  }, [currentUserId, presets, showToast, fetchPresets]);

  /**
   * Load presets when component mounts (even when collapsed for accurate count)
   */
  useEffect(() => {
    fetchPresets();
  }, [testRunId, fetchPresets]);

  return {
    presets,
    presetsLoading,
    savePresetModalOpen,
    setSavePresetModalOpen,
    presetSaving,
    currentUserId,
    fetchPresets,
    handleLoadPreset,
    handleSavePreset,
    handleDeletePreset,
    handleDeleteAllPresets,
  };
}
