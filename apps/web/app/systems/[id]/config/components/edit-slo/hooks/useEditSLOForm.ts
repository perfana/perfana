'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceDashboards, fetchDynatraceMetrics } from '@/lib/dynatrace';
import {
  SLOFormData,
  ValidationErrors,
  SaveDialogOption,
  UseEditSLOFormProps,
  UseEditSLOFormReturn,
  initialSLOFormData,
} from '../types';
import { SUPPORTED_PANEL_TYPES, convertDecimalToPercentageForDisplay } from '../utils/slo-validators';
import { isPerformanceTest } from '@/lib/metrics-source-utils';

export function useEditSLOForm({
  open,
  benchmark,
  systemId,
  environment,
  workload,
}: UseEditSLOFormProps): UseEditSLOFormReturn {
  // SLO form data state
  const [sloFormData, setSloFormData] = useState<SLOFormData>(initialSLOFormData);

  // Loading states
  const [sloFormLoading, _setSloFormLoading] = useState(false);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [panelsLoading, setPanelsLoading] = useState(false);

  // Save dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveDialogOption, setSaveDialogOption] = useState<SaveDialogOption>('none');

  // Available options
  const [availableDashboards, setAvailableDashboards] = useState<any[]>([]);
  const [availablePanels, setAvailablePanels] = useState<any[]>([]);
  const [availableDynatraceDashboards, setAvailableDynatraceDashboards] = useState<any[]>([]);
  const [availableDynatraceMetrics, setAvailableDynatraceMetrics] = useState<any[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});

  // Fetch Grafana application dashboards
  const fetchSloApplicationDashboards = useCallback(async () => {
    if (!systemId || !environment) {
      return;
    }

    try {
      setDashboardsLoading(true);
      const response = await authenticatedFetch(
        `/grafana/application-dashboards?systemId=${encodeURIComponent(systemId)}&environment=${encodeURIComponent(environment)}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const dashboardsData = await response.json();
        setAvailableDashboards(dashboardsData);
      } else {
        console.warn('Failed to fetch SLO application dashboards:', response.statusText);
        setAvailableDashboards([]);
      }
    } catch (error) {
      console.error('Error fetching SLO application dashboards:', error);
      setAvailableDashboards([]);
    } finally {
      setDashboardsLoading(false);
    }
  }, [systemId, environment]);

  // Fetch Dynatrace dashboards
  const fetchDynatraceDashboardsForSlo = useCallback(async () => {
    if (!systemId || !environment || !workload) {
      return;
    }

    try {
      setDashboardsLoading(true);
      const dashboardsData = await fetchDynatraceDashboards(systemId, environment, workload);
      setAvailableDynatraceDashboards(dashboardsData);
    } catch (error) {
      console.error('Error fetching Dynatrace dashboards for SLO:', error);
      setAvailableDynatraceDashboards([]);
    } finally {
      setDashboardsLoading(false);
    }
  }, [systemId, environment, workload]);

  // Fetch Dynatrace metrics
  const fetchDynatraceMetricsForSlo = useCallback(
    async (dashboardLabel: string) => {
      if (!systemId || !environment || !workload || !dashboardLabel) {
        return;
      }

      try {
        setPanelsLoading(true);
        const metricsData = await fetchDynatraceMetrics(systemId, environment, workload, dashboardLabel);
        setAvailableDynatraceMetrics(metricsData);
      } catch (error) {
        console.error('Error fetching Dynatrace metrics for SLO:', error);
        setAvailableDynatraceMetrics([]);
      } finally {
        setPanelsLoading(false);
      }
    },
    [systemId, environment, workload]
  );

  // Fetch Grafana dashboard panels
  const fetchDashboardPanels = useCallback(async (dashboardUid: string) => {
    if (!dashboardUid) return;

    try {
      setPanelsLoading(true);
      const response = await authenticatedFetch(`/grafana/dashboards?uid=${dashboardUid}`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const dashboardData = await response.json();

        // Handle array response - take first element
        const dashboard = Array.isArray(dashboardData) ? dashboardData[0] : dashboardData;

        // Filter panels by supported types
        const filteredPanels =
          dashboard?.panels?.filter((panel: unknown) => SUPPORTED_PANEL_TYPES.includes(panel.type)) || [];

        setAvailablePanels(filteredPanels);
      } else {
        console.warn('Failed to fetch dashboard panels:', response.statusText);
        setAvailablePanels([]);
      }
    } catch (error) {
      console.error('Error fetching dashboard panels:', error);
      setAvailablePanels([]);
    } finally {
      setPanelsLoading(false);
    }
  }, []);

  // Fetch panels for performance-test dashboards from ds_metric_statistics
  const fetchPerfMetricsPanels = useCallback(async (applicationDashboardId: string) => {
    if (!applicationDashboardId) return;

    try {
      setPanelsLoading(true);
      const response = await authenticatedFetch(
        `/metrics/ds-metrics/panels-by-dashboard?applicationDashboardId=${encodeURIComponent(applicationDashboardId)}`,
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (response.ok) {
        const rows: Array<{ panel_id: number; panel_title: string; unit?: string }> = await response.json();
        const panels = rows.map(row => ({
          id: row.panel_id,
          title: row.panel_title,
          type: 'timeseries',
        }));
        setAvailablePanels(panels);
      } else {
        setAvailablePanels([]);
      }
    } catch (error) {
      console.error('Error fetching performance test panels:', error);
      setAvailablePanels([]);
    } finally {
      setPanelsLoading(false);
    }
  }, []);

  // Initialize form when dialog opens with benchmark data
  useEffect(() => {
    if (open && benchmark) {
      // Handle percentunit conversion for display - convert decimal back to percentage
      const effectiveUnitFormat = benchmark.configuration?.yAxesFormat || benchmark.configuration?.metricUnit;
      const displayRequirementValue = convertDecimalToPercentageForDisplay(
        benchmark.requirement_value,
        effectiveUnitFormat
      );

      // Handle validateWithDefaultIfNoDataValue percentunit conversion
      const displayDefaultValue = convertDecimalToPercentageForDisplay(
        benchmark.configuration?.validateWithDefaultIfNoDataValue,
        effectiveUnitFormat
      );

      // Build synthetic dashboard/panel objects from the benchmark's own data.
      // Since Source, Dashboard, and Panel fields are disabled in edit mode,
      // we only need display-compatible objects. The API fetch below may replace
      // these with richer objects if a match is found.
      const syntheticDashboard = benchmark.source === 'dynatrace'
        ? {
            dashboardLabel: benchmark.dashboard_label || benchmark.config_title?.split(' - ')[0] || 'Dashboard',
            id: benchmark.application_dashboard_id,
            dashboard_uid: benchmark.dashboard_uid,
          }
        : {
            id: benchmark.application_dashboard_id,
            dashboard_uid: benchmark.dashboard_uid,
            dashboard_label: benchmark.dashboard_label || benchmark.config_title?.split(' - ')[0] || 'Dashboard',
            dashboard_id: benchmark.dashboard_id,
            grafanaInstance: benchmark.grafana_instance ? { label: benchmark.grafana_instance } : undefined,
          };

      const panelTitle = benchmark.source === 'dynatrace'
        ? (benchmark.config_title?.split(' - ').slice(1).join(' - ') || benchmark.panel_title || benchmark.metric_name || 'Metric')
        : (benchmark.panel_title || benchmark.metric_name || benchmark.config_title?.split(' - ').slice(1).join(' - ') || 'Metric');

      const syntheticPanel = benchmark.source === 'dynatrace'
        ? {
            panelTitle,
          }
        : {
            id: benchmark.configuration?.panelId || benchmark.configuration?.id,
            title: panelTitle,
            type: 'timeseries',
            yAxesFormat: benchmark.configuration?.yAxesFormat,
            metricUnit: benchmark.configuration?.metricUnit || benchmark.metric_unit,
          };

      setSloFormData({
        source: benchmark.source || 'grafana',
        selectedDashboard: syntheticDashboard,
        selectedPanel: syntheticPanel,
        evaluateType: benchmark.evaluate_type || 'avg',
        requirementOperator: benchmark.requirement_operator || 'lt',
        requirementValue: displayRequirementValue,
        tags: benchmark.tags || [],
        excludeRampUpTime: benchmark.exclude_ramp_up_time !== false,
        averageAll: benchmark.configuration?.averageAll || false,
        matchPattern: benchmark.configuration?.matchPattern || '',
        validateWithDefaultIfNoData: benchmark.configuration?.validateWithDefaultIfNoData || false,
        validateWithDefaultIfNoDataValue: displayDefaultValue,
      });

      // Also fetch real dashboards in background — if a match is found, it will
      // replace the synthetic object with a richer one (more metadata for the save payload).
      if (benchmark.source === 'grafana' && systemId && environment) {
        fetchSloApplicationDashboards();
      } else if (benchmark.source === 'dynatrace' && systemId && environment && workload) {
        fetchDynatraceDashboardsForSlo();
      }
    }
  }, [open, benchmark, systemId, environment, fetchSloApplicationDashboards, fetchDynatraceDashboardsForSlo, workload]);

  // Upgrade synthetic dashboard to real one when Grafana dashboards are loaded
  useEffect(() => {
    if (availableDashboards.length > 0 && benchmark) {
      // Find the dashboard that matches the benchmark - prioritize metrics_source_id, then application_dashboard_id
      let matchingDashboard = null;

      // First try to match by metrics_source_id (most reliable when available)
      if ((benchmark as unknown).metrics_source_id) {
        matchingDashboard = availableDashboards.find(
          (dashboard: unknown) => dashboard.metrics_source_id === (benchmark as unknown).metrics_source_id
        );
      }

      // Then try to match by application_dashboard_id
      if (!matchingDashboard && benchmark.application_dashboard_id) {
        matchingDashboard = availableDashboards.find(
          (dashboard) => dashboard.id === benchmark.application_dashboard_id
        );
      }

      // Fallback to dashboard_uid match if no application_dashboard_id match
      if (!matchingDashboard && benchmark.dashboard_uid) {
        matchingDashboard = availableDashboards.find(
          (dashboard) => dashboard.dashboard_uid === benchmark.dashboard_uid
        );
      }

      if (matchingDashboard) {
        setSloFormData((prev) => ({
          ...prev,
          selectedDashboard: matchingDashboard,
        }));

        // Fetch panels for this dashboard to upgrade the synthetic panel too
        if (isPerformanceTest(matchingDashboard)) {
          fetchPerfMetricsPanels(matchingDashboard.id);
        } else {
          fetchDashboardPanels(matchingDashboard.dashboard_uid);
        }
      }
    }
  }, [availableDashboards, benchmark, fetchDashboardPanels, fetchPerfMetricsPanels]);

  // Upgrade synthetic dashboard to real one when Dynatrace dashboards are loaded
  useEffect(() => {
    if (
      availableDynatraceDashboards.length > 0 &&
      benchmark &&
      benchmark.source === 'dynatrace'
    ) {
      // For Dynatrace, try to match by dashboardLabel
      const matchingDashboard = availableDynatraceDashboards.find(
        (dashboard) => dashboard.dashboardLabel === benchmark.config_title?.split(' - ')[0]
      );

      if (matchingDashboard) {
        setSloFormData((prev) => ({
          ...prev,
          selectedDashboard: matchingDashboard,
        }));

        // Fetch metrics for this dashboard to upgrade the synthetic panel
        fetchDynatraceMetricsForSlo(matchingDashboard.dashboardLabel);
      }
    }
  }, [availableDynatraceDashboards, benchmark, fetchDynatraceMetricsForSlo]);

  // Upgrade synthetic panel to real one when Dynatrace metrics are loaded
  useEffect(() => {
    if (
      availableDynatraceMetrics.length > 0 &&
      benchmark &&
      benchmark.source === 'dynatrace'
    ) {
      // Try to match by panel title from config_title
      let matchingMetric = null;

      if (benchmark.config_title) {
        const parts = benchmark.config_title.split(' - ');
        if (parts.length > 1) {
          const extractedTitle = parts.slice(1).join(' - ');
          matchingMetric = availableDynatraceMetrics.find((metric) => metric.panelTitle === extractedTitle);
        }
      }

      // Fallback to metric_name match
      if (!matchingMetric && benchmark.metric_name) {
        matchingMetric = availableDynatraceMetrics.find((metric) => metric.panelTitle === benchmark.metric_name);
      }

      if (matchingMetric) {
        setSloFormData((prev) => ({
          ...prev,
          selectedPanel: matchingMetric,
        }));
      }
    }
  }, [availableDynatraceMetrics, benchmark]);

  // Upgrade synthetic panel to real one when Grafana panels are loaded
  useEffect(() => {
    if (availablePanels.length > 0 && benchmark) {
      // Try multiple ways to find the matching panel
      let matchingPanel = null;

      // 1. Try to match by panel ID from configuration (most reliable)
      if (benchmark.configuration?.panelId) {
        const panelId = benchmark.configuration.panelId;
        matchingPanel = availablePanels.find((panel) => {
          // Handle both string and number panel IDs
          return panel.id === panelId || panel.id === String(panelId) || String(panel.id) === String(panelId);
        });
      }

      // 2. Try to match by panel title exactly matching metric_name
      if (!matchingPanel && benchmark.metric_name) {
        matchingPanel = availablePanels.find((panel) => panel.title === benchmark.metric_name);
      }

      // 3. Try to match by extracting panel title from config_title
      if (!matchingPanel && benchmark.config_title) {
        // Try different extraction methods for "Dashboard - Panel Name" format
        const parts = benchmark.config_title.split(' - ');
        if (parts.length > 1) {
          const extractedTitle = parts.slice(1).join(' - ');
          matchingPanel = availablePanels.find((panel) => panel.title === extractedTitle);
        }

        // Also try last part only
        if (!matchingPanel && parts.length > 0) {
          const lastPart = parts[parts.length - 1];
          matchingPanel = availablePanels.find((panel) => panel.title === lastPart);
        }
      }

      // 4. Try partial/fuzzy matching as last resort
      if (!matchingPanel && benchmark.metric_name) {
        const metricLower = benchmark.metric_name.toLowerCase();
        matchingPanel = availablePanels.find((panel) => {
          const titleLower = panel.title.toLowerCase();
          return titleLower.includes(metricLower) || metricLower.includes(titleLower);
        });
      }

      if (matchingPanel) {
        setSloFormData((prev) => ({
          ...prev,
          selectedPanel: matchingPanel,
        }));
      }
    }
  }, [availablePanels, benchmark]);

  return {
    sloFormData,
    setSloFormData,
    validationErrors,
    setValidationErrors,
    loadingStates: {
      sloFormLoading,
      dashboardsLoading,
      panelsLoading,
    },
    availableOptions: {
      availableDashboards,
      availablePanels,
      availableDynatraceDashboards,
      availableDynatraceMetrics,
    },
    showSaveDialog,
    setShowSaveDialog,
    saveDialogOption,
    setSaveDialogOption,
    fetchDashboardPanels,
    fetchSloApplicationDashboards,
    fetchDynatraceDashboardsForSlo,
    fetchDynatraceMetricsForSlo,
  };
}
