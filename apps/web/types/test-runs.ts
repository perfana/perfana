export interface TestRunStatus {
  phase: 'starting' | 'running' | 'completed' | 'failed' | 'aborted';
  progress?: number;
  message?: string;
  evaluatingChecks?: 'IN_PROGRESS' | 'COMPLETED' | 'ERROR' | 'NOT_CONFIGURED' | 'FAILED';
  evaluatingComparisons?: 'IN_PROGRESS' | 'COMPLETED' | 'ERROR' | 'NOT_CONFIGURED' | 'FAILED';
  evaluatingAdapt?: 'IN_PROGRESS' | 'COMPLETED' | 'NO_BASELINES_FOUND' | 'ERROR' | 'NOT_CONFIGURED' | 'FAILED';
  lastUpdate?: string;
}

export interface ConsolidatedResult {
  passed: boolean;
  score?: number;
  overall?: boolean;
  meetsRequirement?: boolean;
  adaptTestRunOK?: boolean;
  benchmarkBaselineTestRunOK?: boolean;
  benchmarkPreviousTestRunOK?: boolean;
  benchmarkResults?: {
    [key: string]: {
      passed: boolean;
      actualValue: number;
      expectedValue: number;
      operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq';
    };
  };
  checkResults?: {
    [key: string]: {
      passed: boolean;
      message?: string;
    };
  };
}

export interface AdaptConfig {
  enabled: boolean;
  baselineTestRunId?: string;
  benchmarkOperator?: 'lt' | 'lte' | 'gt' | 'gte';
  tolerancePercentage?: number;
  minSampleSize?: number;
}

export interface TestRunVariables {
  [key: string]: string | number | boolean;
}

export interface DeepLinks {
  grafana?: string[];
  dynatrace?: string[];
  elastic?: string[];
  custom?: {
    name: string;
    url: string;
  }[];
}

export interface PyroscopeInstance {
  id: string;
  label: string;
  pyroscopeUrl: string;
  backendUrl?: string;
  pyroscopeStandAlone: boolean;
}

export interface PyroscopeConfiguration {
  application: string;
  profiler: string;
}

export interface TracingService {
  id: string;
  system_under_test_id: string;
  test_environment?: string;
  workload?: string;
  tracing_url: string;
  tracing_ui: 'tempo' | 'jaeger' | 'elastic';
  tracing_iframe_allowed: boolean;
  trace_request_name_panel_description?: string;
}

export interface SystemUnderTest {
  id?: string;
  name: string;
  description?: string;
  team_id?: string | null;
  organization_id?: string | null;
  tracing_service?: string;
  pyroscope_instance_id?: string;
  pyroscope_configurations?: PyroscopeConfiguration[];
  pyroscopeInstance?: PyroscopeInstance;
  team?: {
    id: string;
    name: string;
  };
}

export interface TestRun {
  id: string;
  test_run_id: string;
  system_under_test_id: string;
  test_environment: string;
  workload: string;
  start_time?: string;
  end_time?: string;
  duration?: number;
  planned_duration?: number;
  ramp_up?: number;
  completed: boolean;
  abort?: boolean;
  is_stale?: boolean;
  stale_detected_at?: string;
  completion_percentage?: number;
  status?: TestRunStatus;
  consolidated_result?: ConsolidatedResult;
  annotations?: string[];
  tags?: string[];
  application_release?: string;
  ci_build_results_url?: string;
  expires?: string;
  expired?: boolean;
  valid?: boolean;
  reasons_not_valid?: string[];
  adapt_config?: AdaptConfig;
  variables?: TestRunVariables;
  deep_links?: DeepLinks;
  created_at: string;
  updated_at: string;
  systems_under_test?: SystemUnderTest;
  system_under_test?: SystemUnderTest;
  tracing_services?: TracingService[];
  is_changepoint?: boolean;
  is_control_group?: boolean;
}