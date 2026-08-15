'use client';

import { useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import {} from '../../types';
import {
  SaveDialogOption,
  UseEditSLOHandlersProps,
  UseEditSLOHandlersReturn,
} from '../types';
import { validateSLOForm, isFormValid as checkFormValid, processPercentunitValue } from '../utils/slo-validators';
import { getEffectiveUnitFormat } from '../utils/slo-formatters';

export function useEditSLOHandlers({
  benchmark,
  systemId,
  environment,
  workload,
  sloFormData,
  setValidationErrors,
  setSloFormLoading,
  setShowSaveDialog,
  setSaveDialogOption,
  onSLOUpdated,
  onClose,
}: UseEditSLOHandlersProps): UseEditSLOHandlersReturn {
  // Close form handler
  const handleCloseSloForm = useCallback(() => {
    onClose();
  }, [onClose]);

  // Validation function
  const validateForm = useCallback(() => {
    const errors = validateSLOForm(sloFormData);
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [sloFormData, setValidationErrors]);

  // Check if form is valid
  const isFormValid = useCallback(() => {
    return checkFormValid(systemId, environment, workload, sloFormData);
  }, [systemId, environment, workload, sloFormData]);

  // Job completion polling function
  const pollJobCompletion = useCallback(
    async (jobId: string) => {
      const maxAttempts = 60; // 2 minutes max
      let attempts = 0;

      const checkStatus = async () => {
        try {
          const response = await authenticatedFetch(`/data/jobs/${jobId}/status`);

          if (!response.ok) {
            throw new Error('Failed to check job status');
          }

          const status = await response.json();

          if (status.status === 'completed' || status.state === 'completed') {
            // Job completed successfully - trigger UI refresh
            if (benchmark) {
              onSLOUpdated(benchmark);
            }
            return;
          }

          if (status.status === 'failed' || status.state === 'failed') {
            console.error('SLO re-evaluation job failed:', jobId, status);
            return;
          }

          // Job still running, continue polling
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(checkStatus, 2000); // Check again in 2 seconds
          } else {
            console.warn('Job polling timeout reached for:', jobId);
          }
        } catch (error) {
          console.error('Error checking job status:', error);
        }
      };

      checkStatus();
    },
    [benchmark, onSLOUpdated]
  );

  // Update SLO function
  const updateSlo = useCallback(
    async (saveOption: SaveDialogOption) => {
      if (!benchmark) return;

      try {
        setSloFormLoading(true);

        // Handle percentunit conversion - divide by 100 if panel uses percentunit format
        const effectiveUnitFormat = getEffectiveUnitFormat(sloFormData.selectedPanel);
        const processedRequirementValue = processPercentunitValue(sloFormData.requirementValue, effectiveUnitFormat);

        // Handle percentunit conversion for default value too
        let processedDefaultValue = sloFormData.validateWithDefaultIfNoDataValue;
        if (sloFormData.validateWithDefaultIfNoData) {
          processedDefaultValue = processPercentunitValue(sloFormData.validateWithDefaultIfNoDataValue, effectiveUnitFormat);
        }

        const payload = {
          systemUnderTestId: systemId,
          testEnvironment: environment,
          workload: workload,
          source: sloFormData.source,
          grafanaInstance: sloFormData.selectedDashboard?.grafanaInstance?.label || 'Default',
          dashboardLabel:
            sloFormData.source === 'dynatrace'
              ? sloFormData.selectedDashboard?.dashboardLabel || ''
              : sloFormData.selectedDashboard?.dashboard_label || '',
          ...(sloFormData.selectedDashboard?.dashboard_id &&
          typeof sloFormData.selectedDashboard.dashboard_id === 'number'
            ? { dashboardId: sloFormData.selectedDashboard.dashboard_id }
            : {}),
          dashboardUid: sloFormData.selectedDashboard?.dashboard_uid || '',
          applicationDashboardId:
            sloFormData.source === 'dynatrace'
              ? benchmark.application_dashboard_id || ''
              : sloFormData.selectedDashboard?.id || '',
          configTitle:
            sloFormData.source === 'dynatrace'
              ? `${sloFormData.selectedDashboard?.dashboardLabel || 'Dashboard'} - ${sloFormData.selectedPanel?.panelTitle || 'Metric'}`
              : `${sloFormData.selectedDashboard?.dashboard_label || 'Dashboard'} - ${sloFormData.selectedPanel?.title || 'Metric'}`,
          panelTitle:
            sloFormData.source === 'dynatrace'
              ? sloFormData.selectedPanel?.panelTitle || ''
              : sloFormData.selectedPanel?.title || '',
          evaluateType: sloFormData.evaluateType,
          requirementOperator: sloFormData.requirementOperator,
          requirementValue: processedRequirementValue,
          tags: sloFormData.tags,
          configuration: {
            requirement: {
              operator: sloFormData.requirementOperator,
              value: processedRequirementValue,
            },
            evaluateType: sloFormData.evaluateType,
            dashboardUid: sloFormData.selectedDashboard?.dashboard_uid,
            id: sloFormData.selectedPanel?.id,
            yAxesFormat: sloFormData.selectedPanel?.yAxesFormat || sloFormData.selectedPanel?.metricUnit || null,
            excludeRampUpTime: sloFormData.excludeRampUpTime,
            averageAll: sloFormData.averageAll,
            matchPattern: sloFormData.matchPattern,
            validateWithDefaultIfNoData: sloFormData.validateWithDefaultIfNoData,
            validateWithDefaultIfNoDataValue: sloFormData.validateWithDefaultIfNoData ? processedDefaultValue : null,
          },
        };

        // First save the SLO configuration
        const response = await authenticatedFetch(`/benchmarks/${benchmark.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error('Failed to update SLO configuration');
        }

        const updatedBenchmark = await response.json();

        // Handle re-evaluation based on user choice
        if (saveOption === 'current') {
          // Re-evaluate this test run only
          const testRunUuid = window.location.pathname.split('/')[2];

          // Fetch the test run details to get the test_run_id string
          const testRunDetailsResponse = await authenticatedFetch(`/test-runs/${testRunUuid}`);
          if (!testRunDetailsResponse.ok) {
            throw new Error('Failed to fetch test run details for re-evaluation');
          }
          const testRunDetails = await testRunDetailsResponse.json();
          const testRunIdForReeval = testRunDetails.test_run_id || testRunUuid;

          const reevalResponse = await authenticatedFetch('/data/reevaluate/batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              testRunIds: [testRunIdForReeval],
              checks: true,
              adapt: true,
            }),
          });

          if (!reevalResponse.ok) {
            throw new Error('Failed to start re-evaluation');
          }

          const result = await reevalResponse.json();

          // Start polling for job completion
          const jobId = result.data?.jobId || result.jobId;
          if (jobId) {
            pollJobCompletion(jobId);
          }
        } else if (saveOption === 'all') {
          // Re-evaluate all test runs after the most recent changepoint
          if (!systemId || !environment || !workload) {
            throw new Error('Missing system/environment/workload information for re-evaluation');
          }

          // First get the test runs after the most recent changepoint
          const testRunsResponse = await authenticatedFetch(
            `/test-runs/test-runs-after-changepoint?systemUnderTestId=${encodeURIComponent(systemId)}&testEnvironment=${encodeURIComponent(environment)}&workload=${encodeURIComponent(workload)}`,
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

          if (testRunIds.length > 0) {
            // Trigger re-evaluation for all test runs
            const reevalResponse = await authenticatedFetch('/data/reevaluate/batch', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                testRunIds: testRunIds,
                checks: true,
                adapt: true,
              }),
            });

            if (!reevalResponse.ok) {
              throw new Error('Failed to start batch re-evaluation');
            }

            const result = await reevalResponse.json();

            // Start polling for job completion
            const jobId = result.data?.jobId || result.jobId;
            if (jobId) {
              pollJobCompletion(jobId);
            }
          }
        }

        // Scroll to top if re-evaluation was triggered so user sees progress indicator
        if (saveOption !== 'none') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Close dialog and notify parent
        onSLOUpdated(updatedBenchmark);
        onClose();
      } catch (error) {
        console.error('Error updating SLO:', error);
      } finally {
        setSloFormLoading(false);
      }
    },
    [benchmark, systemId, environment, workload, sloFormData, setSloFormLoading, onSLOUpdated, onClose, pollJobCompletion]
  );

  // Handle save button click
  const handleSaveClick = useCallback(() => {
    if (!benchmark) return;

    // Validate the form before showing save dialog
    if (!validateForm()) {
      console.error('Form validation failed');
      return;
    }

    // Show save dialog
    setShowSaveDialog(true);
  }, [benchmark, validateForm, setShowSaveDialog]);

  // Handle save dialog confirm
  const handleSaveDialogConfirm = useCallback(
    (option: SaveDialogOption) => {
      setSaveDialogOption(option);
      setShowSaveDialog(false);
      updateSlo(option);
    },
    [setSaveDialogOption, setShowSaveDialog, updateSlo]
  );

  return {
    handleCloseSloForm,
    handleSaveClick,
    handleSaveDialogConfirm,
    validateForm,
    isFormValid,
  };
}
