'use client';

import { useState, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { GrafanaInstance, GrafanaDashboard } from '../components/DashboardFormDialog';

interface UseGrafanaDataReturn {
  dashboards: GrafanaDashboard[];
  instances: GrafanaInstance[];
  loading: boolean;
  loadGrafanaData: () => Promise<void>;
  isLoaded: boolean;
}

/**
 * Hook for managing Grafana instances and dashboards data
 */
export function useGrafanaData(): UseGrafanaDataReturn {
  const [dashboards, setDashboards] = useState<GrafanaDashboard[]>([]);
  const [instances, setInstances] = useState<GrafanaInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const fetchAvailableGrafanaDashboards = async (): Promise<GrafanaDashboard[]> => {
    try {
      const response = await authenticatedFetch('/grafana/dashboards', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch available dashboards');
      }

      const data = await response.json();
      // Filter to only include template dashboards (tagged with "perfana-template")
      return data.filter((dashboard: GrafanaDashboard) =>
        dashboard.tags?.includes('perfana-template')
      );
    } catch (err) {
      return [];
    }
  };

  const fetchAvailableGrafanaInstances = async (): Promise<GrafanaInstance[]> => {
    try {
      const response = await authenticatedFetch('/grafana-instances', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch Grafana instances');
      }

      return await response.json();
    } catch (err) {
      return [];
    }
  };

  const loadGrafanaData = useCallback(async () => {
    if (isLoaded) return;

    setLoading(true);
    const [loadedDashboards, loadedInstances] = await Promise.all([
      fetchAvailableGrafanaDashboards(),
      fetchAvailableGrafanaInstances(),
    ]);
    setDashboards(loadedDashboards);
    setInstances(loadedInstances);
    setLoading(false);
    setIsLoaded(true);
  }, [isLoaded]);

  return {
    dashboards,
    instances,
    loading,
    loadGrafanaData,
    isLoaded,
  };
}
