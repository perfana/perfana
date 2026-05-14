'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTheme } from '@mui/material';
import { authenticatedFetch } from '@/lib/api';
import {
  RelatedTestRun,
  FlamegraphAnalysis,
  FlamegraphDiff,
  UsePyroscopeDataProps,
  PyroscopeConfiguration,
  ViewMode,
} from '../types';
import { extractProfilerLabel, dateToMs, validateTimestamps } from '../utils/pyroscope-formatters';

export function usePyroscopeData({ testRun, expanded }: UsePyroscopeDataProps) {
  const theme = useTheme();

  // Basic state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Top-level tab state (application-profiler combinations)
  const [activeCombinationTab, setActiveCombinationTab] = useState<number>(0);

  // Nested tab state (Single View / Diff View per combination)
  const [viewModeTab, setViewModeTab] = useState<ViewMode>(0);

  // Single view state
  const [singleViewUrl, setSingleViewUrl] = useState<string | null>(null);
  const [iframeLoading, setIframeLoading] = useState(false);

  // Comparison view state
  const [relatedTestRuns, setRelatedTestRuns] = useState<RelatedTestRun[]>([]);
  const [selectedBaseline, setSelectedBaseline] = useState<RelatedTestRun | null>(null);
  const [compareViewUrl, setCompareViewUrl] = useState<string | null>(null);
  const [compareIframeLoading, setCompareIframeLoading] = useState(false);
  const [fetchingBaselines, setFetchingBaselines] = useState(false);

  // Flamegraph analysis state
  const [flamegraphAnalysis, setFlamegraphAnalysis] = useState<FlamegraphAnalysis | null>(null);
  const [analysingFlamegraph, setAnalysingFlamegraph] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [symbolFilter, setSymbolFilter] = useState<string>('');
  const [showAllRegressions, setShowAllRegressions] = useState(false);
  const [showAllImprovements, setShowAllImprovements] = useState(false);

  // Extract Pyroscope configuration from test run
  // Handle both possible field names (systems_under_test and system_under_test)
  const pyroscopeConfig = testRun.systems_under_test || testRun.system_under_test;
  const configurations: PyroscopeConfiguration[] = pyroscopeConfig?.pyroscope_configurations || [];
  const pyroscopeInstance = pyroscopeConfig?.pyroscopeInstance;

  // Derive unique applications and profilers for collapsed state display
  const applications = useMemo(
    () => [...new Set(configurations.map((c) => c.application))].sort(),
    [configurations]
  );
  const profilers = useMemo(
    () => [...new Set(configurations.map((c) => c.profiler))].sort(),
    [configurations]
  );

  // Get currently selected combination based on active tab
  const currentCombination = configurations[activeCombinationTab];
  const selectedApplication = currentCombination?.application || '';
  const selectedProfiler = currentCombination?.profiler || '';

  // Client-side filtering of analysis results
  const filteredAnalysis = useMemo(() => {
    if (!flamegraphAnalysis || !symbolFilter.trim()) {
      return flamegraphAnalysis;
    }

    const filterPattern = symbolFilter.trim().toLowerCase();
    const filterFn = (diff: FlamegraphDiff) =>
      diff.function.toLowerCase().includes(filterPattern);

    return {
      ...flamegraphAnalysis,
      regressions: flamegraphAnalysis.regressions?.filter(filterFn) || [],
      improvements: flamegraphAnalysis.improvements?.filter(filterFn) || [],
      topFunctionChanges: flamegraphAnalysis.topFunctionChanges.filter(filterFn),
    };
  }, [flamegraphAnalysis, symbolFilter]);

  // Load related test runs for comparison
  const loadRelatedTestRuns = useCallback(async (): Promise<void> => {
    try {
      setFetchingBaselines(true);
      const system = testRun.systems_under_test?.name;
      const environment = testRun.test_environment;
      const workload = testRun.workload;

      let url = `/test-runs/${testRun.test_run_id}/related`;
      if (system && environment && workload) {
        const queryParams = new URLSearchParams({
          system,
          environment,
          workload,
        });
        url += `?${queryParams.toString()}`;
      }

      const response = await authenticatedFetch(url);
      if (response.ok) {
        const data = await response.json();

        // Filter to only include completed test runs with start_time and end_time
        const validTestRuns = (data || []).filter(
          (tr: RelatedTestRun) => tr.completed && tr.start_time && tr.end_time
        );

        setRelatedTestRuns(validTestRuns);

        if (validTestRuns.length > 0 && !selectedBaseline) {
          setSelectedBaseline(validTestRuns[0]);
        }
      } else {
        console.warn('Failed to fetch related test runs');
        setRelatedTestRuns([]);
      }
    } catch (err) {
      console.error('Failed to fetch related test runs:', err);
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to fetch related test runs'
      );
      setRelatedTestRuns([]);
    } finally {
      setFetchingBaselines(false);
    }
  }, [testRun, selectedBaseline]);

  // Generate single view URL (client-side, no API roundtrip needed)
  const generateSingleViewUrl = useCallback((): void => {
    if (!pyroscopeInstance || !selectedApplication || !selectedProfiler) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setIframeLoading(true);

      const pyroscopeUrl = pyroscopeInstance.pyroscope_url || pyroscopeInstance.pyroscopeUrl;
      const isStandalone = pyroscopeInstance.pyroscope_stand_alone ?? pyroscopeInstance.pyroscopeStandAlone;
      const startTimeMs = dateToMs(testRun.start_time);
      const endTimeMs = dateToMs(testRun.end_time);

      let url: string;
      if (isStandalone) {
        // No URLSearchParams — Pyroscope doesn't decode %3A-encoded colons in profiler metric IDs
        const startSec = Math.round(startTimeMs / 1000);
        const endSec = Math.round(endTimeMs / 1000);
        url = `${pyroscopeUrl}/?from=${startSec}&until=${endSec}&var-profileMetricId=${selectedProfiler}&var-serviceName=${encodeURIComponent(selectedApplication)}`;
      } else {
        const params = new URLSearchParams({
          searchText: '',
          panelType: 'time-series',
          layout: 'grid',
          hideNoData: 'off',
          explorationType: 'flame-graph',
          'var-serviceName': selectedApplication,
          'var-profileMetricId': selectedProfiler,
          'var-groupBy': 'all',
          'var-filters': '',
          maxNodes: '16384',
          from: new Date(startTimeMs).toISOString(),
          to: new Date(endTimeMs).toISOString(),
          theme: theme.palette.mode,
          kiosk: 'true',
        });
        url = `${pyroscopeUrl}?${params.toString()}`;
      }

      setSingleViewUrl(url);
    } catch (err) {
      console.error('Failed to generate Pyroscope URL:', err);
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to generate Pyroscope URL'
      );
      setSingleViewUrl(null);
    } finally {
      setLoading(false);
    }
  }, [pyroscopeInstance, selectedApplication, selectedProfiler, testRun, theme.palette.mode]);

  // Generate comparison view URL (client-side, no API roundtrip needed)
  const generateComparisonUrl = useCallback((): void => {
    if (
      !pyroscopeInstance ||
      !selectedApplication ||
      !selectedProfiler ||
      !selectedBaseline
    ) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setCompareIframeLoading(true);

      // Validate baseline has required timestamps
      if (!selectedBaseline.start_time || !selectedBaseline.end_time) {
        setError('Selected baseline test run does not have valid timestamps for comparison');
        setLoading(false);
        setCompareIframeLoading(false);
        return;
      }

      const pyroscopeUrl = pyroscopeInstance.pyroscope_url || pyroscopeInstance.pyroscopeUrl;
      const isStandalone = pyroscopeInstance.pyroscope_stand_alone ?? pyroscopeInstance.pyroscopeStandAlone;

      // Convert ISO date strings to millisecond timestamps
      const currentStartTimeMs = dateToMs(testRun.start_time);
      const currentEndTimeMs = dateToMs(testRun.end_time);
      const baselineStartTimeMs = dateToMs(selectedBaseline.start_time);
      const baselineEndTimeMs = dateToMs(selectedBaseline.end_time);

      // Validate conversions were successful
      if (!validateTimestamps(baselineStartTimeMs, baselineEndTimeMs, currentStartTimeMs, currentEndTimeMs)) {
        setError('Failed to parse test run timestamps');
        setLoading(false);
        setCompareIframeLoading(false);
        return;
      }

      let url: string;
      if (isStandalone) {
        // No URLSearchParams — Pyroscope doesn't decode %3A-encoded colons in profiler labels
        const profilerLabel = extractProfilerLabel(selectedProfiler);
        const query = `${profilerLabel}{service_name="${selectedApplication}"}`;
        const baselineStartSec = Math.round(baselineStartTimeMs / 1000);
        const baselineEndSec = Math.round(baselineEndTimeMs / 1000);
        const currentStartSec = Math.round(currentStartTimeMs / 1000);
        const currentEndSec = Math.round(currentEndTimeMs / 1000);
        url = `${pyroscopeUrl}/diff?from=${baselineStartSec}&until=${currentEndSec}&leftFrom=${baselineStartSec}&leftUntil=${baselineEndSec}&rightFrom=${currentStartSec}&rightUntil=${currentEndSec}&query=${encodeURIComponent(query)}`;
      } else {
        const params = new URLSearchParams({
          searchText: '',
          panelType: 'time-series',
          layout: 'grid',
          hideNoData: 'off',
          explorationType: 'diff-flame-graph',
          'var-serviceName': selectedApplication,
          'var-profileMetricId': selectedProfiler,
          'var-groupBy': 'all',
          'var-filters': '',
          maxNodes: '16384',
          diffFrom: new Date(baselineStartTimeMs).toISOString(),
          diffTo: new Date(baselineEndTimeMs).toISOString(),
          'diffFrom-2': new Date(currentStartTimeMs).toISOString(),
          'diffTo-2': new Date(currentEndTimeMs).toISOString(),
          'from-2': new Date(baselineStartTimeMs).toISOString(),
          'to-2': new Date(baselineEndTimeMs).toISOString(),
          'from-3': new Date(currentStartTimeMs).toISOString(),
          'to-3': new Date(currentEndTimeMs).toISOString(),
          theme: theme.palette.mode,
          kiosk: 'true',
        });
        url = `${pyroscopeUrl}?${params.toString()}`;
      }

      setCompareViewUrl(url);
    } catch (err) {
      console.error('Failed to generate Pyroscope comparison URL:', err);
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to generate Pyroscope comparison URL'
      );
      setCompareViewUrl(null);
    } finally {
      setLoading(false);
    }
  }, [pyroscopeInstance, selectedApplication, selectedProfiler, selectedBaseline, testRun, theme.palette.mode]);

  // Analyze flamegraphs
  const analyzeFlamegraphs = useCallback(async (): Promise<void> => {
    if (!pyroscopeInstance || !selectedBaseline || !selectedApplication || !selectedProfiler) {
      return;
    }

    try {
      setAnalysingFlamegraph(true);
      setFlamegraphAnalysis(null);

      // Validate baseline has required timestamps
      if (!selectedBaseline.start_time || !selectedBaseline.end_time) {
        console.error('Selected baseline does not have valid timestamps');
        return;
      }

      // Convert ISO date strings to millisecond timestamps
      const currentStartTimeMs = dateToMs(testRun.start_time);
      const currentEndTimeMs = dateToMs(testRun.end_time);
      const baselineStartTimeMs = dateToMs(selectedBaseline.start_time);
      const baselineEndTimeMs = dateToMs(selectedBaseline.end_time);

      // Extract profiler label
      const profilerLabel = extractProfilerLabel(selectedProfiler);

      // Build request body with backend URL for API access
      const backendUrl = pyroscopeInstance.backend_url || pyroscopeInstance.pyroscope_url || pyroscopeInstance.pyroscopeUrl;
      const requestBody = {
        backendUrl: backendUrl?.trim() || pyroscopeInstance.pyroscopeUrl,
        application: selectedApplication,
        profilerLabel,
        baselineStartTime: baselineStartTimeMs,
        baselineEndTime: baselineEndTimeMs,
        currentStartTime: currentStartTimeMs,
        currentEndTime: currentEndTimeMs,
        significanceThreshold: 100,
      };

      const response = await authenticatedFetch('/pyroscope/analyze-flamegraphs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const analysis = await response.json();
        setFlamegraphAnalysis(analysis);
      } else {
        const errorData = await response.json();
        console.error('Failed to analyze flamegraphs:', errorData);
        setFlamegraphAnalysis({
          summary: {
            baselineTotal: 0,
            currentTotal: 0,
            totalDelta: 0,
            totalDeltaPercent: 0,
          },
          topFunctionChanges: [],
          newHotspots: [],
          improvedFunctions: [],
          tableReport: '',
          error: errorData.message || 'Failed to analyze flamegraphs',
        });
      }
    } catch (err) {
      console.error('Error analyzing flamegraphs:', err);
      setFlamegraphAnalysis({
        summary: {
          baselineTotal: 0,
          currentTotal: 0,
          totalDelta: 0,
          totalDeltaPercent: 0,
        },
        topFunctionChanges: [],
        newHotspots: [],
        improvedFunctions: [],
        tableReport: '',
        error:
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'An error occurred while analyzing flamegraphs',
      });
    } finally {
      setAnalysingFlamegraph(false);
    }
  }, [pyroscopeInstance, selectedBaseline, selectedApplication, selectedProfiler, testRun]);

  // Fetch related test runs when diff view tab is active
  useEffect(() => {
    if (viewModeTab === 1 && relatedTestRuns.length === 0) {
      loadRelatedTestRuns();
    }
  }, [viewModeTab, relatedTestRuns.length, loadRelatedTestRuns]);

  // Trigger URL generation when dependencies change
  useEffect(() => {
    if (expanded && viewModeTab === 0 && selectedApplication && selectedProfiler) {
      generateSingleViewUrl();
    }
  }, [expanded, viewModeTab, activeCombinationTab, generateSingleViewUrl, selectedApplication, selectedProfiler]);

  useEffect(() => {
    if (
      expanded &&
      viewModeTab === 1 &&
      selectedApplication &&
      selectedProfiler &&
      selectedBaseline
    ) {
      generateComparisonUrl();
      analyzeFlamegraphs();
    }
  }, [expanded, viewModeTab, activeCombinationTab, selectedBaseline, generateComparisonUrl, analyzeFlamegraphs, selectedApplication, selectedProfiler]);

  // Add timeout for iframe loading to prevent infinite spinner
  useEffect(() => {
    if (iframeLoading && singleViewUrl) {
      const timeout = setTimeout(() => {
        setIframeLoading(false);
      }, 5000);

      return () => clearTimeout(timeout);
    }
  }, [iframeLoading, singleViewUrl]);

  useEffect(() => {
    if (compareIframeLoading && compareViewUrl) {
      const timeout = setTimeout(() => {
        setCompareIframeLoading(false);
      }, 5000);

      return () => clearTimeout(timeout);
    }
  }, [compareIframeLoading, compareViewUrl]);

  // Handlers
  const handleCombinationTabChange = useCallback(
    (_event: React.SyntheticEvent, newValue: number): void => {
      setActiveCombinationTab(newValue);
      setError(null);
    },
    []
  );

  const handleViewModeTabChange = useCallback(
    (_event: React.SyntheticEvent, newValue: number): void => {
      setViewModeTab(newValue as ViewMode);
      setError(null);
    },
    []
  );

  const handleOpenExternal = useCallback((): void => {
    const url = viewModeTab === 0 ? singleViewUrl : compareViewUrl;
    if (url) {
      window.open(url, '_blank');
    }
  }, [viewModeTab, singleViewUrl, compareViewUrl]);

  const handleIframeLoad = useCallback((): void => {
    setIframeLoading(false);
  }, []);

  const handleIframeError = useCallback((): void => {
    setIframeLoading(false);
    setError('Failed to load Pyroscope iframe');
  }, []);

  const handleCompareIframeLoad = useCallback((): void => {
    setCompareIframeLoading(false);
  }, []);

  const handleCompareIframeError = useCallback((): void => {
    setCompareIframeLoading(false);
    setError('Failed to load Pyroscope comparison iframe');
  }, []);

  return {
    // State
    loading,
    error,
    activeCombinationTab,
    viewModeTab,
    singleViewUrl,
    iframeLoading,
    relatedTestRuns,
    selectedBaseline,
    compareViewUrl,
    compareIframeLoading,
    fetchingBaselines,
    flamegraphAnalysis: filteredAnalysis,
    analysingFlamegraph,
    showAnalysis,
    symbolFilter,
    showAllRegressions,
    showAllImprovements,

    // Derived data
    pyroscopeConfig,
    configurations,
    pyroscopeInstance,
    applications,
    profilers,
    currentCombination,
    selectedApplication,
    selectedProfiler,

    // State setters
    setSelectedBaseline,
    setShowAnalysis,
    setSymbolFilter,
    setShowAllRegressions,
    setShowAllImprovements,

    // Handlers
    handleCombinationTabChange,
    handleViewModeTabChange,
    handleOpenExternal,
    handleIframeLoad,
    handleIframeError,
    handleCompareIframeLoad,
    handleCompareIframeError,
  };
}
