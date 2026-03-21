'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import {
  DynatraceConfig,
  DynatraceEntity,
  DynatraceEntityMapping,
  RelatedTestRun,
  DrillDownFilters,
} from '../types';
import { deriveFilterOptions } from '../utils/dynatrace-formatters';

interface UseDynatraceDataProps {
  testRun: TestRun;
  testRunId: string;
  expanded: boolean;
  initialFilters?: DrillDownFilters;
  onConfigurationStatus?: (hasConfiguration: boolean) => void;
}

export function useDynatraceData({
  testRun,
  testRunId,
  expanded,
  initialFilters,
  onConfigurationStatus,
}: UseDynatraceDataProps) {
  // Loading and error state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data state
  const [configs, setConfigs] = useState<DynatraceConfig[]>([]);
  const [entities, setEntities] = useState<DynatraceEntity[]>([]);
  const [entityMappings, setEntityMappings] = useState<DynatraceEntityMapping[]>([]);
  const [metricNames, setMetricNames] = useState<string[]>([]);

  // Filter state
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<string | null>(null);
  const [selectedSampler, setSelectedSampler] = useState<string | null>(null);
  const [minDuration, setMinDuration] = useState<string>('');
  const [maxDuration, setMaxDuration] = useState<string>('');

  // Tab state
  const [tabValue, setTabValue] = useState(0);
  const [primaryTabValue, setPrimaryTabValue] = useState(0);

  // Comparison state
  const [relatedTestRuns, setRelatedTestRuns] = useState<RelatedTestRun[]>([]);
  const [selectedComparisonTestRun, setSelectedComparisonTestRun] = useState<RelatedTestRun | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);

  // Derive filter options from metric names
  const filterOptions = deriveFilterOptions(
    metricNames,
    selectedScenario,
    selectedTransaction,
    selectedSampler
  );

  // Fetch Dynatrace data
  const fetchDynatraceData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch configurations
      const configsResponse = await authenticatedFetch('/dynatrace', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!configsResponse.ok) {
        throw new Error('Failed to fetch Dynatrace configurations');
      }

      const configsData = await configsResponse.json();
      setConfigs(configsData || []);

      if (configsData && configsData.length > 0) {
        // Fetch entity mappings
        const mappingsResponse = await authenticatedFetch(
          `/dynatrace/entities/mappings?systemId=${testRun.system_under_test_id}&environment=${testRun.test_environment}&workload=${testRun.workload}`,
          { method: 'GET', headers: { 'Content-Type': 'application/json' } }
        );

        if (mappingsResponse.ok) {
          const mappingsData = await mappingsResponse.json();
          setEntityMappings(mappingsData || []);

          // Convert to entities for backward compatibility
          const convertedEntities = mappingsData.map((mapping: DynatraceEntityMapping) => ({
            entityId: mapping.entityId,
            displayName: mapping.entityDisplayName,
            type: mapping.entityType,
            tags: [],
          }));
          setEntities(convertedEntities);
        }
      }

      // Fetch request names for hierarchical filtering
      const requestNamesResponse = await authenticatedFetch(`/test-runs/${testRunId}/request-names`);
      if (requestNamesResponse.ok) {
        const requestNamesData = await requestNamesResponse.json();
        setMetricNames(requestNamesData || []);
      }
    } catch (err) {
      const errorMessage = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to fetch Dynatrace data';
      setError(errorMessage);
      setConfigs([]);
      setEntities([]);
      setEntityMappings([]);
      setMetricNames([]);
    } finally {
      setLoading(false);
    }
  }, [testRun.system_under_test_id, testRun.test_environment, testRun.workload, testRunId]);

  // Fetch related test runs for comparison
  const fetchRelatedTestRuns = useCallback(async () => {
    if (!testRun) return;

    try {
      setComparisonLoading(true);
      const system = testRun.systems_under_test?.name;
      const environment = testRun.test_environment;
      const workload = testRun.workload;

      let url = `/test-runs/${testRunId}/related`;
      if (system && environment && workload) {
        const queryParams = new URLSearchParams({ system, environment, workload });
        url += `?${queryParams.toString()}`;
      }

      const response = await authenticatedFetch(url);
      if (response.ok) {
        const data = await response.json();
        setRelatedTestRuns(data || []);
      } else {
        setRelatedTestRuns([]);
      }
    } catch {
      setRelatedTestRuns([]);
    } finally {
      setComparisonLoading(false);
    }
  }, [testRun, testRunId]);

  // Initial data fetch
  useEffect(() => {
    fetchDynatraceData();
  }, [fetchDynatraceData]);

  // Fetch related test runs when expanded
  useEffect(() => {
    if (expanded && relatedTestRuns.length === 0 && testRun) {
      fetchRelatedTestRuns();
    }
  }, [expanded, testRun, relatedTestRuns.length, fetchRelatedTestRuns]);

  // Report configuration status to parent
  useEffect(() => {
    if (!loading && onConfigurationStatus) {
      onConfigurationStatus(entityMappings.length > 0);
    }
  }, [loading, entityMappings.length, onConfigurationStatus]);

  // Apply initial filters
  useEffect(() => {
    if (initialFilters && metricNames.length > 0) {
      const availableScenarios = [...new Set(metricNames.map(name => name.split('|')[0]))];

      let matchedScenario: string | undefined;
      if (initialFilters.scenario && availableScenarios.includes(initialFilters.scenario)) {
        matchedScenario = initialFilters.scenario;
      } else if (initialFilters.transaction) {
        const matchingMetric = metricNames.find(name => name.split('|')[1] === initialFilters.transaction);
        if (matchingMetric) {
          matchedScenario = matchingMetric.split('|')[0];
        }
      }

      if (matchedScenario) {
        setSelectedScenario(matchedScenario);

        if (initialFilters.transaction) {
          const availableTransactions = [...new Set(metricNames
            .filter(name => name.startsWith(`${matchedScenario}|`))
            .map(name => name.split('|')[1])
            .filter(Boolean)
          )];

          if (availableTransactions.includes(initialFilters.transaction)) {
            setSelectedTransaction(initialFilters.transaction);

            if (initialFilters.sampler) {
              const availableSamplers = [...new Set(metricNames
                .filter(name => name.startsWith(`${matchedScenario}|${initialFilters.transaction}|`))
                .map(name => name.split('|')[2])
                .filter(Boolean)
              )];

              if (availableSamplers.includes(initialFilters.sampler)) {
                setSelectedSampler(initialFilters.sampler);
              }
            }
          }
        }
      }
    }
  }, [initialFilters, metricNames]);

  // Filter entities by type
  const serviceEntities = entityMappings.filter(m => m.entityType === 'SERVICE');
  const hostEntities = entityMappings.filter(m => m.entityType === 'HOST');

  // Handle tab changes
  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handlePrimaryTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setPrimaryTabValue(newValue);
  };

  // Handle scenario change
  const handleScenarioChange = (newValue: string | null) => {
    setSelectedScenario(newValue);
    setSelectedTransaction(null);
    setSelectedSampler(null);
  };

  // Handle transaction change
  const handleTransactionChange = (newValue: string | null) => {
    setSelectedTransaction(newValue);
    setSelectedSampler(null);
  };

  return {
    // State
    loading,
    error,
    configs,
    entities,
    entityMappings,
    metricNames,
    serviceEntities,
    hostEntities,

    // Filter state
    selectedScenario,
    selectedTransaction,
    selectedSampler,
    minDuration,
    maxDuration,
    filterOptions,

    // Tab state
    tabValue,
    primaryTabValue,

    // Comparison state
    relatedTestRuns,
    selectedComparisonTestRun,
    comparisonLoading,

    // Handlers
    handleTabChange,
    handlePrimaryTabChange,
    handleScenarioChange,
    handleTransactionChange,
    setSelectedSampler,
    setMinDuration,
    setMaxDuration,
    setSelectedComparisonTestRun,
    fetchRelatedTestRuns,
  };
}
