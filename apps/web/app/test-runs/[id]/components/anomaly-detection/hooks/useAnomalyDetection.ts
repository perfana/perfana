'use client';

import { useState, useEffect, useCallback, useMemo, useRef, MutableRefObject } from 'react';
import { useRouter } from 'next/navigation';
import { TestRun } from '@/types/test-runs';
import { authenticatedFetch } from '@/lib/api';
import { generateConfigHash } from '@/lib/config-hash';
import { deleteAnomalyData, DeleteAnomalyRequest } from '@/lib/anomaly-api';
import { AnomalyData, MetricTrendData, ConfigFormData, AdaptConclusion, DrawerData } from '../types';
import { useUpdateAdaptConfig } from './useUpdateAdaptConfig';

// Known classification values - anything not in this list shows as "Unclassified"
const KNOWN_CLASSIFICATIONS = new Set([
  'red_duration', 'red_rate', 'red_errors',
  'use_saturation', 'use_utilization', 'use_errors',
  'business_metric', 'infrastructure_metric', 'application_metric'
]);

function matchesSearchPredicate(item: AnomalyData, searchQuery: string): boolean {
  if (!searchQuery?.trim()) return true;
  const searchWords = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  const searchableText = [item.metric_name, item.dashboard_label, item.panel_title, item.conclusion_label, item.classification]
    .filter(Boolean).join(' ').toLowerCase();
  return searchWords.every(w => searchableText.includes(w));
}

function matchesConclusionPredicate(item: AnomalyData, filter: string): boolean {
  return filter === 'all' || (!!item.conclusion_label && item.conclusion_label.toLowerCase() === filter.toLowerCase());
}

function matchesClassificationPredicate(item: AnomalyData, filter: string): boolean {
  if (filter === 'all' || filter === 'higher-is-better' || filter === 'lower-is-better') return true;
  const itemClass = item.classification?.toLowerCase();
  const normalized = itemClass && KNOWN_CLASSIFICATIONS.has(itemClass) ? itemClass : 'unclassified';
  return normalized === filter.toLowerCase();
}

function matchesDashboardPredicate(item: AnomalyData, filter: string): boolean {
  return filter === 'all' || item.dashboard_label === filter;
}

function matchesPanelPredicate(item: AnomalyData, filter: string): boolean {
  return filter === 'all' || item.panel_title === filter;
}

function normalizeItemClassification(item: AnomalyData): string {
  const classification = item.classification?.toLowerCase();
  return classification && KNOWN_CLASSIFICATIONS.has(classification) ? classification : 'unclassified';
}

export type AnomalySortKey =
  | 'dashboard_label'
  | 'panel_title'
  | 'metric_name'
  | 'classification'
  | 'conclusion_label'
  | 'test_value'
  | 'control_group_value'
  | 'difference';

export type SortDirection = 'asc' | 'desc';
export type DiffSortMode = 'absolute' | 'percentage';

const NUMERIC_SORT_KEYS: ReadonlySet<AnomalySortKey> = new Set([
  'test_value',
  'control_group_value',
  'difference',
]);

function toNumberOrNaN(value: string | null | undefined): number {
  if (value === null || value === undefined || value === '') return NaN;
  return parseFloat(value);
}

function getDifferencePercentage(item: AnomalyData): number {
  const diff = toNumberOrNaN(item.difference);
  const control = toNumberOrNaN(item.control_group_value);
  if (isNaN(diff) || isNaN(control) || control === 0) return NaN;
  return (diff / control) * 100;
}

interface UseAnomalyDetectionProps {
  testRun: TestRun | null;
  testRunId: string;
  anomalyExpanded: boolean;
  onAnomalyExpand: (tabIndex?: number) => void;
  parentActiveTab?: number;
  onActiveTabChange?: (tabIndex: number) => void;
  conclusionFilter: string;
  setConclusionFilter: (value: string) => void;
  showToast: (message: string) => void;
  onTestRunUpdate?: (updatedTestRun: TestRun) => void;
  cardRef: MutableRefObject<HTMLDivElement | null>;
}

interface UseAnomalyDetectionReturn {
  // Data state
  anomalyData: AnomalyData[];
  loading: boolean;
  error: string | undefined;
  dsAdaptConclusion: AdaptConclusion | null;
  trackedCount: number;

  // Tab state
  activeTab: number;
  setActiveTab: (tab: number) => void;

  // Filter & pagination state
  page: number;
  setPage: (page: number) => void;
  rowsPerPage: number;
  setRowsPerPage: (rows: number) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  classificationFilter: string;
  setClassificationFilter: (filter: string) => void;
  dashboardFilter: string;
  setDashboardFilter: (filter: string) => void;
  panelFilter: string;
  setPanelFilter: (filter: string) => void;

  // Sort state
  sortBy: AnomalySortKey | null;
  sortDirection: SortDirection;
  diffSortMode: DiffSortMode;
  handleSortChange: (key: AnomalySortKey) => void;
  handleDiffSortModeChange: (mode: DiffSortMode) => void;

  // Row state
  expandedRows: Set<string>;
  trendsData: Record<string, MetricTrendData[]>;
  trendsLoading: Record<string, boolean>;

  // Drawer state
  drawerOpen: Record<string, boolean>;
  drawerData: Record<string, DrawerData>;
  drawerLoading: Record<string, boolean>;
  chartKey: Record<string, number>;

  // Config form state
  showConfigForm: Record<string, boolean>;
  configFormData: Record<string, unknown>;

  // Derived data
  filteredData: AnomalyData[];
  paginatedData: AnomalyData[];
  conclusionsForDropdown: string[];
  classificationsForDropdown: string[];
  dashboardsForDropdown: string[];
  panelsForDropdown: string[];

  // Ref for pending conclusion
  pendingConclusionRef: MutableRefObject<string | null>;

  hasActiveFilters: boolean;

  // Handlers
  handleExpand: (tabIndex?: number) => void;
  handleCollapse: () => void;
  handleRowToggle: (rowKey: string) => void;
  handleDrawerToggle: (rowKey: string) => void;
  handleConfigFormToggle: (rowKey: string) => void;
  handleConfigSave: (rowKey: string, configData: ConfigFormData, scope: 'metric' | 'panel') => Promise<void>;
  handleDeleteAnomaly: (anomaly: AnomalyData, options: { scope: 'metric' | 'panel'; range: 'current-test-run' | 'all-test-runs' }) => Promise<void>;
  handleAcceptResults: () => void;
  handleDenyResults: () => void;
  updateAdaptConfig: (differencesAccepted: 'ACCEPTED' | 'DENIED' | 'TBD') => Promise<void>;
  disableBaselineMode: () => Promise<void>;
  fetchAnomalyData: () => Promise<void>;
  handleConclusionFilterChange: (newFilter: string) => void;
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleConclusionFilterForForm: (e: { target: { value: string } }) => void;
  handleClassificationFilterChange: (e: { target: { value: string } }) => void;
  handleDashboardFilterChange: (e: { target: { value: string } }) => void;
  handlePanelFilterChange: (e: { target: { value: string } }) => void;
  handleClearAllFilters: () => void;
}

export function useAnomalyDetection({
  testRun,
  testRunId,
  anomalyExpanded,
  onAnomalyExpand,
  parentActiveTab,
  onActiveTabChange,
  conclusionFilter,
  setConclusionFilter,
  showToast,
  onTestRunUpdate,
  cardRef,
}: UseAnomalyDetectionProps): UseAnomalyDetectionReturn {
  const router = useRouter();
  const pendingConclusionRef = useRef<string | null>(null);

  // Use shared hook for updating adapt config
  const { updateAdaptConfig: updateAdaptConfigHook } = useUpdateAdaptConfig({
    testRun,
    showToast,
    onTestRunUpdate
  });

  // Main data state
  const [anomalyData, setAnomalyData] = useState<AnomalyData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [dsAdaptConclusion, setDsAdaptConclusion] = useState<AdaptConclusion | null>(null);

  // Tab and tracking state
  const [localActiveTab, setLocalActiveTab] = useState<number>(0);
  const activeTab = parentActiveTab !== undefined ? parentActiveTab : localActiveTab;
  const setActiveTab = onActiveTabChange || setLocalActiveTab;
  const [trackedCount, setTrackedCount] = useState<number>(0);

  // Filter and pagination state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [classificationFilter, setClassificationFilter] = useState<string>('all');
  const [dashboardFilter, setDashboardFilter] = useState<string>('all');
  const [panelFilter, setPanelFilter] = useState<string>('all');

  // Sort state
  const [sortBy, setSortBy] = useState<AnomalySortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [diffSortMode, setDiffSortMode] = useState<DiffSortMode>('absolute');

  // Row interaction state
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [trendsData, setTrendsData] = useState<Record<string, MetricTrendData[]>>({});
  const [trendsLoading, setTrendsLoading] = useState<Record<string, boolean>>({});

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState<Record<string, boolean>>({});
  const [drawerData, setDrawerData] = useState<Record<string, DrawerData>>({});
  const [drawerLoading, setDrawerLoading] = useState<Record<string, boolean>>({});
  const [chartKey, setChartKey] = useState<Record<string, number>>({});

  // Config form state
  const [showConfigForm, setShowConfigForm] = useState<Record<string, boolean>>({});
  const configFormData: Record<string, unknown> = {};

  // API Functions
  const fetchAnomalyData = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await authenticatedFetch(`/test-runs/${testRunId}/anomaly-detection`);
      if (response.ok) {
        const data = await response.json();
        setAnomalyData(data);
      } else {
        const errorMsg = 'Failed to load anomaly detection data';
        setError(errorMsg);
        showToast(errorMsg);
      }
    } catch (err) {
      const errorMsg = 'Error loading anomaly detection data';
      setError(errorMsg);
      showToast(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [testRunId, showToast]);

  const fetchTrackedRegressionsCount = useCallback(async () => {
    try {
      const response = await authenticatedFetch(`/adapt/tracked-regressions/count?testRunId=${testRunId}`);
      if (response.ok) {
        const data = await response.json();
        setTrackedCount(data.count || 0);
      }
    } catch (err) {
      // Silently fail for count fetch
    }
  }, [testRunId]);

  const fetchDsAdaptConclusion = useCallback(async () => {
    try {
      const response = await authenticatedFetch(`/adapt/conclusion/${testRunId}`);
      if (response.ok) {
        const text = await response.text();
        if (text.trim()) {
          const data = JSON.parse(text);
          setDsAdaptConclusion(data);
        }
      }
    } catch (err) {
      // Silently fail for conclusion fetch
    }
  }, [testRunId]);

  const fetchTrendsData = useCallback(async (rowKey: string, item: AnomalyData) => {
    if (!item.application_dashboard_id || !item.panel_id || !item.metric_name) {
      return;
    }

    setTrendsLoading(prev => ({ ...prev, [rowKey]: true }));

    try {
      const queryParams = new URLSearchParams({
        applicationDashboardId: item.application_dashboard_id,
        panelId: item.panel_id,
        metricName: item.metric_name
      });
      if (item.metrics_source_id) {
        queryParams.set('metricsSourceId', item.metrics_source_id);
      }

      const response = await authenticatedFetch(
        `/metrics/control-group-trends/${testRunId}?${queryParams.toString()}`
      );

      if (response.ok) {
        const data: MetricTrendData[] = await response.json();
        data.sort((a, b) => new Date(a.test_run_start).getTime() - new Date(b.test_run_start).getTime());
        setTrendsData(prev => ({ ...prev, [rowKey]: data }));
      } else {
        setTrendsData(prev => ({ ...prev, [rowKey]: [] }));
      }
    } catch (err) {
      setTrendsData(prev => ({ ...prev, [rowKey]: [] }));
    } finally {
      setTrendsLoading(prev => ({ ...prev, [rowKey]: false }));
    }
  }, [testRunId]);

  const fetchDrawerData = useCallback(async (rowKey: string, item: AnomalyData) => {
    if (!item.application_dashboard_id || !item.panel_id || !item.metric_name) {
      return;
    }

    setDrawerLoading(prev => ({ ...prev, [rowKey]: true }));

    try {
      const dsAdaptParams = new URLSearchParams({
        applicationDashboardId: item.application_dashboard_id,
        panelId: item.panel_id,
        metricName: item.metric_name,
      });
      if (item.metrics_source_id) {
        dsAdaptParams.set('metricsSourceId', item.metrics_source_id);
      }

      const response = await authenticatedFetch(
        `/test-runs/${testRunId}/ds-adapt-result?${dsAdaptParams.toString()}`
      );

      if (response.ok) {
        const data = await response.json();
        setDrawerData(prev => ({ ...prev, [rowKey]: data }));
      } else {
        setDrawerData(prev => ({ ...prev, [rowKey]: null }));
      }
    } catch (err) {
      setDrawerData(prev => ({ ...prev, [rowKey]: null }));
    } finally {
      setDrawerLoading(prev => ({ ...prev, [rowKey]: false }));
    }
  }, [testRunId]);

  // Data filtering
  const getFilteredData = useCallback(() => {
    return anomalyData.filter(item =>
      matchesSearchPredicate(item, searchQuery) &&
      matchesConclusionPredicate(item, conclusionFilter) &&
      matchesClassificationPredicate(item, classificationFilter) &&
      matchesDashboardPredicate(item, dashboardFilter) &&
      matchesPanelPredicate(item, panelFilter)
    );
  }, [anomalyData, searchQuery, conclusionFilter, classificationFilter, dashboardFilter, panelFilter]);

  const filteredData = useMemo(() => getFilteredData(), [getFilteredData]);

  const sortedData = useMemo(() => {
    if (!sortBy) return filteredData;
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    const isNumeric = NUMERIC_SORT_KEYS.has(sortBy);

    const getNumericValue = (item: AnomalyData): number => {
      if (sortBy === 'difference' && diffSortMode === 'percentage') {
        return getDifferencePercentage(item);
      }
      return toNumberOrNaN(item[sortBy as 'test_value' | 'control_group_value' | 'difference']);
    };

    const getStringValue = (item: AnomalyData): string => {
      const raw = item[sortBy as Exclude<AnomalySortKey, 'test_value' | 'control_group_value' | 'difference'>];
      return (raw ?? '').toString().toLowerCase();
    };

    return [...filteredData].sort((a, b) => {
      if (isNumeric) {
        const aVal = getNumericValue(a);
        const bVal = getNumericValue(b);
        const aNaN = isNaN(aVal);
        const bNaN = isNaN(bVal);
        if (aNaN && bNaN) return 0;
        if (aNaN) return 1;  // NaN always sorts to the end
        if (bNaN) return -1;
        return (aVal - bVal) * multiplier;
      }
      const aVal = getStringValue(a);
      const bVal = getStringValue(b);
      if (aVal < bVal) return -1 * multiplier;
      if (aVal > bVal) return 1 * multiplier;
      return 0;
    });
  }, [filteredData, sortBy, sortDirection, diffSortMode]);

  const paginatedData = useMemo(() => sortedData.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [sortedData, page, rowsPerPage]);

  const handleSortChange = useCallback((key: AnomalySortKey) => {
    if (sortBy === key) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDirection('asc');
    }
    setPage(0);
  }, [sortBy]);

  const handleDiffSortModeChange = useCallback((mode: DiffSortMode) => {
    setDiffSortMode(mode);
    if (sortBy === 'difference') {
      setPage(0);
    }
  }, [sortBy]);

  // Dropdown options — faceted: each dropdown shows values available given all OTHER active filters
  const dashboardsForDropdown = useMemo(() => {
    const filtered = anomalyData.filter(item =>
      matchesSearchPredicate(item, searchQuery) &&
      matchesConclusionPredicate(item, conclusionFilter) &&
      matchesClassificationPredicate(item, classificationFilter)
    );
    return [...new Set(filtered.map(item => item.dashboard_label).filter((v): v is string => !!v))].sort();
  }, [anomalyData, searchQuery, conclusionFilter, classificationFilter]);

  const panelsForDropdown = useMemo(() => {
    const filtered = anomalyData.filter(item =>
      matchesSearchPredicate(item, searchQuery) &&
      matchesConclusionPredicate(item, conclusionFilter) &&
      matchesClassificationPredicate(item, classificationFilter) &&
      matchesDashboardPredicate(item, dashboardFilter)
    );
    return [...new Set(filtered.map(item => item.panel_title).filter((v): v is string => !!v))].sort();
  }, [anomalyData, searchQuery, conclusionFilter, classificationFilter, dashboardFilter]);

  const conclusionsForDropdown = useMemo(() => {
    const filtered = anomalyData.filter(item =>
      matchesSearchPredicate(item, searchQuery) &&
      matchesClassificationPredicate(item, classificationFilter) &&
      matchesDashboardPredicate(item, dashboardFilter) &&
      matchesPanelPredicate(item, panelFilter)
    );
    return [...new Set(filtered.map(item => item.conclusion_label).filter((v): v is string => !!v))];
  }, [anomalyData, searchQuery, classificationFilter, dashboardFilter, panelFilter]);

  const classificationsForDropdown = useMemo(() => {
    const filtered = anomalyData.filter(item =>
      matchesSearchPredicate(item, searchQuery) &&
      matchesConclusionPredicate(item, conclusionFilter) &&
      matchesDashboardPredicate(item, dashboardFilter) &&
      matchesPanelPredicate(item, panelFilter)
    );
    return [...new Set(filtered.map(item => normalizeItemClassification(item)))];
  }, [anomalyData, searchQuery, conclusionFilter, dashboardFilter, panelFilter]);

  // Wrapper function for adapt config
  const updateAdaptConfig = useCallback(async (differencesAccepted: 'ACCEPTED' | 'DENIED' | 'TBD') => {
    const success = await updateAdaptConfigHook(testRunId, differencesAccepted);
    if (success && !onTestRunUpdate) {
      router.refresh();
    }
  }, [updateAdaptConfigHook, testRunId, onTestRunUpdate, router]);

  // Switch from BASELINE mode to DEFAULT mode
  const disableBaselineMode = useCallback(async () => {
    const success = await updateAdaptConfigHook(testRunId, 'TBD', 'DEFAULT');
    if (success && !onTestRunUpdate) {
      router.refresh();
    }
  }, [updateAdaptConfigHook, testRunId, onTestRunUpdate, router]);

  // Event Handlers
  const handleExpand = useCallback((tabIndex?: number) => {
    const wasExpanded = anomalyExpanded;
    onAnomalyExpand(tabIndex);

    if (!wasExpanded) {
      if (anomalyData.length === 0) {
        fetchAnomalyData();
        fetchTrackedRegressionsCount();
        fetchDsAdaptConclusion();
      }
      setTimeout(() => {
        if (cardRef.current) {
          cardRef.current.focus({ preventScroll: true });
        }
      }, 300);
    }

    if (pendingConclusionRef.current) {
      setTimeout(() => {
        const targetConclusion = pendingConclusionRef.current;
        setConclusionFilter(targetConclusion!);
        setPage(0);
        pendingConclusionRef.current = null;
      }, 300);
    }
  }, [anomalyExpanded, onAnomalyExpand, anomalyData.length, fetchAnomalyData, fetchTrackedRegressionsCount, fetchDsAdaptConclusion, cardRef, setConclusionFilter]);

  const handleCollapse = useCallback(() => {
    onAnomalyExpand();
  }, [onAnomalyExpand]);

  const handleRowToggle = useCallback((rowKey: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(rowKey)) {
        newSet.delete(rowKey);
        setDrawerOpen(prevDrawer => ({ ...prevDrawer, [rowKey]: false }));
      } else {
        newSet.add(rowKey);
        setDrawerOpen(prevDrawer => ({ ...prevDrawer, [rowKey]: true }));
        const rowIndex = parseInt(rowKey.split('_').pop() || '0');
        const item = paginatedData[rowIndex];
        if (item) {
          fetchTrendsData(rowKey, item);
        }
        if (!drawerData[rowKey] && !drawerLoading[rowKey]) {
          fetchDrawerData(rowKey, item);
        }
      }
      return newSet;
    });
  }, [paginatedData, fetchTrendsData, fetchDrawerData, drawerData, drawerLoading]);

  const handleDrawerToggle = useCallback((rowKey: string) => {
    setDrawerOpen(prev => {
      const newState = { ...prev, [rowKey]: !prev[rowKey] };
      if (newState[rowKey] && !drawerData[rowKey] && !drawerLoading[rowKey]) {
        const rowIndex = parseInt(rowKey.split('_').pop() || '0');
        const item = paginatedData[rowIndex];
        if (item) {
          fetchDrawerData(rowKey, item);
        }
      }
      setTimeout(() => {
        setChartKey(prevKeys => ({
          ...prevKeys,
          [rowKey]: (prevKeys[rowKey] || 0) + 1
        }));
      }, 350);
      return newState;
    });
  }, [paginatedData, fetchDrawerData, drawerData, drawerLoading]);

  const handleConfigFormToggle = useCallback((rowKey: string) => {
    setShowConfigForm(prev => ({ ...prev, [rowKey]: !prev[rowKey] }));
  }, []);

  const handleConfigSave = useCallback(async (rowKey: string, configData: ConfigFormData, scope: 'metric' | 'panel') => {
    try {
      const rowIndex = parseInt(rowKey.split('_').pop() || '0');
      const item = paginatedData[rowIndex];

      if (!item) {
        throw new Error('Could not find metric data for configuration');
      }

      const configDataPayload = {
        source: scope,
        ignore: configData.ignore,
        metricClassification: {
          classification: configData.metricClassification.classification,
          higherIsBetter: configData.metricClassification.higherIsBetter
        },
        thresholds: {
          aggregation: configData.thresholds.aggregation,
          percentageThreshold: configData.thresholds.percentageThreshold / 100,
          iqrThreshold: configData.thresholds.iqrThreshold,
          absoluteThreshold: configData.thresholds.absoluteThreshold
        },
        defaultValueIfControlGroupMissing: configData.defaultValueIfControlGroupMissing || 0
      };

      const configHash = generateConfigHash(configDataPayload);

      const payload = {
        systemUnderTestId: testRun?.system_under_test_id,
        testEnvironment: testRun?.test_environment,
        workload: testRun?.workload,
        applicationDashboardId: item.application_dashboard_id,
        ...(item.metrics_source_id && { metricsSourceId: item.metrics_source_id }),
        panelId: item.panel_id.toString(),
        metricName: scope === 'metric' ? item.metric_name : undefined,
        configData: {
          ...configDataPayload,
          config_hash: configHash
        }
      };

      const response = await authenticatedFetch('/test-runs/ds-compare-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to save configuration: ${response.status}`);
      }

      setShowConfigForm(prev => ({ ...prev, [rowKey]: false }));
      showToast(`Configuration saved successfully (${scope} level)`);

      if (drawerData[rowKey]) {
        setTimeout(() => {
          fetchDrawerData(rowKey, item);
        }, 500);
      }

      setChartKey(prev => ({ ...prev, [rowKey]: (prev[rowKey] || 0) + 1 }));
    } catch (err) {
      const errorMessage = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to save configuration';
      showToast(`Error: ${errorMessage}`);
    }
  }, [paginatedData, testRun, showToast, drawerData, fetchDrawerData]);

  const handleDeleteAnomaly = useCallback(async (
    anomaly: AnomalyData,
    options: { scope: 'metric' | 'panel'; range: 'current-test-run' | 'all-test-runs' }
  ) => {
    try {
      const deleteRequest: DeleteAnomalyRequest = {
        dashboardLabel: anomaly.dashboard_label,
        panelTitle: anomaly.panel_title,
        metricName: options.scope === 'metric' ? anomaly.metric_name : undefined,
        panelId: String(anomaly.panel_id),
        applicationDashboardId: anomaly.application_dashboard_id,
        ...(anomaly.metrics_source_id && { metricsSourceId: anomaly.metrics_source_id }),
        scope: options.scope,
        range: options.range,
      };

      const result = await deleteAnomalyData(testRunId, deleteRequest);

      const scopeText = options.scope === 'metric' ? `metric "${anomaly.metric_name}"` : `all metrics in panel "${anomaly.panel_title}"`;
      const rangeText = options.range === 'current-test-run' ? 'this test run' : 'all test runs';
      showToast(`Successfully deleted ${scopeText} for ${rangeText} (${result.deletedCount} records)`);

      await fetchAnomalyData();
    } catch (err) {
      const errorMessage = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to delete anomaly data';
      showToast(errorMessage);
      throw err;
    }
  }, [testRunId, showToast, fetchAnomalyData]);

  const handleAcceptResults = useCallback(() => updateAdaptConfig('ACCEPTED'), [updateAdaptConfig]);
  const handleDenyResults = useCallback(() => updateAdaptConfig('DENIED'), [updateAdaptConfig]);

  const hasActiveFilters = useMemo(() =>
    searchQuery !== '' || conclusionFilter !== 'all' || classificationFilter !== 'all' ||
    dashboardFilter !== 'all' || panelFilter !== 'all',
    [searchQuery, conclusionFilter, classificationFilter, dashboardFilter, panelFilter]
  );

  const handleClearAllFilters = useCallback(() => {
    setSearchQuery('');
    setConclusionFilter('all');
    setClassificationFilter('all');
    setDashboardFilter('all');
    setPanelFilter('all');
    setPage(0);
  }, [setConclusionFilter]);

  const handleConclusionFilterChange = useCallback((newFilter: string) => {
    if (!anomalyExpanded) {
      pendingConclusionRef.current = newFilter;
      handleExpand();
    } else {
      setConclusionFilter(newFilter);
      setPage(0);
    }
  }, [anomalyExpanded, handleExpand, setConclusionFilter]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setPage(0);
  }, []);

  const handleConclusionFilterForForm = useCallback((e: { target: { value: string } }) => {
    setConclusionFilter(e.target.value);
    setPage(0);
  }, [setConclusionFilter]);

  const handleClassificationFilterChange = useCallback((e: { target: { value: string } }) => {
    setClassificationFilter(e.target.value);
    setPage(0);
  }, []);

  const handleDashboardFilterChange = useCallback((e: { target: { value: string } }) => {
    setDashboardFilter(e.target.value);
    setPanelFilter('all'); // Reset panel when dashboard changes
    setPage(0);
  }, []);

  const handlePanelFilterChange = useCallback((e: { target: { value: string } }) => {
    setPanelFilter(e.target.value);
    setPage(0);
  }, []);

  // Effects
  useEffect(() => {
    if (testRunId) {
      fetchAnomalyData();
      fetchTrackedRegressionsCount();
      fetchDsAdaptConclusion();
    }
  }, [testRunId, fetchAnomalyData, fetchTrackedRegressionsCount, fetchDsAdaptConclusion]);

  useEffect(() => {
    if (anomalyExpanded && testRunId && anomalyData.length === 0) {
      fetchAnomalyData();
    }
  }, [anomalyExpanded, testRunId, anomalyData.length, fetchAnomalyData]);

  return {
    // Data state
    anomalyData,
    loading,
    error,
    dsAdaptConclusion,
    trackedCount,

    // Tab state
    activeTab,
    setActiveTab,

    // Filter & pagination state
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    searchQuery,
    setSearchQuery,
    classificationFilter,
    setClassificationFilter,
    dashboardFilter,
    setDashboardFilter,
    panelFilter,
    setPanelFilter,

    // Sort state
    sortBy,
    sortDirection,
    diffSortMode,
    handleSortChange,
    handleDiffSortModeChange,

    // Row state
    expandedRows,
    trendsData,
    trendsLoading,

    // Drawer state
    drawerOpen,
    drawerData,
    drawerLoading,
    chartKey,

    // Config form state
    showConfigForm,
    configFormData,

    // Derived data
    filteredData,
    paginatedData,
    conclusionsForDropdown,
    classificationsForDropdown,
    dashboardsForDropdown,
    panelsForDropdown,

    // Ref
    pendingConclusionRef,

    // Handlers
    handleExpand,
    handleCollapse,
    handleRowToggle,
    handleDrawerToggle,
    handleConfigFormToggle,
    handleConfigSave,
    handleDeleteAnomaly,
    handleAcceptResults,
    handleDenyResults,
    updateAdaptConfig,
    disableBaselineMode,
    fetchAnomalyData,
    hasActiveFilters,
    handleConclusionFilterChange,
    handleSearchChange,
    handleConclusionFilterForForm,
    handleClassificationFilterChange,
    handleDashboardFilterChange,
    handlePanelFilterChange,
    handleClearAllFilters,
  };
}
