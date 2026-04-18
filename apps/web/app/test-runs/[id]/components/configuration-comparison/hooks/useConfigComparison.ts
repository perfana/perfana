'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { authenticatedFetch } from '@/lib/api';
import {
  ConfigItem,
  RelatedTestRun,
  ExpectedConfigChange,
  ConfigComparison,
  UseConfigComparisonProps,
} from '../types';
import {
  normalizeConfigs,
  extractUniqueTags,
  createConfigComparisons,
  filterComparisons,
  getAccentColor,
} from '../utils/comparison-formatters';

export function useConfigComparison({
  testRun,
  testRunId,
  _configExpanded,
  showToast,
}: UseConfigComparisonProps) {
  const searchParams = useSearchParams();

  // Configuration data state
  const [testRunConfigs, setTestRunConfigs] = useState<ConfigItem[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [keyFilter, setKeyFilter] = useState<string>('');

  // Related test runs state
  const [relatedTestRuns, setRelatedTestRuns] = useState<RelatedTestRun[]>([]);
  const [selectedRelatedTestRun, setSelectedRelatedTestRun] = useState<string>('');
  const [selectedTestRunConfigs, setSelectedTestRunConfigs] = useState<ConfigItem[]>([]);
  const [selectedConfigLoading, setSelectedConfigLoading] = useState(false);

  // Status filters and expected changes state
  const [statusFilters, setStatusFilters] = useState<string[]>(['changed', 'new']);
  const [expectedConfigChanges, setExpectedConfigChanges] = useState<ExpectedConfigChange[]>([]);
  const [expectedChangesLoading, setExpectedChangesLoading] = useState(false);
  const [expectedChangesLoaded, setExpectedChangesLoaded] = useState(false);

  // Track if we've already attempted to load data (prevents flickering when no data exists)
  const relatedTestRunsAttempted = useRef(false);
  const testRunConfigsAttempted = useRef(false);
  const selectedTestRunConfigsAttempted = useRef<Record<string, boolean>>({});

  // Build URL with query parameters
  const buildUrlWithParams = useCallback((baseUrl: string): string => {
    const system = searchParams.get('system');
    const environment = searchParams.get('environment');
    const workload = searchParams.get('workload');

    if (system && environment && workload) {
      const queryParams = new URLSearchParams({ system, environment, workload });
      return `${baseUrl}?${queryParams.toString()}`;
    }
    return baseUrl;
  }, [searchParams]);

  // Load test run configurations
  const loadTestRunConfigs = useCallback(async (targetTestRunId: string) => {
    // Skip if already attempted (prevents flickering when no configs exist)
    if (testRunConfigsAttempted.current) {
      return;
    }

    try {
      setConfigLoading(true);
      const url = buildUrlWithParams(`/test-runs/${targetTestRunId}/configs`);

      const response = await authenticatedFetch(url);
      if (!response.ok) {
        if (response.status === 404) {
          console.warn('Test run configs not found');
          setTestRunConfigs([]);
          testRunConfigsAttempted.current = true;
          return;
        }
        throw new Error('Failed to fetch test run configs');
      }

      const configs = await response.json();
      const normalizedConfigs = normalizeConfigs(configs);
      setTestRunConfigs(normalizedConfigs);
      setAllTags(extractUniqueTags(normalizedConfigs));
      testRunConfigsAttempted.current = true;
    } catch (err) {
      console.error('Failed to load test run configs:', err);
      setTestRunConfigs([]);
      testRunConfigsAttempted.current = true;
    } finally {
      setConfigLoading(false);
    }
  }, [buildUrlWithParams]);

  // Load related test runs
  const loadRelatedTestRuns = useCallback(async (targetTestRunId: string) => {
    // Skip if already attempted (prevents flickering when no related test runs exist)
    if (relatedTestRunsAttempted.current) {
      return;
    }

    try {
      const url = buildUrlWithParams(`/test-runs/${targetTestRunId}/related`);

      const response = await authenticatedFetch(url);
      if (!response.ok) {
        if (response.status === 404) {
          console.warn('Related test runs not found');
          setRelatedTestRuns([]);
          relatedTestRunsAttempted.current = true;
          return;
        }
        throw new Error('Failed to fetch related test runs');
      }

      const relatedRuns = await response.json();
      setRelatedTestRuns(relatedRuns);
      relatedTestRunsAttempted.current = true;

      // Automatically select the previous test run
      if (relatedRuns.length > 0 && !selectedRelatedTestRun) {
        const currentTestRunDate = testRun ? new Date(testRun.created_at) : new Date();
        const previousTestRun = relatedRuns.find((run: RelatedTestRun) =>
          new Date(run.created_at) < currentTestRunDate
        );

        if (previousTestRun) {
          setSelectedRelatedTestRun(previousTestRun.test_run_id);
          loadSelectedTestRunConfigs(previousTestRun.test_run_id);
        }
      }
    } catch (err) {
      console.error('Failed to load related test runs:', err);
      setRelatedTestRuns([]);
      relatedTestRunsAttempted.current = true;
    }
  }, [buildUrlWithParams, testRun, selectedRelatedTestRun]);

  // Load selected test run configurations
  const loadSelectedTestRunConfigs = useCallback(async (selectedTestRunId: string) => {
    // Skip if already attempted for this test run (prevents infinite retry loop)
    if (selectedTestRunConfigsAttempted.current[selectedTestRunId]) {
      return;
    }

    try {
      setSelectedConfigLoading(true);
      selectedTestRunConfigsAttempted.current[selectedTestRunId] = true;
      const url = buildUrlWithParams(`/test-runs/${selectedTestRunId}/configs`);

      const response = await authenticatedFetch(url);
      if (!response.ok) {
        if (response.status === 404) {
          console.warn('Selected test run configs not found');
          setSelectedTestRunConfigs([]);
          return;
        }
        if (response.status === 429) {
          console.warn('Rate limit exceeded, please try again later');
          setSelectedTestRunConfigs([]);
          return;
        }
        throw new Error('Failed to fetch selected test run configs');
      }

      const configs = await response.json();
      const normalizedConfigs = normalizeConfigs(configs);
      setSelectedTestRunConfigs(normalizedConfigs);

      // Update allTags to include tags from the selected test run
      setAllTags(prevTags => {
        const newTags = extractUniqueTags(normalizedConfigs);
        const uniqueTags = new Set([...prevTags, ...newTags]);
        return Array.from(uniqueTags).sort();
      });
    } catch (err) {
      console.error('Failed to load selected test run configs:', err);
      setSelectedTestRunConfigs([]);
    } finally {
      setSelectedConfigLoading(false);
    }
  }, [buildUrlWithParams]);

  // Load expected configuration changes
  const loadExpectedConfigChanges = useCallback(async () => {
    try {
      setExpectedChangesLoading(true);

      const system = searchParams.get('system');
      const environment = searchParams.get('environment');
      const workload = searchParams.get('workload');

      if (!system || !environment || !workload) {
        setExpectedConfigChanges([]);
        setExpectedChangesLoaded(true);
        return;
      }

      const queryParams = new URLSearchParams({ system, environment, workload });
      const response = await authenticatedFetch(
        `/test-runs/expected-config-changes?${queryParams.toString()}`
      );

      if (!response.ok) {
        if (response.status === 401) {
          console.warn('Authentication failed for expected config changes - continuing without them');
          setExpectedConfigChanges([]);
          setExpectedChangesLoaded(true);
          return;
        }
        if (response.status === 404) {
          console.warn('No expected config changes found - continuing without them');
          setExpectedConfigChanges([]);
          setExpectedChangesLoaded(true);
          return;
        }
        console.error(`Expected config changes API failed with status ${response.status}:`, await response.text());
        throw new Error(`Failed to fetch expected config changes (HTTP ${response.status})`);
      }

      const expectedChanges = await response.json();
      setExpectedConfigChanges(expectedChanges);
      setExpectedChangesLoaded(true);
    } catch (err) {
      console.error('Failed to load expected config changes:', err);
      setExpectedConfigChanges([]);
      setExpectedChangesLoaded(true);
    } finally {
      setExpectedChangesLoading(false);
    }
  }, [searchParams]);

  // Toggle expected configuration change
  const toggleExpectedConfigChange = useCallback(async (configKey: string, isCurrentlyExpected: boolean) => {
    try {
      const system = searchParams.get('system');
      const environment = searchParams.get('environment');
      const workload = searchParams.get('workload');

      if (!system || !environment || !workload) {
        return;
      }

      if (isCurrentlyExpected) {
        // Remove from expected changes
        const queryParams = new URLSearchParams({
          system,
          environment,
          workload,
          configKey
        });

        const response = await authenticatedFetch(
          `/test-runs/expected-config-changes?${queryParams.toString()}`,
          { method: 'DELETE' }
        );

        if (!response.ok) {
          if (response.status === 401) {
            showToast('Authentication required to manage ignored changes');
            return;
          }
          throw new Error('Failed to remove expected config change');
        }

        showToast(`"${configKey}" is no longer ignored and will reappear`);

        // Ensure the item will be visible after unflagging
        if (!statusFilters.includes('changed')) {
          setStatusFilters(prev => [...prev, 'changed']);
        }
      } else {
        // Add to expected changes
        const response = await authenticatedFetch(`/test-runs/expected-config-changes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system,
            environment,
            workload,
            configKey,
            reason: 'Marked as ignored change from UI'
          })
        });

        if (!response.ok) {
          if (response.status === 401) {
            showToast('Authentication required to manage ignored changes');
            return;
          }
          throw new Error('Failed to create expected config change');
        }

        showToast(`"${configKey}" is now ignored and hidden from this view`);

        // Temporarily show expected changes to provide visual feedback
        setStatusFilters(prev => [...prev, 'expected']);

        // After a short delay, remove 'expected' from filters to hide it again
        setTimeout(() => {
          setStatusFilters(prev => prev.filter(status => status !== 'expected'));
        }, 2000);
      }

      // Reload expected changes
      await loadExpectedConfigChanges();
    } catch (err) {
      console.error('Failed to toggle expected config change:', err);
      showToast('Failed to update ignore status');
    }
  }, [searchParams, statusFilters, showToast, loadExpectedConfigChanges]);

  // Handle related test run selection change
  const handleRelatedTestRunChange = useCallback((selectedTestRunId: string) => {
    setSelectedRelatedTestRun(selectedTestRunId);
    if (selectedTestRunId) {
      loadSelectedTestRunConfigs(selectedTestRunId);
    } else {
      setSelectedTestRunConfigs([]);
    }
  }, [loadSelectedTestRunConfigs]);

  // Reset loading attempts when test run changes
  useEffect(() => {
    relatedTestRunsAttempted.current = false;
    testRunConfigsAttempted.current = false;
    selectedTestRunConfigsAttempted.current = {};
    setRelatedTestRuns([]);
    setTestRunConfigs([]);
    setSelectedTestRunConfigs([]);
    setSelectedRelatedTestRun('');
  }, [testRun?.id]);

  // Effects for loading data
  // Use testRun?.id instead of testRun to prevent re-triggers on object reference changes
  useEffect(() => {
    if (testRun?.id && relatedTestRuns.length === 0 && !relatedTestRunsAttempted.current) {
      loadRelatedTestRuns(testRunId);
    }
  }, [testRun?.id, testRunId, relatedTestRuns.length, loadRelatedTestRuns]);

  useEffect(() => {
    if (testRun?.id && !expectedChangesLoaded && !expectedChangesLoading) {
      loadExpectedConfigChanges();
    }
  }, [testRun?.id, expectedChangesLoaded, expectedChangesLoading, loadExpectedConfigChanges]);

  useEffect(() => {
    if (
      selectedRelatedTestRun &&
      selectedTestRunConfigs.length === 0 &&
      !selectedConfigLoading &&
      !selectedTestRunConfigsAttempted.current[selectedRelatedTestRun]
    ) {
      loadSelectedTestRunConfigs(selectedRelatedTestRun);
    }
  }, [selectedRelatedTestRun, selectedTestRunConfigs.length, selectedConfigLoading, loadSelectedTestRunConfigs]);

  useEffect(() => {
    if (testRun?.id && testRunConfigs.length === 0 && !configLoading && !testRunConfigsAttempted.current) {
      loadTestRunConfigs(testRunId);
    }
  }, [testRun?.id, testRunId, testRunConfigs.length, configLoading, loadTestRunConfigs]);

  // Compute config comparisons
  const configComparisons: ConfigComparison[] = (() => {
    // Guard against race condition: wait for both config sets to finish loading
    if (configLoading || selectedConfigLoading) {
      return [];
    }
    return createConfigComparisons(testRunConfigs, selectedTestRunConfigs, expectedConfigChanges);
  })();

  // Apply filters
  const filteredComparisons = filterComparisons(
    configComparisons,
    statusFilters,
    selectedTags,
    keyFilter
  );

  // Compute accent color
  const accentColor = getAccentColor(configComparisons);

  return {
    // Configuration data
    testRunConfigs,
    configLoading,
    selectedTags,
    setSelectedTags,
    allTags,
    keyFilter,
    setKeyFilter,

    // Related test runs
    relatedTestRuns,
    selectedRelatedTestRun,
    selectedTestRunConfigs,
    selectedConfigLoading,
    handleRelatedTestRunChange,

    // Status filters and expected changes
    statusFilters,
    setStatusFilters,
    expectedConfigChanges,
    expectedChangesLoading,
    toggleExpectedConfigChange,

    // Computed values
    configComparisons,
    filteredComparisons,
    accentColor,

    // Loading functions
    loadTestRunConfigs,
    loadRelatedTestRuns,
  };
}
