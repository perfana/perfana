import { TestRun, SystemUnderTest, ConsolidatedResult, AdaptConfig, DeepLinks } from '@/types/test-runs';
import { FilterState, FilterOptions } from '../types';

/**
 * The camelCase shape a test run arrives in over the websocket. REST returns
 * the snake_case `TestRun`; real-time events carry the entity property names.
 * Every field is optional because only the changed ones are guaranteed.
 */
type CamelCaseTestRun = {
  testRunId?: string;
  testEnvironment?: string;
  systemUnderTestId?: string;
  startTime?: string;
  endTime?: string;
  plannedDuration?: number;
  analysisStartOffset?: number;
  consolidatedResult?: ConsolidatedResult;
  applicationRelease?: string;
  ciBuildResultsUrl?: string;
  deepLinks?: DeepLinks;
  createdAt?: string;
  updatedAt?: string;
  reasonsNotValid?: string[];
  dataWarnings?: string[];
  adaptConfig?: AdaptConfig;
  isChangepoint?: boolean;
  isControlGroup?: boolean;
  systemUnderTest?: SystemUnderTest;
};

/** A test run as received, which may carry either casing. */
type MaybeCamelTestRun = TestRun & Partial<CamelCaseTestRun>;

/**
 * Normalize a test run from camelCase to snake_case format
 * This is needed because real-time events may use camelCase
 */
export function normalizeTestRun(testRun: TestRun): TestRun {
  const rawTestRun = testRun as MaybeCamelTestRun;
  return {
    ...testRun,
    test_run_id: rawTestRun.testRunId || testRun.test_run_id,
    test_environment: rawTestRun.testEnvironment || testRun.test_environment,
    system_under_test_id: rawTestRun.systemUnderTestId || testRun.system_under_test_id,
    start_time: rawTestRun.startTime || testRun.start_time,
    end_time: rawTestRun.endTime || testRun.end_time,
    planned_duration: rawTestRun.plannedDuration || testRun.planned_duration,
    analysis_start_offset: rawTestRun.analysisStartOffset || testRun.analysis_start_offset,
    consolidated_result: rawTestRun.consolidatedResult || testRun.consolidated_result,
    application_release: rawTestRun.applicationRelease || testRun.application_release,
    ci_build_results_url: rawTestRun.ciBuildResultsUrl || testRun.ci_build_results_url,
    deep_links: rawTestRun.deepLinks || testRun.deep_links,
    created_at: rawTestRun.createdAt || testRun.created_at,
    updated_at: rawTestRun.updatedAt || testRun.updated_at,
    reasons_not_valid: rawTestRun.reasonsNotValid || testRun.reasons_not_valid,
    data_warnings: rawTestRun.dataWarnings || testRun.data_warnings,
    adapt_config: rawTestRun.adaptConfig || testRun.adapt_config,
    is_changepoint: rawTestRun.isChangepoint || testRun.is_changepoint,
    is_control_group: rawTestRun.isControlGroup || testRun.is_control_group,
    systems_under_test: rawTestRun.systemUnderTest || testRun.systems_under_test,
  };
}

/**
 * Extract system name from a test run (supports both camelCase and snake_case)
 */
export function getSystemName(testRun: TestRun): string | undefined {
  return (testRun as MaybeCamelTestRun).systemUnderTest?.name || testRun.systems_under_test?.name;
}

/**
 * Extract environment from a test run (supports both camelCase and snake_case)
 */
export function getEnvironment(testRun: TestRun): string | undefined {
  return (testRun as MaybeCamelTestRun).testEnvironment || testRun.test_environment;
}

/**
 * Filter test runs based on filter state
 */
export function filterTestRuns(testRuns: TestRun[], filters: FilterState): TestRun[] {
  return testRuns.filter(testRun => {
    const systemName = getSystemName(testRun);
    const environment = getEnvironment(testRun);
    const workload = testRun.workload;

    const systemMatch = !filters.system || systemName === filters.system;
    const environmentMatch = !filters.environment || environment === filters.environment;
    const workloadMatch = !filters.workload || workload === filters.workload;

    return systemMatch && environmentMatch && workloadMatch;
  });
}

/**
 * Sort test runs by end time (most recent first)
 */
export function sortTestRunsByEndTime(testRuns: TestRun[]): TestRun[] {
  return [...testRuns].sort((a, b) => {
    // Either casing may be absent; an unfinished run sorts as epoch 0.
    const aEnd = (a as MaybeCamelTestRun).endTime || a.end_time;
    const bEnd = (b as MaybeCamelTestRun).endTime || b.end_time;
    const aTime = aEnd ? new Date(aEnd).getTime() : 0;
    const bTime = bEnd ? new Date(bEnd).getTime() : 0;
    return bTime - aTime;
  });
}

/**
 * Separate running and completed test runs
 */
export function separateTestRuns(testRuns: TestRun[]): {
  running: TestRun[];
  completed: TestRun[];
} {
  const running = testRuns.filter(testRun => !testRun.completed && !testRun.abort);
  const completed = testRuns.filter(testRun => testRun.completed || testRun.abort);
  return { running, completed };
}

/**
 * Extract filter options from test runs
 */
export function extractFilterOptions(
  testRuns: TestRun[],
  filters: FilterState
): FilterOptions {
  // Systems: filter by environment and workload
  const systemsFiltered = testRuns.filter(run => {
    const environment = getEnvironment(run);
    const environmentMatch = !filters.environment || environment === filters.environment;
    const workloadMatch = !filters.workload || run.workload === filters.workload;
    return environmentMatch && workloadMatch;
  });
  const systems = Array.from(new Set(
    systemsFiltered.map(run => getSystemName(run)).filter(Boolean)
  )) as string[];

  // Environments: filter by system and workload
  const environmentsFiltered = testRuns.filter(run => {
    const systemName = getSystemName(run);
    const systemMatch = !filters.system || systemName === filters.system;
    const workloadMatch = !filters.workload || run.workload === filters.workload;
    return systemMatch && workloadMatch;
  });
  const environments = Array.from(new Set(
    environmentsFiltered.map(run => getEnvironment(run)).filter(Boolean)
  )) as string[];

  // Workloads: filter by system and environment
  const workloadsFiltered = testRuns.filter(run => {
    const systemName = getSystemName(run);
    const environment = getEnvironment(run);
    const systemMatch = !filters.system || systemName === filters.system;
    const environmentMatch = !filters.environment || environment === filters.environment;
    return systemMatch && environmentMatch;
  });
  const workloads = Array.from(new Set(
    workloadsFiltered.map(run => run.workload).filter(Boolean)
  )) as string[];

  return { systems, environments, workloads };
}

/**
 * Check if all test runs share the same scope (system, environment, workload)
 */
export function allSameScope(runs: TestRun[]): boolean {
  if (runs.length <= 1) return true;

  const first = runs[0];
  const firstSystem = getSystemName(first);
  const firstEnv = getEnvironment(first);
  const firstWorkload = first.workload;

  return runs.every(run => {
    const system = getSystemName(run);
    const env = getEnvironment(run);
    return system === firstSystem && env === firstEnv && run.workload === firstWorkload;
  });
}

/**
 * Build URL search params from filters
 */
export function buildFilterParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.system) params.set('system', filters.system);
  if (filters.environment) params.set('environment', filters.environment);
  if (filters.workload) params.set('workload', filters.workload);
  return params;
}

/**
 * Parse filters from URL search params
 */
export function parseFiltersFromParams(searchParams: URLSearchParams): FilterState {
  return {
    system: searchParams.get('system') || '',
    environment: searchParams.get('environment') || '',
    workload: searchParams.get('workload') || '',
  };
}
