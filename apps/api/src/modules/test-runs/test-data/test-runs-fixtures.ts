import { UpdateRunningTestDto, VariableDto, DeepLinkDto } from '../dto/update-running-test.dto';

export const testRunFixtures = {
  // Complete test run with all optional fields
  completeTestRun: {
    systemUnderTest: 'ecommerce-api',
    workload: 'load-test',
    testEnvironment: 'production',
    testRunId: 'load-test-2024-01-15-14-30-001',
    completed: false,
    version: '1.2.3',
    start: '2024-01-15T14:30:00.000Z',
    end: '2024-01-15T15:00:00.000Z',
    duration: '1800',
    rampUp: '300',
    CIBuildResultsUrl: 'https://jenkins.example.com/build/123/results',
    annotations: 'Performance baseline test for Q1 2024',
    abort: false,
    abortMessage: '',
    tags: ['performance', 'baseline', 'production', 'q1-2024'],
    variables: [
      { placeholder: 'heap.size', value: '4096m' },
      { placeholder: 'thread.count', value: '50' },
      { placeholder: 'connection.pool.size', value: '20' },
      { placeholder: 'timeout.seconds', value: '30' }
    ] as VariableDto[],
    deepLinks: [
      { name: 'Grafana Dashboard', url: 'https://grafana.example.com/dashboard/ecommerce-load-test' },
      { name: 'Application Logs', url: 'https://logs.example.com/app/ecommerce-api?from=2024-01-15T14:30:00Z' },
      { name: 'System Metrics', url: 'https://metrics.example.com/system/ecommerce-prod' },
      { name: 'Database Metrics', url: 'https://db-metrics.example.com/postgres/ecommerce' }
    ] as DeepLinkDto[]
  } as UpdateRunningTestDto,

  // Minimal test run with only required fields
  minimalTestRun: {
    systemUnderTest: 'user-service',
    workload: 'smoke-test',
    testEnvironment: 'development',
    testRunId: 'smoke-test-2024-01-15-10-00-001',
    completed: false
  } as UpdateRunningTestDto,

  // Completed test run
  completedTestRun: {
    systemUnderTest: 'payment-service',
    workload: 'stress-test',
    testEnvironment: 'staging',
    testRunId: 'stress-test-2024-01-15-16-45-001',
    completed: true,
    version: '2.1.0',
    start: '2024-01-15T16:45:00.000Z',
    end: '2024-01-15T18:15:00.000Z',
    duration: '5400',
    rampUp: '600',
    annotations: 'Stress test completed successfully with 95th percentile under 500ms',
    tags: ['stress', 'staging', 'completed'],
    variables: [
      { placeholder: 'max.users', value: '1000' },
      { placeholder: 'ramp.rate', value: '10' }
    ] as VariableDto[]
  } as UpdateRunningTestDto,

  // Aborted test run
  abortedTestRun: {
    systemUnderTest: 'notification-service',
    workload: 'endurance-test',
    testEnvironment: 'production',
    testRunId: 'endurance-test-2024-01-15-20-00-001',
    completed: false,
    version: '1.5.2',
    start: '2024-01-15T20:00:00.000Z',
    duration: '3600',
    rampUp: '300',
    abort: true,
    abortMessage: 'Test was manually aborted due to high error rate (>5%) detected at 1 hour mark',
    annotations: 'Aborted due to system instability - requires investigation',
    tags: ['endurance', 'production', 'aborted', 'investigation-required'],
    variables: [
      { placeholder: 'duration.hours', value: '8' },
      { placeholder: 'steady.users', value: '200' }
    ] as VariableDto[],
    deepLinks: [
      { name: 'Error Dashboard', url: 'https://errors.example.com/notifications/2024-01-15' },
      { name: 'Alert Manager', url: 'https://alerts.example.com/notifications/high-error-rate' }
    ] as DeepLinkDto[]
  } as UpdateRunningTestDto,

  // Test run with CI/CD integration
  ciIntegratedTestRun: {
    systemUnderTest: 'api-gateway',
    workload: 'integration-test',
    testEnvironment: 'staging',
    testRunId: 'integration-test-2024-01-15-12-30-build-456',
    completed: true,
    version: '3.0.0-rc1',
    start: '2024-01-15T12:30:00.000Z',
    end: '2024-01-15T12:45:00.000Z',
    duration: '900',
    rampUp: '60',
    CIBuildResultsUrl: 'https://jenkins.example.com/job/api-gateway-integration/456/',
    annotations: 'Automated integration test triggered by PR #789 merge',
    tags: ['integration', 'ci-cd', 'pr-789', 'automated'],
    variables: [
      { placeholder: 'build.number', value: '456' },
      { placeholder: 'pr.number', value: '789' },
      { placeholder: 'branch.name', value: 'feature/new-auth-flow' }
    ] as VariableDto[],
    deepLinks: [
      { name: 'GitHub PR', url: 'https://github.com/company/api-gateway/pull/789' },
      { name: 'Jenkins Build', url: 'https://jenkins.example.com/job/api-gateway-integration/456/' },
      { name: 'Test Coverage', url: 'https://codecov.example.com/api-gateway/build/456' }
    ] as DeepLinkDto[]
  } as UpdateRunningTestDto,

  // Long-running test
  longRunningTest: {
    systemUnderTest: 'data-pipeline',
    workload: 'volume-test',
    testEnvironment: 'production',
    testRunId: 'volume-test-2024-01-15-08-00-001',
    completed: false,
    version: '4.2.1',
    start: '2024-01-15T08:00:00.000Z',
    duration: '28800', // 8 hours
    rampUp: '1800', // 30 minutes
    annotations: 'Volume test processing 10TB of data - expected runtime 12 hours',
    tags: ['volume', 'production', 'big-data', 'long-running'],
    variables: [
      { placeholder: 'data.volume.tb', value: '10' },
      { placeholder: 'batch.size.mb', value: '100' },
      { placeholder: 'parallel.jobs', value: '8' },
      { placeholder: 'expected.duration.hours', value: '12' }
    ] as VariableDto[],
    deepLinks: [
      { name: 'Data Processing Dashboard', url: 'https://data-ops.example.com/pipeline/volume-test' },
      { name: 'Resource Monitoring', url: 'https://monitoring.example.com/cluster/data-pipeline' },
      { name: 'Job Status', url: 'https://jobs.example.com/volume-test-2024-01-15-08-00-001' }
    ] as DeepLinkDto[]
  } as UpdateRunningTestDto,

  // Test run with complex variables
  complexVariablesTest: {
    systemUnderTest: 'recommendation-engine',
    workload: 'ml-performance-test',
    testEnvironment: 'production',
    testRunId: 'ml-perf-test-2024-01-15-14-00-001',
    completed: true,
    version: '2.3.4',
    start: '2024-01-15T14:00:00.000Z',
    end: '2024-01-15T16:30:00.000Z',
    duration: '9000',
    rampUp: '900',
    annotations: 'ML model performance test with different feature sets and batch sizes',
    tags: ['ml', 'performance', 'feature-testing', 'batch-processing'],
    variables: [
      { placeholder: 'model.version', value: 'v2.3.4-recommendation-enhanced' },
      { placeholder: 'feature.set', value: 'user-behavior,product-attributes,seasonal-trends' },
      { placeholder: 'batch.size', value: '1000' },
      { placeholder: 'inference.timeout.ms', value: '100' },
      { placeholder: 'cache.enabled', value: 'true' },
      { placeholder: 'gpu.memory.gb', value: '16' },
      { placeholder: 'cpu.cores', value: '8' },
      { placeholder: 'model.accuracy.threshold', value: '0.85' }
    ] as VariableDto[]
  } as UpdateRunningTestDto,

  // Edge case: Test run with empty arrays
  testRunWithEmptyArrays: {
    systemUnderTest: 'simple-service',
    workload: 'basic-test',
    testEnvironment: 'development',
    testRunId: 'basic-test-2024-01-15-09-00-001',
    completed: false,
    tags: [],
    variables: [],
    deepLinks: []
  } as UpdateRunningTestDto
};

// Database response fixtures
export const databaseTestRunFixtures = {
  // Expected database record structure
  expectedTestRunRecord: {
    id: expect.any(String),
    test_run_id: 'load-test-2024-01-15-14-30-001',
    system_under_test_id: expect.any(String),
    test_environment: 'production',
    workload: 'load-test',
    start_time: '2024-01-15T14:30:00.000Z',
    end_time: '2024-01-15T15:00:00.000Z',
    duration: 1800,
    planned_duration: 2100,
    ramp_up: 300,
    completed: false,
    abort: false,
    application_release: '1.2.3',
    ci_build_results_url: 'https://jenkins.example.com/build/123/results',
    annotations: ['Performance baseline test for Q1 2024'],
    tags: ['performance', 'baseline', 'production', 'q1-2024'],
    deep_links: [
      { name: 'Grafana Dashboard', url: 'https://grafana.example.com/dashboard/ecommerce-load-test' },
      { name: 'Application Logs', url: 'https://logs.example.com/app/ecommerce-api?from=2024-01-15T14:30:00Z' }
    ],
    created_at: expect.any(String),
    updated_at: expect.any(String)
  },

  // Mock system under test
  mockSystemUnderTest: {
    id: 'sys-1',
    name: 'ecommerce-api',
    description: 'E-commerce API service',
    team_id: 'team-1',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z'
  },

  // Multiple test runs for listing
  multipleTestRuns: [
    {
      id: '1',
      test_run_id: 'load-test-2024-01-15-14-30-001',
      system_under_test_id: 'sys-1',
      test_environment: 'production',
      workload: 'load-test',
      completed: false,
      created_at: '2024-01-15T14:30:00.000Z',
      updated_at: '2024-01-15T14:30:00.000Z',
      systems_under_test: { name: 'ecommerce-api' }
    },
    {
      id: '2',
      test_run_id: 'stress-test-2024-01-15-16-45-001',
      system_under_test_id: 'sys-1',
      test_environment: 'staging',
      workload: 'stress-test',
      completed: true,
      created_at: '2024-01-15T16:45:00.000Z',
      updated_at: '2024-01-15T18:15:00.000Z',
      systems_under_test: { name: 'payment-service' }
    },
    {
      id: '3',
      test_run_id: 'smoke-test-2024-01-15-10-00-001',
      system_under_test_id: 'sys-2',
      test_environment: 'development',
      workload: 'smoke-test',
      completed: true,
      created_at: '2024-01-15T10:00:00.000Z',
      updated_at: '2024-01-15T10:15:00.000Z',
      systems_under_test: { name: 'user-service' }
    }
  ]
};

// Invalid DTOs for validation testing
export const invalidTestRunFixtures = {
  missingSystemUnderTest: {
    workload: 'load-test',
    testEnvironment: 'production',
    testRunId: 'test-001',
    completed: false
  },

  missingWorkload: {
    systemUnderTest: 'ecommerce-api',
    testEnvironment: 'production',
    testRunId: 'test-001',
    completed: false
  },

  missingTestEnvironment: {
    systemUnderTest: 'ecommerce-api',
    workload: 'load-test',
    testRunId: 'test-001',
    completed: false
  },

  missingTestRunId: {
    systemUnderTest: 'ecommerce-api',
    workload: 'load-test',
    testEnvironment: 'production',
    completed: false
  },

  missingCompleted: {
    systemUnderTest: 'ecommerce-api',
    workload: 'load-test',
    testEnvironment: 'production',
    testRunId: 'test-001'
  },

  invalidTypes: {
    systemUnderTest: 123,
    workload: true,
    testEnvironment: [],
    testRunId: 456,
    completed: 'false',
    version: 789,
    start: new Date(),
    end: new Date(),
    duration: 1800,
    rampUp: 300,
    tags: 'not-an-array',
    variables: 'not-an-array',
    deepLinks: 'not-an-array',
    abort: 'true'
  },

  invalidVariables: {
    systemUnderTest: 'ecommerce-api',
    workload: 'load-test',
    testEnvironment: 'production',
    testRunId: 'test-001',
    completed: false,
    variables: [
      { placeholder: 'valid.var', value: 'valid.value' },
      { placeholder: 'missing.value' },
      { value: 'missing.placeholder' },
      { placeholder: 123, value: 'invalid.placeholder.type' },
      { placeholder: 'invalid.value.type', value: 456 }
    ]
  },

  invalidDeepLinks: {
    systemUnderTest: 'ecommerce-api',
    workload: 'load-test',
    testEnvironment: 'production',
    testRunId: 'test-001',
    completed: false,
    deepLinks: [
      { name: 'Valid Link', url: 'https://example.com' },
      { name: 'Missing URL' },
      { url: 'https://example.com/missing-name' },
      { name: 123, url: 'https://example.com/invalid-name-type' },
      { name: 'Invalid URL Type', url: 456 }
    ]
  },

  invalidTags: {
    systemUnderTest: 'ecommerce-api',
    workload: 'load-test',
    testEnvironment: 'production',
    testRunId: 'test-001',
    completed: false,
    tags: ['valid-tag', 123, 'another-valid-tag', true]
  }
};

// Query parameter test cases
export const queryParameterTestCases = {
  validParams: {
    testRunId: 'load-test-2024-01-15-14-30-001',
    system: 'ecommerce-api',
    environment: 'production',
    workload: 'load-test'
  },

  partialParams: {
    testRunId: 'load-test-2024-01-15-14-30-001',
    system: 'ecommerce-api',
    environment: undefined,
    workload: 'load-test'
  },

  emptyParams: {
    testRunId: 'load-test-2024-01-15-14-30-001',
    system: undefined,
    environment: undefined,
    workload: undefined
  },

  uuidParams: {
    testRunId: '123e4567-e89b-12d3-a456-426614174000',
    system: undefined,
    environment: undefined,
    workload: undefined
  }
};

// Duration calculation test cases
export const durationTestCases = {
  withStartAndEnd: {
    updateDto: {
      start: '2024-01-15T14:30:00.000Z',
      end: '2024-01-15T15:00:00.000Z',
      duration: '1800',
      rampUp: '300'
    },
    expectedDuration: 1800,
    expectedPlannedDuration: 2100
  },

  withExistingTestRun: {
    updateDto: {},
    existingTestRun: {
      start_time: new Date(Date.now() - 1800000).toISOString(), // 30 minutes ago
      planned_duration: 3600
    },
    expectedDuration: 1800, // Approximately
    expectedPlannedDuration: 3600
  },

  newTestRunWithoutTimes: {
    updateDto: {},
    existingTestRun: null,
    expectedDuration: 0,
    expectedPlannedDuration: -1
  },

  withDurationOnly: {
    updateDto: {
      duration: '2400',
      rampUp: '600'
    },
    existingTestRun: null,
    expectedDuration: 0,
    expectedPlannedDuration: 3000
  }
};