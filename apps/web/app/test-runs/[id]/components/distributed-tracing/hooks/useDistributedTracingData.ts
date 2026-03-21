'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTheme } from '@mui/material';
import { authenticatedFetch } from '@/lib/api';
import { TracingService, generateTracingUrl } from '@/lib/distributed-tracing';
import {
  DrillDownFilters,
  ServiceNameItem,
  UseDistributedTracingDataReturn,
} from '../types';

interface UseDistributedTracingDataProps {
  testRun: {
    id: string;
    test_run_id: string;
    system_under_test_id: string;
    start_time: string;
    end_time: string;
    test_environment: string;
    workload: string;
    systems_under_test?: {
      name: string;
    };
  };
  expanded: boolean;
  initialFilters?: DrillDownFilters;
  onConfigurationStatus?: (hasConfiguration: boolean) => void;
}

export function useDistributedTracingData({
  testRun,
  expanded,
  initialFilters,
  onConfigurationStatus,
}: UseDistributedTracingDataProps): UseDistributedTracingDataReturn {
  const theme = useTheme();

  // Basic state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tracing services and configuration
  const [tracingServices, setTracingServices] = useState<TracingService[]>([]);
  const [activeServiceNameTab, setActiveServiceNameTab] = useState<number>(0);

  // Hierarchical request name filtering
  const [requestNames, setRequestNames] = useState<string[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<string | null>(null);
  const [selectedSampler, setSelectedSampler] = useState<string | null>(null);

  // Duration filters (in milliseconds)
  const [minDuration, setMinDuration] = useState<string>('');
  const [maxDuration, setMaxDuration] = useState<string>('');

  // Generated URL and iframe state
  const [tracingUrl, setTracingUrl] = useState<string | null>(null);
  const [iframeLoading, setIframeLoading] = useState(false);

  // View mode tab state (0 = Visualise, 1 = Traces Diff)
  const [viewModeTab, setViewModeTab] = useState<number>(0);

  // Derive unique scenarios from request names
  const scenarios = useMemo(() =>
    [...new Set(requestNames.map(name => name.split('|')[0]))].sort(),
    [requestNames]
  );

  // Derive transactions based on selected scenario
  const transactions = useMemo(() =>
    selectedScenario
      ? [...new Set(requestNames
          .filter(name => name.startsWith(`${selectedScenario}|`))
          .map(name => name.split('|')[1])
        )].sort()
      : [],
    [requestNames, selectedScenario]
  );

  // Derive samplers based on selected scenario and transaction
  const samplers = useMemo(() =>
    selectedScenario && selectedTransaction
      ? [...new Set(requestNames
          .filter(name => name.startsWith(`${selectedScenario}|${selectedTransaction}|`))
          .map(name => name.split('|')[2])
        )].sort()
      : [],
    [requestNames, selectedScenario, selectedTransaction]
  );

  // Build the request name pattern for Grafana variable
  const requestNamePattern = useMemo(() => {
    if (!selectedScenario) return '.*';
    if (!selectedTransaction) return `${selectedScenario}\\\\|.*`;
    if (!selectedSampler) return `${selectedScenario}\\\\|${selectedTransaction}\\\\|.*`;
    return `${selectedScenario}\\\\|${selectedTransaction}\\\\|${selectedSampler}`;
  }, [selectedScenario, selectedTransaction, selectedSampler]);

  // Check if Traces Diff tab should be enabled
  const isTracesDiffEnabled = Boolean(selectedScenario && selectedTransaction);

  // Get unique UI types for collapsed state
  const uiTypes = useMemo(() =>
    tracingServices.length > 0
      ? [...new Set(tracingServices.map((s) => s.tracingInstance?.tracingUi).filter(Boolean))].sort() as string[]
      : [],
    [tracingServices]
  );

  // Calculate total number of service names
  const totalServiceNames = useMemo(() =>
    tracingServices.reduce((total, service) => total + (service.serviceNames?.length || 0), 0),
    [tracingServices]
  );

  // Flatten all service names with metadata
  const allServiceNames: ServiceNameItem[] = useMemo(() =>
    tracingServices.flatMap(service =>
      (service.serviceNames || []).map(serviceName => ({
        serviceName,
        tracingServiceId: service.id,
        tracingInstanceLabel: service.tracingInstance?.label || 'Unknown',
        tracingUi: (service.tracingInstance?.tracingUi || 'tempo') as 'tempo' | 'jaeger' | 'elastic',
      }))
    ),
    [tracingServices]
  );

  // Get currently selected service name item
  const currentServiceNameItem = allServiceNames[activeServiceNameTab];

  // Get the tracing service for the currently selected service name
  const currentService = useMemo(() =>
    tracingServices.find(service => service.id === currentServiceNameItem?.tracingServiceId),
    [tracingServices, currentServiceNameItem]
  );

  // Load tracing services
  const loadTracingServices = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        systemId: testRun.system_under_test_id,
        environment: testRun.test_environment,
        workload: testRun.workload,
      });

      const response = await authenticatedFetch(`/tracing-services?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to load tracing services');
      }

      const services = await response.json();
      setTracingServices(Array.isArray(services) ? services : []);

      if (!services || (Array.isArray(services) && services.length === 0)) {
        setError('No tracing services configured for this test run');
      }
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load tracing services'
      );
      setTracingServices([]);
    } finally {
      setLoading(false);
    }
  }, [testRun.system_under_test_id, testRun.test_environment, testRun.workload]);

  // Load request names
  const loadRequestNames = useCallback(async (): Promise<void> => {
    try {
      const response = await authenticatedFetch(
        `/test-runs/${testRun.test_run_id}/request-names`
      );

      if (response.ok) {
        const names = await response.json();
        setRequestNames(names || []);
      }
    } catch (err) {
      // Non-critical error, continue without request names
      setRequestNames([]);
    }
  }, [testRun.test_run_id]);

  // Generate tracing URL
  const generateUrl = useCallback(async (): Promise<void> => {
    if (!currentService || !currentServiceNameItem) {
      return;
    }

    try {
      setIframeLoading(true);
      setError(null);

      const url = generateTracingUrl({
        tracingService: currentService,
        testRunId: testRun.test_run_id,
        startTime: testRun.start_time,
        endTime: testRun.end_time,
        serviceName: currentServiceNameItem.serviceName,
        requestName: requestNamePattern !== '.*' ? requestNamePattern : undefined,
        minDuration: minDuration || undefined,
        maxDuration: maxDuration || undefined,
        themeMode: theme.palette.mode,
      });

      setTracingUrl(url);
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to generate tracing URL'
      );
      setTracingUrl(null);
    }
  }, [currentService, currentServiceNameItem, testRun, requestNamePattern, minDuration, maxDuration, theme.palette.mode]);

  // Load tracing services on mount
  useEffect(() => {
    loadTracingServices();
  }, [loadTracingServices]);

  // Load request names when expanded
  useEffect(() => {
    if (expanded && tracingServices.length > 0) {
      loadRequestNames();
    }
  }, [expanded, tracingServices.length, loadRequestNames]);

  // Generate URL when service or filters change
  useEffect(() => {
    if (expanded && currentService) {
      generateUrl();
    }
  }, [expanded, currentService, generateUrl]);

  // Report configuration status to parent
  useEffect(() => {
    if (!loading && onConfigurationStatus) {
      onConfigurationStatus(tracingServices.length > 0);
    }
  }, [loading, tracingServices.length, onConfigurationStatus]);

  // Apply initial filters when provided (from drill-down)
  useEffect(() => {
    if (initialFilters && requestNames.length > 0) {
      const availableScenarios = [...new Set(requestNames.map(name => name.split('|')[0]))];

      // Try to find matching scenario
      let matchedScenario: string | undefined;
      if (initialFilters.scenario && availableScenarios.includes(initialFilters.scenario)) {
        matchedScenario = initialFilters.scenario;
      } else if (initialFilters.transaction) {
        const matchingRequest = requestNames.find(name => name.split('|')[1] === initialFilters.transaction);
        if (matchingRequest) {
          matchedScenario = matchingRequest.split('|')[0];
        }
      }

      if (matchedScenario) {
        setSelectedScenario(matchedScenario);

        if (initialFilters.transaction) {
          const availableTransactions = [...new Set(requestNames
            .filter(name => name.startsWith(`${matchedScenario}|`))
            .map(name => name.split('|')[1])
          )];

          if (availableTransactions.includes(initialFilters.transaction)) {
            setSelectedTransaction(initialFilters.transaction);

            if (initialFilters.sampler) {
              const availableSamplers = [...new Set(requestNames
                .filter(name => name.startsWith(`${matchedScenario}|${initialFilters.transaction}|`))
                .map(name => name.split('|')[2])
              )];

              if (availableSamplers.includes(initialFilters.sampler)) {
                setSelectedSampler(initialFilters.sampler);
              }
            }
          }
        }
      }
    }
  }, [initialFilters, requestNames]);

  // Add timeout for iframe loading
  useEffect(() => {
    if (iframeLoading && tracingUrl) {
      const timeout = setTimeout(() => {
        setIframeLoading(false);
      }, 5000);

      return () => clearTimeout(timeout);
    }
  }, [iframeLoading, tracingUrl]);

  // Handle service name tab change
  const handleServiceNameTabChange = useCallback((_event: React.SyntheticEvent, newValue: number): void => {
    setActiveServiceNameTab(newValue);
    setError(null);
    setSelectedScenario(null);
    setSelectedTransaction(null);
    setSelectedSampler(null);
    setMinDuration('');
    setMaxDuration('');
    setViewModeTab(0);
  }, []);

  // Handle view mode tab change
  const handleViewModeTabChange = useCallback((_event: React.SyntheticEvent, newValue: number): void => {
    if (newValue === 1 && !isTracesDiffEnabled) {
      return;
    }
    setViewModeTab(newValue);
    setError(null);
  }, [isTracesDiffEnabled]);

  // Handle opening external URL
  const handleOpenExternal = useCallback((): void => {
    if (tracingUrl) {
      window.open(tracingUrl, '_blank');
    }
  }, [tracingUrl]);

  return {
    // Loading states
    loading,
    error,
    iframeLoading,

    // Tracing services
    tracingServices,
    allServiceNames,
    currentServiceNameItem,
    currentService,

    // Filter state
    requestNames,
    scenarios,
    transactions,
    samplers,
    selectedScenario,
    selectedTransaction,
    selectedSampler,
    minDuration,
    maxDuration,

    // Tab state
    activeServiceNameTab,
    viewModeTab,

    // URL state
    tracingUrl,

    // Derived values
    totalServiceNames,
    uiTypes,
    isTracesDiffEnabled,

    // Actions
    setError,
    setIframeLoading,
    setSelectedScenario,
    setSelectedTransaction,
    setSelectedSampler,
    setMinDuration,
    setMaxDuration,
    handleServiceNameTabChange,
    handleViewModeTabChange,
    handleOpenExternal,
  };
}
