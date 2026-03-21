import { TestRun } from '@/types/test-runs';

/**
 * Dynatrace configuration from the backend
 * Note: This should match @/lib/dynatrace DynatraceConfig
 */
export interface DynatraceConfig {
  id: string;
  host: string;
  apiToken: string;
  dynatraceType: 'saas' | 'managed';
  label: string;
  platformApiToken?: string;
  perfanaTestRunIdAttribute?: string;
  perfanaRequestNameAttribute?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Dynatrace entity from the API
 */
export interface DynatraceEntity {
  entityId: string;
  displayName: string;
  type: string;
  tags?: Array<{
    key: string;
    value: string;
  }>;
}

/**
 * Dynatrace entity mapping with system context
 */
export interface DynatraceEntityMapping {
  id: string;
  entityId: string;
  entityDisplayName: string;
  entityType: string;
  systemUnderTestId: string;
  testEnvironment?: string;
  workload?: string;
  level: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Related test run for comparison features
 */
export interface RelatedTestRun {
  test_run_id: string;
  created_at: string;
  completed: boolean;
  application_release?: string;
  start_time?: string;
  annotations?: string[];
}

/**
 * Drill-down filters for navigation
 */
export interface DrillDownFilters {
  scenario?: string;
  transaction?: string;
  sampler?: string;
}

/**
 * Props for the DynatraceCard component
 */
export interface DynatraceCardProps {
  testRun: TestRun;
  expanded: boolean;
  onExpand: () => void;
  initialFilters?: DrillDownFilters;
  onConfigurationStatus?: (hasConfiguration: boolean) => void;
}

/**
 * Props for TabPanel component
 */
export interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

/**
 * Filter state for request name hierarchy
 */
export interface FilterState {
  selectedScenario: string | null;
  selectedTransaction: string | null;
  selectedSampler: string | null;
  minDuration: string;
  maxDuration: string;
}

/**
 * Derived filter options from metric names
 */
export interface FilterOptions {
  scenarios: string[];
  transactions: string[];
  samplers: string[];
  selectedMetric: string | null;
  isFullFilterSelected: boolean;
}

/**
 * Multidimensional analysis item configuration
 */
export interface AnalysisItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ sx?: object }>;
  description: string;
}

/**
 * Deep link item configuration
 */
export interface DeepLinkItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ sx?: object }>;
  description: string;
}
