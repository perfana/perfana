'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '@mui/material';
import { useSearchParams } from 'next/navigation';
import { authenticatedFetch } from '@/lib/api';
import { TestRun, TestRunStatus } from '@/types/test-runs';
import { SamplerStat, SortField, SortDirection } from '../types/slo.types';

export interface RequestActionMenuData {
  transactionName: string;
  scenarioName?: string;
  samplerName: string;
}

export interface ApdexActionMenuData {
  transactionName: string;
  scenarioName?: string;
  threshold: number;
}

export interface TransactionForApdex {
  transactionName: string;
  currentThreshold: number;
}

export interface UseSLOSectionProps {
  testRun: TestRun | null;
  testRunId: string;
  sloExpanded: boolean;
  setSloExpanded: (expanded: boolean) => void;
}

export interface UseSLOSectionReturn {
  // Core data
  checkResults: unknown[];
  checkResultsLoading: boolean;
  benchmarks: unknown[];
  benchmarksLoading: boolean;

  // UI state
  expandedSloRows: Set<string>;
  sloFilter: 'all' | 'failed';
  isFilterManuallySet: boolean;
  selectedTarget: Map<string, string>;
  searchText: string;
  sortConfig: Map<string, { field: SortField; direction: SortDirection }>;
  accentColor: string;

  // Transaction/Apdex state
  expandedTransactions: Set<string>;
  transactionSamples: Record<string, SamplerStat[]>;
  loadingTransactionSamples: Record<string, boolean>;
  transactionSamplesError: Record<string, string>;

  // Menu state
  requestActionMenuAnchor: HTMLElement | null;
  requestActionMenuData: RequestActionMenuData | null;
  apdexActionMenuAnchor: HTMLElement | null;
  apdexActionMenuData: ApdexActionMenuData | null;

  // Dialog state
  editSloDialogOpen: boolean;
  selectedSloForEdit: unknown;
  apdexConfigDialogOpen: boolean;
  selectedTransactionForApdex: TransactionForApdex | null;
  apdexThresholdsDialogOpen: boolean;
  selectedApdexResultForThresholds: unknown;

  // Refs
  cardRef: React.RefObject<HTMLDivElement>;

  // Actions
  loadCheckResults: (testRunId: string) => Promise<void>;
  loadBenchmarks: () => Promise<void>;
  handleSloExpand: () => void;
  toggleSloRow: (key: string) => void;
  handleSort: (rowKey: string, field: SortField) => void;
  setSloFilter: (filter: 'all' | 'failed') => void;
  setIsFilterManuallySet: (value: boolean) => void;
  setSearchText: (text: string) => void;
  setSelectedTarget: React.Dispatch<React.SetStateAction<Map<string, string>>>;

  // Transaction actions
  toggleTransactionExpanded: (transactionKey: string, transactionName: string) => Promise<void>;

  // Menu actions
  handleOpenRequestActionMenu: (event: React.MouseEvent<HTMLElement>, transactionName: string, scenarioName: string | undefined, samplerName: string) => void;
  handleCloseRequestActionMenu: () => void;
  handleOpenApdexActionMenu: (event: React.MouseEvent<HTMLElement>, transactionName: string, scenarioName: string | undefined, threshold: number) => void;
  handleCloseApdexActionMenu: () => void;

  // Dialog actions
  handleEditSlo: (checkResult: unknown) => Promise<void>;
  handleSloUpdated: (updatedSlo: unknown) => void;
  handleOpenApdexConfigDialog: (transactionName: string, currentThreshold: number, event: React.MouseEvent) => void;
  handleApdexConfigSuccess: () => void;
  setApdexConfigDialogOpen: (open: boolean) => void;
  setSelectedTransactionForApdex: (data: TransactionForApdex | null) => void;
  handleOpenApdexThresholdsDialog: (result: unknown, event: React.MouseEvent) => void;
  handleApdexThresholdsSuccess: () => void;
  setApdexThresholdsDialogOpen: (open: boolean) => void;
  setSelectedApdexResultForThresholds: (result: unknown) => void;
  setEditSloDialogOpen: (open: boolean) => void;
  setSelectedSloForEdit: (slo: unknown) => void;

  // Re-evaluation
  handleReEvaluate: (panelId: number, applicationDashboardId?: string, metricName?: string, metricsSourceId?: string) => Promise<void>;

  // Utilities
  getCheckResultKey: (result: unknown) => string;
}

export function useSLOSection({
  testRun,
  testRunId,
  sloExpanded,
  setSloExpanded,
}: UseSLOSectionProps): UseSLOSectionReturn {
  const theme = useTheme();
  const searchParams = useSearchParams();
  const cardRef = useRef<HTMLDivElement>(null);

  // Core data state
  const [checkResults, setCheckResults] = useState<any[]>([]);
  const [checkResultsLoading, setCheckResultsLoading] = useState(false);
  const [benchmarks, setBenchmarks] = useState<any[]>([]);
  const [benchmarksLoading, setBenchmarksLoading] = useState(false);

  // UI state
  const [expandedSloRows, setExpandedSloRows] = useState<Set<string>>(new Set());
  const [sloFilter, setSloFilter] = useState<'all' | 'failed'>('all');
  const [isFilterManuallySet, setIsFilterManuallySet] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<Map<string, string>>(new Map());
  const [searchText, setSearchText] = useState<string>('');
  const [sortConfig, setSortConfig] = useState<Map<string, { field: SortField; direction: SortDirection }>>(new Map());

  // Transaction/Apdex state
  const [expandedTransactions, setExpandedTransactions] = useState<Set<string>>(new Set());
  const [transactionSamples, setTransactionSamples] = useState<Record<string, SamplerStat[]>>({});
  const [loadingTransactionSamples, setLoadingTransactionSamples] = useState<Record<string, boolean>>({});
  const [transactionSamplesError, setTransactionSamplesError] = useState<Record<string, string>>({});

  // Request action menu state
  const [requestActionMenuAnchor, setRequestActionMenuAnchor] = useState<null | HTMLElement>(null);
  const [requestActionMenuData, setRequestActionMenuData] = useState<RequestActionMenuData | null>(null);

  // Apdex action menu state
  const [apdexActionMenuAnchor, setApdexActionMenuAnchor] = useState<null | HTMLElement>(null);
  const [apdexActionMenuData, setApdexActionMenuData] = useState<ApdexActionMenuData | null>(null);

  // Edit SLO dialog state
  const [editSloDialogOpen, setEditSloDialogOpen] = useState(false);
  const [selectedSloForEdit, setSelectedSloForEdit] = useState<any>(null);

  // Apdex transaction threshold config dialog state
  const [apdexConfigDialogOpen, setApdexConfigDialogOpen] = useState(false);
  const [selectedTransactionForApdex, setSelectedTransactionForApdex] = useState<TransactionForApdex | null>(null);

  // Apdex thresholds management dialog state
  const [apdexThresholdsDialogOpen, setApdexThresholdsDialogOpen] = useState(false);
  const [selectedApdexResultForThresholds, setSelectedApdexResultForThresholds] = useState<any>(null);

  // Ref for status change tracking
  const prevStatusRef = useRef<TestRunStatus | null>(null);

  // Generate a unique key for each check result based on its properties
  const getCheckResultKey = useCallback((result: unknown): string => {
    if (result.panel_type === 'apdex' || result.evaluate_type === 'apdex') {
      const benchmarkId = result.benchmark_id || 'unknown';
      const panelTitle = result.panel_title || 'unknown';
      return `apdex_${benchmarkId}_${panelTitle}`;
    }
    const dashboardId = result.application_dashboard_id || result.benchmark_id || 'unknown';
    const panelId = result.panel_id ?? 'unknown';
    const metricName = result.metric_name || 'unknown';
    return `${dashboardId}_${panelId}_${metricName}`;
  }, []);

  // Load check results
  const loadCheckResults = useCallback(async (testRunId: string) => {
    try {
      setCheckResultsLoading(true);

      const system = searchParams.get('system');
      const environment = searchParams.get('environment');
      const workload = searchParams.get('workload');

      let url = `/test-runs/${testRunId}/check-results`;
      if (system && environment && workload) {
        const queryParams = new URLSearchParams({ system, environment, workload });
        url += `?${queryParams.toString()}`;
      }

      const response = await authenticatedFetch(url);
      if (!response.ok) {
        if (response.status === 404) {
          console.warn('Check results not found');
          setCheckResults([]);
          return;
        }
        throw new Error('Failed to fetch check results');
      }

      const results = await response.json();
      setCheckResults(results);
    } catch (err) {
      console.error('Failed to load check results:', err);
      setCheckResults([]);
    } finally {
      setCheckResultsLoading(false);
    }
  }, [searchParams]);

  // Load benchmarks
  const loadBenchmarks = useCallback(async () => {
    if (!testRun) return;

    try {
      setBenchmarksLoading(true);

      const queryParams = new URLSearchParams({
        systemUnderTestId: testRun.system_under_test_id,
        testEnvironment: testRun.test_environment,
        workload: testRun.workload
      });

      const url = `/benchmarks?${queryParams.toString()}`;
      const response = await authenticatedFetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          console.warn('No benchmarks found');
          setBenchmarks([]);
          return;
        }
        throw new Error('Failed to fetch benchmarks');
      }

      const results = await response.json();
      setBenchmarks(results);
    } catch (err) {
      console.error('Failed to load benchmarks:', err);
      setBenchmarks([]);
    } finally {
      setBenchmarksLoading(false);
    }
  }, [testRun]);

  // Job completion polling function for re-evaluation
  const pollReEvaluationJobCompletion = useCallback(async (jobId: string) => {
    const maxAttempts = 60;
    let attempts = 0;

    const checkStatus = async () => {
      try {
        attempts++;
        const response = await authenticatedFetch(`/data/jobs/${jobId}/status`, {
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error('Failed to check job status');
        }

        const status = await response.json();

        if (status.status === 'completed' || status.state === 'completed') {
          console.log('SLO re-evaluation job completed:', jobId);
          await loadCheckResults(testRunId);
          await loadBenchmarks();
          return;
        }

        if (status.status === 'failed' || status.state === 'failed') {
          console.error('SLO re-evaluation job failed:', jobId, status);
          return;
        }

        if (attempts < maxAttempts) {
          setTimeout(checkStatus, 2000);
        } else {
          console.warn('Job polling timeout reached for:', jobId);
        }
      } catch (error) {
        console.error('Error checking job status:', error);
      }
    };

    checkStatus();
  }, [testRunId, loadCheckResults, loadBenchmarks]);

  // Handle SLO expand/collapse
  const handleSloExpand = useCallback(() => {
    setSloExpanded(!sloExpanded);
    if (!sloExpanded) {
      if (checkResults.length === 0) {
        loadCheckResults(testRunId);
      }
      if (benchmarks.length === 0) {
        loadBenchmarks();
      }
      setTimeout(() => {
        if (cardRef.current) {
          cardRef.current.focus({ preventScroll: true });
        }
      }, 300);
    }
  }, [sloExpanded, setSloExpanded, checkResults.length, benchmarks.length, testRunId, loadCheckResults, loadBenchmarks]);

  // Toggle SLO row expansion
  const toggleSloRow = useCallback((key: string) => {
    setExpandedSloRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  }, []);

  // Handle sort
  const handleSort = useCallback((rowKey: string, field: SortField) => {
    setSortConfig(prev => {
      const newConfig = new Map(prev);
      const currentConfig = newConfig.get(rowKey);

      if (currentConfig?.field === field) {
        newConfig.set(rowKey, {
          field,
          direction: currentConfig.direction === 'asc' ? 'desc' : 'asc'
        });
      } else {
        newConfig.set(rowKey, { field, direction: 'asc' });
      }

      return newConfig;
    });
  }, []);

  // Toggle transaction expanded
  const toggleTransactionExpanded = useCallback(async (transactionKey: string, transactionName: string) => {
    const isExpanding = !expandedTransactions.has(transactionKey);

    setExpandedTransactions(prev => {
      const next = new Set(prev);
      if (next.has(transactionKey)) {
        next.delete(transactionKey);
      } else {
        next.add(transactionKey);
      }
      return next;
    });

    if (isExpanding && !transactionSamples[transactionKey]) {
      setLoadingTransactionSamples(prev => ({ ...prev, [transactionKey]: true }));
      setTransactionSamplesError(prev => ({ ...prev, [transactionKey]: '' }));

      try {
        const response = await authenticatedFetch(
          `/test-runs/${testRunId}/transactions/${encodeURIComponent(transactionName)}/samples`,
          { method: 'GET', headers: { 'Content-Type': 'application/json' } }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch request samples');
        }

        const data = await response.json();
        setTransactionSamples(prev => ({ ...prev, [transactionKey]: data }));
      } catch (err) {
        console.error('Error fetching sampler statistics:', err);
        setTransactionSamplesError(prev => ({
          ...prev,
          [transactionKey]: err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to fetch request statistics'
        }));
      } finally {
        setLoadingTransactionSamples(prev => ({ ...prev, [transactionKey]: false }));
      }
    }
  }, [testRunId, expandedTransactions, transactionSamples]);

  // Request action menu handlers
  const handleOpenRequestActionMenu = useCallback((
    event: React.MouseEvent<HTMLElement>,
    transactionName: string,
    scenarioName: string | undefined,
    samplerName: string
  ) => {
    event.stopPropagation();
    setRequestActionMenuAnchor(event.currentTarget);
    setRequestActionMenuData({ transactionName, scenarioName, samplerName });
  }, []);

  const handleCloseRequestActionMenu = useCallback(() => {
    setRequestActionMenuAnchor(null);
    setRequestActionMenuData(null);
  }, []);

  // Apdex action menu handlers
  const handleOpenApdexActionMenu = useCallback((
    event: React.MouseEvent<HTMLElement>,
    transactionName: string,
    scenarioName: string | undefined,
    threshold: number
  ) => {
    event.stopPropagation();
    setApdexActionMenuAnchor(event.currentTarget);
    setApdexActionMenuData({ transactionName, scenarioName, threshold });
  }, []);

  const handleCloseApdexActionMenu = useCallback(() => {
    setApdexActionMenuAnchor(null);
    setApdexActionMenuData(null);
  }, []);

  // Edit SLO handler
  const handleEditSlo = useCallback(async (checkResult: unknown) => {
    try {
      const benchmarkId = checkResult.benchmark_id;
      if (!benchmarkId) {
        console.error('No benchmark_id found in checkResult');
        return;
      }

      const response = await authenticatedFetch(`/benchmarks/${benchmarkId}`, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch current benchmark');
      }

      const currentBenchmark = await response.json();
      console.log('handleEditSlo - current benchmark from database:', currentBenchmark);

      setSelectedSloForEdit(currentBenchmark);
      setEditSloDialogOpen(true);
    } catch (error) {
      console.error('Failed to fetch current benchmark:', error);

      const benchmarkFromCheckResult = {
        id: checkResult.benchmark_id || checkResult.application_dashboard_id,
        source: checkResult.source || 'grafana',
        application_dashboard_id: checkResult.application_dashboard_id,
        dashboard_uid: checkResult.dashboard_uid,
        metric_name: checkResult.metric_name,
        config_title: checkResult.config_title,
        evaluate_type: checkResult.evaluate_type,
        requirement_operator: checkResult.requirement?.operator,
        requirement_value: checkResult.requirement?.value,
        tags: checkResult.tags || [],
        exclude_ramp_up_time: checkResult.exclude_ramp_up_time !== false,
        configuration: {
          panelId: checkResult.panel_id,
          yAxesFormat: checkResult.metric_unit,
          averageAll: checkResult.average_all || false,
          matchPattern: checkResult.match_pattern || '',
          validateWithDefaultIfNoData: checkResult.validate_with_default_if_no_data || false,
          validateWithDefaultIfNoDataValue: checkResult.validate_with_default_if_no_data_value || '',
        }
      };

      setSelectedSloForEdit(benchmarkFromCheckResult);
      setEditSloDialogOpen(true);
    }
  }, []);

  // SLO updated handler
  const handleSloUpdated = useCallback((_updatedSlo: unknown) => {
    loadCheckResults(testRunId);
    loadBenchmarks();
    setEditSloDialogOpen(false);
    setSelectedSloForEdit(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [testRunId, loadCheckResults, loadBenchmarks]);

  // Apdex config dialog handlers
  const handleOpenApdexConfigDialog = useCallback((transactionName: string, currentThreshold: number, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedTransactionForApdex({ transactionName, currentThreshold });
    setApdexConfigDialogOpen(true);
  }, []);

  const handleApdexConfigSuccess = useCallback(() => {
    loadCheckResults(testRunId);
  }, [testRunId, loadCheckResults]);

  // Apdex thresholds dialog handlers
  const handleOpenApdexThresholdsDialog = useCallback((result: unknown, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedApdexResultForThresholds(result);
    setApdexThresholdsDialogOpen(true);
  }, []);

  const handleApdexThresholdsSuccess = useCallback(() => {
    loadCheckResults(testRunId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [testRunId, loadCheckResults]);

  // Re-evaluation handler
  const handleReEvaluate = useCallback(async (panelId: number, applicationDashboardId?: string, metricName?: string, metricsSourceId?: string) => {
    try {
      const testRunIdForReeval = testRun?.test_run_id || testRunId;

      const payload = {
        testRunIds: [testRunIdForReeval],
        checks: true,
        adapt: true,
        ...(applicationDashboardId && { applicationDashboardId }),
        ...(metricsSourceId && { metricsSourceId }),
        ...(panelId && { panelId }),
        ...(metricName && { metricName })
      };

      const response = await authenticatedFetch('/data/reevaluate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Re-evaluation API error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          payload
        });
        throw new Error(`Failed to start re-evaluation: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      console.log('Re-evaluation started successfully:', result);

      window.scrollTo({ top: 0, behavior: 'smooth' });

      const jobId = result.data?.jobId || result.jobId;
      if (jobId) {
        pollReEvaluationJobCompletion(jobId);
      }
    } catch (error) {
      console.error('Failed to start re-evaluation:', error);
    }
  }, [testRun, testRunId, pollReEvaluationJobCompletion]);

  // Calculate accent color based on SLO status
  const getAccentColor = useCallback(() => {
    const hasFailed = checkResults.some(r => r.meets_requirement === false);
    const allPassed = checkResults.length > 0 && checkResults.every(r => r.meets_requirement === true);

    if (hasFailed) return theme.palette.error.main;
    if (allPassed) return theme.palette.success.main;
    if (!testRun?.completed) return theme.palette.warning.main;
    return theme.palette.primary.main;
  }, [checkResults, testRun?.completed, theme]);

  const accentColor = getAccentColor();

  // Initial load effect
  useEffect(() => {
    if (testRun) {
      if (checkResults.length === 0 && !checkResultsLoading) {
        loadCheckResults(testRunId);
      }
      if (benchmarks.length === 0 && !benchmarksLoading) {
        loadBenchmarks();
      }
    }
  }, [testRun]);

  // Status change effect
  useEffect(() => {
    if (!testRun?.status) return;

    const currentStatus = testRun.status;
    const prevStatus = prevStatusRef.current;

    const statusChanged =
      prevStatus &&
      (prevStatus.evaluatingChecks !== currentStatus.evaluatingChecks ||
       prevStatus.evaluatingComparisons !== currentStatus.evaluatingComparisons ||
       prevStatus.evaluatingAdapt !== currentStatus.evaluatingAdapt ||
       prevStatus.lastUpdate !== currentStatus.lastUpdate);

    if (statusChanged) {
      console.log('[SLOSection] Test run status changed, reloading check results');
      loadCheckResults(testRunId);
    }

    prevStatusRef.current = { ...currentStatus };
  }, [testRun?.status, testRunId, loadCheckResults]);

  // Auto-set filter effect
  useEffect(() => {
    if (checkResults.length > 0 && !isFilterManuallySet) {
      const failedCount = checkResults.filter(r => r.meets_requirement === false).length;

      if (failedCount > 0 && sloFilter === 'all') {
        setSloFilter('failed');
      }

      if (failedCount === 0 && sloFilter === 'failed') {
        setSloFilter('all');
      }
    }
  }, [checkResults, sloFilter, isFilterManuallySet]);

  return {
    // Core data
    checkResults,
    checkResultsLoading,
    benchmarks,
    benchmarksLoading,

    // UI state
    expandedSloRows,
    sloFilter,
    isFilterManuallySet,
    selectedTarget,
    searchText,
    sortConfig,
    accentColor,

    // Transaction/Apdex state
    expandedTransactions,
    transactionSamples,
    loadingTransactionSamples,
    transactionSamplesError,

    // Menu state
    requestActionMenuAnchor,
    requestActionMenuData,
    apdexActionMenuAnchor,
    apdexActionMenuData,

    // Dialog state
    editSloDialogOpen,
    selectedSloForEdit,
    apdexConfigDialogOpen,
    selectedTransactionForApdex,
    apdexThresholdsDialogOpen,
    selectedApdexResultForThresholds,

    // Refs
    cardRef,

    // Actions
    loadCheckResults,
    loadBenchmarks,
    handleSloExpand,
    toggleSloRow,
    handleSort,
    setSloFilter,
    setIsFilterManuallySet,
    setSearchText,
    setSelectedTarget,

    // Transaction actions
    toggleTransactionExpanded,

    // Menu actions
    handleOpenRequestActionMenu,
    handleCloseRequestActionMenu,
    handleOpenApdexActionMenu,
    handleCloseApdexActionMenu,

    // Dialog actions
    handleEditSlo,
    handleSloUpdated,
    handleOpenApdexConfigDialog,
    handleApdexConfigSuccess,
    setApdexConfigDialogOpen,
    setSelectedTransactionForApdex,
    handleOpenApdexThresholdsDialog,
    handleApdexThresholdsSuccess,
    setApdexThresholdsDialogOpen,
    setSelectedApdexResultForThresholds,
    setEditSloDialogOpen,
    setSelectedSloForEdit,

    // Re-evaluation
    handleReEvaluate,

    // Utilities
    getCheckResultKey,
  };
}
