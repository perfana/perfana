import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository, IsNull } from 'typeorm';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { ProvisioningService } from './provisioning.service';
import {
  Profile,
  ProfileGrafanaDashboard,
  ProfileBenchmark,
  ProvisionedTemplateDsCompareConfig,
} from '../../entities';

jest.mock('fs');
jest.mock('js-yaml');

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedYaml = yaml as jest.Mocked<typeof yaml>;

describe('ProvisioningService', () => {
  let service: ProvisioningService;
  let profileRepo: jest.Mocked<Repository<Profile>>;
  let dashboardRepo: jest.Mocked<Repository<ProfileGrafanaDashboard>>;
  let benchmarkRepo: jest.Mocked<Repository<ProfileBenchmark>>;
  let templateRepo: jest.Mocked<Repository<ProvisionedTemplateDsCompareConfig>>;
  let configService: jest.Mocked<ConfigService>;
  let queryRunner: { connect: jest.Mock; query: jest.Mock; release: jest.Mock };

  const createMockRepo = () => ({
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  });

  beforeEach(async () => {
    const mockProfileRepo = createMockRepo();
    const mockDashboardRepo = createMockRepo();
    const mockBenchmarkRepo = createMockRepo();
    const mockTemplateRepo = createMockRepo();
    // pg_try_advisory_lock answers one row; every other statement's result is ignored.
    queryRunner = { connect: jest.fn(), query: jest.fn().mockResolvedValue([{ locked: true }]), release: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvisioningService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              const config: Record<string, string> = {
                PROVISIONING_ENABLED: 'true',
                PROVISIONING_DIR: '/test/provisioning',
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
        { provide: getRepositoryToken(Profile), useValue: mockProfileRepo },
        { provide: getRepositoryToken(ProfileGrafanaDashboard), useValue: mockDashboardRepo },
        { provide: getRepositoryToken(ProfileBenchmark), useValue: mockBenchmarkRepo },
        { provide: getRepositoryToken(ProvisionedTemplateDsCompareConfig), useValue: mockTemplateRepo },
        { provide: DataSource, useValue: { createQueryRunner: jest.fn(() => queryRunner) } },
      ],
    }).compile();

    service = module.get(ProvisioningService);
    profileRepo = module.get(getRepositoryToken(Profile));
    dashboardRepo = module.get(getRepositoryToken(ProfileGrafanaDashboard));
    benchmarkRepo = module.get(getRepositoryToken(ProfileBenchmark));
    templateRepo = module.get(getRepositoryToken(ProvisionedTemplateDsCompareConfig));
    configService = module.get(ConfigService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('onApplicationBootstrap', () => {
    it('should skip when PROVISIONING_ENABLED is not true', async () => {
      configService.get.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'PROVISIONING_ENABLED') return 'false';
        return defaultValue;
      });

      await service.onApplicationBootstrap();

      expect(mockedFs.existsSync).not.toHaveBeenCalled();
    });

    it('should skip when directory does not exist', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      await service.onApplicationBootstrap();

      expect(mockedFs.readFileSync).not.toHaveBeenCalled();
    });

    it('should not crash the API on unexpected errors', async () => {
      mockedFs.existsSync.mockImplementation(() => {
        throw new Error('filesystem error');
      });

      // Should not throw
      await service.onApplicationBootstrap();
    });
  });

  describe('loadYamlFile', () => {
    it('should return null when file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = service.loadYamlFile('/dir', 'missing.yaml');

      expect(result).toBeNull();
    });

    it('should parse flat array format', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('content');
      mockedYaml.load.mockReturnValue([{ name: 'test' }]);

      const result = service.loadYamlFile('/dir', 'profiles.yaml');

      expect(result).toEqual({
        organizationId: null,
        items: [{ name: 'test' }],
      });
    });

    it('should parse wrapped format with organizationId', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('content');
      mockedYaml.load.mockReturnValue({
        organizationId: 'org-123',
        items: [{ name: 'test' }],
      });

      const result = service.loadYamlFile('/dir', 'profiles.yaml');

      expect(result).toEqual({
        organizationId: 'org-123',
        items: [{ name: 'test' }],
      });
    });

    it('should handle wrapped format without organizationId', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('content');
      mockedYaml.load.mockReturnValue({
        items: [{ name: 'test' }],
      });

      const result = service.loadYamlFile('/dir', 'profiles.yaml');

      expect(result).toEqual({
        organizationId: null,
        items: [{ name: 'test' }],
      });
    });

    it('should return null for unexpected format', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('content');
      mockedYaml.load.mockReturnValue('just a string');

      const result = service.loadYamlFile('/dir', 'profiles.yaml');

      expect(result).toBeNull();
    });

    /**
     * Value:
     *   protects — a typo never wipes every provisioned template. `items:` with nothing after it
     *     parses as null; read as "no items" it is a declared empty state, and the prune deletes
     *     every provisioned compare-config template.
     *   fails_when — a null or non-list `items` is normalised to [].
     *   why_new — the invalid-YAML case below covers parse errors only.
     */
    it.each([[null], ['x'], [{ a: 1 }]])('returns null for a wrapped file whose items is %p', (items) => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('content');
      mockedYaml.load.mockReturnValue({ items });

      expect(service.loadYamlFile('/dir', 'template_ds_compare_configs.yaml')).toBeNull();
    });

    it('should return null and log error for invalid YAML', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('content');
      mockedYaml.load.mockImplementation(() => {
        throw new Error('YAML parse error');
      });

      const result = service.loadYamlFile('/dir', 'profiles.yaml');

      expect(result).toBeNull();
    });
  });

  describe('provisionProfiles', () => {
    it('should create a new profile', async () => {
      profileRepo.findOne.mockResolvedValue(null);
      profileRepo.insert.mockResolvedValue(undefined as any);

      const result = await service.provisionProfiles(
        [{ name: 'gatling', description: 'Gatling profile', tags: ['gatling'] }],
        null,
      );

      expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: 0 });
      expect(profileRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'gatling',
          description: 'Gatling profile',
          tags: ['gatling'],
          readOnly: true,
          createdBy: 'system:provisioning',
          updatedBy: 'system:provisioning',
        }),
      );
    });

    it('should update an existing profile', async () => {
      profileRepo.findOne.mockResolvedValue({ id: 'existing-id', name: 'gatling' } as Profile);
      profileRepo.update.mockResolvedValue(undefined as any);

      const result = await service.provisionProfiles(
        [{ name: 'gatling', description: 'Updated', tags: ['gatling'] }],
        null,
      );

      expect(result).toEqual({ created: 0, updated: 1, skipped: 0, errors: 0 });
      expect(profileRepo.update).toHaveBeenCalledWith(
        'existing-id',
        expect.objectContaining({
          description: 'Updated',
          readOnly: true,
          updatedBy: 'system:provisioning',
        }),
      );
    });

    it('should set organizationId when provided', async () => {
      profileRepo.findOne.mockResolvedValue(null);
      profileRepo.insert.mockResolvedValue(undefined as any);

      await service.provisionProfiles(
        [{ name: 'test' }],
        'org-uuid',
      );

      expect(profileRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-uuid' }),
      );
    });

    it('should continue on error and count failures', async () => {
      profileRepo.findOne.mockResolvedValue(null);
      profileRepo.insert
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce(undefined as any);

      const result = await service.provisionProfiles(
        [{ name: 'fail' }, { name: 'succeed' }],
        null,
      );

      expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: 1 });
    });
  });

  describe('provisionProfileDashboards', () => {
    it('should create a new dashboard', async () => {
      dashboardRepo.findOne.mockResolvedValue(null);
      dashboardRepo.insert.mockResolvedValue(undefined as any);

      const result = await service.provisionProfileDashboards(
        [{
          profile: 'gatling',
          dashboardName: 'Gatling Overview',
          dashboardUid: 'gatling-overview',
        }],
        null,
      );

      expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: 0 });
      expect(dashboardRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: 'gatling',
          dashboardName: 'Gatling Overview',
          dashboardUid: 'gatling-overview',
          grafanaLabel: 'Default',
          readOnly: true,
          createdBy: 'system:provisioning',
        }),
      );
    });

    it('should update an existing dashboard', async () => {
      dashboardRepo.findOne.mockResolvedValue({ id: 'dash-id' } as ProfileGrafanaDashboard);
      dashboardRepo.update.mockResolvedValue(undefined as any);

      const result = await service.provisionProfileDashboards(
        [{
          profile: 'gatling',
          grafana: 'Custom',
          dashboardName: 'Updated',
          dashboardUid: 'gatling-overview',
        }],
        null,
      );

      expect(result).toEqual({ created: 0, updated: 1, skipped: 0, errors: 0 });
      expect(dashboardRepo.findOne).toHaveBeenCalledWith({
        where: {
          profile: 'gatling',
          dashboardUid: 'gatling-overview',
          grafanaLabel: 'Custom',
        },
      });
    });

    it('should pass through setHardcodedValueForVariables array format', async () => {
      dashboardRepo.findOne.mockResolvedValue(null);
      dashboardRepo.insert.mockResolvedValue(undefined as any);

      const variables = [
        { name: 'jvm_memory_pool_heap', values: ['All'] },
        { name: 'jvm_memory_pool_nonheap', values: ['All'] },
      ];

      await service.provisionProfileDashboards(
        [{
          profile: 'test',
          dashboardName: 'Test',
          dashboardUid: 'test-uid',
          setHardcodedValueForVariables: variables,
        }],
        null,
      );

      expect(dashboardRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          setHardcodedValueForVariables: variables,
        }),
      );
    });

    it('should convert matchRegexForVariables from array to Record format', async () => {
      dashboardRepo.findOne.mockResolvedValue(null);
      dashboardRepo.insert.mockResolvedValue(undefined as any);

      await service.provisionProfileDashboards(
        [{
          profile: 'docker',
          dashboardName: 'Docker',
          dashboardUid: 'docker-uid',
          matchRegexForVariables: [
            { name: 'container', regex: 'perfana-containers' },
          ],
        }],
        null,
      );

      expect(dashboardRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          matchRegexForVariables: { container: 'perfana-containers' },
        }),
      );
    });
  });

  describe('provisionProfileBenchmarks', () => {
    const profileMock = { id: 'profile-uuid', name: 'gatling' } as Profile;
    const dashboardMock = { id: 'dash-uuid' } as ProfileGrafanaDashboard;

    it('should create a new benchmark', async () => {
      profileRepo.findOne.mockResolvedValue(profileMock);
      dashboardRepo.findOne.mockResolvedValue(dashboardMock);
      benchmarkRepo.findOne.mockResolvedValue(null);
      benchmarkRepo.insert.mockResolvedValue(undefined as any);

      const result = await service.provisionProfileBenchmarks(
        [{
          profile: 'gatling',
          dashboardUid: 'gatling-overview',
          panel: {
            id: 1,
            title: 'Response Time',
            evaluateType: 'avg',
            requirement: { operator: 'lt', value: 1000 },
          },
        }],
        null,
      );

      expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: 0 });
      expect(benchmarkRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          profile_id: 'profile-uuid',
          profile_dashboard_id: 'dash-uuid',
          panel_id: 1,
          panel_title: 'Response Time',
          evaluate_type: 'avg',
          requirement_operator: 'lt',
          requirement_value: 1000,
          source: 'grafana',
          read_only: true,
          createdBy: 'system:provisioning',
        }),
      );
    });

    it('provisions a performance-metrics benchmark without a profile dashboard', async () => {
      profileRepo.findOne.mockResolvedValue(profileMock);
      benchmarkRepo.findOne.mockResolvedValue(null);
      benchmarkRepo.insert.mockResolvedValue(undefined as any);

      const result = await service.provisionProfileBenchmarks(
        [{
          profile: 'gatling',
          source: 'performance-metrics',
          panel: { id: 105, title: 'Transaction Error Rate', evaluateType: 'avg', requirement: { operator: 'lt', value: 2 } },
        }],
        null,
      );

      expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: 0 });
      expect(dashboardRepo.findOne).not.toHaveBeenCalled();
      expect(benchmarkRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          profile_dashboard_id: null,
          grafana_instance: undefined,
          source: 'performance-metrics',
          dashboard_uid: '^performance-test-metrics-(?!all-aggregated$|default$)',
          panel_id: 105,
        }),
      );
    });

    it('should skip when profile not found', async () => {
      profileRepo.findOne.mockResolvedValue(null);

      const result = await service.provisionProfileBenchmarks(
        [{
          profile: 'missing',
          dashboardUid: 'uid',
          panel: { id: 1 },
        }],
        null,
      );

      expect(result).toEqual({ created: 0, updated: 0, skipped: 1, errors: 0 });
      expect(benchmarkRepo.insert).not.toHaveBeenCalled();
    });

    it('should skip when dashboard not found', async () => {
      profileRepo.findOne.mockResolvedValue(profileMock);
      dashboardRepo.findOne.mockResolvedValue(null);

      const result = await service.provisionProfileBenchmarks(
        [{
          profile: 'gatling',
          dashboardUid: 'missing-uid',
          panel: { id: 1 },
        }],
        null,
      );

      expect(result).toEqual({ created: 0, updated: 0, skipped: 1, errors: 0 });
    });

    it('should update existing benchmark', async () => {
      profileRepo.findOne.mockResolvedValue(profileMock);
      dashboardRepo.findOne.mockResolvedValue(dashboardMock);
      benchmarkRepo.findOne.mockResolvedValue({ id: 'bench-uuid' } as ProfileBenchmark);
      benchmarkRepo.update.mockResolvedValue(undefined as any);

      const result = await service.provisionProfileBenchmarks(
        [{
          profile: 'gatling',
          dashboardUid: 'gatling-overview',
          panel: { id: 1, title: 'Updated Title' },
        }],
        null,
      );

      expect(result).toEqual({ created: 0, updated: 1, skipped: 0, errors: 0 });
      expect(benchmarkRepo.update).toHaveBeenCalledWith(
        'bench-uuid',
        expect.objectContaining({ panel_title: 'Updated Title' }),
      );
    });

    it('should use default workload pattern when not specified', async () => {
      profileRepo.findOne.mockResolvedValue(profileMock);
      dashboardRepo.findOne.mockResolvedValue(dashboardMock);
      benchmarkRepo.findOne.mockResolvedValue(null);
      benchmarkRepo.insert.mockResolvedValue(undefined as any);

      await service.provisionProfileBenchmarks(
        [{
          profile: 'gatling',
          dashboardUid: 'uid',
          panel: { id: 1 },
        }],
        null,
      );

      expect(benchmarkRepo.findOne).toHaveBeenCalledWith({
        where: expect.objectContaining({ workload_pattern: '.*' }),
      });
    });
  });

  describe('provisionMetricClassifications', () => {
    const SUMMARY = { created: 0, updated: 0, unchanged: 0, takenOver: 0, pruned: 0, skipped: 0, errors: 0 };
    /** A stored template row as find() returns it. */
    const row = (over: Partial<ProvisionedTemplateDsCompareConfig>) =>
      ({
        id: 'row', organization_id: null, dashboard_uid: 'jmeter-overview', regex: false, dashboard_label: null,
        panel_id: 5, panel_title: null, metric_name: null, metric_classification: 'RED_rate',
        higher_is_better: null, config_overrides: {}, read_only: true, ...over,
      }) as unknown as ProvisionedTemplateDsCompareConfig;

    it('should create a new classification', async () => {
      templateRepo.findOne.mockResolvedValue(null);
      templateRepo.insert.mockResolvedValue(undefined as any);

      const result = await service.provisionMetricClassifications(
        [{
          dashboardUid: 'jmeter-overview',
          dashboardLabel: 'JMeter Overview',
          panelId: 5,
          panelTitle: 'Error Rate',
          metricClassification: 'RED_errors',
          higherIsBetter: false,
        }],
        null,
      );

      expect(result).toEqual({ ...SUMMARY, created: 1 });
      expect(templateRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          dashboard_uid: 'jmeter-overview',
          panel_id: 5,
          metric_classification: 'RED_errors',
          higher_is_better: false,
          created_by: 'system:provisioning',
        }),
      );
    });

    it('updates a provisioned template whose values changed', async () => {
      templateRepo.find.mockResolvedValue([row({ id: 'cls-uuid', metric_classification: 'RED_errors' })]);
      templateRepo.update.mockResolvedValue(undefined as any);

      const result = await service.provisionMetricClassifications(
        [{
          dashboardUid: 'jmeter-overview',
          panelId: 5,
          metricClassification: 'RED_rate',
          higherIsBetter: true,
        }],
        null,
      );

      expect(result).toEqual({ ...SUMMARY, updated: 1 });
      expect(templateRepo.update).toHaveBeenCalledWith(
        'cls-uuid',
        expect.objectContaining({
          metric_classification: 'RED_rate',
          updated_by: 'system:provisioning',
        }),
      );
    });

    it('reports an identical template as unchanged and writes nothing', async () => {
      templateRepo.find.mockResolvedValue([
        row({ id: 'cls-uuid', higher_is_better: true, config_overrides: { higherIsBetter: true } }),
      ]);

      const result = await service.provisionMetricClassifications(
        [{ dashboardUid: 'jmeter-overview', panelId: 5, metricClassification: 'RED_rate', higherIsBetter: true }],
        null,
      );

      expect(result).toEqual({ ...SUMMARY, unchanged: 1 });
      expect(templateRepo.update).not.toHaveBeenCalled();
      expect(templateRepo.insert).not.toHaveBeenCalled();
    });

    it('persists a wildcard template (no dashboardUid) keyed on NULL uid + panel + regex', async () => {
      // A template on the same panel of one specific dashboard is a different key.
      templateRepo.find.mockResolvedValue([row({ dashboard_uid: 'x', panel_id: 201, read_only: false })]);
      templateRepo.insert.mockResolvedValue(undefined as any);

      const result = await service.provisionMetricClassifications(
        [{ panelId: 201, metricClassification: 'RED_rate', higherIsBetter: false }],
        null,
      );

      expect(result).toEqual({ ...SUMMARY, created: 1 });
      expect(templateRepo.find).toHaveBeenCalledWith({ where: { system_under_test_id: IsNull() } });
      expect(templateRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ dashboard_uid: null, regex: false, panel_id: 201 }),
      );
    });

    it('persists regex: true and keys the upsert on it', async () => {
      // The same text as a literal uid is a different template.
      templateRepo.find.mockResolvedValue([row({ dashboard_uid: '^performance-test-metrics-', panel_id: 201, read_only: false })]);
      templateRepo.insert.mockResolvedValue(undefined as any);

      await service.provisionMetricClassifications(
        [{ dashboardUid: '^performance-test-metrics-', regex: true, panelId: 201, metricClassification: 'RED_rate' }],
        null,
      );

      expect(templateRepo.update).not.toHaveBeenCalled();
      expect(templateRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ dashboard_uid: '^performance-test-metrics-', regex: true }),
      );
    });

    it('keys a title-only template on NULL panel_id + panel_title (#611)', async () => {
      // An id template whose descriptive title happens to read 'CPU Usage' is a different key.
      templateRepo.find.mockResolvedValue([
        row({ dashboard_uid: '^dynatrace-', regex: true, panel_id: 9, panel_title: 'CPU Usage', read_only: false }),
      ]);
      templateRepo.insert.mockResolvedValue(undefined as any);

      const result = await service.provisionMetricClassifications(
        [{ dashboardUid: '^dynatrace-', regex: true, panelTitle: 'CPU Usage', metricClassification: 'USE_utilization' }],
        null,
      );

      expect(result).toEqual({ ...SUMMARY, created: 1 });
      expect(templateRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ panel_id: null, panel_title: 'CPU Usage' }),
      );
    });

    it('counts a template with neither panelId nor panelTitle as an error', async () => {
      const result = await service.provisionMetricClassifications(
        [{ dashboardUid: 'x', metricClassification: 'RED_rate' }],
        null,
      );

      expect(result).toEqual({ ...SUMMARY, errors: 1 });
      expect(templateRepo.findOne).not.toHaveBeenCalled();
    });

    it('should set organization_id when provided', async () => {
      templateRepo.findOne.mockResolvedValue(null);
      templateRepo.insert.mockResolvedValue(undefined as any);

      await service.provisionMetricClassifications(
        [{
          dashboardUid: 'uid',
          panelId: 1,
          metricClassification: 'USE_utilization',
        }],
        'aaaaaaaa-0000-4000-8000-00000000000a',
      );

      expect(templateRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: 'aaaaaaaa-0000-4000-8000-00000000000a' }),
      );
    });

    it('marks what it creates read-only', async () => {
      await service.provisionMetricClassifications([{ panelId: 1, metricClassification: 'RED_rate' }], null);

      expect(templateRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ read_only: true }));
    });

    it('takes over a UI-created row holding a file key, counting it apart from updates', async () => {
      templateRepo.find.mockResolvedValue([row({ id: 'ui-row', read_only: false })]);

      const result = await service.provisionMetricClassifications(
        [{ dashboardUid: 'jmeter-overview', panelId: 5, metricClassification: 'RED_rate' }],
        null,
      );

      expect(result).toEqual({ ...SUMMARY, takenOver: 1 });
      expect(templateRepo.update).toHaveBeenCalledWith(
        'ui-row',
        expect.objectContaining({ read_only: true, updated_by: 'system:provisioning' }),
      );
    });

    it('writes config_overrides wholesale, so an override dropped from the file stops forcing', async () => {
      templateRepo.find.mockResolvedValue([row({ id: 'r', config_overrides: { absThreshold: 5 } })]);

      await service.provisionMetricClassifications(
        [{ dashboardUid: 'jmeter-overview', panelId: 5, metricClassification: 'RED_rate' }],
        null,
      );

      expect(templateRepo.update).toHaveBeenCalledWith(
        'r',
        expect.objectContaining({ config_overrides: {}, higher_is_better: null }),
      );
    });

    it('treats a NULL and an empty config_overrides as the same', async () => {
      templateRepo.find.mockResolvedValue([row({ config_overrides: null as unknown as Record<string, unknown> })]);

      const result = await service.provisionMetricClassifications(
        [{ dashboardUid: 'jmeter-overview', panelId: 5, metricClassification: 'RED_rate' }],
        null,
      );

      expect(result).toEqual({ ...SUMMARY, unchanged: 1 });
    });

    describe('prune', () => {
      /**
       * Value:
       *   protects — the file is the declared state for provisioned templates, without collateral
       *     deletes: a UI row and a row whose item merely failed to parse both survive.
       *   fails_when — the prune predicate widens past read_only rows, or a failed item's key is
       *     not declared.
       *   why_new — prune is new.
       */
      it('deletes provisioned templates the file no longer declares, by id, and nothing else', async () => {
        templateRepo.find.mockResolvedValue([
          row({ id: 'kept', panel_id: 1 }),
          row({ id: 'gone', panel_id: 2 }),
          row({ id: 'ui', panel_id: 3, read_only: false }),
          row({ id: 'invalid-item', panel_id: 4 }),
        ]);

        const result = await service.provisionMetricClassifications(
          [
            { dashboardUid: 'jmeter-overview', panelId: 1, metricClassification: 'RED_rate' },
            { dashboardUid: 'jmeter-overview', panelId: 4, metricClassification: 'RED_rate', aggregation: 'avg' },
          ],
          null,
        );

        expect(templateRepo.delete).toHaveBeenCalledTimes(1);
        expect(templateRepo.delete).toHaveBeenCalledWith('gone');
        expect(result).toEqual({ ...SUMMARY, unchanged: 1, pruned: 1, errors: 1 });
      });

      it('prunes every provisioned template for an explicit empty list', async () => {
        templateRepo.find.mockResolvedValue([row({ id: 'a' }), row({ id: 'b', panel_id: 6 })]);

        const result = await service.provisionMetricClassifications([], null);

        expect(result).toEqual({ ...SUMMARY, pruned: 2 });
      });

      /**
       * Value: protects=adding a file-level organizationId to a legacy file re-keys its templates:
       *   organization rows are created and the install-wide ones pruned, never both kept;
       * fails_when=organization_id drops out of templateKey, so the item matches the install-wide
       *   row and only updates it, or the old row survives the prune;
       * why_new=design 3 calls out this upgrade path and no case covered it;
       * seam=none; no_claim=the applier's side of the move (see the metrics spec)
       */
      it('moves a legacy install-wide template to the organization the file now names', async () => {
        templateRepo.find.mockResolvedValue([row({ id: 'install-wide', organization_id: null })]);

        const result = await service.provisionMetricClassifications(
          [{ dashboardUid: 'jmeter-overview', panelId: 5, metricClassification: 'RED_rate' }],
          'aaaaaaaa-0000-4000-8000-00000000000a',
        );

        expect(result).toEqual({ ...SUMMARY, created: 1, pruned: 1 });
        expect(templateRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ organization_id: 'aaaaaaaa-0000-4000-8000-00000000000a', panel_id: 5 }));
        expect(templateRepo.delete).toHaveBeenCalledWith('install-wide');
      });

      /**
       * Value: protects=a stored template survives a boot on which the item that would re-key it
       *   fails to write;
       * fails_when=the prune runs after a failed write: the stored row's key reads as undeclared and
       *   is deleted while its replacement never landed;
       * why_new=only the unidentified-item suppression was pinned;
       * seam=none; no_claim=which database errors cause the write to fail (mocked repository)
       */
      it('prunes nothing on a boot where a template failed to write', async () => {
        templateRepo.find.mockResolvedValue([row({ id: 'install-wide', organization_id: null })]);
        templateRepo.insert.mockRejectedValue(new Error('duplicate key value violates unique constraint'));

        const result = await service.provisionMetricClassifications(
          [{ dashboardUid: 'jmeter-overview', panelId: 5, metricClassification: 'RED_rate' }],
          'aaaaaaaa-0000-4000-8000-00000000000a',
        );

        expect(templateRepo.delete).not.toHaveBeenCalled();
        expect(result).toEqual({ ...SUMMARY, errors: 1 });
      });

      it('carries on past a prune that fails', async () => {
        templateRepo.find.mockResolvedValue([row({ id: 'a', panel_id: 1 }), row({ id: 'b', panel_id: 2 })]);
        templateRepo.delete.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined as any);

        const result = await service.provisionMetricClassifications([], null);

        expect(templateRepo.delete).toHaveBeenCalledWith('b');
        expect(result).toEqual({ ...SUMMARY, pruned: 1, errors: 1 });
      });

      it('prunes nothing while an item cannot be identified', async () => {
        templateRepo.find.mockResolvedValue([row({ id: 'gone', panel_id: 2 })]);

        const result = await service.provisionMetricClassifications(
          [{ dashboardUid: 'jmeter-overview', metricClassification: 'RED_rate' }],
          null,
        );

        expect(templateRepo.delete).not.toHaveBeenCalled();
        expect(result).toEqual({ ...SUMMARY, errors: 1 });
      });
    });

    it('skips both items declaring one key, and keeps the existing row', async () => {
      templateRepo.find.mockResolvedValue([row({ id: 'existing' })]);

      const result = await service.provisionMetricClassifications(
        [
          { dashboardUid: 'jmeter-overview', panelId: 5, panelTitle: 'A', metricClassification: 'RED_rate' },
          { dashboardUid: 'jmeter-overview', panelId: 5, panelTitle: 'B', metricClassification: 'RED_errors' },
        ],
        null,
      );

      expect(result).toEqual({ ...SUMMARY, errors: 2 });
      expect(templateRepo.update).not.toHaveBeenCalled();
      expect(templateRepo.insert).not.toHaveBeenCalled();
      expect(templateRepo.delete).not.toHaveBeenCalled();
    });

    it('carries on past an item that fails to write', async () => {
      templateRepo.insert.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined as any);

      const result = await service.provisionMetricClassifications(
        [
          { panelId: 1, metricClassification: 'RED_rate' },
          { panelId: 2, metricClassification: 'RED_rate' },
        ],
        null,
      );

      expect(result).toEqual({ ...SUMMARY, created: 1, errors: 1 });
    });

    it('holds an advisory lock across the run and releases it even when the read fails', async () => {
      templateRepo.find.mockRejectedValue(new Error('db down'));

      await expect(service.provisionMetricClassifications([], null)).rejects.toThrow('db down');

      const sql = queryRunner.query.mock.calls.map(([q]) => q as string);
      expect(sql[0]).toMatch(/pg_try_advisory_lock\(/);
      // The same key, or a session lock stays held on a pooled connection.
      expect(sql[sql.length - 1]).toBe(sql[0].replace('pg_try_advisory_lock(', 'pg_advisory_unlock(').replace(' AS locked', ''));
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('re-marks the rows provisioning wrote as read-only before it prunes', async () => {
      await service.provisionMetricClassifications([], null);

      const remark = queryRunner.query.mock.calls.find(([q]) => /UPDATE provisioned_template_ds_compare_configs/.test(q as string));
      expect(remark?.[0]).toMatch(/created_by = \$1 AND system_under_test_id IS NULL AND read_only IS NOT TRUE/);
      expect(remark?.[1]).toEqual(['system:provisioning']);
    });

    it('gives up on a lock another instance keeps, provisioning and pruning nothing', async () => {
      jest.useFakeTimers();
      try {
        queryRunner.query.mockResolvedValue([{ locked: false }]);
        templateRepo.find.mockResolvedValue([row({ id: 'gone' })]);

        const done = service.provisionMetricClassifications([], null);
        await jest.runAllTimersAsync();

        expect(await done).toEqual({ ...SUMMARY, errors: 1 });
        expect(templateRepo.find).not.toHaveBeenCalled();
        expect(templateRepo.delete).not.toHaveBeenCalled();
        expect(queryRunner.query.mock.calls.some(([q]) => /pg_advisory_unlock/.test(q as string))).toBe(false);
        expect(queryRunner.release).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    /**
     * Value:
     *   protects — export and provisioning share one format and one key: a committed export
     *     provisions back to itself, and a boot with an unchanged file writes nothing.
     *   fails_when — a field is dropped from the exporter, or the key drifts between the two.
     *   why_new — the exporter and the codec are new.
     */
    it('provisions an exported file back to itself, and a second boot reports nothing to do', async () => {
      const realYaml = jest.requireActual('js-yaml') as typeof yaml;
      mockedYaml.dump.mockImplementation(realYaml.dump);
      const { serializeTemplates } = await import('./compare-template-codec');
      const canonical = [
        'items:',
        '  - organizationId: null',
        '    panelId: 201',
        '    metricClassification: RED_rate',
        '    higherIsBetter: null',
        '    percentageThreshold: 0.15',
        '  - organizationId: aaaaaaaa-0000-4000-8000-00000000000a',
        '    dashboardUid: ^dynatrace-',
        '    regex: true',
        '    panelTitle: CPU Usage',
        '    metricClassification: USE_utilization',
        '    absThreshold: 5',
        '',
      ].join('\n');
      const { items } = realYaml.load(canonical) as { items: unknown[] };

      // An in-memory table behind the repository.
      const table: ProvisionedTemplateDsCompareConfig[] = [];
      templateRepo.find.mockImplementation(async () => table.map((r) => ({ ...r })));
      templateRepo.insert.mockImplementation(async (v: any) => {
        table.push({ id: `id-${table.length}`, ...v });
        return undefined as any;
      });

      expect(await service.provisionMetricClassifications(items, null)).toEqual({ ...SUMMARY, created: 2 });
      expect(serializeTemplates(table)).toBe(canonical);
      expect(await service.provisionMetricClassifications(items, null)).toEqual({ ...SUMMARY, unchanged: 2 });
    });
  });

  describe('runProvisioning (integration)', () => {
    it('should process all YAML files in order', async () => {
      // Make directory exist
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('content');

      // All files return empty arrays
      mockedYaml.load.mockReturnValue([]);

      await service.runProvisioning('/test');

      // Should check for each file
      expect(mockedFs.existsSync).toHaveBeenCalledWith('/test/profiles.yaml');
      expect(mockedFs.existsSync).toHaveBeenCalledWith('/test/profile_grafana_dashboards.yaml');
      expect(mockedFs.existsSync).toHaveBeenCalledWith('/test/profile_benchmarks.yaml');
      expect(mockedFs.existsSync).toHaveBeenCalledWith('/test/template_ds_compare_configs.yaml');
    });

    it('should skip missing files gracefully', async () => {
      // Only profiles.yaml exists
      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        return String(p).endsWith('profiles.yaml');
      });
      mockedFs.readFileSync.mockReturnValue('content');
      mockedYaml.load.mockReturnValue([]);

      // Should not throw
      await service.runProvisioning('/test');

      expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);
    });
  });
});
