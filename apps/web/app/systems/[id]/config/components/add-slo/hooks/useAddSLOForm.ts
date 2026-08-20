'use client';
import { ApplicationDashboard, GrafanaPanel } from '@/lib/types';
import { DynatraceDashboard, DynatraceMetric } from '@/lib/dynatrace';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceDashboards, fetchDynatraceMetrics, fetchDynatraceQueries } from '@/lib/dynatrace';
import {
  SLOFormData,
  ValidationErrors,
  UseAddSLOFormProps,
  UseAddSLOFormReturn,
  initialSLOFormData,
} from '../types';
import { SUPPORTED_PANEL_TYPES } from '../utils/slo-validators';
import { isPerformanceTest } from '@/lib/metrics-source-utils';

export function useAddSLOForm({
  open,
  systemId,
  environment,
  workload,
}: UseAddSLOFormProps): UseAddSLOFormReturn {
  // SLO form data state
  const [sloFormData, setSloFormData] = useState<SLOFormData>(initialSLOFormData);

  // Loading states
  const [sloFormLoading, setSloFormLoading] = useState(false);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [panelsLoading, setPanelsLoading] = useState(false);

  // Available options
  const [availableDashboards, setAvailableDashboards] = useState<ApplicationDashboard[]>([]);
  const [availablePanels, setAvailablePanels] = useState<GrafanaPanel[]>([]);
  const [availableDynatraceDashboards, setAvailableDynatraceDashboards] = useState<DynatraceDashboard[]>([]);
  const [availableDynatraceMetrics, setAvailableDynatraceMetrics] = useState<DynatraceMetric[]>([]);
  const [availablePerfMetricsDashboards, setAvailablePerfMetricsDashboards] = useState<ApplicationDashboard[]>([]);
  const [availablePerfMetricsPanels, setAvailablePerfMetricsPanels] = useState<GrafanaPanel[]>([]);
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});

  // Data source availability
  const [hasDynatraceData, setHasDynatraceData] = useState(false);
  const [hasPerfMetricsData, setHasPerfMetricsData] = useState(false);

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

  // Fetch Dynatrace dashboards.
  // Workload-agnostic: a Dynatrace dashboard's panels are identical across
  // workloads, so the SLO picker must not filter by the page's selected
  // workload (which may be a workload that never had a Dynatrace run).
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

  // Fetch Dynatrace metrics
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

  // Check if Dynatrace data exists
  const checkDynatraceDataExists = useCallback(async () => {
    if (!systemId || !environment) {
      return false;
    }

    try {
      const queryQueries = await fetchDynatraceQueries(systemId, environment);
      return queryQueries.length > 0;
    } catch (error) {
      console.error('Error checking Dynatrace data existence:', error);
      return false;
    }
  }, [systemId, environment]);

  // Fetch Performance metrics dashboards
  const fetchPerfMetricsDashboardsForSlo = useCallback(async () => {
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
        // Filter for performance-test-metrics dashboards only
        const perfMetricsDashboards = dashboardsData.filter(
          (d: { dashboard_uid?: string; metrics_source_id?: string; source_type?: string }) =>
            isPerformanceTest(d),
        );
        setAvailablePerfMetricsDashboards(perfMetricsDashboards);
      } else {
        console.warn('Failed to fetch Performance metrics dashboards:', response.statusText);
        setAvailablePerfMetricsDashboards([]);
      }
    } catch (error) {
      console.error('Error fetching Performance metrics dashboards:', error);
      setAvailablePerfMetricsDashboards([]);
    } finally {
      setDashboardsLoading(false);
    }
  }, [systemId, environment]);

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
        const dashboard = Array.isArray(dashboardData) ? dashboardData[0] : dashboardData;
        const filteredPanels =
          dashboard?.panels?.filter((panel: { type: string }) => SUPPORTED_PANEL_TYPES.includes(panel.type)) || [];
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

  // Fetch Performance metrics panels from ds_metric_statistics
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
        setAvailablePerfMetricsPanels(panels);
      } else {
        console.warn('Failed to fetch Performance metrics panels:', response.statusText);
        setAvailablePerfMetricsPanels([]);
      }
    } catch (error) {
      console.error('Error fetching Performance metrics panels:', error);
      setAvailablePerfMetricsPanels([]);
    } finally {
      setPanelsLoading(false);
    }
  }, []);

  // Check if Performance metrics data exists
  const checkPerfMetricsDataExists = useCallback(async () => {
    if (!systemId || !environment) {
      return false;
    }

    try {
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
        const perfMetricsDashboards = dashboardsData.filter(
          (d: { dashboard_uid?: string; metrics_source_id?: string; source_type?: string }) =>
            isPerformanceTest(d),
        );
        return perfMetricsDashboards.length > 0;
      }
      return false;
    } catch (error) {
      console.error('Error checking Performance metrics data existence:', error);
      return false;
    }
  }, [systemId, environment]);

  // Reset form state
  const resetForm = useCallback(() => {
    setSloFormData(initialSLOFormData);
    setAvailableDashboards([]);
    setAvailablePanels([]);
    setAvailableDynatraceDashboards([]);
    setAvailableDynatraceMetrics([]);
    setAvailablePerfMetricsDashboards([]);
    setAvailablePerfMetricsPanels([]);
    setValidationErrors({});
  }, []);

  // Handle source change
  const handleSourceChange = useCallback(
    (sourceValue: string) => {
      setSloFormData((prev) => ({
        ...prev,
        source: sourceValue,
        selectedDashboard: null,
        selectedPanel: null,
      }));

      // Clear previous data
      setAvailableDashboards([]);
      setAvailablePanels([]);
      setAvailableDynatraceDashboards([]);
      setAvailableDynatraceMetrics([]);
      setAvailablePerfMetricsDashboards([]);
      setAvailablePerfMetricsPanels([]);

      // Fetch appropriate data based on source
      if (sourceValue === 'grafana') {
        fetchSloApplicationDashboards();
      } else if (sourceValue === 'dynatrace') {
        fetchDynatraceDashboardsForSlo();
      } else if (sourceValue === 'performance-metrics') {
        fetchPerfMetricsDashboardsForSlo();
      }
    },
    [fetchSloApplicationDashboards, fetchDynatraceDashboardsForSlo, fetchPerfMetricsDashboardsForSlo]
  );

  // Reset form when dialog opens and determine available sources
  useEffect(() => {
    if (open) {
      resetForm();

      // Check what sources are available and auto-select if only one
      const initializeSources = async () => {
        const [hasGrafanaData, dynatraceDataExists, perfMetricsDataExists] = await Promise.all([
          Promise.resolve(true), // Always assume Grafana is available
          checkDynatraceDataExists(),
          checkPerfMetricsDataExists(),
        ]);

        setHasDynatraceData(dynatraceDataExists);
        setHasPerfMetricsData(perfMetricsDataExists);

        // Fetch all available sources upfront for the grouped dropdown
        if (hasGrafanaData && systemId && environment) {
          fetchSloApplicationDashboards();
        }
        if (dynatraceDataExists) {
          fetchDynatraceDashboardsForSlo();
        }
        if (perfMetricsDataExists) {
          fetchPerfMetricsDashboardsForSlo();
        }
      };

      initializeSources();
    }
  }, [
    open,
    systemId,
    environment,
    workload,
    fetchSloApplicationDashboards,
    fetchDynatraceDashboardsForSlo,
    checkDynatraceDataExists,
    fetchPerfMetricsDashboardsForSlo,
    checkPerfMetricsDataExists,
    resetForm,
  ]);

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
    setLoadingStates: {
      setSloFormLoading,
      setDashboardsLoading,
      setPanelsLoading,
    },
    availableOptions: {
      availableDashboards,
      availablePanels,
      availableDynatraceDashboards,
      availableDynatraceMetrics,
      availablePerfMetricsDashboards,
      availablePerfMetricsPanels,
    },
    dataSourceAvailability: {
      hasDynatraceData,
      hasPerfMetricsData,
    },
    fetchDashboardPanels,
    fetchPerfMetricsPanels,
    fetchSloApplicationDashboards,
    fetchDynatraceDashboardsForSlo,
    fetchDynatraceMetricsForSlo,
    fetchPerfMetricsDashboardsForSlo,
    handleSourceChange,
    resetForm,
  };
}
