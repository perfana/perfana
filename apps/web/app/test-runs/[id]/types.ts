/**
 * Types for TestRunDetailsPage
 */

/**
 * Related test run for navigation between test runs
 */
export interface RelatedTestRun {
  test_run_id: string;
  created_at: string;
}

/**
 * Filters for drill-down to distributed tracing or Dynatrace
 */
export interface DrillDownFilters {
  scenario?: string;
  transaction?: string;
  sampler?: string;
}

/**
 * State for all expansion states in the test run details page
 */
export interface ExpansionState {
  expanded: boolean;
  configExpanded: boolean;
  sloExpanded: boolean;
  anomalyExpanded: boolean;
  dashboardsExpanded: boolean;
  trendsExpanded: boolean;
  deepLinksExpanded: boolean;
  dynatraceExpanded: boolean;
  distributedTracingExpanded: boolean;
  pyroscopeExpanded: boolean;
  compareExpanded: boolean;
  performanceExpanded: boolean;
  graphsExpanded: boolean;
  awrExpanded: boolean;
  reportExpanded: boolean;
  eventsExpanded: boolean;
  scalingProgressionExpanded: boolean;
}

/**
 * Anomaly detection tab state
 */
export interface AnomalyState {
  activeTab: number;
  conclusionFilter: string;
}

/**
 * Test run details card editing state
 */
export interface EditingState {
  isEditingTags: boolean;
  editingTags: string[];
  allAvailableTags: string[];
  tagsSaving: boolean;
  isEditingAnnotations: boolean;
  editingAnnotations: string;
  annotationsSaving: boolean;
}

/**
 * Snackbar notification state
 */
export interface SnackbarState {
  open: boolean;
  message: string;
}

/**
 * Configuration status for drill-down options
 */
export interface ConfigurationStatus {
  hasDistributedTracing: boolean;
  hasDynatrace: boolean;
}
