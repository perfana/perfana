import { ApplicationDashboard, GrafanaPanel } from '@/lib/types';
import { DynatraceDashboard, DynatraceMetric } from '@/lib/dynatrace';
import { Benchmark } from '../../types';

/**
 * A dashboard reference held by the SLO form. Every field is optional on
 * purpose: add mode stores a full ApplicationDashboard or DynatraceDashboard,
 * while edit mode reconstructs a partial one from the saved benchmark before
 * the dashboard lists have loaded.
 */
export type SloDashboard = Partial<ApplicationDashboard> &
  Partial<DynatraceDashboard> & {
    /** Only set on the synthetic dashboard the edit dialog rebuilds from a benchmark. */
    dashboard_id?: number;
    grafanaInstance?: { label: string };
  };

/** A panel/metric reference held by the SLO form. Optional for the same reason. */
export type SloPanel = Partial<GrafanaPanel> & Partial<DynatraceMetric>;

/** Dynatrace dashboards are the only camelCase shape in the union. */
export function isDynatraceDashboard(d: SloDashboard): boolean {
  return d.dashboardLabel !== undefined;
}

/** Dynatrace metrics carry panelTitle; Grafana panels carry title. */
export function isDynatraceMetric(p: SloPanel): boolean {
  return p.panelTitle !== undefined;
}

/**
 * SLO Form Data State for Add mode
 */
export interface SLOFormData {
  source: string;
  /** Grafana + performance-test dashboards are ApplicationDashboards; Dynatrace has its own shape. */
  selectedDashboard: SloDashboard | null;
  selectedPanel: SloPanel | null;
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
  availableDashboards: ApplicationDashboard[];
  availablePanels: GrafanaPanel[];
  availableDynatraceDashboards: DynatraceDashboard[];
  availableDynatraceMetrics: DynatraceMetric[];
  availablePerfMetricsDashboards: ApplicationDashboard[];
  availablePerfMetricsPanels: GrafanaPanel[];
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
