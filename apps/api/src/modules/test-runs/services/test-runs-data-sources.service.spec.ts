import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TestRunsDataSourcesService } from './test-runs-data-sources.service';
import {
  TestRun,
  SystemUnderTest,
  TracingService,
  PyroscopeInstance,
  ApplicationDashboard,
  MetricsSource,
  DynatraceConfig,
  DsMetricStatistics,
} from '../../../entities';
import { TempoService } from '../../tempo/tempo.service';
import { createMockRepository } from '../../../../test/helpers/mock-repository.factory';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SUT_ID = 'sut-uuid-1';
const TEST_RUN_UUID = 'tr-uuid-1';
const DT_CONFIG_ID = 'dt-cfg-uuid-1';
const METRICS_SOURCE_ID = 'ms-uuid-1';

function makeSut(overrides: Partial<SystemUnderTest> = {}): SystemUnderTest {
  return { id: SUT_ID, name: 'afterburner', ...overrides } as SystemUnderTest;
}

function makeTestRun(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: TEST_RUN_UUID,
    testRunId: 'afterburner-acc-loadtest-001',
    systemUnderTestId: SUT_ID,
    testEnvironment: 'acc',
    workload: 'loadTest',
    systemUnderTest: makeSut(),
    ...overrides,
  } as unknown as TestRun;
}

function makeDynatraceConfig(overrides: Partial<DynatraceConfig> = {}): DynatraceConfig {
  return {
    id: DT_CONFIG_ID,
    label: 'Demo Dynatrace',
    host: 'http://localhost:8061',
    dynatraceType: 'saas',
    ...overrides,
  } as DynatraceConfig;
}

function makeMetricsSource(overrides: Partial<MetricsSource> = {}): MetricsSource {
  return {
    id: METRICS_SOURCE_ID,
    systemUnderTestId: SUT_ID,
    testEnvironment: 'acc',
    workload: 'loadTest',
    sourceType: 'dynatrace',
    sourceConfigId: DT_CONFIG_ID,
    externalRef: DT_CONFIG_ID,
    displayName: 'Demo Dynatrace',
    displayLabel: 'loadTest',
    ...overrides,
  } as MetricsSource;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TestRunsDataSourcesService — getConnectedSources (Dynatrace)', () => {
  let service: TestRunsDataSourcesService;

  const testRunRepo = createMockRepository<TestRun>();
  const tracingServiceRepo = createMockRepository<TracingService>();
  const pyroscopeInstanceRepo = createMockRepository<PyroscopeInstance>();
  const appDashboardRepo = createMockRepository<ApplicationDashboard>();
  const metricsSourceRepo = createMockRepository<MetricsSource>();
  const dynatraceConfigRepo = createMockRepository<DynatraceConfig>();
  const metricStatisticsRepo = createMockRepository<DsMetricStatistics>();
  const tempoService = { searchTraces: jest.fn(), getTrace: jest.fn() } as unknown as TempoService;

  beforeEach(async () => {
    jest.clearAllMocks();

    tracingServiceRepo.find.mockResolvedValue([]);
    appDashboardRepo.find.mockResolvedValue([]);
    pyroscopeInstanceRepo.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsDataSourcesService,
        { provide: getRepositoryToken(TestRun), useValue: testRunRepo },
        { provide: getRepositoryToken(TracingService), useValue: tracingServiceRepo },
        { provide: getRepositoryToken(PyroscopeInstance), useValue: pyroscopeInstanceRepo },
        { provide: getRepositoryToken(ApplicationDashboard), useValue: appDashboardRepo },
        { provide: getRepositoryToken(MetricsSource), useValue: metricsSourceRepo },
        { provide: getRepositoryToken(DynatraceConfig), useValue: dynatraceConfigRepo },
        { provide: getRepositoryToken(DsMetricStatistics), useValue: metricStatisticsRepo },
        { provide: TempoService, useValue: tempoService },
      ],
    }).compile();

    service = module.get(TestRunsDataSourcesService);
  });

  it('returns dynatrace.available: true when a MetricsSource row exists for the SUT/env/workload', async () => {
    testRunRepo.findOne.mockResolvedValue(makeTestRun());
    metricsSourceRepo.find.mockResolvedValue([makeMetricsSource()]);
    dynatraceConfigRepo.findOne.mockResolvedValue(makeDynatraceConfig());

    const result = await service.getConnectedSources(TEST_RUN_UUID, 'user-1', []);

    expect(result.dynatrace.available).toBe(true);
    expect(result.dynatrace.configs).toHaveLength(1);
    expect(result.dynatrace.configs[0]).toEqual({
      id: DT_CONFIG_ID,
      label: 'Demo Dynatrace',
      host: 'http://localhost:8061',
    });
  });

  it('returns dynatrace.available: false when no MetricsSource rows exist for the SUT', async () => {
    testRunRepo.findOne.mockResolvedValue(makeTestRun());
    metricsSourceRepo.find.mockResolvedValue([]);

    const result = await service.getConnectedSources(TEST_RUN_UUID, 'user-1', []);

    expect(result.dynatrace.available).toBe(false);
    expect(result.dynatrace.configs).toHaveLength(0);
  });

  it('deduplicates configs when multiple MetricsSource rows share the same sourceConfigId', async () => {
    testRunRepo.findOne.mockResolvedValue(makeTestRun());
    metricsSourceRepo.find.mockResolvedValue([
      makeMetricsSource({ id: 'ms-1' }),
      makeMetricsSource({ id: 'ms-2' }),
    ]);
    dynatraceConfigRepo.findOne.mockResolvedValue(makeDynatraceConfig());

    const result = await service.getConnectedSources(TEST_RUN_UUID, 'user-1', []);

    expect(result.dynatrace.configs).toHaveLength(1);
    expect(dynatraceConfigRepo.findOne).toHaveBeenCalledTimes(1);
  });

  it('queries metrics_sources by SUT id, environment, workload, and source_type=dynatrace', async () => {
    testRunRepo.findOne.mockResolvedValue(makeTestRun({ testEnvironment: 'prod', workload: 'stress' }));
    metricsSourceRepo.find.mockResolvedValue([]);

    await service.getConnectedSources(TEST_RUN_UUID, 'user-1', []);

    expect(metricsSourceRepo.find).toHaveBeenCalledWith({
      where: {
        systemUnderTestId: SUT_ID,
        testEnvironment: 'prod',
        workload: 'stress',
        sourceType: 'dynatrace',
      },
    });
  });
});
