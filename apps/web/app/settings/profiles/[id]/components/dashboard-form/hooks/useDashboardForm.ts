'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  UseDashboardFormProps,
  DashboardFormData,
  AvailableVariable,
} from '../types';

const INITIAL_FORM_DATA: DashboardFormData = {
  grafanaLabel: '',
  dashboardUid: '',
  createSeparateDashboardForVariable: '',
  hardcodedVariables: [],
  regexRules: [],
  readOnly: false,
};

export function useDashboardForm({
  mode,
  dashboard,
  availableDashboards,
  availableInstances,
  open,
  onSubmit,
  onClose,
}: UseDashboardFormProps) {
  // Form state
  const [formData, setFormData] = useState<DashboardFormData>(INITIAL_FORM_DATA);

  // Loading and error states
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Track current input value for each autocomplete (for pending values)
  const [currentInputValues, setCurrentInputValues] = useState<Record<number, string>>({});

  // Filter dashboards by selected instance
  const filteredDashboards = useMemo(() => {
    if (!formData.grafanaLabel) return [];
    const instance = availableInstances.find(i => i.label === formData.grafanaLabel);
    return instance
      ? availableDashboards.filter(d => d.grafana_instance_id === instance.id)
      : [];
  }, [formData.grafanaLabel, availableDashboards, availableInstances]);

  // Get selected dashboard
  const selectedDashboard = useMemo(() => {
    return filteredDashboards.find(d => d.uid === formData.dashboardUid) || null;
  }, [filteredDashboards, formData.dashboardUid]);

  // Extract available variable names from selected dashboard
  const availableVariableNames: AvailableVariable[] = useMemo(() => {
    return selectedDashboard?.templating_variables?.map(v => ({
      name: v.name,
      type: v.type || 'unknown',
    })) || [];
  }, [selectedDashboard]);

  // Reset form
  const resetForm = useCallback(() => {
    setFormData(INITIAL_FORM_DATA);
    setError('');
    setCurrentInputValues({});
  }, []);

  // Initialize form with existing dashboard data in edit mode
  useEffect(() => {
    if (open) {
      if (mode === 'edit' && dashboard) {
        setFormData({
          grafanaLabel: dashboard.grafanaLabel,
          dashboardUid: dashboard.dashboardUid,
          createSeparateDashboardForVariable: dashboard.createSeparateDashboardForVariable || '',
          hardcodedVariables: (dashboard.setHardcodedValueForVariables || []).map(v => ({
            name: v.name,
            values: [...v.values],
          })),
          regexRules: dashboard.matchRegexForVariables
            ? Object.entries(dashboard.matchRegexForVariables).map(([key, value]) => ({
                key,
                value,
              }))
            : [],
          readOnly: dashboard.readOnly || false,
        });
      } else {
        resetForm();
      }
    }
  }, [mode, dashboard, open, resetForm]);

  // Hardcoded variables handlers
  const handleAddHardcodedVariable = useCallback(() => {
    setFormData(prev => ({
      ...prev,
      hardcodedVariables: [...prev.hardcodedVariables, { name: '', values: [] }],
    }));
  }, []);

  const handleRemoveHardcodedVariable = useCallback((index: number) => {
    setFormData(prev => ({
      ...prev,
      hardcodedVariables: prev.hardcodedVariables.filter((_, i) => i !== index),
    }));
    // Clean up input value tracking for removed index
    setCurrentInputValues(prev => {
      const { [index]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const handleHardcodedVariableChange = useCallback(
    (index: number, field: 'name' | 'values', value: string | string[]) => {
      setFormData(prev => {
        const updated = [...prev.hardcodedVariables];
        const variable = updated[index];
        if (!variable) return prev;

        if (field === 'name') {
          variable.name = value as string;
        } else {
          variable.values = value as string[];
        }
        return { ...prev, hardcodedVariables: updated };
      });
    },
    []
  );

  const handleAddPendingValueOnBlur = useCallback(
    (index: number) => {
      const pendingValue = currentInputValues[index];
      if (pendingValue && pendingValue.trim()) {
        const currentValues = formData.hardcodedVariables[index]?.values || [];
        if (!currentValues.includes(pendingValue.trim())) {
          handleHardcodedVariableChange(index, 'values', [...currentValues, pendingValue.trim()]);
        }
        setCurrentInputValues(prev => ({ ...prev, [index]: '' }));
      }
    },
    [currentInputValues, formData.hardcodedVariables, handleHardcodedVariableChange]
  );

  const updateCurrentInputValue = useCallback((index: number, value: string) => {
    setCurrentInputValues(prev => ({ ...prev, [index]: value }));
  }, []);

  const clearCurrentInputValue = useCallback((index: number) => {
    setCurrentInputValues(prev => ({ ...prev, [index]: '' }));
  }, []);

  // Regex rules handlers
  const handleAddRegexRule = useCallback(() => {
    setFormData(prev => ({
      ...prev,
      regexRules: [...prev.regexRules, { key: '', value: '' }],
    }));
  }, []);

  const handleRemoveRegexRule = useCallback((index: number) => {
    setFormData(prev => ({
      ...prev,
      regexRules: prev.regexRules.filter((_, i) => i !== index),
    }));
  }, []);

  const handleRegexRuleChange = useCallback((index: number, field: 'key' | 'value', value: string) => {
    setFormData(prev => {
      const updated = [...prev.regexRules];
      const rule = updated[index];
      if (!rule) return prev;

      rule[field] = value;
      return { ...prev, regexRules: updated };
    });
  }, []);

  // Form field update handlers
  const updateGrafanaLabel = useCallback((value: string) => {
    setFormData(prev => ({ ...prev, grafanaLabel: value, dashboardUid: '' }));
  }, []);

  const updateDashboardUid = useCallback((value: string) => {
    setFormData(prev => ({ ...prev, dashboardUid: value }));
  }, []);

  const updateSeparateDashboardVariable = useCallback((value: string) => {
    setFormData(prev => ({ ...prev, createSeparateDashboardForVariable: value }));
  }, []);

  const updateReadOnly = useCallback((value: boolean) => {
    setFormData(prev => ({ ...prev, readOnly: value }));
  }, []);

  // Submit handler
  const handleSubmit = useCallback(async () => {
    // Validation
    if (!formData.grafanaLabel) {
      setError('Grafana instance is required');
      return;
    }

    if (!formData.dashboardUid) {
      setError('Dashboard is required');
      return;
    }

    // Convert regex array to object
    const matchRegexForVariables: Record<string, string> = {};
    formData.regexRules.forEach(rule => {
      if (rule.key && rule.value) {
        matchRegexForVariables[rule.key] = rule.value;
      }
    });

    // Filter out empty hardcoded variables
    const validHardcodedVariables = formData.hardcodedVariables.filter(
      v => v.name && v.values.length > 0
    );

    const data = {
      grafanaLabel: formData.grafanaLabel,
      dashboardUid: formData.dashboardUid,
      createSeparateDashboardForVariable: formData.createSeparateDashboardForVariable || undefined,
      setHardcodedValueForVariables: validHardcodedVariables.length > 0 ? validHardcodedVariables : [],
      matchRegexForVariables: Object.keys(matchRegexForVariables).length > 0 ? matchRegexForVariables : {},
      readOnly: formData.readOnly,
    };

    try {
      setSubmitting(true);
      setError('');
      await onSubmit(data);
      resetForm();
      onClose();
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : `Failed to ${mode} dashboard`
      );
    } finally {
      setSubmitting(false);
    }
  }, [formData, mode, onSubmit, onClose, resetForm]);

  // Close handler
  const handleClose = useCallback(() => {
    if (!submitting) {
      resetForm();
      onClose();
    }
  }, [submitting, resetForm, onClose]);

  // Check if form is valid for submit button
  const isFormValid = useMemo(() => {
    return Boolean(formData.grafanaLabel && formData.dashboardUid);
  }, [formData.grafanaLabel, formData.dashboardUid]);

  return {
    // State
    formData,
    submitting,
    error,
    currentInputValues,

    // Derived data
    filteredDashboards,
    selectedDashboard,
    availableVariableNames,
    isFormValid,

    // Form field handlers
    updateGrafanaLabel,
    updateDashboardUid,
    updateSeparateDashboardVariable,
    updateReadOnly,

    // Hardcoded variables handlers
    handleAddHardcodedVariable,
    handleRemoveHardcodedVariable,
    handleHardcodedVariableChange,
    handleAddPendingValueOnBlur,
    updateCurrentInputValue,
    clearCurrentInputValue,

    // Regex rules handlers
    handleAddRegexRule,
    handleRemoveRegexRule,
    handleRegexRuleChange,

    // Form actions
    handleSubmit,
    handleClose,
  };
}
