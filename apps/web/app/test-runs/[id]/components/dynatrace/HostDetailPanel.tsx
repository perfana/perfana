'use client';

import { useState, useEffect } from 'react';
import { Box, CircularProgress, Alert } from '@mui/material';
import {
  fetchHostProperties,
  fetchHostMetrics,
  fetchHostProblems,
  storeHostProperties,
  HostPropertiesResponse,
  HostMetricsResponse,
  HostProblemResponse,
  DynatraceConfig
} from '@/lib/dynatrace';
import { TestRun } from '@/types/test-runs';
import HostPropertiesSection from './HostPropertiesSection';
import HostPerformanceGraphs from './HostPerformanceGraphs';
import HostProblemsSection from './HostProblemsSection';

interface DynatraceEntityMapping {
  id: string;
  entityId: string;
  entityDisplayName: string;
  entityType: string;
  systemUnderTestId: string;
  testEnvironment?: string;
  workload?: string;
  level: string;
  createdAt: string;
  updatedAt: string;
}

interface HostDetailPanelProps {
  host: DynatraceEntityMapping;
  testRun: TestRun;
  config: DynatraceConfig;
}

export default function HostDetailPanel({
  host,
  testRun,
  config
}: HostDetailPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [properties, setProperties] = useState<HostPropertiesResponse | null>(null);
  const [metrics, setMetrics] = useState<HostMetricsResponse | null>(null);
  const [problems, setProblems] = useState<HostProblemResponse[]>([]);

  useEffect(() => {
    fetchHostData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.entityId, testRun.id]);

  const fetchHostData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Parallel fetch of properties, metrics, and problems
      const [propertiesData, metricsData, problemsData] = await Promise.all([
        fetchHostProperties(host.entityId, config.id),
        testRun.start_time && testRun.end_time
          ? fetchHostMetrics(
              host.entityId,
              testRun.start_time,
              testRun.end_time,
              config.id
            )
          : Promise.resolve(null),
        testRun.start_time && testRun.end_time
          ? fetchHostProblems(
              host.entityId,
              testRun.start_time,
              testRun.end_time,
              config.id
            )
          : Promise.resolve([])
      ]);

      setProperties(propertiesData);
      setMetrics(metricsData);
      setProblems(problemsData);

      // Auto-store properties to test_run_configs
      if (propertiesData && testRun.id) {
        try {
          await storeHostProperties(
            host.entityId,
            testRun.id,
            host.entityDisplayName,
            propertiesData.properties
          );
        } catch (storeError) {
          console.warn('Failed to store host properties:', storeError);
          // Don't fail the whole component if storage fails
        }
      }
    } catch (err) {
      console.error('Error fetching host data:', err);
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to fetch host data'
      );
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Box textAlign="center" py={4}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Host Properties Section */}
      {properties && (
        <HostPropertiesSection
          properties={properties}
          hostId={host.entityId}
          config={config}
          startTime={testRun.start_time}
          endTime={testRun.end_time}
        />
      )}

      {/* Performance Graphs Section */}
      {metrics && testRun.start_time && testRun.end_time && (
        <HostPerformanceGraphs
          metrics={metrics}
          startTime={testRun.start_time}
          endTime={testRun.end_time}
          hostDisplayName={host.entityDisplayName}
        />
      )}

      {/* Problems Section */}
      <HostProblemsSection problems={problems} />
    </Box>
  );
}
