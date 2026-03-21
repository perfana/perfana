import {
  CreateProfileDashboardData,
  UpdateProfileDashboardData,
  DashboardVariable,
  ProfileDashboard,
} from '@/lib/profiles';

/**
 * Grafana instance interface
 */
export interface GrafanaInstance {
  id: string;
  label: string;
  client_url: string;
  server_url?: string;
  org_id: string;
  snapshot_instance: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Grafana dashboard interface
 */
export interface GrafanaDashboard {
  id: string;
  grafana_instance_id: string;
  grafana_id: number;
  datasource_type?: string;
  uid: string;
  slug?: string;
  name: string;
  uri?: string;
  templating_variables?: Array<{
    name: string;
    query?: string | { query?: string; [key: string]: unknown };
    type?: string;
    datasource?: Record<string, unknown>;
    regex?: string;
    options?: Array<{ text?: string; value: string; [key: string]: unknown }>;
  }>;
  panels?: unknown[];
  variables?: unknown[];
  tags?: string[];
  used_by_sut?: string[];
  updated?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Available variable info extracted from dashboard
 */
export interface AvailableVariable {
  name: string;
  type: string;
}

/**
 * Regex rule for variable matching
 */
export interface RegexRule {
  key: string;
  value: string;
}

/**
 * Form data state for dashboard form
 */
export interface DashboardFormData {
  grafanaLabel: string;
  dashboardUid: string;
  createSeparateDashboardForVariable: string;
  hardcodedVariables: DashboardVariable[];
  regexRules: RegexRule[];
  readOnly: boolean;
}

/**
 * Props for the DashboardFormDialog component
 */
export interface DashboardFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  dashboard?: ProfileDashboard;
  availableDashboards: GrafanaDashboard[];
  availableInstances: GrafanaInstance[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (data: CreateProfileDashboardData | UpdateProfileDashboardData) => Promise<void>;
}

/**
 * Props for hooks
 */
export interface UseDashboardFormProps {
  mode: 'create' | 'edit';
  dashboard?: ProfileDashboard;
  availableDashboards: GrafanaDashboard[];
  availableInstances: GrafanaInstance[];
  open: boolean;
  onSubmit: (data: CreateProfileDashboardData | UpdateProfileDashboardData) => Promise<void>;
  onClose: () => void;
}

// Re-export types from lib for convenience
export type { DashboardVariable, ProfileDashboard, CreateProfileDashboardData, UpdateProfileDashboardData };
