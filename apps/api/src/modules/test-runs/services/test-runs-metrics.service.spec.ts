import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { TestRunsMetricsService } from './test-runs-metrics.service';
import {
  TestRun as TestRunEntity,
  SystemUnderTest as SystemEntity,
  DsCompareConfig,
  ProvisionedTemplateDsCompareConfig,
  ApplicationDashboard,
  DsPanels,
} from '../../../entities';
import { createMockRepository, MockRepository } from '../../../../test/helpers/mock-repository.factory';
import { createAuthorizationServiceMock } from '../../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AuditService } from '../../audit/audit.service';
import { SERIES_GROUPING_DERIVED_SOURCE } from '@perfana/shared/constants';

describe('TestRunsMetricsService', () => {
  let service: TestRunsMetricsService;
  let systemRepo: MockRepository<SystemEntity>;
  let templateRepo: MockRepository<ProvisionedTemplateDsCompareConfig>;
  let compareConfigRepo: MockRepository<DsCompareConfig>;
  let applicationDashboardRepo: MockRepository<ApplicationDashboard>;
  let dsPanelsRepo: MockRepository<DsPanels>;
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
        { provide: getRepositoryToken(DsPanels), useValue: createMockRepository() },
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
    dsPanelsRepo = module.get(getRepositoryToken(DsPanels));
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
      // One batched lookup of the run's existing configs replaces the per-template findOne
      compareConfigRepo.find.mockResolvedValue([
        { application_dashboard_id: 'dash-1', panel_id: 6, metric_name: null },
      ] as any);

      const result = await service.applyGoldenPathClassifications(testRunInput);

      expect(result).toEqual({ compareConfigsCreated: 0 });
      expect(compareConfigRepo.create).not.toHaveBeenCalled();
      expect(compareConfigRepo.findOne).not.toHaveBeenCalled();
    });

    describe('worker-seeded rows', () => {
      const dashboard = { id: 'dash-1', systemUnderTestId: 'sut-uuid-1', testEnvironment: 'production', dashboardUid: 'performance-test-metrics-a', organizationId: 'org-1' };
      const template = {
        id: 'tmpl-1', system_under_test_id: null, dashboard_uid: '^performance-test-metrics-', regex: true, panel_id: 101,
        metric_classification: 'RED_duration', higher_is_better: false, config_overrides: { absThreshold: 25 },
      };
      const seededData = {
        thresholds: { aggregation: 'mean', percentageThreshold: 0.15, iqrThreshold: 2, absoluteThreshold: null, minSampleCount: 1 },
        metricClassification: { classification: 'RED_duration', higherIsBetter: false },
        defaultValueIfControlGroupMissing: 0,
      };

      it('merges the template into a row the perf-test pipeline seeded, keeping the worker keys', async () => {
        applicationDashboardRepo.find.mockResolvedValue([dashboard]);
        templateRepo.find.mockResolvedValue([template]);
        compareConfigRepo.find.mockResolvedValue([
          { id: 'cfg-1', application_dashboard_id: 'dash-1', panel_id: 101, metric_name: null, config_data: seededData, updated_by: 'worker-pipeline' },
        ] as any);

        const result = await service.applyGoldenPathClassifications(testRunInput);

        expect(result).toEqual({ compareConfigsCreated: 1 });
        expect(compareConfigRepo.create).not.toHaveBeenCalled();
        expect(compareConfigRepo.update).toHaveBeenCalledWith(
          { id: 'cfg-1', updated_by: 'worker-pipeline' },
          {
            config_data: { ...seededData, thresholds: { ...seededData.thresholds, absoluteThreshold: 25 } },
            updated_by: 'system:golden-path',
            // Migration 1822: the row's config before the merge, and which template merged.
            template_base: seededData,
            template_id: 'tmpl-1',
          },
        );
      });

      it('leaves a row a user edited alone', async () => {
        applicationDashboardRepo.find.mockResolvedValue([dashboard]);
        templateRepo.find.mockResolvedValue([template]);
        compareConfigRepo.find.mockResolvedValue([
          { id: 'cfg-1', application_dashboard_id: 'dash-1', panel_id: 101, metric_name: null, config_data: seededData, updated_by: 'user-sub' },
        ] as any);

        const result = await service.applyGoldenPathClassifications(testRunInput);

        expect(result).toEqual({ compareConfigsCreated: 0 });
        expect(compareConfigRepo.update).not.toHaveBeenCalled();
        expect(compareConfigRepo.create).not.toHaveBeenCalled();
      });
    });

    describe('Dynatrace host rows seeded by the mapping path', () => {
      // A HOST mapping writes a panel-level config with no author at all, so the row read as a user
      // edit and every `^dynatrace-` template was skipped forever. Measured on the dev database:
      // 56 of 56 panels a CPU/Memory Usage template targets were already occupied, 0 mergeable.
      const dashboard = {
        id: 'dash-dt', systemUnderTestId: 'sut-uuid-1', testEnvironment: 'production',
        dashboardUid: 'dynatrace-dynatrace-host-metrics-app-1', organizationId: 'org-1',
      };
      const template = {
        id: 'tmpl-dt', system_under_test_id: null, dashboard_uid: '^dynatrace-', regex: true,
        panel_id: null, panel_title: 'CPU Usage',
        metric_classification: 'USE_utilization', higher_is_better: false, config_overrides: { absThreshold: 5 },
      };
      const dynatraceSeeded = {
        metricClassification: { classification: 'USE_utilization', higherIsBetter: false },
        thresholds: { aggregation: 'mean', percentageThreshold: 0.1, iqrThreshold: 2, absoluteThreshold: null },
        ignore: false,
        source: 'dynatrace-host',
      };

      beforeEach(() => {
        applicationDashboardRepo.find.mockResolvedValue([dashboard]);
        templateRepo.find.mockResolvedValue([template]);
        dsPanelsRepo.query.mockResolvedValue([
          { dashboard_id: 'dash-dt', panel_id: 67141, panel_title: 'CPU Usage' },
        ]);
      });

      it("merges the template's absThreshold into the mapping-seeded row", async () => {
        compareConfigRepo.find.mockResolvedValue([
          { id: 'cfg-dt', application_dashboard_id: 'dash-dt', panel_id: 67141, metric_name: null, config_data: dynatraceSeeded, updated_by: null },
        ] as any);

        const result = await service.applyGoldenPathClassifications(testRunInput);

        expect(result).toEqual({ compareConfigsCreated: 1 });
        expect(compareConfigRepo.create).not.toHaveBeenCalled();
        expect(compareConfigRepo.update).toHaveBeenCalledWith(
          { id: 'cfg-dt', updated_by: IsNull() },
          {
            config_data: { ...dynatraceSeeded, thresholds: { ...dynatraceSeeded.thresholds, absoluteThreshold: 5 } },
            updated_by: 'system:golden-path',
            // Migration 1822: the row's config before the merge, and which template merged.
            template_base: dynatraceSeeded,
            template_id: 'tmpl-dt',
          },
        );
      });

      it('leaves a Dynatrace panel the user edited alone (source rewritten by the UI save)', async () => {
        compareConfigRepo.find.mockResolvedValue([
          {
            id: 'cfg-dt', application_dashboard_id: 'dash-dt', panel_id: 67141, metric_name: null,
            config_data: { ...dynatraceSeeded, source: 'panel' }, updated_by: 'user-sub',
          },
        ] as any);

        expect(await service.applyGoldenPathClassifications(testRunInput)).toEqual({ compareConfigsCreated: 0 });
        expect(compareConfigRepo.update).not.toHaveBeenCalled();
      });

      // Intentional rewrite (D11): this used to pin "does not re-merge a row the golden path already
      // stamped", the behaviour that kept a template edited in git from reaching panels it had seeded.
      it('re-merges a golden-path row when its winning template changed', async () => {
        compareConfigRepo.find.mockResolvedValue([
          {
            id: 'cfg-dt', application_dashboard_id: 'dash-dt', panel_id: 67141, metric_name: null,
            config_data: { ...dynatraceSeeded, thresholds: { ...dynatraceSeeded.thresholds, absoluteThreshold: 3 } },
            template_base: dynatraceSeeded, template_id: 'tmpl-dt',
            updated_by: 'system:golden-path',
          },
        ] as any);

        expect(await service.applyGoldenPathClassifications(testRunInput)).toEqual({ compareConfigsCreated: 0 });
        expect(compareConfigRepo.update).toHaveBeenCalledTimes(1);
        expect(compareConfigRepo.update).toHaveBeenCalledWith(
          { id: 'cfg-dt', updated_by: 'system:golden-path' },
          { config_data: { ...dynatraceSeeded, thresholds: { ...dynatraceSeeded.thresholds, absoluteThreshold: 5 } } },
        );
      });

      it('writes nothing to a golden-path row whose template did not change', async () => {
        compareConfigRepo.find.mockResolvedValue([
          {
            id: 'cfg-dt', application_dashboard_id: 'dash-dt', panel_id: 67141, metric_name: null,
            config_data: { ...dynatraceSeeded, thresholds: { ...dynatraceSeeded.thresholds, absoluteThreshold: 5 } },
            template_base: dynatraceSeeded, template_id: 'tmpl-dt',
            updated_by: 'system:golden-path',
          },
        ] as any);

        expect(await service.applyGoldenPathClassifications(testRunInput)).toEqual({ compareConfigsCreated: 0 });
        expect(compareConfigRepo.update).not.toHaveBeenCalled();
      });
    });

    describe('generic templates (issue #607)', () => {
      const dashboards = [
        { id: 'dash-a', systemUnderTestId: 'sut-uuid-1', testEnvironment: 'production', dashboardUid: 'performance-test-metrics-a', organizationId: 'org-1' },
        { id: 'dash-b', systemUnderTestId: 'sut-uuid-1', testEnvironment: 'production', dashboardUid: 'performance-test-metrics-b', organizationId: 'org-1' },
        { id: 'dash-jvm', systemUnderTestId: 'sut-uuid-1', testEnvironment: 'production', dashboardUid: 'spring-boot-jvm', organizationId: 'org-1' },
      ];
      const tmpl = (over: Record<string, unknown>) => ({
        id: 'tmpl', system_under_test_id: null, dashboard_uid: null, panel_id: 201,
        metric_classification: 'RED_rate', higher_is_better: false, regex: false, config_overrides: null, ...over,
      });
      const created = () => compareConfigRepo.create.mock.calls.map(([d]) => d as any);

      beforeEach(() => {
        applicationDashboardRepo.find.mockResolvedValue(dashboards);
        compareConfigRepo.create.mockImplementation((data) => data as any);
        compareConfigRepo.save.mockImplementation((data) => Promise.resolve({ id: 'new-id', ...data } as any));
      });

      it('a NULL dashboard_uid template seeds every dashboard of the SUT', async () => {
        templateRepo.find.mockResolvedValue([tmpl({ id: 'wild' })]);

        const result = await service.applyGoldenPathClassifications(testRunInput);

        expect(result).toEqual({ compareConfigsCreated: 3 });
        expect(created().map((c) => c.application_dashboard_id).sort()).toEqual(['dash-a', 'dash-b', 'dash-jvm']);
        expect(created().every((c) => c.panel_id === 201)).toBe(true);
      });

      it('regex: true matches dashboard_uid as a regular expression', async () => {
        templateRepo.find.mockResolvedValue([tmpl({ id: 'rx', dashboard_uid: '^performance-test-metrics-', regex: true })]);

        const result = await service.applyGoldenPathClassifications(testRunInput);

        expect(result).toEqual({ compareConfigsCreated: 2 });
        expect(created().map((c) => c.application_dashboard_id).sort()).toEqual(['dash-a', 'dash-b']);
      });

      it('an exact uid template wins over regex and wildcard for the same panel', async () => {
        templateRepo.find.mockResolvedValue([
          tmpl({ id: 'wild', metric_classification: 'wild-class' }),
          tmpl({ id: 'rx', dashboard_uid: '^performance-test-metrics-', regex: true, metric_classification: 'rx-class' }),
          tmpl({ id: 'exact', dashboard_uid: 'performance-test-metrics-a', metric_classification: 'exact-class' }),
        ]);

        const result = await service.applyGoldenPathClassifications(testRunInput);

        expect(result).toEqual({ compareConfigsCreated: 3 });
        const byDash = Object.fromEntries(created().map((c) => [c.application_dashboard_id, c.config_data.metricClassification.classification]));
        expect(byDash).toEqual({ 'dash-a': 'exact-class', 'dash-b': 'rx-class', 'dash-jvm': 'wild-class' });
      });

      it('an invalid regex is logged and skipped without aborting the run', async () => {
        templateRepo.find.mockResolvedValue([
          tmpl({ id: 'bad', dashboard_uid: '(unclosed', regex: true }),
          tmpl({ id: 'wild', panel_id: 101 }),
        ]);

        const result = await service.applyGoldenPathClassifications(testRunInput);

        expect(result).toEqual({ compareConfigsCreated: 3 });
        expect(created().every((c) => c.panel_id === 101)).toBe(true);
      });

      it('a wildcard does not recreate a config that already exists on that panel', async () => {
        templateRepo.find.mockResolvedValue([tmpl({ id: 'wild' })]);
        compareConfigRepo.find.mockResolvedValue([
          // PANEL-level: this is what "a config already exists on that panel" means. The fixture
          // used to be metric-level, which made the case pass for the wrong reason — see the pair
          // below, which is the behaviour that changed.
          { application_dashboard_id: 'dash-a', panel_id: 201, metric_name: null },
        ] as any);

        const result = await service.applyGoldenPathClassifications(testRunInput);

        expect(result).toEqual({ compareConfigsCreated: 2 });
        expect(created().map((c) => c.application_dashboard_id).sort()).toEqual(['dash-b', 'dash-jvm']);
      });

      /**
       * Value:
       *   protects — a panel-level golden-path template must still apply to a panel whose only
       *     config is a per-SERIES override. `StatisticsPipeline` writes one metric-level row per
       *     derived series (`api (sum)`, `api (pod count)`) on every grouped analysis, so without
       *     this the first grouped analysis of a workload disables that panel's template forever.
       *     A user's own per-series tweak had the same effect; it was simply rare (one metric-level
       *     row in 420 on the dev database) until series grouping made them routine.
       *   fails_when — a row of another metric (any level) blocks the panel template again, i.e. the
       *     candidate key stops matching metric_name exactly. The consequence is silent
       *     and inverted: the template never lands, so the panel's series — including the PRIMARY
       *     grouped series — fall back to DEFAULT_COMPARE_CONFIG with `higherIsBetter` null, and a
       *     real regression on that panel can never flip the run to REGRESSION. The only output is
       *     `0 compare configs created`.
       *   why_new — the gate is keyed on the row's LEVEL, not on who wrote it. An earlier version
       *     excluded only rows carrying `SERIES_GROUPING_DERIVED_SOURCE`, which is not durable:
       *     the anomaly card's save rebuilds `config_data` from scratch and the API replaces the
       *     column wholesale, so one edit of a derived row erased the marker and silently restored
       *     the defect. Both cases below are therefore driven through the same assertion — the
       *     machine-written row and the user-edited one must behave identically.
       *   seam — `metric_name IS NOT NULL`, a property of the row that no save can rewrite.
       */
      it.each([
        ['machine-written, marker intact', { source: SERIES_GROUPING_DERIVED_SOURCE }, 'worker-pipeline'],
        // Exactly what the UI writes over a derived row on any edit: marker gone, author replaced.
        ['user-edited, marker erased', { source: 'metric' }, 'user-sub'],
      ])('a metric-level row does not block a panel-level template (%s)', async (_label, configData, updatedBy) => {
        templateRepo.find.mockResolvedValue([tmpl({ id: 'wild' })]);
        compareConfigRepo.find.mockResolvedValue([
          {
            application_dashboard_id: 'dash-a',
            panel_id: 201,
            metric_name: 'api (sum)',
            config_data: configData,
            updated_by: updatedBy,
          },
        ] as any);

        const result = await service.applyGoldenPathClassifications(testRunInput);

        expect(result).toEqual({ compareConfigsCreated: 3 });
        expect(created().map((c) => c.application_dashboard_id).sort()).toEqual(['dash-a', 'dash-b', 'dash-jvm']);
        // Every row it creates is its own panel-level one; the metric-level row is untouched.
        expect(created().every((c) => c.metric_name == null)).toBe(true);
      });
    });

    describe('panel_title templates (issue #611)', () => {
      // Two Dynatrace host dashboards whose ids for the same panel differ per dashboard.
      const dashboards = [
        { id: 'host-a', systemUnderTestId: 'sut-uuid-1', testEnvironment: 'production', dashboardUid: 'dynatrace-host-a', organizationId: 'org-1' },
        { id: 'host-b', systemUnderTestId: 'sut-uuid-1', testEnvironment: 'production', dashboardUid: 'dynatrace-host-b', organizationId: 'org-1' },
      ];
      const panels = [
        { dashboard_id: 'host-a', panel_id: 15735, panel_title: 'CPU Usage' },
        { dashboard_id: 'host-a', panel_id: 15736, panel_title: 'Memory Usage' },
        { dashboard_id: 'host-b', panel_id: 19755, panel_title: 'CPU Usage' },
        { dashboard_id: 'host-b', panel_id: 19756, panel_title: 'Memory Usage' },
        { dashboard_id: 'host-b', panel_id: 19757, panel_title: 'Memory Usage' }, // duplicate title
      ];
      const tmpl = (over: Record<string, unknown>) => ({
        id: 'tmpl', system_under_test_id: null, dashboard_uid: '^dynatrace-', panel_id: null, panel_title: null,
        metric_classification: 'USE_utilization', higher_is_better: false, regex: true, config_overrides: null, ...over,
      });
      const created = () => compareConfigRepo.create.mock.calls.map(([d]) => d as any);

      beforeEach(() => {
        applicationDashboardRepo.find.mockResolvedValue(dashboards);
        dsPanelsRepo.query.mockResolvedValue(panels);
        compareConfigRepo.create.mockImplementation((data) => data as any);
        compareConfigRepo.save.mockImplementation((data) => Promise.resolve({ id: 'new-id', ...data } as any));
      });

      it('resolves the panel id per dashboard and seeds every panel a title matches', async () => {
        templateRepo.find.mockResolvedValue([tmpl({ panel_title: 'Memory Usage' })]);

        const result = await service.applyGoldenPathClassifications(testRunInput);

        expect(result).toEqual({ compareConfigsCreated: 3 });
        expect(created().map((c) => `${c.application_dashboard_id}|${c.panel_id}`).sort())
          .toEqual(['host-a|15736', 'host-b|19756', 'host-b|19757']);
        // Panels come from the SUT's recent runs, loaded once.
        expect(dsPanelsRepo.query).toHaveBeenCalledTimes(1);
        expect(dsPanelsRepo.query).toHaveBeenCalledWith(expect.any(String), [['host-a', 'host-b'], 'sut-uuid-1', 'production']);
      });

      it('regex: true applies to panel_title; a literal uid pairs with a pattern title', async () => {
        templateRepo.find.mockResolvedValue([tmpl({ dashboard_uid: 'dynatrace-host-a', panel_title: 'Usage$' })]);

        const result = await service.applyGoldenPathClassifications(testRunInput);

        expect(result).toEqual({ compareConfigsCreated: 2 });
        expect(created().map((c) => c.panel_id).sort()).toEqual([15735, 15736]);
      });

      it('a literal title is not a pattern when regex is false', async () => {
        templateRepo.find.mockResolvedValue([tmpl({ dashboard_uid: null, regex: false, panel_title: 'Usage' })]);

        expect(await service.applyGoldenPathClassifications(testRunInput)).toEqual({ compareConfigsCreated: 0 });
      });

      it('an exact panel_id wins over a title resolving to the same panel', async () => {
        templateRepo.find.mockResolvedValue([
          tmpl({ id: 'title', panel_title: 'CPU Usage', metric_classification: 'title-class' }),
          tmpl({ id: 'exact', dashboard_uid: 'dynatrace-host-a', regex: false, panel_id: 15735, metric_classification: 'id-class' }),
        ]);

        const result = await service.applyGoldenPathClassifications(testRunInput);

        expect(result).toEqual({ compareConfigsCreated: 2 });
        const byPanel = Object.fromEntries(created().map((c) => [c.panel_id, c.config_data.metricClassification.classification]));
        expect(byPanel).toEqual({ 15735: 'id-class', 19755: 'title-class' });
      });

      it('a title matching no panel, or a dashboard with no collected panels, is a no-op', async () => {
        templateRepo.find.mockResolvedValue([tmpl({ panel_title: 'Disk Utilization' })]);
        dsPanelsRepo.query.mockResolvedValue([]);

        expect(await service.applyGoldenPathClassifications(testRunInput)).toEqual({ compareConfigsCreated: 0 });
      });

      it('an invalid panel_title regex is logged and skips that template only', async () => {
        templateRepo.find.mockResolvedValue([
          tmpl({ id: 'bad', panel_title: '(unclosed' }),
          tmpl({ id: 'ok', panel_title: 'CPU Usage' }),
        ]);

        const result = await service.applyGoldenPathClassifications(testRunInput);

        expect(result).toEqual({ compareConfigsCreated: 2 });
        expect(created().map((c) => c.panel_id).sort()).toEqual([15735, 19755]);
      });

      it('does not load panels when every template has a panel_id', async () => {
        templateRepo.find.mockResolvedValue([tmpl({ panel_id: 201 })]);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(dsPanelsRepo.query).not.toHaveBeenCalled();
      });
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

    describe('template ownership and re-merge (migration 1822)', () => {
      const dashboard = {
        id: 'dash-1', systemUnderTestId: 'sut-uuid-1', testEnvironment: 'production',
        dashboardUid: 'jvm-prod-1', organizationId: 'org-a',
      };
      const base = {
        thresholds: { aggregation: 'mean', iqrThreshold: 2, absoluteThreshold: null, percentageThreshold: 0.15 },
        metricClassification: { classification: 'none', higherIsBetter: null },
        defaultValueIfControlGroupMissing: 0,
      };
      const tmpl = (over: Record<string, unknown>) => ({
        id: 'tmpl', system_under_test_id: null, dashboard_uid: 'jvm-prod-1', regex: false, panel_id: 7,
        panel_title: null, metric_name: null, organization_id: null,
        metric_classification: 'USE_saturation', higher_is_better: null, config_overrides: {}, ...over,
      });
      /** config_data as the given template would build it from `base`. */
      const built = (abs: number | null, classification = 'USE_saturation') => ({
        ...base,
        thresholds: { ...base.thresholds, absoluteThreshold: abs },
        metricClassification: { classification, higherIsBetter: null },
      });
      const owned = (over: Record<string, unknown>) => ({
        id: 'cfg-1', application_dashboard_id: 'dash-1', panel_id: 7, metric_name: null,
        updated_by: 'system:golden-path', template_base: base, template_id: 'tmpl', config_data: built(5), ...over,
      });

      beforeEach(() => {
        applicationDashboardRepo.find.mockResolvedValue([dashboard] as any);
        compareConfigRepo.create.mockImplementation((data) => data as any);
        compareConfigRepo.save.mockImplementation((data) => Promise.resolve({ id: 'new-id', ...data } as any));
      });

      it('stores the insert defaults as the base of a row it creates, and the winner as its template', async () => {
        templateRepo.find.mockResolvedValue([tmpl({ config_overrides: { absThreshold: 5 } })] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ config_data: built(5), template_base: base, template_id: 'tmpl' }),
        );
      });

      it('carries a GitOps edit to a template-owned row and leaves a hand-edited row on the same panel', async () => {
        templateRepo.find.mockResolvedValue([tmpl({ config_overrides: { absThreshold: 9 } })] as any);
        compareConfigRepo.find.mockResolvedValue([
          owned({}),
          owned({ id: 'cfg-hand', metric_name: 'heap', updated_by: 'user-sub' }),
        ] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).toHaveBeenCalledTimes(1);
        expect(compareConfigRepo.update).toHaveBeenCalledWith({ id: 'cfg-1', updated_by: 'system:golden-path' }, { config_data: built(9) });
      });

      it('writes only template_id when the winner changes but the config does not', async () => {
        templateRepo.find.mockResolvedValue([tmpl({ id: 'tmpl-new', config_overrides: { absThreshold: 5 } })] as any);
        compareConfigRepo.find.mockResolvedValue([owned({})] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).toHaveBeenCalledWith({ id: 'cfg-1', updated_by: 'system:golden-path' }, { template_id: 'tmpl-new' });
      });

      it('reverts a row whose template is gone to its base and clears template_id', async () => {
        templateRepo.find.mockResolvedValue([]);
        compareConfigRepo.find.mockResolvedValue([owned({})] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).toHaveBeenCalledWith({ id: 'cfg-1', updated_by: 'system:golden-path' }, { config_data: base, template_id: null });
      });

      it('clears only template_id on an unmatched row whose config already equals its base', async () => {
        templateRepo.find.mockResolvedValue([]);
        compareConfigRepo.find.mockResolvedValue([owned({ config_data: base })] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).toHaveBeenCalledWith({ id: 'cfg-1', updated_by: 'system:golden-path' }, { template_id: null });
      });

      it('takes a pre-upgrade golden-path row with no base as its own base, losing nothing', async () => {
        const legacy = { ...built(5), ignore: true };
        templateRepo.find.mockResolvedValue([tmpl({ config_overrides: { absThreshold: 5 } })] as any);
        compareConfigRepo.find.mockResolvedValue([owned({ template_base: null, template_id: null, config_data: legacy })] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).toHaveBeenCalledWith(
          { id: 'cfg-1', updated_by: 'system:golden-path' },
          { template_id: 'tmpl', template_base: legacy },
        );
      });

      it('hands a row to a newly added, more specific template', async () => {
        templateRepo.find.mockResolvedValue([
          tmpl({ id: 'wild', dashboard_uid: null, config_overrides: { absThreshold: 5 } }),
          tmpl({ id: 'exact', metric_classification: 'USE_errors', config_overrides: { absThreshold: 1 } }),
        ] as any);
        compareConfigRepo.find.mockResolvedValue([owned({ template_id: 'wild' })] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).toHaveBeenCalledWith(
          { id: 'cfg-1', updated_by: 'system:golden-path' },
          { config_data: built(1, 'USE_errors'), template_id: 'exact' },
        );
      });

      it("keeps a machine-seeded row's direction when the template does not name one", async () => {
        // The behaviour change behind the CHANGELOG callout: this used to write higherIsBetter: null.
        const seeded = { ...base, metricClassification: { classification: 'USE_saturation', higherIsBetter: true } };
        templateRepo.find.mockResolvedValue([tmpl({ config_overrides: { absThreshold: 5 } })] as any);
        compareConfigRepo.find.mockResolvedValue([
          owned({ updated_by: 'worker-pipeline', template_base: null, template_id: null, config_data: seeded }),
        ] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        const patch = compareConfigRepo.update.mock.calls[0]![1] as any;
        expect(patch.config_data.metricClassification).toEqual({ classification: 'USE_saturation', higherIsBetter: true });
      });

      it('never lets a panel template claim a per-series row', async () => {
        templateRepo.find.mockResolvedValue([tmpl({ config_overrides: { absThreshold: 5 } })] as any);
        compareConfigRepo.find.mockResolvedValue([
          owned({ id: 'derived', metric_name: 'api (sum)', updated_by: 'worker-pipeline', template_base: null, template_id: null, config_data: base }),
        ] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).not.toHaveBeenCalled();
        expect(compareConfigRepo.create).toHaveBeenCalledWith(expect.objectContaining({ metric_name: undefined }));
      });

      /**
       * Generated by /ship test coverage audit.
       * Value: protects=a metric-level template reaches only rows of its own series: it merges into the
       *   worker-seeded `api (sum)` row and inserts with its metric_name, never touching the panel row;
       * fails_when=the insert drops metric_name (the template becomes the whole panel's default) or the
       *   row key stops carrying the metric;
       * why_new=only the opposite direction (panel template vs per-series row) is pinned, and metricName
       *   is new in the YAML;
       * seam=none;
       * no_claim=the partial unique indexes on ds_compare_config (mocked repository; unit only)
       */
      it('lets a metric-level template reach only rows of its own series', async () => {
        templateRepo.find.mockResolvedValue([
          tmpl({ id: 'sum', metric_name: 'api (sum)', config_overrides: { absThreshold: 5 } }),
          tmpl({ id: 'count', metric_name: 'api (count)', config_overrides: { absThreshold: 1 } }),
        ] as any);
        compareConfigRepo.find.mockResolvedValue([
          // Machine-seeded, so mergeable, but no template here names a NULL metric.
          owned({ id: 'panel-row', updated_by: 'worker-pipeline', template_base: null, template_id: null, config_data: base }),
          owned({ id: 'derived-sum', metric_name: 'api (sum)', updated_by: 'worker-pipeline', template_base: null, template_id: null, config_data: base }),
        ] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).toHaveBeenCalledTimes(1);
        expect(compareConfigRepo.update).toHaveBeenCalledWith(
          { id: 'derived-sum', updated_by: 'worker-pipeline' },
          expect.objectContaining({ config_data: built(5), template_id: 'sum', updated_by: 'system:golden-path' }),
        );
        expect(compareConfigRepo.create).toHaveBeenCalledTimes(1);
        expect(compareConfigRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ panel_id: 7, metric_name: 'api (count)', template_id: 'count', config_data: built(1) }),
        );
      });

      /**
       * Value:
       *   protects — cross-organization isolation for organization templates (D10). The table has
       *     no RLS, so this filter is the only boundary.
       *   fails_when — the per-dashboard filter is removed or reads an optional TestRun field.
       */
      it("applies an install-wide template everywhere and an organization's only to its own dashboards", async () => {
        templateRepo.find.mockResolvedValue([
          tmpl({ id: 'org-b', organization_id: 'org-b', panel_id: 1 }),
          tmpl({ id: 'org-a', organization_id: 'org-a', panel_id: 2 }),
          tmpl({ id: 'install', panel_id: 3 }),
        ] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        const created = compareConfigRepo.create.mock.calls.map(([d]) => (d as any).template_id).sort();
        expect(created).toEqual(['install', 'org-a']);
      });

      /**
       * Value: protects=when a legacy install-wide template becomes an organization template, rows
       *   in that organization follow the new winner and rows in another organization revert to base;
       * fails_when=the organization filter is dropped (org-b keeps the template) or an unmatched owned
       *   row keeps its template fields and template_id;
       * why_new=design 3 names this consequence for multi-organization installs and no case pinned it;
       * seam=none; no_claim=provisioning's re-key (see the provisioning spec)
       */
      it('moves owned rows when an install-wide template becomes an organization template', async () => {
        applicationDashboardRepo.find.mockResolvedValue([
          dashboard,
          { ...dashboard, id: 'dash-b', dashboardUid: 'jvm-prod-1', organizationId: 'org-b' },
        ] as any);
        templateRepo.find.mockResolvedValue([
          tmpl({ id: 'org-a-tmpl', organization_id: 'org-a', config_overrides: { absThreshold: 5 } }),
        ] as any);
        compareConfigRepo.find.mockResolvedValue([
          owned({ template_id: 'install-wide-tmpl' }),
          owned({ id: 'cfg-b', application_dashboard_id: 'dash-b', template_id: 'install-wide-tmpl' }),
        ] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).toHaveBeenCalledWith({ id: 'cfg-1', updated_by: 'system:golden-path' }, { template_id: 'org-a-tmpl' });
        expect(compareConfigRepo.update).toHaveBeenCalledWith({ id: 'cfg-b', updated_by: 'system:golden-path' }, { config_data: base, template_id: null });
      });

      it('prefers an organization template over an install-wide one on the same panel', async () => {
        templateRepo.find.mockResolvedValue([
          tmpl({ id: 'a-install', metric_classification: 'install-class' }),
          tmpl({ id: 'z-org', organization_id: 'org-a', metric_classification: 'org-class' }),
        ] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.create).toHaveBeenCalledWith(expect.objectContaining({ template_id: 'z-org' }));
      });

      it('leaves an owned row alone when its panel is missing from the recent panel list', async () => {
        const logSpy = jest.spyOn((service as any).logger, 'log');
        templateRepo.find.mockResolvedValue([tmpl({ panel_id: null, panel_title: 'Heap' })] as any);
        dsPanelsRepo.query.mockResolvedValue([{ dashboard_id: 'dash-1', panel_id: 8, panel_title: 'Threads' }]);
        compareConfigRepo.find.mockResolvedValue([owned({})] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('left alone for a collection gap: jvm-prod-1 (1)'));
      });

      /**
       * Value: protects=a row an id template owns keeps following it on a dashboard that never gets
       *   ds_panels rows (perf-test dashboards) even while a wildcard title template is in play;
       * fails_when=the gap guard keys on "a title template reaches this dashboard" again, which freezes
       *   every owned row there for good and reports a collection gap on every run;
       * why_new=the guard case only covered a title-owned row;
       * seam=none; no_claim=which pipelines write ds_panels (mocked)
       */
      it('rebuilds an id-owned row on a dashboard with no recorded panels', async () => {
        templateRepo.find.mockResolvedValue([
          tmpl({ config_overrides: { absThreshold: 9 } }),
          tmpl({ id: 'title-wild', dashboard_uid: null, panel_id: null, panel_title: 'Heap' }),
        ] as any);
        dsPanelsRepo.query.mockResolvedValue([]);
        compareConfigRepo.find.mockResolvedValue([owned({})] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).toHaveBeenCalledWith({ id: 'cfg-1', updated_by: 'system:golden-path' }, { config_data: built(9) });
      });

      it('leaves the rows of a template skipped for a bad pattern alone', async () => {
        templateRepo.find.mockResolvedValue([tmpl({ dashboard_uid: '(unclosed', regex: true })] as any);
        compareConfigRepo.find.mockResolvedValue([owned({})] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).not.toHaveBeenCalled();
      });

      /**
       * Value: protects=the applier's own safety rails, added after the /ship adversarial review:
       *   a pre-1822 row holding a pre-v0.2.95.42 hand edit, a save racing the loop, an insert another
       *   writer beat it to, a stored pattern that never met the ReDoS check, and a pre-1822 row on a
       *   perf-test dashboard (no ds_panels) that a wildcard title template used to freeze;
       * fails_when=a legacy row is rebuilt from its current config regardless, a write is keyed on id
       *   alone, one 23505 aborts the run, the applier compiles a stored pattern unchecked, or the gap
       *   guard ignores that an id template wins the row;
       * why_new=none of these were covered; seam=repository mocks; no_claim=what Postgres does with
       *   the conditional UPDATE (the WHERE shape is what is pinned)
       */
      it('leaves a pre-upgrade row alone when its template would change it', async () => {
        // A user set 5 before v0.2.95.42, when a save did not change updated_by; the template says 9.
        templateRepo.find.mockResolvedValue([tmpl({ config_overrides: { absThreshold: 9 } })] as any);
        compareConfigRepo.find.mockResolvedValue([owned({ template_base: null, template_id: null })] as any);
        const logSpy = jest.spyOn((service as any).logger, 'log');

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 pre-v0.2.97.54 row(s) left alone'));
      });

      it('adopts a pre-upgrade row on a dashboard with no recorded panels when an id template wins it', async () => {
        templateRepo.find.mockResolvedValue([
          tmpl({ config_overrides: { absThreshold: 5 } }),
          tmpl({ id: 'title-wild', dashboard_uid: null, panel_id: null, panel_title: 'Heap' }),
        ] as any);
        dsPanelsRepo.query.mockResolvedValue([]);
        compareConfigRepo.find.mockResolvedValue([owned({ template_base: null, template_id: null })] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).toHaveBeenCalledWith(
          { id: 'cfg-1', updated_by: 'system:golden-path' },
          { template_base: built(5), template_id: 'tmpl' },
        );
      });

      it('skips a row saved while it ran, and does not count it as rebuilt', async () => {
        templateRepo.find.mockResolvedValue([tmpl({ config_overrides: { absThreshold: 9 } })] as any);
        compareConfigRepo.find.mockResolvedValue([owned({})] as any);
        compareConfigRepo.update.mockResolvedValue({ affected: 0 } as any);
        const logSpy = jest.spyOn((service as any).logger, 'log');

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).toHaveBeenCalledWith({ id: 'cfg-1', updated_by: 'system:golden-path' }, { config_data: built(9) });
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('0 rebuilt, rewrote=0'));
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 row(s) skipped: edited while this ran'));
      });

      it('carries on past an insert another writer beat it to', async () => {
        templateRepo.find.mockResolvedValue([tmpl({}), tmpl({ id: 'tmpl-8', panel_id: 8 })] as any);
        compareConfigRepo.find.mockResolvedValue([]);
        compareConfigRepo.save.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }));

        expect(await service.applyGoldenPathClassifications(testRunInput)).toEqual({ compareConfigsCreated: 1 });
        expect(compareConfigRepo.save).toHaveBeenCalledTimes(2);
      });

      it('still fails on an insert error that is not a collision', async () => {
        templateRepo.find.mockResolvedValue([tmpl({})] as any);
        compareConfigRepo.find.mockResolvedValue([]);
        compareConfigRepo.save.mockRejectedValueOnce(Object.assign(new Error('null value'), { code: '23502' }));

        await expect(service.applyGoldenPathClassifications(testRunInput)).rejects.toThrow('null value');
      });

      it('skips a stored regex template that fails the ReDoS check, leaving its rows alone', async () => {
        templateRepo.find.mockResolvedValue([
          tmpl({ dashboard_uid: '(a+)+$', regex: true, config_overrides: { absThreshold: 9 } }),
        ] as any);
        compareConfigRepo.find.mockResolvedValue([owned({})] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        expect(compareConfigRepo.update).not.toHaveBeenCalled();
        expect(compareConfigRepo.create).not.toHaveBeenCalled();
      });

      it('records a tie decided by template id once per run, not once per panel', async () => {
        const logSpy = jest.spyOn((service as any).logger, 'log');
        applicationDashboardRepo.find.mockResolvedValue([
          dashboard,
          { ...dashboard, id: 'dash-2', dashboardUid: 'jvm-prod-2' },
        ] as any);
        templateRepo.find.mockResolvedValue([
          tmpl({ id: 'b-broad', dashboard_uid: '^jvm-.*', regex: true }),
          tmpl({ id: 'a-narrow', dashboard_uid: '^jvm-prod.*', regex: true }),
        ] as any);

        await service.applyGoldenPathClassifications(testRunInput);

        const summary = logSpy.mock.calls.map(([m]) => String(m)).find((m) => m.startsWith('Golden-path applied'))!;
        expect(summary).toContain('decided by template id: a-narrow over b-broad');
        expect(summary.match(/a-narrow over b-broad/g)).toHaveLength(1);
      });

      it('reports rows rewritten and duration, at warn once it takes over 5000 ms', async () => {
        const logSpy = jest.spyOn((service as any).logger, 'log');
        const warnSpy = jest.spyOn((service as any).logger, 'warn');
        templateRepo.find.mockResolvedValue([tmpl({ config_overrides: { absThreshold: 9 } })] as any);
        compareConfigRepo.find.mockResolvedValue([owned({})] as any);

        const now = jest.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_120);
        await service.applyGoldenPathClassifications(testRunInput);
        expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/1 rebuilt, rewrote=1 in 120ms$/));

        now.mockReturnValueOnce(1_000).mockReturnValueOnce(7_000);
        await service.applyGoldenPathClassifications(testRunInput);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/in 6000ms \(slow: this runs inside the completion request\)$/));
        now.mockRestore();
      });
    });
  });

  // -----------------------------------------------------------------
  // Phase 5a (PR13) — audit-logging invariants
  // -----------------------------------------------------------------
  /**
   * Value: protects=a metric-scope save writes a row for that series and leaves the panel's own row
   *   alone, so the panel keeps its config and its template ownership;
   * fails_when=the upsert takes getDsCompareConfig's metric -> panel fallback as "the existing row"
   *   and rewrites the panel row with one series' settings;
   * why_new=no case saved at metric scope onto a panel that only has a panel-level row;
   * seam=none; no_claim=what the anomaly card sends (the controller and UI are not exercised)
   */
  describe('createOrUpdateDsCompareConfig upserts the exact row', () => {
    const dto = (metricName?: string) => ({
      systemUnderTestId: 'sut-1', testEnvironment: 'production', workload: 'loadTest',
      applicationDashboardId: 'ad-1', panelId: '7', metricName, configData: { thresholds: { absoluteThreshold: 9 } },
    }) as never;
    const panelRow = { id: 'panel-row', metricName: undefined } as never;

    beforeEach(() => {
      systemRepo.createQueryBuilder.mockReturnValue({
        leftJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'sut-1', organization_id: 'org-1', team_id: null }),
      } as any);
      applicationDashboardRepo.findOne.mockResolvedValue({ id: 'ad-1' } as ApplicationDashboard);
      compareConfigRepo.create.mockImplementation((data) => data as any);
      compareConfigRepo.save.mockImplementation((data) =>
        Promise.resolve({ id: 'new-row', created_at: new Date(), updated_at: new Date(), ...data } as any),
      );
    });

    it('creates a series row when only the panel row exists', async () => {
      jest.spyOn(service, 'getDsCompareConfig').mockResolvedValue(panelRow);
      const update = jest.spyOn(service, 'updateDsCompareConfig');

      await service.createOrUpdateDsCompareConfig(dto('api'), 'user-1', true);

      expect(update).not.toHaveBeenCalled();
      // Stamped with its author: an unauthored row with the Dynatrace marker reads as machine-seeded.
      expect(compareConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ panel_id: 7, metric_name: 'api', created_by: 'user-1', updated_by: 'user-1' }),
      );
    });

    it('still updates the panel row for a panel-scope save', async () => {
      jest.spyOn(service, 'getDsCompareConfig').mockResolvedValue(panelRow);
      const update = jest.spyOn(service, 'updateDsCompareConfig').mockResolvedValue({} as never);

      await service.createOrUpdateDsCompareConfig(dto(), 'user-1', true);

      expect(update).toHaveBeenCalledWith('panel-row', { configData: { thresholds: { absoluteThreshold: 9 } } }, 'user-1', true);
      expect(compareConfigRepo.create).not.toHaveBeenCalled();
    });
  });

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

  // -----------------------------------------------------------------
  // organization_id inheritance (RLS: NOT NULL on ds_compare_config,
  // and a NULL row would be invisible to every non-admin anyway)
  // -----------------------------------------------------------------
  describe('organization_id inheritance', () => {
    it('createOrUpdateDsCompareConfig inherits organization_id and team_id from the parent SUT', async () => {
      const systemQuery = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'sut-1', organization_id: 'org-inh-1', team_id: 'team-inh-1' }),
      };
      systemRepo.createQueryBuilder.mockReturnValue(systemQuery as any);
      applicationDashboardRepo.findOne.mockResolvedValue({ id: 'ad-1' } as ApplicationDashboard);
      compareConfigRepo.findOne.mockResolvedValue(null);
      compareConfigRepo.create.mockImplementation((data) => data as any);
      compareConfigRepo.save.mockImplementation((data) =>
        Promise.resolve({
          id: 'cmp-new',
          ...data,
          created_at: new Date('2026-08-23T10:00:00Z'),
          updated_at: new Date('2026-08-23T10:00:00Z'),
        } as any),
      );

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

      expect(compareConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: 'org-inh-1', team_id: 'team-inh-1' }),
      );
      // the SUT lookup must actually select the ownership columns it inherits from
      expect(systemQuery.select).toHaveBeenCalledWith(['sut.id', 'sut.organization_id', 'sut.team_id']);
    });

    it('applyGoldenPathClassifications inherits organization_id and team_id from the dashboard', async () => {
      applicationDashboardRepo.find.mockResolvedValue([
        {
          id: 'dash-1',
          systemUnderTestId: 'sut-1',
          testEnvironment: 'production',
          dashboardUid: 'gatling-overview-influxdb',
          organizationId: 'org-dash-1',
          teamId: 'team-dash-1',
        },
      ] as any);
      templateRepo.find.mockResolvedValue([
        {
          id: 'tmpl-1',
          system_under_test_id: null,
          dashboard_uid: 'gatling-overview-influxdb',
          panel_id: 6,
          metric_classification: 'RED_rate',
          higher_is_better: true,
          regex: false,
          config_overrides: null,
        },
      ] as any);
      compareConfigRepo.findOne.mockResolvedValue(null);
      compareConfigRepo.create.mockImplementation((data) => data as any);
      compareConfigRepo.save.mockImplementation((data) => Promise.resolve({ id: 'new-cfg', ...data } as any));

      await service.applyGoldenPathClassifications({
        systemUnderTestId: 'sut-1',
        testEnvironment: 'production',
        workload: 'loadTest',
      });

      expect(compareConfigRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: 'org-dash-1',
          team_id: 'team-dash-1',
          created_by: 'system:golden-path',
        }),
      );
    });
  });

});
