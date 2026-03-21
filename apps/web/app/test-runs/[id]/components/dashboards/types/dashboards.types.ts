import { TestRun } from '@/types/test-runs';

/**
 * Artificial dashboards don't exist in Grafana - they're synthetic entries
 */
export const ARTIFICIAL_DASHBOARD_UID_PREFIXES = [
  'performance-test-metrics-',  // Performance metrics pipeline
  'dynatrace-',                  // Dynatrace host metrics
];

/**
 * Props for the main DashboardsSection component
 */
export interface DashboardsSectionProps {
  testRun: TestRun;
  testRunId: string;
  dashboardsExpanded: boolean;
  onDashboardsExpand: () => void;
  showToast: (message: string) => void;
}

/**
 * Dashboard type returned from API
 */
export interface Dashboard {
  id: string;
  dashboard_label: string;
  dashboard_name: string;
  dashboard_uid: string;
  dashboard_id: number;
  grafana_instance: {
    client_url: string;
  };
  variables?: DashboardVariable[];
  tags?: string[];
}

/**
 * Dashboard variable configuration
 */
export interface DashboardVariable {
  name: string;
  values?: string[];
}

/**
 * State returned by useDashboardsData hook
 */
export interface DashboardsDataState {
  // Data
  dashboards: Dashboard[];
  filteredDashboards: Dashboard[];
  allDashboardTags: string[];

  // Loading states
  dashboardsLoading: boolean;

  // Selection state
  selectedDashboardTags: string[];
  dashboardSearchText: string;
  expandedDashboard: Dashboard | null;

  // Actions
  setSelectedDashboardTags: React.Dispatch<React.SetStateAction<string[]>>;
  setDashboardSearchText: (text: string) => void;
  setExpandedDashboard: (dashboard: Dashboard | null) => void;
  toggleTagSelection: (tag: string) => void;
  handleOpenDashboard: (dashboard: Dashboard) => void;
  handleCloseDashboard: () => void;
  handleDashboardsExpand: (preselectTag?: string) => void;
  loadApplicationDashboards: () => Promise<void>;
  buildGrafanaIframeUrl: (dashboard: Dashboard) => string;
}
