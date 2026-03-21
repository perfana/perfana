import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TestRunsMetricsService } from './test-runs-metrics.service';
import {
  TestRun as TestRunEntity,
  SystemUnderTest as SystemEntity,
  DsCompareConfig,
  ProvisionedTemplateDsCompareConfig,
  ApplicationDashboard,
} from '../../../entities';
import { createMockRepository, MockRepository } from '../../../../test/helpers/mock-repository.factory';
import { createAuthorizationServiceMock } from '../../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../../common/services/authorization.service';

describe('TestRunsMetricsService', () => {
  let service: TestRunsMetricsService;
  let templateRepo: MockRepository<ProvisionedTemplateDsCompareConfig>;
  let compareConfigRepo: MockRepository<DsCompareConfig>;
  let applicationDashboardRepo: MockRepository<ApplicationDashboard>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunsMetricsService,
        { provide: getRepositoryToken(TestRunEntity), useValue: createMockRepository() },
        { provide: getRepositoryToken(SystemEntity), useValue: createMockRepository() },
        { provide: getRepositoryToken(DsCompareConfig), useValue: createMockRepository() },
        { provide: getRepositoryToken(ProvisionedTemplateDsCompareConfig), useValue: createMockRepository() },
        { provide: getRepositoryToken(ApplicationDashboard), useValue: createMockRepository() },
        { provide: AuthorizationService, useValue: createAuthorizationServiceMock() },
      ],
    }).compile();

    service = module.get<TestRunsMetricsService>(TestRunsMetricsService);
    templateRepo = module.get(getRepositoryToken(ProvisionedTemplateDsCompareConfig));
    compareConfigRepo = module.get(getRepositoryToken(DsCompareConfig));
    applicationDashboardRepo = module.get(getRepositoryToken(ApplicationDashboard));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('applyGoldenPathClassifications', () => {
    const testRunInput = {
      systemUnderTestId: 'sut-uuid-1',
      testEnvironment: 'production',
      workload: 'loadTest',
    };

    it('should return zero when no application dashboards exist', async () => {
      applicationDashboardRepo.find.mockResolvedValue([]);

      const result = await service.applyGoldenPathClassifications(testRunInput);

      expect(result).toEqual({ compareConfigsCreated: 0 });
      expect(templateRepo.find).not.toHaveBeenCalled();
    });

    it('should return zero when no golden-path templates exist', async () => {
      applicationDashboardRepo.find.mockResolvedValue([
        { id: 'dash-1', systemUnderTestId: 'sut-uuid-1', testEnvironment: 'production', dashboardUid: 'gatling-overview-influxdb' },
      ]);
      templateRepo.find.mockResolvedValue([]);

      const result = await service.applyGoldenPathClassifications(testRunInput);

      expect(result).toEqual({ compareConfigsCreated: 0 });
    });

    it('should create compare config with correct config_data schema for matching template', async () => {
      const dashboard = {
        id: 'dash-1',
        systemUnderTestId: 'sut-uuid-1',
        testEnvironment: 'production',
        dashboardUid: 'gatling-overview-influxdb',
      };
      const template = {
        id: 'tmpl-1',
        system_under_test_id: null,
        dashboard_uid: 'gatling-overview-influxdb',
        dashboard_label: 'Gatling',
        panel_id: 6,
        panel_title: 'Passed requests per second',
        metric_classification: 'RED_rate',
        higher_is_better: true,
        regex: false,
        config_overrides: null,
      };

      applicationDashboardRepo.find.mockResolvedValue([dashboard]);
      templateRepo.find.mockResolvedValue([template]);
      compareConfigRepo.findOne.mockResolvedValue(null);
      compareConfigRepo.create.mockImplementation((data) => data as any);
      compareConfigRepo.save.mockImplementation((data) => Promise.resolve({ id: 'new-cfg-1', ...data } as any));

      const result = await service.applyGoldenPathClassifications(testRunInput);

      expect(result).toEqual({ compareConfigsCreated: 1 });

      // Verify config_data matches actual DB schema
      expect(compareConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          system_under_test_id: 'sut-uuid-1',
          test_environment: 'production',
          workload: 'loadTest',
          application_dashboard_id: 'dash-1',
          panel_id: 6,
          config_data: {
            thresholds: {
              aggregation: 'mean',
              iqrThreshold: 2,
              absoluteThreshold: null,
              percentageThreshold: 0.15,
            },
            metricClassification: {
              classification: 'RED_rate',
              higherIsBetter: true,
            },
            defaultValueIfControlGroupMissing: 0,
          },
          created_by: 'system:golden-path',
        }),
      );
    });

    it('should apply absThreshold override from golden path', async () => {
      const dashboard = {
        id: 'dash-1',
        systemUnderTestId: 'sut-uuid-1',
        testEnvironment: 'production',
        dashboardUid: 'gatling-overview-influxdb',
      };
      const template = {
        id: 'tmpl-3',
        system_under_test_id: null,
        dashboard_uid: 'gatling-overview-influxdb',
        panel_id: 52,
        metric_classification: 'RED_duration',
        higher_is_better: false,
        regex: false,
        config_overrides: { absThreshold: 25 },
      };

      applicationDashboardRepo.find.mockResolvedValue([dashboard]);
      templateRepo.find.mockResolvedValue([template]);
      compareConfigRepo.findOne.mockResolvedValue(null);
      compareConfigRepo.create.mockImplementation((data) => data as any);
      compareConfigRepo.save.mockImplementation((data) => Promise.resolve({ id: 'new-cfg-3', ...data } as any));

      await service.applyGoldenPathClassifications(testRunInput);

      expect(compareConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          config_data: expect.objectContaining({
            thresholds: expect.objectContaining({
              absoluteThreshold: 25,
            }),
          }),
        }),
      );
    });

    it('should apply ignore and ignoreMeanDiffSmallerThan overrides', async () => {
      const dashboard = {
        id: 'dash-1',
        systemUnderTestId: 'sut-uuid-1',
        testEnvironment: 'production',
        dashboardUid: 'spring-boot-kubernetes-hickari-cp-mimir',
      };
      const template = {
        id: 'tmpl-2',
        system_under_test_id: null,
        dashboard_uid: 'spring-boot-kubernetes-hickari-cp-mimir',
        panel_id: 23,
        metric_classification: 'USE_utilization',
        higher_is_better: false,
        regex: false,
        config_overrides: {
          ignore: true,
          ignoreMeanDiffSmallerThan: 10,
        },
      };

      applicationDashboardRepo.find.mockResolvedValue([dashboard]);
      templateRepo.find.mockResolvedValue([template]);
      compareConfigRepo.findOne.mockResolvedValue(null);
      compareConfigRepo.create.mockImplementation((data) => data as any);
      compareConfigRepo.save.mockImplementation((data) => Promise.resolve({ id: 'new-cfg-2', ...data } as any));

      await service.applyGoldenPathClassifications(testRunInput);

      expect(compareConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          config_data: expect.objectContaining({
            ignore: true,
            ignoreMeanDiffSmallerThan: 10,
          }),
        }),
      );
    });

    it('should skip creating config when it already exists', async () => {
      const dashboard = {
        id: 'dash-1',
        systemUnderTestId: 'sut-uuid-1',
        testEnvironment: 'production',
        dashboardUid: 'gatling-overview-influxdb',
      };
      const template = {
        id: 'tmpl-1',
        system_under_test_id: null,
        dashboard_uid: 'gatling-overview-influxdb',
        panel_id: 6,
        metric_classification: 'RED_rate',
        higher_is_better: true,
        regex: false,
        config_overrides: null,
      };

      applicationDashboardRepo.find.mockResolvedValue([dashboard]);
      templateRepo.find.mockResolvedValue([template]);
      compareConfigRepo.findOne.mockResolvedValue({ id: 'existing-cfg' } as any);

      const result = await service.applyGoldenPathClassifications(testRunInput);

      expect(result).toEqual({ compareConfigsCreated: 0 });
      expect(compareConfigRepo.create).not.toHaveBeenCalled();
    });

    it('should skip dashboards without a dashboardUid', async () => {
      applicationDashboardRepo.find.mockResolvedValue([
        { id: 'dash-1', systemUnderTestId: 'sut-uuid-1', testEnvironment: 'production', dashboardUid: null },
      ]);
      templateRepo.find.mockResolvedValue([
        { id: 'tmpl-1', system_under_test_id: null, dashboard_uid: 'some-uid', panel_id: 1, regex: false },
      ]);

      const result = await service.applyGoldenPathClassifications(testRunInput);

      expect(result).toEqual({ compareConfigsCreated: 0 });
    });

    it('should handle multiple dashboards and templates', async () => {
      const dashboards = [
        { id: 'dash-1', systemUnderTestId: 'sut-uuid-1', testEnvironment: 'production', dashboardUid: 'gatling-overview-influxdb' },
        { id: 'dash-2', systemUnderTestId: 'sut-uuid-1', testEnvironment: 'production', dashboardUid: 'spring-boot-kubernetes-jvm-mimir' },
      ];
      const templates = [
        { id: 'tmpl-1', system_under_test_id: null, dashboard_uid: 'gatling-overview-influxdb', panel_id: 6, metric_classification: 'RED_rate', higher_is_better: true, regex: false, config_overrides: null },
        { id: 'tmpl-2', system_under_test_id: null, dashboard_uid: 'gatling-overview-influxdb', panel_id: 38, metric_classification: 'RED_rate', higher_is_better: true, regex: false, config_overrides: null },
        { id: 'tmpl-3', system_under_test_id: null, dashboard_uid: 'spring-boot-kubernetes-jvm-mimir', panel_id: 32, metric_classification: 'USE_utilization', higher_is_better: false, regex: false, config_overrides: null },
      ];

      applicationDashboardRepo.find.mockResolvedValue(dashboards);
      templateRepo.find.mockResolvedValue(templates);
      compareConfigRepo.findOne.mockResolvedValue(null);
      compareConfigRepo.create.mockImplementation((data) => data as any);
      compareConfigRepo.save.mockImplementation((data) => Promise.resolve({ id: 'new-id', ...data } as any));

      const result = await service.applyGoldenPathClassifications(testRunInput);

      expect(result).toEqual({ compareConfigsCreated: 3 });
    });

    it('should embed classification in metricClassification field of config_data', async () => {
      const dashboard = {
        id: 'dash-1',
        systemUnderTestId: 'sut-uuid-1',
        testEnvironment: 'production',
        dashboardUid: 'loki',
      };
      const template = {
        id: 'tmpl-loki',
        system_under_test_id: null,
        dashboard_uid: 'loki',
        panel_id: 1,
        metric_classification: 'USE_errors',
        higher_is_better: false,
        regex: false,
        config_overrides: null,
      };

      applicationDashboardRepo.find.mockResolvedValue([dashboard]);
      templateRepo.find.mockResolvedValue([template]);
      compareConfigRepo.findOne.mockResolvedValue(null);
      compareConfigRepo.create.mockImplementation((data) => data as any);
      compareConfigRepo.save.mockImplementation((data) => Promise.resolve({ id: 'new-cfg', ...data } as any));

      await service.applyGoldenPathClassifications(testRunInput);

      const createdArg = compareConfigRepo.create.mock.calls[0][0] as any;
      expect(createdArg.config_data.metricClassification).toEqual({
        classification: 'USE_errors',
        higherIsBetter: false,
      });
      expect(createdArg.config_data.thresholds).toEqual({
        aggregation: 'mean',
        iqrThreshold: 2,
        absoluteThreshold: null,
        percentageThreshold: 0.15,
      });
      expect(createdArg.config_data.defaultValueIfControlGroupMissing).toBe(0);
    });
  });
});
