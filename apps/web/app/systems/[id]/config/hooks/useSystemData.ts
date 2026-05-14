'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { SystemUnderTest } from '@/lib/types';
import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceConfigs } from '@/lib/dynatrace';
import { fetchTracingInstances } from '@/lib/distributed-tracing';
import { fetchPyroscopeInstances } from '@/lib/pyroscope';

export type TabId = 'grafana' | 'slo' | 'deep-links' | 'dynatrace' | 'tracing' | 'pyroscope' | 'notifications' | 'templates' | 'adapt-settings';

interface UseSystemDataProps {
  onDashboardsLoad?: (systemId: string, environment: string) => void;
  onBenchmarksLoad?: (systemId: string, environment: string, workload: string) => void;
}

interface UseSystemDataReturn {
  // Core state
  systemId: string;
  system: SystemUnderTest | null;
  loading: boolean;
  error: string | null;

  // Environment and workload state
  selectedEnvironment: string;
  selectedWorkload: string;
  availableEnvironments: string[];
  availableWorkloads: string[];

  // Tab state
  activeTab: TabId;

  // Integration availability
  hasDynatrace: boolean;
  hasTracing: boolean;
  hasPyroscope: boolean;

  // Handlers
  handleEnvironmentChange: (environment: string) => void;
  handleWorkloadChange: (workload: string) => void;
  handleTabChange: (newValue: TabId) => void;
  setSystem: (system: SystemUnderTest) => void;
  fetchSystem: () => Promise<void>;
}

// Tab name to TabId mapping (for URL params)
const TAB_NAME_MAPPING: { [key: string]: TabId } = {
  'Grafana dashboards': 'grafana',
  'Service Level Objectives': 'slo',
  'Deep Links': 'deep-links',
  'Dynatrace': 'dynatrace',
  'Distributed Tracing': 'tracing',
  'Pyroscope': 'pyroscope',
  'Notifications': 'notifications',
  'Reporting Templates': 'templates',
};

// Legacy numeric index to TabId mapping (for URL backward compat)
const TAB_INDEX_MAPPING: TabId[] = [
  'grafana', 'slo', 'deep-links', 'dynatrace', 'tracing', 'pyroscope', 'notifications', 'templates',
];

export function useSystemData({
  onDashboardsLoad,
  onBenchmarksLoad,
}: UseSystemDataProps = {}): UseSystemDataReturn {
  const params = useParams();
  const searchParams = useSearchParams();
  const systemId = params.id as string;

  // Core state
  const [system, setSystem] = useState<SystemUnderTest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Environment and workload state
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>('');
  const [selectedWorkload, setSelectedWorkload] = useState<string>('');
  const [availableEnvironments, setAvailableEnvironments] = useState<string[]>([]);
  const [availableWorkloads, setAvailableWorkloads] = useState<string[]>([]);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('grafana');

  // Integration availability
  const [hasDynatrace, setHasDynatrace] = useState(false);
  const [hasTracing, setHasTracing] = useState(false);
  const [hasPyroscope, setHasPyroscope] = useState(false);

  // Fetch integration availability
  const fetchIntegrations = useCallback(async () => {
    try {
      const [dynatraceConfigs, tracingInstances, pyroscopeInstances] = await Promise.all([
        fetchDynatraceConfigs().catch(() => []),
        fetchTracingInstances().catch(() => []),
        fetchPyroscopeInstances().catch(() => []),
      ]);
      setHasDynatrace(dynatraceConfigs.length > 0);
      setHasTracing(tracingInstances.length > 0);
      setHasPyroscope(pyroscopeInstances.length > 0);
    } catch {
      // Silently fail - tabs just won't show
    }
  }, []);

  // Fetch system data function
  const fetchSystem = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const systemResponse = await authenticatedFetch(`/systems-under-test/${systemId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!systemResponse.ok) {
        throw new Error('Failed to load system data');
      }

      const systemData = await systemResponse.json();
      setSystem(systemData);

      // Extract environments and workloads from system data
      const environments = (systemData as { environments?: Array<{ environment: string; workloads: string[] }> }).environments;
      if (environments && Array.isArray(environments)) {
        const envNames = environments.map((env) => env.environment);
        setAvailableEnvironments(envNames);

        // Read URL params to check if scope was provided
        const envParam = searchParams.get('environment');
        const workloadParam = searchParams.get('workload');

        // Use URL param environment if provided and valid, otherwise auto-select first
        const targetEnvironment = (envParam && envNames.includes(envParam))
          ? envParam
          : (!selectedEnvironment && envNames.length > 0 ? envNames[0] : selectedEnvironment);

        if (targetEnvironment && targetEnvironment !== selectedEnvironment) {
          setSelectedEnvironment(targetEnvironment);
        }

        // Populate workloads for the target environment
        if (targetEnvironment) {
          const envData = environments.find((e) => e.environment === targetEnvironment);
          if (envData?.workloads) {
            setAvailableWorkloads(envData.workloads);

            // Use URL param workload if provided and valid, otherwise auto-select first
            const targetWorkload = (workloadParam && envData.workloads.includes(workloadParam))
              ? workloadParam
              : (!selectedWorkload && envData.workloads.length > 0 ? envData.workloads[0] : selectedWorkload);

            if (targetWorkload && targetWorkload !== selectedWorkload) {
              setSelectedWorkload(targetWorkload);
            }
          }

          // Load dashboards for the environment
          if (activeTab === 'grafana' && onDashboardsLoad) {
            onDashboardsLoad(systemId, targetEnvironment);
          }
        }
      }
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to load system data');
    } finally {
      setLoading(false);
    }
  }, [systemId, selectedEnvironment, selectedWorkload, activeTab, onDashboardsLoad, searchParams]);

  // Load system data and integration availability on mount
  useEffect(() => {
    if (systemId) {
      fetchSystem();
      fetchIntegrations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId]);

  // Handle URL parameters for initial state
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    const environmentParam = searchParams.get('environment');
    const workloadParam = searchParams.get('workload');

    // Set initial tab if provided
    if (tabParam) {
      // Try as numeric index (backward compat)
      const tabIndex = parseInt(tabParam, 10);
      if (!isNaN(tabIndex) && tabIndex >= 0 && tabIndex < TAB_INDEX_MAPPING.length) {
        setActiveTab(TAB_INDEX_MAPPING[tabIndex]);
      } else {
        // Try as tab name
        const decodedTabParam = decodeURIComponent(tabParam);
        if (TAB_NAME_MAPPING[decodedTabParam] !== undefined) {
          setActiveTab(TAB_NAME_MAPPING[decodedTabParam]);
        } else if (TAB_INDEX_MAPPING.includes(decodedTabParam as TabId)) {
          // Try as TabId directly (e.g. ?tab=dynatrace)
          setActiveTab(decodedTabParam as TabId);
        }
      }
    }

    // Set initial environment if provided
    if (environmentParam) {
      setSelectedEnvironment(environmentParam);
    }

    // Set initial workload if provided
    if (workloadParam) {
      setSelectedWorkload(workloadParam);
    }
  }, [searchParams]);

  // Handle environment selection
  const handleEnvironmentChange = useCallback((environment: string) => {
    setSelectedEnvironment(environment);
    setSelectedWorkload('');
    setAvailableWorkloads([]);

    if (environment && system) {
      // Find workloads for selected environment
      const systemEnvs = (system as { environments?: Array<{ environment: string; workloads: string[] }> }).environments;
      const selectedEnvData = systemEnvs?.find((env) => env.environment === environment);
      if (selectedEnvData?.workloads) {
        setAvailableWorkloads(selectedEnvData.workloads);
      }

      // Load dashboards for this environment
      if (activeTab === 'grafana' && onDashboardsLoad) {
        onDashboardsLoad(systemId, environment);
      }
    }
  }, [system, activeTab, onDashboardsLoad, systemId]);

  // Handle workload selection
  const handleWorkloadChange = useCallback((workload: string) => {
    setSelectedWorkload(workload);
  }, []);

  // Tab change handler
  const handleTabChange = useCallback((newValue: TabId) => {
    setActiveTab(newValue);
  }, []);

  // Load SLO benchmarks whenever the SLO tab is active and scope is set.
  // Reactive rather than imperative so URL-driven mount (?tab=slo) works the
  // same as a tab click: the click and the URL both resolve to the same
  // (activeTab, env, workload) triple that this effect watches.
  useEffect(() => {
    if (activeTab === 'slo' && systemId && selectedEnvironment && selectedWorkload && onBenchmarksLoad) {
      onBenchmarksLoad(systemId, selectedEnvironment, selectedWorkload);
    }
  }, [activeTab, systemId, selectedEnvironment, selectedWorkload, onBenchmarksLoad]);

  return {
    systemId,
    system,
    loading,
    error,
    selectedEnvironment,
    selectedWorkload,
    availableEnvironments,
    availableWorkloads,
    activeTab,
    hasDynatrace,
    hasTracing,
    hasPyroscope,
    handleEnvironmentChange,
    handleWorkloadChange,
    handleTabChange,
    setSystem,
    fetchSystem,
  };
}
