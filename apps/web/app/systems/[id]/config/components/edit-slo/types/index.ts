import { ApplicationDashboard, GrafanaPanel } from '@/lib/types';
import { DynatraceDashboard, DynatraceMetric } from '@/lib/dynatrace';
import { Benchmark } from '../../types';

/** A dashboard the SLO form can point at, across all three metric sources. */
export type SloDashboard = ApplicationDashboard | DynatraceDashboard;

/** A panel or metric the SLO form can point at, across all three metric sources. */
export type SloPanel = GrafanaPanel | DynatraceMetric;

/** Dynatrace dashboards are the only camelCase shape in the union. */
export function isDynatraceDashboard(d: SloDashboard): d is DynatraceDashboard {
  return 'dashboardLabel' in d;
}

/** Dynatrace metrics carry panelTitle; Grafana panels carry title. */
export function isDynatraceMetric(p: SloPanel): p is DynatraceMetric {
  return 'panelTitle' in p;
}

/**
 * SLO Form Data State
 */
export interface SLOFormData {
  source: string;
  /** Grafana + performance-test dashboards are ApplicationDashboards; Dynatrace has its own shape. */
  selectedDashboard: SloDashboard | null;
  selectedPanel: SloPanel | null;
  evaluateType: string;
  requirementOperator: string;
  requirementValue: string;
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
  tags: [],
  excludeRampUpTime: true,
  averageAll: false,
  matchPattern: '',
  validateWithDefaultIfNoData: false,
  validateWithDefaultIfNoDataValue: '',
};

/**
 * Edit SLO Dialog Props
 */
export interface EditSLODialogProps {
  open: boolean;
  onClose: () => void;
  benchmark: Benchmark | null;
  systemId: string;
  systemName: string;
  environment: string;
  workload: string;
  onSLOUpdated: (slo: Benchmark) => void;
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
  availableDashboards: ApplicationDashboard[];
  availablePanels: GrafanaPanel[];
  availableDynatraceDashboards: DynatraceDashboard[];
  availableDynatraceMetrics: DynatraceMetric[];
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
 * Save dialog option type
 */
export type SaveDialogOption = 'none' | 'current' | 'all';

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
 * Hooks props for useEditSLOForm
 */
export interface UseEditSLOFormProps {
  open: boolean;
  benchmark: Benchmark | null;
  systemId: string;
  systemName?: string;
  environment: string;
  workload: string;
}

/**
 * Hooks return type for useEditSLOForm
 */
export interface UseEditSLOFormReturn {
  sloFormData: SLOFormData;
  setSloFormData: React.Dispatch<React.SetStateAction<SLOFormData>>;
  validationErrors: ValidationErrors;
  setValidationErrors: React.Dispatch<React.SetStateAction<ValidationErrors>>;
  loadingStates: LoadingStates;
  availableOptions: AvailableOptions;
  showSaveDialog: boolean;
  setShowSaveDialog: React.Dispatch<React.SetStateAction<boolean>>;
  saveDialogOption: SaveDialogOption;
  setSaveDialogOption: React.Dispatch<React.SetStateAction<SaveDialogOption>>;
  fetchDashboardPanels: (dashboardUid: string) => Promise<void>;
  fetchSloApplicationDashboards: () => Promise<void>;
  fetchDynatraceDashboardsForSlo: () => Promise<void>;
  fetchDynatraceMetricsForSlo: (dashboardLabel: string) => Promise<void>;
}

/**
 * Hooks props for useEditSLOHandlers
 */
export interface UseEditSLOHandlersProps {
  benchmark: Benchmark | null;
  systemId: string;
  environment: string;
  workload: string;
  sloFormData: SLOFormData;
  setSloFormData: React.Dispatch<React.SetStateAction<SLOFormData>>;
  validationErrors: ValidationErrors;
  setValidationErrors: React.Dispatch<React.SetStateAction<ValidationErrors>>;
  setSloFormLoading: (loading: boolean) => void;
  setShowSaveDialog: React.Dispatch<React.SetStateAction<boolean>>;
  saveDialogOption: SaveDialogOption;
  setSaveDialogOption: React.Dispatch<React.SetStateAction<SaveDialogOption>>;
  onSLOUpdated: (slo: Benchmark) => void;
  onClose: () => void;
}

/**
 * Hooks return type for useEditSLOHandlers
 */
export interface UseEditSLOHandlersReturn {
  handleCloseSloForm: () => void;
  handleSaveClick: () => void;
  handleSaveDialogConfirm: (option: SaveDialogOption) => void;
  validateForm: () => boolean;
  isFormValid: () => boolean;
}
