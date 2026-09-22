'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { getUnit } from '@/lib/units';
import {
  CreateProfileBenchmarkData,
  UpdateProfileBenchmarkData,
  ProfileBenchmark,
  PERF_TEST_PROFILE_DASHBOARD,
  isPerfTestProfileDashboard,
} from '@/lib/profile-benchmarks';
import { PERF_TEST_PROFILE_SOURCE, PERF_TEST_PROFILE_PANELS } from '@perfana/shared/constants';
import { ProfileDashboard } from '@/lib/profiles';
import {
  BenchmarkFormData,
  GrafanaPanel,
  SUPPORTED_PANEL_TYPES,
} from '../types';
import {
  parseValueWithUnit,
  isValidNumericValue,
  processPercentUnitValue,
} from '../utils';

interface UseBenchmarkFormProps {
  mode: 'create' | 'edit';
  benchmark?: ProfileBenchmark;
  profileDashboards: ProfileDashboard[];
  open: boolean;
  onSubmit: (data: CreateProfileBenchmarkData | UpdateProfileBenchmarkData) => Promise<void>;
  onClose: () => void;
}

const INITIAL_FORM_DATA: BenchmarkFormData = {
  selectedDashboard: null,
  selectedPanel: null,
  workloadPattern: '.*',
  evaluateType: 'avg',
  requirementOperator: 'lt',
  requirementValue: '',
  tags: [],
  excludeRampUpTime: true,
  averageAll: false,
  matchPattern: '',
  validateWithDefaultIfNoData: false,
  validateWithDefaultIfNoDataValue: '',
};

export function useBenchmarkForm({
  mode,
  benchmark,
  profileDashboards,
  open,
  onSubmit,
  onClose,
}: UseBenchmarkFormProps) {
  // Form data state
  const [formData, setFormData] = useState<BenchmarkFormData>(INITIAL_FORM_DATA);

  // Loading states
  const [formLoading, setFormLoading] = useState(false);
  const [panelsLoading, setPanelsLoading] = useState(false);

  // Available options
  const [availablePanels, setAvailablePanels] = useState<GrafanaPanel[]>([]);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>('');

  // Fetch dashboard panels from Grafana. The perf-test pseudo-dashboard has no Grafana
  // uid to ask for (its uid field holds a regex); its panels are the fixed set every
  // scenario dashboard carries.
  const fetchDashboardPanels = useCallback(async (dashboard: ProfileDashboard) => {
    if (isPerfTestProfileDashboard(dashboard)) {
      setAvailablePanels(PERF_TEST_PROFILE_PANELS.map((p) => ({ ...p, type: PERF_TEST_PROFILE_SOURCE })));
      return;
    }
    const dashboardUid = dashboard.dashboardUid;
    if (!dashboardUid) return;

    try {
      setPanelsLoading(true);
      const response = await authenticatedFetch(
        `/grafana/dashboards?uid=${dashboardUid}`,
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const dashboardData = await response.json();
        const dashboard = Array.isArray(dashboardData) ? dashboardData[0] : dashboardData;
        const filteredPanels = dashboard?.panels?.filter((panel: GrafanaPanel) =>
          SUPPORTED_PANEL_TYPES.includes(panel.type)
        ) || [];
        setAvailablePanels(filteredPanels);
      } else {
        setAvailablePanels([]);
      }
    } catch {
      setAvailablePanels([]);
    } finally {
      setPanelsLoading(false);
    }
  }, []);

  // Validation function
  const validateForm = useCallback(() => {
    const errors: Record<string, string> = {};

    if (!formData.selectedDashboard) {
      errors.selectedDashboard = 'Dashboard is required';
    }

    if (!formData.selectedPanel) {
      errors.selectedPanel = 'Metric is required';
    }

    if (!formData.requirementValue || formData.requirementValue.trim() === '') {
      errors.requirementValue = 'Requirement value is required';
    } else if (!isValidNumericValue(formData.requirementValue)) {
      errors.requirementValue = 'Requirement value must be a valid number';
    }

    if (formData.validateWithDefaultIfNoData) {
      if (!formData.validateWithDefaultIfNoDataValue || formData.validateWithDefaultIfNoDataValue.trim() === '') {
        errors.validateWithDefaultIfNoDataValue = 'Default value is required when "Use Default If No Data" is enabled';
      } else if (!isValidNumericValue(formData.validateWithDefaultIfNoDataValue)) {
        errors.validateWithDefaultIfNoDataValue = 'Default value must be a valid number';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData]);

  // Check if form is valid for submit button
  const isFormValid = useCallback(() => {
    return (
      formData.selectedDashboard &&
      formData.selectedPanel &&
      formData.requirementValue &&
      formData.requirementValue.trim() !== '' &&
      (!formData.validateWithDefaultIfNoData ||
        (formData.validateWithDefaultIfNoDataValue && formData.validateWithDefaultIfNoDataValue.trim() !== ''))
    );
  }, [formData]);

  // Initialize form data when editing
  useEffect(() => {
    if (mode === 'edit' && benchmark && open) {
      const dashboard = benchmark.source === PERF_TEST_PROFILE_SOURCE
        ? { ...PERF_TEST_PROFILE_DASHBOARD, dashboardUid: benchmark.dashboardUid || PERF_TEST_PROFILE_DASHBOARD.dashboardUid }
        : profileDashboards.find(d => d.id === benchmark.profileDashboardId);

      setFormData({
        selectedDashboard: dashboard || null,
        selectedPanel: benchmark.panelId ? {
          id: benchmark.panelId,
          title: benchmark.panelTitle || '',
          type: benchmark.panelType || '',
          yAxesFormat: benchmark.metricUnit || null,
        } : null,
        workloadPattern: benchmark.workloadPattern || '.*',
        evaluateType: benchmark.evaluateType || 'avg',
        requirementOperator: benchmark.requirementOperator || 'lt',
        requirementValue: benchmark.requirementValue?.toString() || '',
        tags: benchmark.tags || [],
        excludeRampUpTime: benchmark.excludeRampUpTime ?? true,
        averageAll: benchmark.averageAll ?? false,
        matchPattern: benchmark.matchPattern || '',
        validateWithDefaultIfNoData: benchmark.validateWithDefaultIfNoData ?? false,
        validateWithDefaultIfNoDataValue: benchmark.validateWithDefaultIfNoDataValue?.toString() || '',
      });

      if (dashboard) {
        fetchDashboardPanels(dashboard);
      }
    } else if (mode === 'create' && open) {
      setFormData(INITIAL_FORM_DATA);
      setAvailablePanels([]);
    }
    setError('');
    setValidationErrors({});
  }, [mode, benchmark, open, profileDashboards, fetchDashboardPanels]);

  // Handle form field updates
  const updateFormField = useCallback(<K extends keyof BenchmarkFormData>(
    field: K,
    value: BenchmarkFormData[K]
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear validation error for this field
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const { [field]: _, ...rest } = prev;
        return rest;
      });
    }
  }, [validationErrors]);

  // Handle dashboard selection
  const handleDashboardSelect = useCallback((dashboard: ProfileDashboard | null) => {
    let autoPopulatedTags: string[] = [];
    if (mode === 'create' && dashboard?.tags) {
      autoPopulatedTags = dashboard.tags.filter(tag => {
        const lowerTag = tag.toLowerCase();
        return !lowerTag.includes('perfana') && !lowerTag.includes('ig');
      });
    }

    setFormData(prev => ({
      ...prev,
      selectedDashboard: dashboard,
      selectedPanel: null,
      tags: mode === 'create' ? autoPopulatedTags : prev.tags,
    }));

    if (dashboard) {
      fetchDashboardPanels(dashboard);
    } else {
      setAvailablePanels([]);
    }

    if (validationErrors.selectedDashboard) {
      setValidationErrors(prev => {
        const { selectedDashboard: _selectedDashboard, ...rest } = prev;
        return rest;
      });
    }
  }, [mode, fetchDashboardPanels, validationErrors.selectedDashboard]);

  // Handle panel selection
  const handlePanelSelect = useCallback((panel: GrafanaPanel | null) => {
    let requirementValue = formData.requirementValue;
    if (panel?.yAxesFormat && !parseValueWithUnit(requirementValue).unit) {
      const unit = getUnit(panel.yAxesFormat);
      if (unit.format && requirementValue && !requirementValue.includes(unit.format)) {
        requirementValue = requirementValue + unit.format;
      }
    }

    setFormData(prev => ({
      ...prev,
      selectedPanel: panel,
      requirementValue,
    }));

    if (validationErrors.selectedPanel) {
      setValidationErrors(prev => {
        const { selectedPanel: _selectedPanel, ...rest } = prev;
        return rest;
      });
    }
  }, [formData.requirementValue, validationErrors.selectedPanel]);

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return;

    try {
      setFormLoading(true);
      setError('');

      const _parsedRequirementValue = parseValueWithUnit(formData.requirementValue);
      const isPercentUnit = formData.selectedPanel?.yAxesFormat === 'percentunit';
      const processedRequirementValue = processPercentUnitValue(formData.requirementValue, isPercentUnit);
      const processedDefaultValue = formData.validateWithDefaultIfNoData
        ? processPercentUnitValue(formData.validateWithDefaultIfNoDataValue, isPercentUnit)
        : '';

      const isPerfTest = isPerfTestProfileDashboard(formData.selectedDashboard);
      const payload: CreateProfileBenchmarkData | UpdateProfileBenchmarkData = {
        profileDashboardId: isPerfTest ? undefined : formData.selectedDashboard!.id,
        workloadPattern: formData.workloadPattern,
        source: isPerfTest ? PERF_TEST_PROFILE_SOURCE : 'grafana',
        grafanaInstance: isPerfTest ? undefined : formData.selectedDashboard!.grafanaLabel,
        // For perf-test this is the uid regex grafana-sync fans out over, not a dashboard uid.
        dashboardUid: formData.selectedDashboard!.dashboardUid,
        panelId: formData.selectedPanel?.id,
        panelTitle: formData.selectedPanel?.title || '',
        panelType: formData.selectedPanel?.type || '',
        panelDescription: formData.selectedPanel?.description || '',
        evaluateType: formData.evaluateType,
        metricUnit: formData.selectedPanel?.yAxesFormat || undefined,
        requirementOperator: formData.requirementOperator,
        requirementValue: parseFloat(parseValueWithUnit(processedRequirementValue).value || '0'),
        excludeRampUpTime: formData.excludeRampUpTime,
        averageAll: formData.averageAll,
        matchPattern: formData.matchPattern || undefined,
        validateWithDefaultIfNoData: formData.validateWithDefaultIfNoData,
        validateWithDefaultIfNoDataValue: formData.validateWithDefaultIfNoData && processedDefaultValue
          ? parseFloat(parseValueWithUnit(processedDefaultValue).value || '0')
          : undefined,
        tags: formData.tags,
        metadata: {},
      };

      await onSubmit(payload);
      onClose();
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to save benchmark'
      );
    } finally {
      setFormLoading(false);
    }
  }, [formData, validateForm, onSubmit, onClose]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    setError('');
    setValidationErrors({});
    onClose();
  }, [onClose]);

  return {
    // State
    formData,
    formLoading,
    panelsLoading,
    availablePanels,
    validationErrors,
    error,

    // Validation
    isFormValid,

    // Handlers
    updateFormField,
    handleDashboardSelect,
    handlePanelSelect,
    handleSubmit,
    handleCancel,
  };
}
