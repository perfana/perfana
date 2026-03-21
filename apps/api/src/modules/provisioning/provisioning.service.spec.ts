import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
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

  const createMockRepo = () => ({
    findOne: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
  });

  beforeEach(async () => {
    const mockProfileRepo = createMockRepo();
    const mockDashboardRepo = createMockRepo();
    const mockBenchmarkRepo = createMockRepo();
    const mockTemplateRepo = createMockRepo();

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

      expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: 0 });
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

    it('should update existing classification', async () => {
      templateRepo.findOne.mockResolvedValue({ id: 'cls-uuid' } as ProvisionedTemplateDsCompareConfig);
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

      expect(result).toEqual({ created: 0, updated: 1, skipped: 0, errors: 0 });
      expect(templateRepo.update).toHaveBeenCalledWith(
        'cls-uuid',
        expect.objectContaining({
          metric_classification: 'RED_rate',
          updated_by: 'system:provisioning',
        }),
      );
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
        'org-uuid',
      );

      expect(templateRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: 'org-uuid' }),
      );
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
