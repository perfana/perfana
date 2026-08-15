'use client';
import { ApplicationDashboard, GrafanaPanel } from '@/lib/types';
import { DynatraceDashboard, DynatraceMetric } from '@/lib/dynatrace';

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
  const [availableDashboards, setAvailableDashboards] = useState<ApplicationDashboard[]>([]);
  const [availablePanels, setAvailablePanels] = useState<GrafanaPanel[]>([]);
  const [availableDynatraceDashboards, setAvailableDynatraceDashboards] = useState<DynatraceDashboard[]>([]);
  const [availableDynatraceMetrics, setAvailableDynatraceMetrics] = useState<DynatraceMetric[]>([]);
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

  // Fetch Dynatrace dashboards (workload-agnostic — see useAddSLOForm)
  const fetchDynatraceDashboardsForSlo = useCallback(async () => {
    if (!systemId || !environment) {
      return;
    }

    try {
      setDashboardsLoading(true);
      const dashboardsData = await fetchDynatraceDashboards(systemId, environment);
      setAvailableDynatraceDashboards(dashboardsData);
    } catch (error) {
      console.error('Error fetching Dynatrace dashboards for SLO:', error);
      setAvailableDynatraceDashboards([]);
    } finally {
      setDashboardsLoading(false);
    }
  }, [systemId, environment]);

  // Fetch Dynatrace metrics (workload-agnostic — see useAddSLOForm)
  const fetchDynatraceMetricsForSlo = useCallback(
    async (dashboardLabel: string) => {
      if (!systemId || !environment || !dashboardLabel) {
        return;
      }

      try {
        setPanelsLoading(true);
        const metricsData = await fetchDynatraceMetrics(systemId, environment, undefined, dashboardLabel);
        setAvailableDynatraceMetrics(metricsData);
      } catch (error) {
        console.error('Error fetching Dynatrace metrics for SLO:', error);
        setAvailableDynatraceMetrics([]);
      } finally {
        setPanelsLoading(false);
      }
    },
    [systemId, environment]
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
          dashboard?.panels?.filter((panel: GrafanaPanel) => SUPPORTED_PANEL_TYPES.includes(panel.type)) || [];

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

      const rawPanelId = benchmark.configuration?.panelId ?? benchmark.configuration?.id;
      const syntheticPanel = benchmark.source === 'dynatrace'
        ? {
            panelTitle,
          }
        : {
            // Coerce only when there is something to coerce: Number(undefined)
            // is NaN, which JSON.stringify writes as null, where the previous
            // `panelId || id` simply omitted the key.
            id: rawPanelId != null ? Number(rawPanelId) : undefined,
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

      type DashboardEntry = Pick<ApplicationDashboard, 'id' | 'dashboard_uid' | 'metrics_source_id'>;
      const benchmarkAny = benchmark as { metrics_source_id?: unknown };
      // First try to match by metrics_source_id (most reliable when available)
      if (benchmarkAny.metrics_source_id) {
        matchingDashboard = availableDashboards.find(
          (dashboard) => (dashboard as DashboardEntry).metrics_source_id === benchmarkAny.metrics_source_id
        );
      }

      // Then try to match by application_dashboard_id
      if (!matchingDashboard && benchmark.application_dashboard_id) {
        matchingDashboard = availableDashboards.find(
          (dashboard) => (dashboard as DashboardEntry).id === benchmark.application_dashboard_id
        );
      }

      // Fallback to dashboard_uid match if no application_dashboard_id match
      if (!matchingDashboard && benchmark.dashboard_uid) {
        matchingDashboard = availableDashboards.find(
          (dashboard) => (dashboard as DashboardEntry).dashboard_uid === benchmark.dashboard_uid
        );
      }

      if (matchingDashboard) {
        const typedDashboard = matchingDashboard as DashboardEntry & { dashboard_uid?: string; id?: string };
        setSloFormData((prev) => ({
          ...prev,
          selectedDashboard: typedDashboard,
        }));

        // Fetch panels for this dashboard to upgrade the synthetic panel too
        if (isPerformanceTest(typedDashboard)) {
          fetchPerfMetricsPanels(typedDashboard.id as string);
        } else {
          fetchDashboardPanels(typedDashboard.dashboard_uid as string);
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
      type DynatraceDashboard = { dashboardLabel?: string };
      // For Dynatrace, try to match by dashboardLabel
      const matchingDashboard = availableDynatraceDashboards.find(
        (dashboard) => (dashboard as DynatraceDashboard).dashboardLabel === benchmark.config_title?.split(' - ')[0]
      ) as DynatraceDashboard | undefined;

      if (matchingDashboard) {
        setSloFormData((prev) => ({
          ...prev,
          selectedDashboard: matchingDashboard,
        }));

        // Fetch metrics for this dashboard to upgrade the synthetic panel
        fetchDynatraceMetricsForSlo(matchingDashboard.dashboardLabel ?? '');
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
          matchingMetric = availableDynatraceMetrics.find((metric) => (metric as { panelTitle?: string }).panelTitle === extractedTitle);
        }
      }

      // Fallback to metric_name match
      if (!matchingMetric && benchmark.metric_name) {
        matchingMetric = availableDynatraceMetrics.find((metric) => (metric as { panelTitle?: string }).panelTitle === benchmark.metric_name);
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
      type GrafanaPanel = { id?: unknown; title?: string };
      // Try multiple ways to find the matching panel
      let matchingPanel: unknown = null;

      // 1. Try to match by panel ID from configuration (most reliable)
      if (benchmark.configuration?.panelId) {
        const panelId = benchmark.configuration.panelId;
        matchingPanel = availablePanels.find((panel) => {
          const p = panel as GrafanaPanel;
          // Handle both string and number panel IDs
          return p.id === panelId || p.id === String(panelId) || String(p.id) === String(panelId);
        });
      }

      // 2. Try to match by panel title exactly matching metric_name
      if (!matchingPanel && benchmark.metric_name) {
        matchingPanel = availablePanels.find((panel) => (panel as GrafanaPanel).title === benchmark.metric_name);
      }

      // 3. Try to match by extracting panel title from config_title
      if (!matchingPanel && benchmark.config_title) {
        // Try different extraction methods for "Dashboard - Panel Name" format
        const parts = benchmark.config_title.split(' - ');
        if (parts.length > 1) {
          const extractedTitle = parts.slice(1).join(' - ');
          matchingPanel = availablePanels.find((panel) => (panel as GrafanaPanel).title === extractedTitle);
        }

        // Also try last part only
        if (!matchingPanel && parts.length > 0) {
          const lastPart = parts[parts.length - 1];
          matchingPanel = availablePanels.find((panel) => (panel as GrafanaPanel).title === lastPart);
        }
      }

      // 4. Try partial/fuzzy matching as last resort
      if (!matchingPanel && benchmark.metric_name) {
        const metricLower = benchmark.metric_name.toLowerCase();
        matchingPanel = availablePanels.find((panel) => {
          const titleLower = ((panel as GrafanaPanel).title ?? '').toLowerCase();
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
