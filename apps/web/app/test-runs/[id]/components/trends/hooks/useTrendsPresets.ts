'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { authenticatedFetch } from '@/lib/api';
import { TrendsPresetsAPI, PresetType } from '@/lib/trends-presets';
import { fetchDynatraceDashboards} from '@/lib/dynatrace';
import { TrendsPreset } from '../TrendsPresetsTable';
import { PresetFormData } from '../SaveTrendsPresetModal';
import {
  ApplicationDashboard,
  Panel,
  TrendsSeries,
  DataSource,
} from '../types';
import { TestRun } from '@/types/test-runs';

interface UseTrendsPresetsProps {
  testRun: TestRun | null;
  testRunId: string;
  showToast: (message: string) => void;
  // Data hooks functions
  selectedSource: DataSource;
  addedSeries: TrendsSeries[];
  dashboards: ApplicationDashboard[];
  fetchApplicationDashboards: () => Promise<ApplicationDashboard[]>;
  fetchDashboardPanels: (uid: string) => Promise<Panel[]>;
  fetchPanelMetrics: (applicationDashboardId: string, panelId: number, metricsSourceId?: string) => Promise<void>;
  fetchDynatraceMetricsList: (label: string) => Promise<void>;
  setSelectedSource: (source: DataSource) => void;
  setSelectedDashboard: (dashboard: ApplicationDashboard | null) => void;
  setSelectedMetric: (metric: Panel | null) => void;
  setEvaluateType: (type: string) => void;
  setAddedSeries: (series: TrendsSeries[] | ((prev: TrendsSeries[]) => TrendsSeries[])) => void;
  setDynatraceMetrics: (fn: (prev: any[]) => any[]) => void;
}

export function useTrendsPresets({
  testRun,
  testRunId,
  showToast,
  selectedSource,
  addedSeries,
  dashboards,
  fetchApplicationDashboards,
  fetchDashboardPanels,
  fetchPanelMetrics,
  fetchDynatraceMetricsList,
  setSelectedSource,
  setSelectedDashboard,
  setSelectedMetric,
  setEvaluateType,
  setAddedSeries,
  setDynatraceMetrics,
}: UseTrendsPresetsProps) {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const [presets, setPresets] = useState<TrendsPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [savePresetModalOpen, setSavePresetModalOpen] = useState(false);
  const [presetsSaving, setPresetsSaving] = useState(false);
  const [applyingPreset, setApplyingPreset] = useState(false);

  // Load presets and enrich with dashboard_label if missing
  const fetchPresets = useCallback(async () => {
    try {
      setPresetsLoading(true);
      const presetsData = await TrendsPresetsAPI.getAll(testRun?.test_run_id || testRunId);

      // Enrich presets with dashboard_label if missing (for backward compatibility)
      const enrichedPresets = await Promise.all(
        presetsData.map(async (preset) => {
          if (!preset.dashboard_label && preset.application_dashboard_id) {
            try {
              const response = await authenticatedFetch(
                `/grafana/application-dashboards/${preset.application_dashboard_id}`
              );
              if (response.ok) {
                const dashboardData = await response.json();
                return { ...preset, dashboard_label: dashboardData.dashboard_label };
              }
            } catch (error) {
              console.warn('Failed to enrich preset with dashboard_label:', error);
            }
          }
          return preset;
        })
      );

      setPresets(enrichedPresets);
    } catch (error) {
      console.error('Error fetching presets:', error);
      showToast('Failed to load presets');
    } finally {
      setPresetsLoading(false);
    }
  }, [testRun, testRunId, showToast]);

  // Apply preset to current filter state
  const applyPreset = useCallback(async (preset: TrendsPreset) => {
    try {
      setApplyingPreset(true);

      // Apply source if present in preset (defaults to grafana for backwards compatibility)
      const presetSource = (preset as any).source || 'grafana';
      setSelectedSource(presetSource);

      if (preset.application_dashboard_id) {
        if (presetSource === 'grafana' || presetSource === 'performance-metrics') {
          // Eagerly load dashboards if not already loaded
          let currentDashboards = dashboards;

          if (currentDashboards.length === 0) {
            currentDashboards = await fetchApplicationDashboards();
          }

          // Find the dashboard in the loaded Grafana dashboards
          let dashboard = currentDashboards.find(d => d.id === preset.application_dashboard_id);

          // Fallback 1: Try matching by dashboard_label if ID not found
          if (!dashboard && preset.dashboard_label) {
            dashboard = currentDashboards.find(d => d.dashboard_label === preset.dashboard_label);
          }

          // Fallback 2: Try matching by partial label match
          if (!dashboard && preset.dashboard_label) {
            dashboard = currentDashboards.find(d =>
              d.dashboard_label?.toLowerCase().includes(preset.dashboard_label!.toLowerCase()) ||
              preset.dashboard_label?.toLowerCase().includes(d.dashboard_label?.toLowerCase() || '')
            );
          }

          if (!dashboard) {
            showToast(`Dashboard "${preset.dashboard_label || preset.application_dashboard_id}" not found. It may have been deleted or is unavailable for this test run.`);
            return;
          }

          setSelectedDashboard(dashboard);

          // If preset has panel info, load panels and try to select the metric
          if (preset.panel_id && preset.panel_title) {
            const panelsData = await fetchDashboardPanels(dashboard.dashboard_uid);

            const panel = panelsData.find(p => p.id === preset.panel_id);
            if (panel) {
              setSelectedMetric(panel);
              // Populate the available metrics dropdown
              const appDashboardId = panel.applicationDashboardId || dashboard.id;
              const metricsSourceId = panel.metricsSourceId || dashboard.metrics_source_id;
              fetchPanelMetrics(appDashboardId, panel.id, metricsSourceId);
            } else {
              showToast('Metric not found in dashboard');
            }
          }
        } else if (presetSource === 'dynatrace') {
          if (preset.panel_title && testRun) {
            const systemId = testRun.system_under_test_id;
            const environment = testRun.test_environment;
            const workload = testRun.workload;

            if (systemId && environment && workload) {
              const dynatraceQueriesData = await fetchDynatraceDashboards(systemId, environment, workload);

              if (dynatraceQueriesData.length > 0) {
                const dashboardLabel = dynatraceQueriesData[0].dashboardLabel;

                setSelectedDashboard({
                  id: preset.application_dashboard_id,
                  dashboard_label: dashboardLabel,
                  dashboard_name: dashboardLabel,
                  dashboard_uid: ''
                } as ApplicationDashboard);

                await fetchDynatraceMetricsList(dashboardLabel);

                setTimeout(() => {
                  setDynatraceMetrics(currentMetrics => {
                    const metric = currentMetrics.find((m: any) => m.panelTitle === preset.panel_title);
                    if (metric) {
                      setSelectedMetric({
                        id: metric.panelId,
                        title: metric.panelTitle,
                        type: 'dynatrace',
                        applicationDashboardId: metric.applicationDashboardId
                      } as Panel);
                    } else {
                      showToast('Metric not found in Dynatrace dashboard');
                    }
                    return currentMetrics;
                  });
                }, 100);
              } else {
                showToast('No Dynatrace dashboards available');
              }
            } else {
              showToast('Test run configuration incomplete for Dynatrace');
            }
          } else {
            showToast('Invalid Dynatrace preset configuration');
          }
        }
      }

      // Apply evaluateType if present in preset
      if (preset.evaluate_type) {
        setEvaluateType(preset.evaluate_type);
      }

      // Restore series config if present
      if (preset.series_config && Array.isArray(preset.series_config) && preset.series_config.length > 0) {
        // Filter out invalid entries (e.g. empty arrays, entries missing required fields)
        const validConfigs = preset.series_config.filter((config: any) =>
          config && typeof config === 'object' && !Array.isArray(config) &&
          config.dashboardId && config.panelId != null && config.metricName
        );
        if (validConfigs.length > 0) {
          const restoredSeries: TrendsSeries[] = validConfigs.map((config: any) => ({
            id: `${config.dashboardId}-${config.panelId}-${config.metricName}-${Date.now()}-${Math.random()}`,
            dashboardId: config.dashboardId,
            dashboardLabel: config.dashboardLabel,
            panelId: config.panelId,
            panelTitle: config.panelTitle,
            metricName: config.metricName,
            source: config.source || 'grafana',
            yAxisFormat: config.yAxisFormat,
            metricsSourceId: config.metricsSourceId
          }));
          setAddedSeries(restoredSeries);
        }
      }

      showToast(`Applied preset: ${preset.name}`);
    } catch (error) {
      showToast('Failed to apply preset - please try again');
    } finally {
      setApplyingPreset(false);
    }
  }, [
    dashboards,
    testRun,
    showToast,
    fetchApplicationDashboards,
    fetchDashboardPanels,
    fetchPanelMetrics,
    fetchDynatraceMetricsList,
    setSelectedSource,
    setSelectedDashboard,
    setSelectedMetric,
    setEvaluateType,
    setAddedSeries,
    setDynatraceMetrics,
  ]);

  // Save preset
  const savePreset = useCallback(async (presetData: PresetFormData) => {
    try {
      setPresetsSaving(true);

      // Convert addedSeries to series_config format, filtering out invalid entries
      let seriesConfig = addedSeries
        .filter(series =>
          series && typeof series === 'object' && !Array.isArray(series) &&
          series.dashboardId && series.panelId != null && series.metricName
        )
        .map(series => ({
          dashboardId: series.dashboardId,
          dashboardLabel: series.dashboardLabel,
          panelId: series.panelId,
          panelTitle: series.panelTitle,
          metricName: series.metricName,
          source: series.source,
          yAxisFormat: series.yAxisFormat,
          metricsSourceId: series.metricsSourceId
        }));

      // If no series were added but we have a selected panel, fetch all available metrics
      if (seriesConfig.length === 0 && presetData.application_dashboard_id && presetData.panel_id != null) {
        try {
          const params = new URLSearchParams({
            applicationDashboardId: presetData.application_dashboard_id,
            panelId: presetData.panel_id.toString()
          });
          const metricsResponse = await authenticatedFetch(
            `/metrics/ds-metrics/distinct-names?${params.toString()}`,
            { headers: { 'Content-Type': 'application/json' } }
          );
          if (metricsResponse.ok) {
            const metricNames: string[] = await metricsResponse.json();
            if (metricNames.length > 0) {
              seriesConfig = metricNames.map(metricName => ({
                dashboardId: presetData.application_dashboard_id!,
                dashboardLabel: presetData.dashboard_label || '',
                panelId: presetData.panel_id!,
                panelTitle: presetData.panel_title || '',
                metricName,
                source: selectedSource,
                yAxisFormat: '',
                metricsSourceId: ''
              }));
            }
          }
        } catch (err) {
          console.warn('Failed to auto-fetch metrics for preset:', err);
        }
      }

      const createRequest = {
        name: presetData.name,
        description: presetData.description,
        preset_type: presetData.preset_type as PresetType,
        application_dashboard_id: presetData.application_dashboard_id,
        panel_id: presetData.panel_id,
        panel_title: presetData.panel_title,
        evaluate_type: presetData.evaluate_type,
        source: selectedSource,
        series_config: seriesConfig.length > 0 ? seriesConfig : undefined,
        created_for_test_run_id: presetData.created_for_test_run_id,
        is_global: presetData.is_global
      };

      const newPreset = await TrendsPresetsAPI.create(createRequest);
      await fetchPresets();
      showToast(`Preset "${newPreset.name}" saved successfully`);
    } catch (error) {
      console.error('Error saving preset:', error);
      showToast('Failed to save preset');
      throw error;
    } finally {
      setPresetsSaving(false);
    }
  }, [addedSeries, selectedSource, fetchPresets, showToast]);

  // Delete preset
  const deletePreset = useCallback(async (presetId: string) => {
    try {
      await TrendsPresetsAPI.delete(presetId);
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
    applyingPreset,
    currentUserId,
    fetchPresets,
    applyPreset,
    savePreset,
    deletePreset,
  };
}
