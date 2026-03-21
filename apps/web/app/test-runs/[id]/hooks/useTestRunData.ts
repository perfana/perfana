import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import { useTestRunRealtime } from '@/hooks/useTestRunRealtime';
import { RelatedTestRun, EditingState } from '../types';

/**
 * Fetch a single test run with optional query parameters
 */
async function fetchTestRun(id: string, searchParams: URLSearchParams): Promise<TestRun> {
  const system = searchParams.get('system');
  const environment = searchParams.get('environment');
  const workload = searchParams.get('workload');
  const organizationId = searchParams.get('organizationId');

  let url = `/test-runs/${id}`;
  if (system && environment && workload) {
    const params: Record<string, string> = { system, environment, workload };
    if (organizationId) {
      params.organizationId = organizationId;
    }
    const queryParams = new URLSearchParams(params);
    url += `?${queryParams.toString()}`;
  }

  const response = await authenticatedFetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch test run');
  }
  return response.json();
}

/**
 * Normalize field names from camelCase to snake_case for compatibility
 */
function normalizeTestRun(updatedTestRun: TestRun): TestRun {
  const rawTestRun = updatedTestRun as any;
  return {
    ...updatedTestRun,
    test_run_id: rawTestRun.testRunId || updatedTestRun.test_run_id,
    test_environment: rawTestRun.testEnvironment || updatedTestRun.test_environment,
    system_under_test_id: rawTestRun.systemUnderTestId || updatedTestRun.system_under_test_id,
    start_time: rawTestRun.startTime || updatedTestRun.start_time,
    end_time: rawTestRun.endTime || updatedTestRun.end_time,
    planned_duration: rawTestRun.plannedDuration || updatedTestRun.planned_duration,
    ramp_up: rawTestRun.rampUp || updatedTestRun.ramp_up,
    consolidated_result: rawTestRun.consolidatedResult || updatedTestRun.consolidated_result,
    application_release: rawTestRun.applicationRelease || updatedTestRun.application_release,
    ci_build_results_url: rawTestRun.ciBuildResultsUrl || updatedTestRun.ci_build_results_url,
    deep_links: rawTestRun.deepLinks || updatedTestRun.deep_links,
    created_at: rawTestRun.createdAt || updatedTestRun.created_at,
    updated_at: rawTestRun.updatedAt || updatedTestRun.updated_at,
    reasons_not_valid: rawTestRun.reasonsNotValid || updatedTestRun.reasons_not_valid,
    adapt_config: rawTestRun.adaptConfig || updatedTestRun.adapt_config,
    is_changepoint: rawTestRun.isChangepoint || updatedTestRun.is_changepoint,
    is_control_group: rawTestRun.isControlGroup || updatedTestRun.is_control_group,
    systems_under_test: rawTestRun.systemUnderTest || updatedTestRun.systems_under_test,
  };
}

/**
 * Check if two test runs are equal based on key fields
 * This prevents unnecessary re-renders when real-time updates send the same data
 */
function areTestRunsEqual(a: TestRun | null, b: TestRun | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  // Compare key primitive fields that would trigger UI changes
  return (
    a.id === b.id &&
    a.test_run_id === b.test_run_id &&
    a.start_time === b.start_time &&
    a.end_time === b.end_time &&
    a.consolidated_result === b.consolidated_result &&
    a.application_release === b.application_release &&
    a.is_changepoint === b.is_changepoint &&
    a.is_control_group === b.is_control_group &&
    JSON.stringify(a.tags || []) === JSON.stringify(b.tags || []) &&
    JSON.stringify(a.annotations || []) === JSON.stringify(b.annotations || []) &&
    JSON.stringify(a.deep_links || {}) === JSON.stringify(b.deep_links || {})
  );
}

interface UseTestRunDataOptions {
  testRunId: string;
  onLoadComplete?: (testRun: TestRun) => void;
}

interface UseTestRunDataReturn {
  testRun: TestRun | null;
  loading: boolean;
  error: string | null;
  setTestRun: React.Dispatch<React.SetStateAction<TestRun | null>>;
  refreshTestRun: () => Promise<void>;
  editingState: EditingState;
  setEditingState: React.Dispatch<React.SetStateAction<EditingState>>;
  /** Increments each time a realtime update is received for this test run. Use as a refresh trigger in child components. */
  realtimeTrigger: number;
}

/**
 * Hook for managing test run data loading and real-time updates
 */
export function useTestRunData({ testRunId, onLoadComplete }: UseTestRunDataOptions): UseTestRunDataReturn {
  const searchParams = useSearchParams();

  const [testRun, setTestRun] = useState<TestRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingState, setEditingState] = useState<EditingState>({
    isEditingTags: false,
    editingTags: [],
    allAvailableTags: [],
    tagsSaving: false,
    isEditingAnnotations: false,
    editingAnnotations: '',
    annotationsSaving: false,
  });

  // Counter that increments on every realtime update — used by child components to trigger
  // data refreshes in sync with the test run entity update cadence.
  const [realtimeTrigger, setRealtimeTrigger] = useState(0);

  // Real-time updates subscription
  useTestRunRealtime({
    enabled: true,
    onTestRunUpdated: (updatedTestRun: TestRun) => {
      const matchesCurrentRun =
        updatedTestRun.id === testRun?.id ||
        (updatedTestRun as any).testRunId === testRunId ||
        updatedTestRun.test_run_id === testRunId;

      if (matchesCurrentRun) {
        const normalizedTestRun = normalizeTestRun(updatedTestRun);

        // Only update state if data actually changed to prevent unnecessary re-renders
        if (!areTestRunsEqual(testRun, normalizedTestRun)) {
          setTestRun(normalizedTestRun);
        }

        // Always increment the trigger so downstream consumers know an update arrived
        setRealtimeTrigger((n) => n + 1);
      }
    },
  });

  // Refresh test run data
  const refreshTestRun = useCallback(async () => {
    try {
      const data = await fetchTestRun(testRunId, searchParams);
      setTestRun(data);
      setEditingState(prev => ({
        ...prev,
        editingTags: [...(data.tags || [])],
        editingAnnotations: (data.annotations || []).join(', '),
      }));
    } catch (err) {
      const errorMessage = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to refresh test run';
      console.error('Failed to refresh test run:', errorMessage);
    }
  }, [testRunId, searchParams]);

  // Load test run data on mount
  useEffect(() => {
    const loadTestRun = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchTestRun(testRunId, searchParams);

        setTestRun(data);
        setEditingState(prev => ({
          ...prev,
          editingTags: [...(data.tags || [])],
          editingAnnotations: (data.annotations || []).join(', '),
        }));

        onLoadComplete?.(data);
      } catch (err) {
        console.error('Failed to load test run:', err);
        setError(
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to load test run details'
        );
      } finally {
        setLoading(false);
      }
    };

    if (testRunId) {
      loadTestRun();
    }
  }, [testRunId, searchParams, onLoadComplete]);

  // Memoize testRun to provide stable reference for child components
  // This prevents unnecessary re-renders when object reference changes but data is the same
  const memoizedTestRun = useMemo(() => testRun, [
    testRun?.id,
    testRun?.test_run_id,
    testRun?.start_time,
    testRun?.end_time,
    testRun?.consolidated_result,
    testRun?.application_release,
    testRun?.is_changepoint,
    testRun?.is_control_group,
    JSON.stringify(testRun?.tags || []),
    JSON.stringify(testRun?.annotations || []),
    JSON.stringify(testRun?.deep_links || {}),
  ]);

  return {
    testRun: memoizedTestRun,
    loading,
    error,
    setTestRun,
    refreshTestRun,
    editingState,
    setEditingState,
    realtimeTrigger,
  };
}
