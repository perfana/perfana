'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import {
  CompareMode,
  RunWindows,
  defaultRunWindows,
  runDurationSeconds,
} from '../../shared/WithinRunWindowsPicker';

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
  // 'within' compares two time ranges of this run instead of a baseline run
  const [compareMode, setCompareMode] = useState<CompareMode>('run');
  const [runWindows, setRunWindows] = useState<RunWindows>(() =>
    defaultRunWindows(runDurationSeconds(testRun.start_time, testRun.end_time))
  );

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const configurations: PyroscopeConfiguration[] = pyroscopeConfig?.pyroscope_configurations || [];
  const pyroscopeInstance = pyroscopeConfig?.pyroscopeInstance;

  // Derive unique applications and profilers for collapsed state display
  const applications = useMemo(
    () => [...new Set(configurations.map((c) => c.application))].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configurations]
  );
  const profilers = useMemo(
    () => [...new Set(configurations.map((c) => c.profiler))].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // The two time windows being compared, in ms; null when nothing to compare yet
  const comparisonWindows = useMemo(() => {
    if (compareMode === 'within') {
      const runStartMs = dateToMs(testRun.start_time);
      return {
        baselineStartTimeMs: runStartMs + runWindows.baseline[0] * 1000,
        baselineEndTimeMs: runStartMs + runWindows.baseline[1] * 1000,
        currentStartTimeMs: runStartMs + runWindows.current[0] * 1000,
        currentEndTimeMs: runStartMs + runWindows.current[1] * 1000,
      };
    }
    if (!selectedBaseline?.start_time || !selectedBaseline.end_time) return null;
    return {
      baselineStartTimeMs: dateToMs(selectedBaseline.start_time),
      baselineEndTimeMs: dateToMs(selectedBaseline.end_time),
      currentStartTimeMs: dateToMs(testRun.start_time),
      currentEndTimeMs: dateToMs(testRun.end_time),
    };
  }, [compareMode, runWindows, selectedBaseline, testRun.start_time, testRun.end_time]);

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
    // A baseline run picked without timestamps has no window to compare; say so rather than wait silently.
    if (compareMode === 'run' && selectedBaseline && !comparisonWindows) {
      setError('Selected baseline test run does not have valid timestamps for comparison');
      return;
    }
    if (
      !pyroscopeInstance ||
      !selectedApplication ||
      !selectedProfiler ||
      !comparisonWindows
    ) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setCompareIframeLoading(true);

      const pyroscopeUrl = pyroscopeInstance.pyroscope_url || pyroscopeInstance.pyroscopeUrl;
      const isStandalone = pyroscopeInstance.pyroscope_stand_alone ?? pyroscopeInstance.pyroscopeStandAlone;

      const { currentStartTimeMs, currentEndTimeMs, baselineStartTimeMs, baselineEndTimeMs } = comparisonWindows;

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
        url = `${pyroscopeUrl}/diff?from=${Math.min(baselineStartSec, currentStartSec)}&until=${Math.max(baselineEndSec, currentEndSec)}&leftFrom=${baselineStartSec}&leftUntil=${baselineEndSec}&rightFrom=${currentStartSec}&rightUntil=${currentEndSec}&query=${encodeURIComponent(query)}`;
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
          // The panels' own ranges, read by the Grafana Pyroscope app 2.x (verified on 2.3.1): the
          // baseline panel shows the page range (from/to), the comparison panel its own scene time
          // range, which syncs on the suffixed keys from-2/to-2 (comparisonFrom/comparisonTo is the
          // same range under the panel's own key). Without them both panels open on Grafana's
          // default range with the selections above outside it; from-2 set to the baseline window,
          // as it used to be, made the comparison panel show the baseline's range.
          from: new Date(baselineStartTimeMs).toISOString(),
          to: new Date(baselineEndTimeMs).toISOString(),
          'from-2': new Date(currentStartTimeMs).toISOString(),
          'to-2': new Date(currentEndTimeMs).toISOString(),
          comparisonFrom: new Date(currentStartTimeMs).toISOString(),
          comparisonTo: new Date(currentEndTimeMs).toISOString(),
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
  }, [pyroscopeInstance, selectedApplication, selectedProfiler, compareMode, selectedBaseline, comparisonWindows, theme.palette.mode]);

  // Analyze flamegraphs. Each committed range change starts another analysis; only the latest may
  // write, or a slow earlier reply would show the analysis of ranges no longer selected.
  const analysisSeq = useRef(0);
  const analyzeFlamegraphs = useCallback(async (): Promise<void> => {
    if (!pyroscopeInstance || !comparisonWindows || !selectedApplication || !selectedProfiler) {
      return;
    }

    const seq = ++analysisSeq.current;
    try {
      setAnalysingFlamegraph(true);
      setFlamegraphAnalysis(null);

      const { currentStartTimeMs, currentEndTimeMs, baselineStartTimeMs, baselineEndTimeMs } = comparisonWindows;

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
        if (seq !== analysisSeq.current) return;
        setFlamegraphAnalysis(analysis);
      } else {
        const errorData = await response.json();
        if (seq !== analysisSeq.current) return;
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
      if (seq !== analysisSeq.current) return;
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
      if (seq === analysisSeq.current) setAnalysingFlamegraph(false);
    }
  }, [pyroscopeInstance, comparisonWindows, selectedApplication, selectedProfiler]);

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
      // a baseline without timestamps still gets here, so generateComparisonUrl can report it
      (comparisonWindows || selectedBaseline)
    ) {
      generateComparisonUrl();
      analyzeFlamegraphs();
    }
  }, [expanded, viewModeTab, activeCombinationTab, comparisonWindows, selectedBaseline, generateComparisonUrl, analyzeFlamegraphs, selectedApplication, selectedProfiler]);

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
    compareMode,
    runWindows,
    hasComparison: comparisonWindows !== null,
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
    setCompareMode,
    setRunWindows,
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
