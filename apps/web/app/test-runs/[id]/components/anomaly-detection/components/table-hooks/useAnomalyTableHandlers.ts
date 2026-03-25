'use client';

import { useState, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { AnomalyData } from '../../types';
import { DeleteOptions } from '../DeleteAnomalyDialog';
import { TestRun } from '@/types/test-runs';

interface UseAnomalyTableHandlersProps {
  testRunId: string;
  testRun?: TestRun | null;
  showToast?: (message: string) => void;
  onRefreshAnomalyData?: () => void;
  onDeleteAnomaly?: (anomaly: AnomalyData, options: DeleteOptions) => Promise<void>;
  onConfigSave?: (rowKey: string, data: any, scope: 'metric' | 'panel') => void;
}

export function useAnomalyTableHandlers({
  testRunId,
  testRun,
  showToast,
  onRefreshAnomalyData,
  onDeleteAnomaly,
  onConfigSave,
}: UseAnomalyTableHandlersProps) {
  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteAnomalyData, setDeleteAnomalyData] = useState<AnomalyData | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Action menu state
  const [actionMenuAnchor, setActionMenuAnchor] = useState<null | HTMLElement>(null);
  const [actionMenuData, setActionMenuData] = useState<AnomalyData | null>(null);

  // Config save dialog state
  const [configSaveDialogOpen, setConfigSaveDialogOpen] = useState(false);
  const [pendingConfigSave, setPendingConfigSave] = useState<{
    rowKey: string;
    data: any;
    scope: 'metric' | 'panel';
  } | null>(null);
  const [configSaveLoading, setConfigSaveLoading] = useState(false);

  // Selected test run state for trends chart interaction
  const [selectedTestRunId, setSelectedTestRunId] = useState<Record<string, string>>({});

  // Action menu handlers
  const handleOpenActionMenu = useCallback((event: React.MouseEvent<HTMLElement>, row: AnomalyData) => {
    event.stopPropagation();
    setActionMenuAnchor(event.currentTarget);
    setActionMenuData(row);
  }, []);

  const handleCloseActionMenu = useCallback(() => {
    setActionMenuAnchor(null);
    setActionMenuData(null);
  }, []);

  // Delete handlers
  const handleDeleteClick = useCallback((anomaly: AnomalyData) => {
    setDeleteAnomalyData(anomaly);
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(async (options: DeleteOptions) => {
    if (!deleteAnomalyData || !onDeleteAnomaly) return;

    try {
      setDeleteLoading(true);
      await onDeleteAnomaly(deleteAnomalyData, options);
      setDeleteDialogOpen(false);
      setDeleteAnomalyData(null);
    } catch (error) {
      if (showToast) {
        const message = error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Failed to delete anomaly data';
        showToast(message);
      }
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteAnomalyData, onDeleteAnomaly, showToast]);

  const handleDeleteCancel = useCallback(() => {
    if (!deleteLoading) {
      setDeleteDialogOpen(false);
      setDeleteAnomalyData(null);
    }
  }, [deleteLoading]);

  // Job completion polling function
  const pollJobCompletion = useCallback(async (jobId: string, metricName?: string) => {
    const maxAttempts = 60;
    let attempts = 0;

    const checkStatus = async () => {
      try {
        const response = await authenticatedFetch(`/data/jobs/${jobId}/status`);
        if (!response.ok) {
          throw new Error('Failed to check job status');
        }

        const status = await response.json();

        if (status.status === 'completed' || status.state === 'completed') {
          if (onRefreshAnomalyData) {
            onRefreshAnomalyData();
          }
          if (showToast) {
            const message = metricName
              ? `Re-analysis completed for ${metricName}`
              : 'Re-analysis completed';
            showToast(message);
          }
          return;
        }

        if (status.status === 'failed' || status.state === 'failed') {
          if (showToast) {
            const message = metricName
              ? `Re-analysis failed for ${metricName}`
              : 'Re-analysis failed';
            showToast(message);
          }
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(checkStatus, 2000);
        } else {
          if (showToast) {
            showToast('Re-analysis is taking longer than expected');
          }
        }
      } catch (error) {
        if (showToast) {
          showToast('Failed to check re-analysis status');
        }
      }
    };

    checkStatus();
  }, [onRefreshAnomalyData, showToast]);

  // Handle stale chip click for re-analysis
  const handleStaleChipClick = useCallback(async (row: AnomalyData) => {
    try {
      const testRunIdForReeval = testRun?.test_run_id || testRunId;

      const response = await authenticatedFetch('/data/reevaluate/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          testRunIds: [testRunIdForReeval],
          checks: true,
          adapt: true,
          applicationDashboardId: row.application_dashboard_id,
          panelId: parseInt(row.panel_id),
          metricName: row.metric_name
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start re-analysis');
      }

      const result = await response.json();

      if (showToast) {
        showToast(`Re-analysis started for ${row.metric_name}`);
      }

      const jobId = result.data?.jobId || result.jobId;
      if (jobId) {
        pollJobCompletion(jobId, row.metric_name);
      }
    } catch (error) {
      if (showToast) {
        showToast('Failed to start re-analysis');
      }
    }
  }, [testRun, testRunId, showToast, pollJobCompletion]);

  // Config save with dialog
  const handleConfigSave = useCallback((rowKey: string, data: any, scope: 'metric' | 'panel') => {
    setPendingConfigSave({ rowKey, data, scope });
    setConfigSaveDialogOpen(true);
  }, []);

  // Handle config save dialog choice
  const handleConfigSaveDialogChoice = useCallback(async (updateOption: 'none' | 'current' | 'all') => {
    if (!pendingConfigSave) return;

    setConfigSaveLoading(true);

    try {
      if (onConfigSave) {
        await onConfigSave(pendingConfigSave.rowKey, pendingConfigSave.data, pendingConfigSave.scope);
      }

      if (updateOption === 'current') {
        const testRunIdForReeval = testRun?.test_run_id || testRunId;

        const response = await authenticatedFetch('/data/reevaluate/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            testRunIds: [testRunIdForReeval],
            checks: true,
            adapt: true
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to start re-analysis');
        }

        const result = await response.json();

        if (showToast) {
          showToast('Configuration saved and re-analysis started for this test run');
        }

        const jobId = result.data?.jobId || result.jobId;
        if (jobId) {
          pollJobCompletion(jobId);
        }

      } else if (updateOption === 'all') {
        if (!testRun?.system_under_test_id || !testRun?.test_environment || !testRun?.workload) {
          throw new Error('Missing system/environment/workload information for re-analysis');
        }

        const testRunsResponse = await authenticatedFetch(
          `/test-runs/test-runs-after-changepoint?systemUnderTestId=${encodeURIComponent(testRun.system_under_test_id)}&testEnvironment=${encodeURIComponent(testRun.test_environment)}&workload=${encodeURIComponent(testRun.workload)}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        if (!testRunsResponse.ok) {
          throw new Error('Failed to get test runs after changepoint');
        }

        const testRunsData = await testRunsResponse.json();
        const testRunIds = testRunsData.testRunIds || [];

        if (testRunIds.length === 0) {
          if (showToast) {
            showToast('Configuration saved. No changepoint or control group test runs found.');
          }
        } else {
          if (showToast) {
            showToast(`Configuration saved. Re-analyzing ${testRunIds.length} test runs.`);
          }

          const response = await authenticatedFetch('/data/reevaluate/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              testRunIds: testRunIds,
              checks: true,
              adapt: true
            }),
          });

          if (!response.ok) {
            throw new Error('Failed to start batch re-analysis');
          }

          const result = await response.json();

          if (showToast) {
            const changepointInfo = testRunsData.changepointTestRunId
              ? ` starting from changepoint ${testRunsData.changepointTestRunId}`
              : '';
            showToast(`Configuration saved and re-analysis started for ${testRunIds.length} test runs${changepointInfo}`);
          }

          const jobId = result.data?.jobId || result.jobId;
          if (jobId) {
            pollJobCompletion(jobId);
          }
        }
      } else {
        if (showToast) {
          showToast('Configuration saved without updating analysis');
        }
      }

      setConfigSaveDialogOpen(false);
      setPendingConfigSave(null);

      if (updateOption !== 'none') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

    } catch (error) {
      if (showToast) {
        showToast('Failed to save configuration');
      }
    } finally {
      setConfigSaveLoading(false);
    }
  }, [pendingConfigSave, onConfigSave, testRun, testRunId, showToast, pollJobCompletion]);

  const handleConfigSaveDialogClose = useCallback(() => {
    setConfigSaveDialogOpen(false);
    setPendingConfigSave(null);
  }, []);

  // Selected test run handlers
  const handleSelectTestRun = useCallback((rowKey: string, selectedId: string) => {
    setSelectedTestRunId(prev => ({
      ...prev,
      [rowKey]: selectedId
    }));
  }, []);

  const handleResetSelectedTestRun = useCallback((rowKey: string) => {
    setSelectedTestRunId(prev => {
      const newState = { ...prev };
      delete newState[rowKey];
      return newState;
    });
  }, []);

  return {
    // Delete dialog
    deleteDialogOpen,
    deleteAnomalyData,
    deleteLoading,
    handleDeleteClick,
    handleDeleteConfirm,
    handleDeleteCancel,

    // Action menu
    actionMenuAnchor,
    actionMenuData,
    handleOpenActionMenu,
    handleCloseActionMenu,

    // Config save dialog
    configSaveDialogOpen,
    configSaveLoading,
    handleConfigSave,
    handleConfigSaveDialogChoice,
    handleConfigSaveDialogClose,

    // Stale handling
    handleStaleChipClick,

    // Selected test run
    selectedTestRunId,
    handleSelectTestRun,
    handleResetSelectedTestRun,
  };
}
