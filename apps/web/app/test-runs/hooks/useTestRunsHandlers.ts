'use client';

import { useState, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import { RefreshSources } from '@/components/dialogs/RefreshSourcesDialog';
import { AvailableSources, fetchAvailableSources, getTestRunScope } from '@/lib/refresh-sources';
import { SnackbarState} from '../types';
import { allSameScope} from '../utils/test-runs-filters';

interface UseTestRunsHandlersProps {
  testRuns: TestRun[];
  onSnackbar: (state: SnackbarState) => void;
  onLoadTestRuns: () => Promise<void>;
  onMonitorJob: (jobId: string) => Promise<void>;
  onSetFiltersFromTestRun: (testRun: TestRun) => void;
}

export function useTestRunsHandlers({
  testRuns,
  onSnackbar,
  onLoadTestRuns,
  onMonitorJob,
  onSetFiltersFromTestRun,
}: UseTestRunsHandlersProps) {
  // Selection state
  const [selectedTestRunIds, setSelectedTestRunIds] = useState<Set<string>>(new Set());
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);

  // Refresh dialog state
  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);
  const [refreshTargetTestRunId, setRefreshTargetTestRunId] = useState<string | null>(null);
  const [availableSources, setAvailableSources] = useState<AvailableSources | undefined>(undefined);

  // Helper to set filters if all selected runs share the same scope
  const setFiltersIfSameScope = useCallback((runs: TestRun[]) => {
    if (runs.length > 0 && allSameScope(runs)) {
      onSetFiltersFromTestRun(runs[0]);
    } else if (runs.length > 1) {
      onSnackbar({ open: true, message: 'Multiple scopes selected - view progress in individual test run details' });
    }
  }, [onSnackbar, onSetFiltersFromTestRun]);

  // Selection handlers
  const handleSelectAll = useCallback((filteredTestRuns: TestRun[]) => {
    if (selectedTestRunIds.size === filteredTestRuns.length) {
      setSelectedTestRunIds(new Set());
    } else {
      setSelectedTestRunIds(new Set(filteredTestRuns.map(run => run.id)));
    }
  }, [selectedTestRunIds.size]);

  const handleSelectOne = useCallback((id: string) => {
    const newSelected = new Set(selectedTestRunIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedTestRunIds(newSelected);
  }, [selectedTestRunIds]);

  const handleClearSelection = useCallback(() => {
    setSelectedTestRunIds(new Set());
  }, []);

  // Batch re-evaluate handler
  const handleBatchReEvaluate = useCallback(async () => {
    const selectedRuns = testRuns.filter(run => selectedTestRunIds.has(run.id));
    const testRunIds = selectedRuns.map(run => run.test_run_id);

    try {
      const response = await authenticatedFetch('/data/reevaluate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testRunIds, checks: true, adapt: true }),
      });

      if (!response.ok) {
        throw new Error('Failed to start batch re-evaluation');
      }

      onSnackbar({ open: true, message: `Re-evaluation started for ${testRunIds.length} test run(s)` });
      setFiltersIfSameScope(selectedRuns);
      handleClearSelection();
    } catch (_err) {
      onSnackbar({ open: true, message: 'Failed to start batch re-evaluation' });
    }
  }, [testRuns, selectedTestRunIds, onSnackbar, setFiltersIfSameScope, handleClearSelection]);

  // Batch refresh confirm handler (defined before handleBatchRefreshClick since it's referenced there)
  const handleBatchRefreshConfirm = useCallback(async (sources: RefreshSources) => {
    const selectedRuns = testRuns.filter(run => selectedTestRunIds.has(run.id));
    const testRunIds = selectedRuns.map(run => run.test_run_id);

    try {
      const response = await authenticatedFetch('/data/refresh/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testRunIds, sources, forceRefetch: sources.forceRefetch }),
      });

      if (!response.ok) {
        throw new Error('Failed to start batch refresh');
      }

      onSnackbar({ open: true, message: `Re-fetch started for ${testRunIds.length} test run(s)` });
      setFiltersIfSameScope(selectedRuns);
      handleClearSelection();
    } catch (_err) {
      onSnackbar({ open: true, message: 'Failed to start batch re-fetch' });
    }
  }, [testRuns, selectedTestRunIds, onSnackbar, setFiltersIfSameScope, handleClearSelection]);

  // Batch refresh click handler — fetches available sources, skips dialog when only perf metrics
  const handleBatchRefreshClick = useCallback(async () => {
    const selectedRuns = testRuns.filter(run => selectedTestRunIds.has(run.id));
    if (selectedRuns.length === 0) return;

    const scopes = selectedRuns.map(getTestRunScope);
    const sources = await fetchAvailableSources(scopes);

    if (!sources.grafana && !sources.dynatrace) {
      // Only performance metrics — skip dialog, refresh immediately
      handleBatchRefreshConfirm({ grafana: false, dynatrace: false, performanceMetrics: true });
      return;
    }

    setAvailableSources(sources);
    setRefreshTargetTestRunId(selectedRuns[0].test_run_id);
    setRefreshDialogOpen(true);
  }, [testRuns, selectedTestRunIds, handleBatchRefreshConfirm]);

  // Batch delete handlers
  const handleBatchDeleteClick = useCallback(() => {
    setBatchDeleteDialogOpen(true);
  }, []);

  const handleBatchDeleteConfirm = useCallback(async () => {
    const idsToDelete = Array.from(selectedTestRunIds);

    try {
      const response = await authenticatedFetch('/test-runs/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToDelete }),
      });

      if (!response.ok) {
        throw new Error('Failed to queue test runs for deletion');
      }

      const result = await response.json();
      const skippedCount = result.skipped?.length || 0;
      const message = skippedCount > 0
        ? `Queued ${result.queued} test run(s) for deletion (${skippedCount} already queued)`
        : `Queued ${result.queued} test run(s) for deletion`;

      onSnackbar({ open: true, message });
      setBatchDeleteDialogOpen(false);
      handleClearSelection();
      await onLoadTestRuns();
    } catch (_err) {
      onSnackbar({ open: true, message: 'Failed to delete test runs' });
      setBatchDeleteDialogOpen(false);
    }
  }, [selectedTestRunIds, onSnackbar, handleClearSelection, onLoadTestRuns]);

  const handleBatchDeleteCancel = useCallback(() => {
    setBatchDeleteDialogOpen(false);
  }, []);

  // Mark as changepoint handler
  const handleBatchMarkAsChangepoint = useCallback(async () => {
    const selectedRuns = testRuns.filter(run => selectedTestRunIds.has(run.id));
    if (selectedRuns.length !== 1) return;

    const testRun = selectedRuns[0];
    if (!testRun) return;

    try {
      const response = await authenticatedFetch('/test-runs/mark-changepoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemUnderTestId: testRun.system_under_test_id || testRun.systems_under_test?.id,
          testEnvironment: testRun.test_environment,
          workload: testRun.workload,
          testRunId: testRun.test_run_id,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to mark test run as changepoint');
      }

      const result = await response.json();
      onSnackbar({ open: true, message: result.message || 'Test run marked as changepoint successfully' });

      if (result.jobId) {
        onSnackbar({ open: true, message: 'Monitoring re-evaluation jobs...' });
        onMonitorJob(result.jobId);
      } else {
        setTimeout(() => onLoadTestRuns(), 2000);
      }
      handleClearSelection();
    } catch (_err) {
      onSnackbar({ open: true, message: 'Failed to mark test run as changepoint' });
    }
  }, [testRuns, selectedTestRunIds, onSnackbar, onMonitorJob, onLoadTestRuns, handleClearSelection]);

  // Remove changepoint handler
  const handleBatchRemoveChangepoint = useCallback(async () => {
    const selectedRuns = testRuns.filter(run => selectedTestRunIds.has(run.id));
    if (selectedRuns.length !== 1) return;

    const testRun = selectedRuns[0];
    if (!testRun) return;

    try {
      const response = await authenticatedFetch('/test-runs/remove-changepoint', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemUnderTestId: testRun.system_under_test_id || testRun.systems_under_test?.id,
          testEnvironment: testRun.test_environment,
          workload: testRun.workload,
          testRunId: testRun.test_run_id,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to remove changepoint');
      }

      const result = await response.json();
      onSnackbar({ open: true, message: result.message || 'Changepoint removed successfully' });

      if (result.jobId) {
        onSnackbar({ open: true, message: 'Monitoring re-evaluation jobs...' });
        onMonitorJob(result.jobId);
      } else {
        setTimeout(() => onLoadTestRuns(), 2000);
      }
      handleClearSelection();
    } catch (_err) {
      onSnackbar({ open: true, message: 'Failed to remove changepoint' });
    }
  }, [testRuns, selectedTestRunIds, onSnackbar, onMonitorJob, onLoadTestRuns, handleClearSelection]);

  // Close refresh dialog
  const closeRefreshDialog = useCallback(() => {
    setRefreshDialogOpen(false);
    setRefreshTargetTestRunId(null);
    setAvailableSources(undefined);
  }, []);

  return {
    // Selection state
    selectedTestRunIds,
    batchDeleteDialogOpen,
    refreshDialogOpen,
    refreshTargetTestRunId,
    availableSources,

    // Selection handlers
    handleSelectAll,
    handleSelectOne,
    handleClearSelection,

    // Batch action handlers
    handleBatchReEvaluate,
    handleBatchRefreshClick,
    handleBatchRefreshConfirm,
    handleBatchDeleteClick,
    handleBatchDeleteConfirm,
    handleBatchDeleteCancel,
    handleBatchMarkAsChangepoint,
    handleBatchRemoveChangepoint,
    closeRefreshDialog,
  };
}
