'use client';

import { useCallback } from 'react';
import { isDynatraceDashboard, isDynatraceMetric } from '../types';
import { authenticatedFetch } from '@/lib/api';
import { getErrorMessage, serverErrorMessage } from '@/lib/errors';
import {  UseAddSLOHandlersProps, UseAddSLOHandlersReturn } from '../types';
import {
  validateSLOForm,
  isFormValid as checkFormValid,
  toStoredThresholdValue,
  thresholdUnitFormat,
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

      // Strip the unit suffix and convert it to the panel's unit (percentunit stores 0-1).
      // The same unit validateSLOForm checked against, so what passed validation is what is stored.
      const unitFormat = thresholdUnitFormat(sloFormData);
      const processedRequirementValue = toStoredThresholdValue(sloFormData.requirementValue, unitFormat);
      const processedDefaultValue = sloFormData.validateWithDefaultIfNoData
        ? toStoredThresholdValue(sloFormData.validateWithDefaultIfNoDataValue, unitFormat)
        : null;

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
            invertMatchPattern: sloFormData.invertMatchPattern,
            validateWithDefaultIfNoData: sloFormData.validateWithDefaultIfNoData,
            validateWithDefaultIfNoDataValue: processedDefaultValue,
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
            invertMatchPattern: sloFormData.invertMatchPattern,
            validateWithDefaultIfNoData: sloFormData.validateWithDefaultIfNoData,
            validateWithDefaultIfNoDataValue: processedDefaultValue,
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
        // The dialog stays open on failure, so the reason has to reach it. A 409 here is
        // uq_benchmarks_active_metric_target: an enabled SLO on this panel already evaluates
        // the same series the same way, and the server's sentence says what to change.
        const message = await serverErrorMessage(response, `Failed to create SLO (${response.status})`);
        console.error('Failed to create SLO:', message);
        setValidationErrors((prev) => ({ ...prev, submit: message }));
      }
    } catch (error) {
      console.error('Error creating SLO:', error);
      setValidationErrors((prev) => ({ ...prev, submit: getErrorMessage(error) }));
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
    setValidationErrors,
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
