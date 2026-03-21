import { Benchmark } from '../../types';

/**
 * SLO Form Data State for Add mode
 */
export interface SLOFormData {
  source: string;
  selectedDashboard: any;
  selectedPanel: any;
  evaluateType: string;
  requirementOperator: string;
  requirementValue: string;
  description: string;
  tags: string[];
  excludeRampUpTime: boolean;
  averageAll: boolean;
  matchPattern: string;
  validateWithDefaultIfNoData: boolean;
  validateWithDefaultIfNoDataValue: string;
}

/**
 * Initial form data state
 */
export const initialSLOFormData: SLOFormData = {
  source: '',
  selectedDashboard: null,
  selectedPanel: null,
  evaluateType: 'avg',
  requirementOperator: 'lt',
  requirementValue: '',
  description: '',
  tags: [],
  excludeRampUpTime: true,
  averageAll: false,
  matchPattern: '',
  validateWithDefaultIfNoData: false,
  validateWithDefaultIfNoDataValue: '',
};

/**
 * Add SLO Dialog Props
 */
export interface AddSLODialogProps {
  open: boolean;
  onClose: () => void;
  systemId: string;
  systemName: string;
  environment: string;
  workload: string;
  onSLOCreated: (slo: Benchmark) => void;
}

/**
 * Loading states for various async operations
 */
export interface LoadingStates {
  sloFormLoading: boolean;
  dashboardsLoading: boolean;
  panelsLoading: boolean;
}

/**
 * Available options from API responses
 */
export interface AvailableOptions {
  availableDashboards: any[];
  availablePanels: any[];
  availableDynatraceDashboards: any[];
  availableDynatraceMetrics: any[];
  availablePerfMetricsDashboards: any[];
  availablePerfMetricsPanels: any[];
}

/**
 * Data source availability state
 */
export interface DataSourceAvailability {
  hasDynatraceData: boolean;
  hasPerfMetricsData: boolean;
}

/**
 * Parsed value with unit result
 */
export interface ParsedValueWithUnit {
  value: string;
  unit: string;
  unitId: string;
}

/**
 * Validation errors record
 */
export type ValidationErrors = Record<string, string>;

/**
 * Evaluate type option
 */
export interface EvaluateTypeOption {
  value: string;
  label: string;
  description: string;
}

/**
 * Requirement operator option
 */
export interface RequirementOperatorOption {
  value: string;
  label: string;
  description: string;
}

/**
 * Source option
 */
export interface SourceOption {
  value: string;
  label: string;
}

/**
 * Hooks props for useAddSLOForm
 */
export interface UseAddSLOFormProps {
  open: boolean;
  systemId: string;
  systemName: string;
  environment: string;
  workload: string;
}

/**
 * Hooks return type for useAddSLOForm
 */
export interface UseAddSLOFormReturn {
  sloFormData: SLOFormData;
  setSloFormData: React.Dispatch<React.SetStateAction<SLOFormData>>;
  validationErrors: ValidationErrors;
  setValidationErrors: React.Dispatch<React.SetStateAction<ValidationErrors>>;
  loadingStates: LoadingStates;
  setLoadingStates: {
    setSloFormLoading: (loading: boolean) => void;
    setDashboardsLoading: (loading: boolean) => void;
    setPanelsLoading: (loading: boolean) => void;
  };
  availableOptions: AvailableOptions;
  dataSourceAvailability: DataSourceAvailability;
  fetchDashboardPanels: (dashboardUid: string) => Promise<void>;
  fetchPerfMetricsPanels: (dashboardUid: string) => Promise<void>;
  fetchSloApplicationDashboards: () => Promise<void>;
  fetchDynatraceDashboardsForSlo: () => Promise<void>;
  fetchDynatraceMetricsForSlo: (dashboardLabel: string) => Promise<void>;
  fetchPerfMetricsDashboardsForSlo: () => Promise<void>;
  handleSourceChange: (sourceValue: string) => void;
  resetForm: () => void;
}

/**
 * Hooks props for useAddSLOHandlers
 */
export interface UseAddSLOHandlersProps {
  systemId: string;
  systemName: string;
  environment: string;
  workload: string;
  sloFormData: SLOFormData;
  setValidationErrors: React.Dispatch<React.SetStateAction<ValidationErrors>>;
  setSloFormLoading: (loading: boolean) => void;
  onSLOCreated: (slo: Benchmark) => void;
  onClose: () => void;
}

/**
 * Hooks return type for useAddSLOHandlers
 */
export interface UseAddSLOHandlersReturn {
  handleCloseSloForm: () => void;
  createSlo: () => Promise<void>;
  validateForm: () => boolean;
  isFormValid: () => boolean;
}
