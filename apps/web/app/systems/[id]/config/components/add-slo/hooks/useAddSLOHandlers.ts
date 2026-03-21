'use client';

import { useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { SLOFormData, UseAddSLOHandlersProps, UseAddSLOHandlersReturn } from '../types';
import {
  validateSLOForm,
  isFormValid as checkFormValid,
  processPercentunitValue,
  parseValueWithUnit,
} from '../utils/slo-validators';

export function useAddSLOHandlers({
  systemId,
  systemName,
  environment,
  workload,
  sloFormData,
  setValidationErrors,
  setSloFormLoading,
  onSLOCreated,
  onClose,
}: UseAddSLOHandlersProps): UseAddSLOHandlersReturn {
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

  // Create SLO function
  const createSlo = useCallback(async () => {
    // Validate the form before submitting
    if (!validateForm()) {
      console.error('Form validation failed');
      return;
    }

    try {
      setSloFormLoading(true);

      // Handle percentunit conversion - divide by 100 if panel uses percentunit format
      let processedRequirementValue = sloFormData.requirementValue;
      if (sloFormData.selectedPanel?.yAxesFormat === 'percentunit') {
        const parsedValue = parseValueWithUnit(sloFormData.requirementValue);
        if (parsedValue.value && !isNaN(Number(parsedValue.value))) {
          processedRequirementValue = String(Number(parsedValue.value) / 100);
          if (parsedValue.unit) {
            processedRequirementValue += parsedValue.unit;
          }
        }
      }

      // Build payload based on source
      let payload;

      if (sloFormData.source === 'dynatrace') {
        payload = {
          systemUnderTestId: systemId,
          testEnvironment: environment,
          workload: workload,
          source: 'dynatrace',
          grafanaInstance: 'Dynatrace',
          dashboardLabel: sloFormData.selectedDashboard?.dashboardLabel || '',
          dashboardUid: '',
          applicationDashboardId: sloFormData.selectedPanel?.applicationDashboardId || '',
          configTitle: `${sloFormData.selectedDashboard?.dashboardLabel || 'Dashboard'} - ${sloFormData.selectedPanel?.panelTitle || 'Metric'}`,
          panelTitle: sloFormData.selectedPanel?.panelTitle || '',
          evaluateType: sloFormData.evaluateType,
          requirementOperator: sloFormData.requirementOperator,
          requirementValue: processedRequirementValue,
          description: sloFormData.description,
          tags: sloFormData.tags,
          configuration: {
            requirement: {
              operator: sloFormData.requirementOperator,
              value: processedRequirementValue,
            },
            evaluateType: sloFormData.evaluateType,
            dashboardUid: '',
            id: sloFormData.selectedPanel?.panelId,
            type: 'dynatrace',
            title: `${sloFormData.selectedDashboard?.dashboardLabel || 'Dashboard'} - ${sloFormData.selectedPanel?.panelTitle || 'Metric'}`,
            yAxesFormat: sloFormData.selectedPanel?.metricUnit || null,
            excludeRampUpTime: sloFormData.excludeRampUpTime,
            averageAll: sloFormData.averageAll,
            matchPattern: sloFormData.matchPattern,
            validateWithDefaultIfNoData: sloFormData.validateWithDefaultIfNoData,
            validateWithDefaultIfNoDataValue: sloFormData.validateWithDefaultIfNoData
              ? sloFormData.validateWithDefaultIfNoDataValue
              : null,
          },
        };
      } else {
        // Grafana / Performance metrics payload
        payload = {
          systemUnderTestId: systemId,
          testEnvironment: environment,
          workload: workload,
          source: sloFormData.source,
          grafanaInstance: sloFormData.selectedDashboard?.grafanaInstance?.label || 'Default',
          dashboardLabel: sloFormData.selectedDashboard?.dashboard_label || '',
          ...(sloFormData.selectedDashboard?.dashboard_id &&
          typeof sloFormData.selectedDashboard.dashboard_id === 'number'
            ? { dashboardId: sloFormData.selectedDashboard.dashboard_id }
            : {}),
          dashboardUid: sloFormData.selectedDashboard?.dashboard_uid || '',
          applicationDashboardId: sloFormData.selectedDashboard?.id || '',
          configTitle: `${sloFormData.selectedDashboard?.dashboard_label || 'Dashboard'} - ${sloFormData.selectedPanel?.title || 'Metric'}`,
          panelTitle: sloFormData.selectedPanel?.title || '',
          evaluateType: sloFormData.evaluateType,
          requirementOperator: sloFormData.requirementOperator,
          requirementValue: processedRequirementValue,
          description: sloFormData.description,
          tags: sloFormData.tags,
          configuration: {
            requirement: {
              operator: sloFormData.requirementOperator,
              value: processedRequirementValue,
            },
            evaluateType: sloFormData.evaluateType,
            dashboardUid: sloFormData.selectedDashboard?.dashboard_uid,
            id: sloFormData.selectedPanel?.id,
            yAxesFormat: sloFormData.selectedPanel?.yAxesFormat || null,
            excludeRampUpTime: sloFormData.excludeRampUpTime,
            averageAll: sloFormData.averageAll,
            matchPattern: sloFormData.matchPattern,
            validateWithDefaultIfNoData: sloFormData.validateWithDefaultIfNoData,
            validateWithDefaultIfNoDataValue: sloFormData.validateWithDefaultIfNoData
              ? sloFormData.validateWithDefaultIfNoDataValue
              : null,
          },
        };
      }

      const response = await authenticatedFetch(`/benchmarks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const newBenchmark = await response.json();
        onSLOCreated(newBenchmark);
        onClose();
      } else {
        console.error('Failed to create SLO:', response.statusText);
      }
    } catch (error) {
      console.error('Error creating SLO:', error);
    } finally {
      setSloFormLoading(false);
    }
  }, [
    sloFormData,
    systemId,
    environment,
    workload,
    validateForm,
    setSloFormLoading,
    onSLOCreated,
    onClose,
  ]);

  return {
    handleCloseSloForm,
    createSlo,
    validateForm,
    isFormValid,
  };
}
