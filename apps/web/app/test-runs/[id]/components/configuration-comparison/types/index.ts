import { TestRun } from '@/types/test-runs';

/**
 * Props for the ConfigurationComparisonSection component
 */
export interface ConfigurationComparisonSectionProps {
  testRun: TestRun | null;
  testRunId: string;
  configExpanded: boolean;
  onConfigExpand: () => void;
  showToast: (message: string) => void;
}

/**
 * Represents a configuration key-value pair with tags
 */
export interface ConfigItem {
  key: string;
  value: string;
  tags: string[];
}

/**
 * Represents a test run related to the current test run
 */
export interface RelatedTestRun {
  test_run_id: string;
  created_at: string;
  application_release?: string;
  start_time?: string;
  annotations?: string[];
  completed: boolean;
}

/**
 * Represents an expected configuration change that should be ignored
 */
export interface ExpectedConfigChange {
  id: string;
  config_key: string;
  reason?: string;
}

/**
 * Configuration comparison status types
 */
export type ConfigComparisonStatus = 'changed' | 'expected' | 'new' | 'removed' | 'same';

/**
 * Represents a comparison between current and previous configuration values
 */
export interface ConfigComparison {
  key: string;
  currentValue: string | null;
  currentTags: string[] | null;
  previousValue: string | null;
  previousTags: string[] | null;
  status: ConfigComparisonStatus;
  isExpected: boolean;
}

/**
 * Status filter options for the configuration comparison table
 */
export const STATUS_FILTER_OPTIONS = [
  { value: 'changed', label: 'Changes', color: 'warning' as const },
  { value: 'expected', label: 'Ignored Changes', color: 'info' as const },
  { value: 'new', label: 'New', color: 'success' as const },
  { value: 'removed', label: 'Removed', color: 'error' as const },
  { value: 'same', label: 'Unchanged', color: 'default' as const },
] as const;

export type StatusFilterOption = typeof STATUS_FILTER_OPTIONS[number];

/**
 * Props for the ConfigDiffTable component
 */
export interface ConfigDiffTableProps {
  comparisons: ConfigComparison[];
  selectedRelatedTestRun: string;
  testRunConfigs: ConfigItem[];
  expectedChangesLoading: boolean;
  onToggleExpectedChange: (configKey: string, isExpected: boolean) => void;
}

/**
 * Props for the useConfigComparison hook
 */
export interface UseConfigComparisonProps {
  testRun: TestRun | null;
  testRunId: string;
  configExpanded: boolean;
  showToast: (message: string) => void;
}
