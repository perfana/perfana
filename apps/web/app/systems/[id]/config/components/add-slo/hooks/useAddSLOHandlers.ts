'use client';

import { useCallback } from 'react';
import { isDynatraceDashboard, isDynatraceMetric } from '../types';
import { authenticatedFetch } from '@/lib/api';
import {  UseAddSLOHandlersProps, UseAddSLOHandlersReturn } from '../types';
import {
  validateSLOForm,
  isFormValid as checkFormValid,
  parseValueWithUnit,
} from '../utils/slo-validators';

export function useAddSLOHandlers({
  systemId,
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

      // The form stores whichever shape the chosen source produced; narrow once.
      const selDash = sloFormData.selectedDashboard;
      const selPanel = sloFormData.selectedPanel;
      const appDashboard = selDash && !isDynatraceDashboard(selDash) ? selDash : null;
      const dynDashboard = selDash && isDynatraceDashboard(selDash) ? selDash : null;
      const grafanaPanel = selPanel && !isDynatraceMetric(selPanel) ? selPanel : null;
      const dynMetric = selPanel && isDynatraceMetric(selPanel) ? selPanel : null;

      // Handle percentunit conversion - divide by 100 if panel uses percentunit format
      let processedRequirementValue = sloFormData.requirementValue;
      if (grafanaPanel?.yAxesFormat === 'percentunit') {
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
          dashboardLabel: dynDashboard?.dashboardLabel || '',
          dashboardUid: '',
          applicationDashboardId: dynMetric?.applicationDashboardId || '',
          configTitle: `${dynDashboard?.dashboardLabel || 'Dashboard'} - ${dynMetric?.panelTitle || 'Metric'}`,
          panelTitle: dynMetric?.panelTitle || '',
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
            id: dynMetric?.panelId,
            type: 'dynatrace',
            title: `${dynDashboard?.dashboardLabel || 'Dashboard'} - ${dynMetric?.panelTitle || 'Metric'}`,
            yAxesFormat: dynMetric?.metricUnit || null,
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
          dashboardLabel: appDashboard?.dashboard_label || '',
          ...(sloFormData.selectedDashboard?.dashboard_id &&
          typeof sloFormData.selectedDashboard.dashboard_id === 'number'
            ? { dashboardId: sloFormData.selectedDashboard.dashboard_id }
            : {}),
          dashboardUid: appDashboard?.dashboard_uid || '',
          applicationDashboardId: appDashboard?.id || '',
          configTitle: `${appDashboard?.dashboard_label || 'Dashboard'} - ${grafanaPanel?.title || 'Metric'}`,
          panelTitle: grafanaPanel?.title || '',
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
            dashboardUid: appDashboard?.dashboard_uid,
            id: grafanaPanel?.id,
            yAxesFormat: grafanaPanel?.yAxesFormat || null,
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
