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
import { AuditService } from '../../audit/audit.service';

describe('TestRunsMetricsService', () => {
  let service: TestRunsMetricsService;
  let systemRepo: MockRepository<SystemEntity>;
  let templateRepo: MockRepository<ProvisionedTemplateDsCompareConfig>;
  let compareConfigRepo: MockRepository<DsCompareConfig>;
  let applicationDashboardRepo: MockRepository<ApplicationDashboard>;
  let auditService: jest.Mocked<AuditService>;

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
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TestRunsMetricsService>(TestRunsMetricsService);
    systemRepo = module.get(getRepositoryToken(SystemEntity));
    templateRepo = module.get(getRepositoryToken(ProvisionedTemplateDsCompareConfig));
    compareConfigRepo = module.get(getRepositoryToken(DsCompareConfig));
    applicationDashboardRepo = module.get(getRepositoryToken(ApplicationDashboard));
    auditService = module.get(AuditService);
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

  // -----------------------------------------------------------------
  // Phase 5a (PR13) — audit-logging invariants
  // -----------------------------------------------------------------
  describe('audit logging (Phase 5a, PR13)', () => {
    const orgId = 'org-cmp-1';
    const dsCompareConfig: DsCompareConfig = {
      id: 'cmp-1',
      system_under_test_id: 'sut-1',
      test_environment: 'production',
      workload: 'loadTest',
      application_dashboard_id: 'ad-1',
      panel_id: 5,
      metric_name: 'p95',
      metrics_source_id: 'ms-1',
      config_data: { thresholds: { iqr: 2 } },
      organization_id: orgId,
      created_at: new Date('2026-05-03T10:00:00Z'),
      updated_at: new Date('2026-05-03T10:00:00Z'),
      last_modified_at: new Date('2026-05-03T10:00:00Z'),
    } as DsCompareConfig;

    const buildSystemQuery = (sutId: string | null) => ({
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(sutId ? { id: sutId } : null),
    });

    it('logs CREATE on the new-config branch of createOrUpdateDsCompareConfig', async () => {
      systemRepo.createQueryBuilder.mockReturnValue(buildSystemQuery('sut-1') as any);
      applicationDashboardRepo.findOne.mockResolvedValue({ id: 'ad-1' } as ApplicationDashboard);
      // First lookup (existing config) — returns null on both metric-specific and panel-level branches
      compareConfigRepo.findOne.mockResolvedValue(null);
      compareConfigRepo.create.mockReturnValue(dsCompareConfig);
      compareConfigRepo.save.mockResolvedValue(dsCompareConfig);

      await service.createOrUpdateDsCompareConfig(
        {
          systemUnderTestId: 'sut-1',
          testEnvironment: 'production',
          workload: 'loadTest',
          applicationDashboardId: 'ad-1',
          panelId: '5',
          metricName: 'p95',
          configData: { thresholds: { iqr: 2 } },
        } as never,
        'user-1',
        true,
      );

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(dsCompareConfig);
    });

    it('logs UPDATE on updateDsCompareConfig with cloned before-snapshot', async () => {
      systemRepo.createQueryBuilder.mockReturnValue(buildSystemQuery('sut-1') as any);
      const after = { ...dsCompareConfig, config_data: { thresholds: { iqr: 3 } } } as DsCompareConfig;
      compareConfigRepo.findOne
        .mockResolvedValueOnce(dsCompareConfig) // existing for access check
        .mockResolvedValueOnce(after); // refetch after update
      compareConfigRepo.update.mockResolvedValue({} as never);

      await service.updateDsCompareConfig('cmp-1', { configData: { thresholds: { iqr: 3 } } } as never, 'user-1', true);

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [beforeArg, afterArg] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      expect(beforeArg).toEqual(expect.objectContaining({ id: 'cmp-1', config_data: { thresholds: { iqr: 2 } } }));
      expect(afterArg).toEqual(expect.objectContaining({ id: 'cmp-1', config_data: { thresholds: { iqr: 3 } } }));
    });

    it('logs DELETE before repository.delete on deleteDsCompareConfig', async () => {
      systemRepo.createQueryBuilder.mockReturnValue(buildSystemQuery('sut-1') as any);
      compareConfigRepo.findOne.mockResolvedValue(dsCompareConfig);
      compareConfigRepo.delete.mockResolvedValue({ affected: 1 } as never);

      await service.deleteDsCompareConfig('cmp-1', 'user-1', true);

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      expect(auditService.logDelete).toHaveBeenCalledWith(dsCompareConfig);
      expect(
        (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(
        (compareConfigRepo.delete as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it('logs CREATE on classifyMetric new-classification branch', async () => {
      systemRepo.createQueryBuilder.mockReturnValue(buildSystemQuery('sut-1') as any);
      const newTemplate = { id: 'tmpl-1', system_under_test_id: 'sut-1' } as ProvisionedTemplateDsCompareConfig;
      templateRepo.findOne.mockResolvedValue(null); // no existing classification
      templateRepo.create.mockReturnValue(newTemplate);
      templateRepo.save.mockResolvedValue(newTemplate);

      await service.classifyMetric(
        'tr-1',
        {
          applicationDashboardId: 'ad-1',
          panelId: '5',
          metricName: 'p95',
          classification: 'RED_rate',
          higherIsBetter: false,
          dashboardLabel: 'Latency',
          panelTitle: 'p95 latency',
        } as never,
        'sut',
        'production',
        'loadTest',
        'user-1',
        true,
      );

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(newTemplate);
    });

    it('logs UPDATE on classifyMetric existing-classification branch', async () => {
      systemRepo.createQueryBuilder.mockReturnValue(buildSystemQuery('sut-1') as any);
      const existing = {
        id: 'tmpl-1',
        system_under_test_id: 'sut-1',
        metric_classification: 'none',
      } as ProvisionedTemplateDsCompareConfig;
      const updated = { ...existing, metric_classification: 'RED_rate' } as ProvisionedTemplateDsCompareConfig;
      templateRepo.findOne
        .mockResolvedValueOnce(existing) // existing classification check
        .mockResolvedValueOnce(updated); // refetch after update
      templateRepo.update.mockResolvedValue({} as never);

      await service.classifyMetric(
        'tr-1',
        {
          applicationDashboardId: 'ad-1',
          panelId: '5',
          metricName: 'p95',
          classification: 'RED_rate',
          higherIsBetter: false,
        } as never,
        'sut',
        'production',
        'loadTest',
        'user-1',
        true,
      );

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [beforeArg, afterArg] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      expect(beforeArg).toEqual(expect.objectContaining({ id: 'tmpl-1', metric_classification: 'none' }));
      expect(afterArg).toEqual(expect.objectContaining({ id: 'tmpl-1', metric_classification: 'RED_rate' }));
    });

    it('does NOT audit applyGoldenPathClassifications (system action)', async () => {
      const dashboard = {
        id: 'dash-1',
        systemUnderTestId: 'sut-1',
        testEnvironment: 'production',
        dashboardUid: 'gatling',
      };
      const template = {
        id: 'tmpl-1',
        dashboard_uid: 'gatling',
        panel_id: 6,
        metric_classification: 'RED_rate',
      } as ProvisionedTemplateDsCompareConfig;

      applicationDashboardRepo.find.mockResolvedValue([dashboard]);
      templateRepo.find.mockResolvedValue([template]);
      compareConfigRepo.findOne.mockResolvedValue(null);
      compareConfigRepo.create.mockImplementation((data) => data as any);
      compareConfigRepo.save.mockResolvedValue({ id: 'cmp-new' } as DsCompareConfig);

      await service.applyGoldenPathClassifications({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'production',
        workload: 'loadTest',
      });

      // golden-path is a worker-driven system action — no audit row.
      expect(auditService.logCreate).not.toHaveBeenCalled();
      expect(auditService.logUpdate).not.toHaveBeenCalled();
    });
  });
});
