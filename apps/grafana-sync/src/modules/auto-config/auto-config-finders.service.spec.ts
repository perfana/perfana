/**
 * Copyright 2025 Perfana Contributors
 *
 * Unit tests for AutoConfigFindersService (Facade)
 * Tests that the facade correctly delegates to specialized finder services
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AutoConfigFindersService, MappedTestRun } from './auto-config-finders.service';
import { TestRunFinderService, MappedProfileBenchmark } from './test-run-finder.service';
import {
  DashboardFinderService,
  MappedAutoConfigDashboard,
  MappedGrafanaDashboard,
  MappedGrafanaConfig,
} from './dashboard-finder.service';
import { Profile, Benchmark, ApplicationDashboard } from '@perfana/shared/entities';

describe('AutoConfigFindersService', () => {
  let service: AutoConfigFindersService;
  let testRunFinderService: jest.Mocked<TestRunFinderService>;
  let dashboardFinderService: jest.Mocked<DashboardFinderService>;

  beforeEach(async () => {
    // Create mock services
    testRunFinderService = {
      findRecentTestRuns: jest.fn(),
      findProfiles: jest.fn(),
      findProfileBenchmarks: jest.fn(),
      findBenchmarkForApplicationDashboardOrNull: jest.fn(),
      findGenericDeepLinks: jest.fn(),
      findGenericReportPanels: jest.fn(),
      findDeepLinkForTestRunOrNull: jest.fn(),
    } as any;

    dashboardFinderService = {
      findAutoConfigGrafanaDashboards: jest.fn(),
      findGrafanaDashboardOrNull: jest.fn(),
      findGrafanaDashboard: jest.fn(),
      findApplicationDashboardsForSystemUnderTest: jest.fn(),
      findExistingGrafanaDashboards: jest.fn(),
      findGrafanaConfiguration: jest.fn(),
      findApplicationDashboardsByTemplateDashboardUid: jest.fn(),
      findReportPanelForApplicationDashboardOrNull: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoConfigFindersService,
        {
          provide: TestRunFinderService,
          useValue: testRunFinderService,
        },
        {
          provide: DashboardFinderService,
          useValue: dashboardFinderService,
        },
      ],
    }).compile();

    service = module.get<AutoConfigFindersService>(AutoConfigFindersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have both finder services injected', () => {
      expect((service as any).testRunFinder).toBeDefined();
      expect((service as any).dashboardFinder).toBeDefined();
    });
  });

  // ============================================
  // Test Run Finder Methods (delegated)
  // ============================================

  describe('findRecentTestRuns', () => {
    it('should delegate to TestRunFinderService', async () => {
      const startTime = new Date('2024-01-01T00:00:00.000Z');
      const mockTestRuns: MappedTestRun[] = [
        {
          testRunId: 'test-run-1',
          systemUnderTestName: 'my-app',
          testEnvironment: 'production',
          workload: 'load-test',
          end: new Date('2024-01-02T00:00:00.000Z'),
          tags: ['tag1'],
          variables: [{ name: 'var1', value: 'val1' }],
        },
      ];
      testRunFinderService.findRecentTestRuns.mockResolvedValue(mockTestRuns);

      const result = await service.findRecentTestRuns(startTime);

      expect(testRunFinderService.findRecentTestRuns).toHaveBeenCalledWith(startTime);
      expect(result).toEqual(mockTestRuns);
    });
  });

  describe('findProfiles', () => {
    it('should delegate to TestRunFinderService', async () => {
      const mockProfiles = [
        { id: 'profile-1', name: 'Profile 1' },
        { id: 'profile-2', name: 'Profile 2' },
      ] as Profile[];
      testRunFinderService.findProfiles.mockResolvedValue(mockProfiles);

      const result = await service.findProfiles();

      expect(testRunFinderService.findProfiles).toHaveBeenCalled();
      expect(result).toEqual(mockProfiles);
    });
  });

  describe('findProfileBenchmarks', () => {
    it('should delegate to TestRunFinderService', async () => {
      const mockBenchmarks: MappedProfileBenchmark[] = [
        {
          id: 'benchmark-1',
          profileId: 'profile-1',
          profileName: 'Production Profile',
          profileDashboardId: 'dash-1',
          workloadPattern: 'load-.*',
          source: 'gatling',
          grafanaInstance: 'grafana-prod',
          dashboardUid: 'jvm-overview',
          panelId: 1,
          panelTitle: 'Heap Usage',
          panelType: 'graph',
          evaluateType: 'avg',
          excludeRampUpTime: true,
          averageAll: false,
          validateWithDefaultIfNoData: false,
          readOnly: false,
          tags: [],
          metadata: {},
        },
      ];
      testRunFinderService.findProfileBenchmarks.mockResolvedValue(mockBenchmarks);

      const result = await service.findProfileBenchmarks();

      expect(testRunFinderService.findProfileBenchmarks).toHaveBeenCalled();
      expect(result).toEqual(mockBenchmarks);
    });
  });

  describe('findBenchmarkForApplicationDashboardOrNull', () => {
    it('should delegate to TestRunFinderService', async () => {
      const appDashboard = { id: 'app-dash-1' } as ApplicationDashboard;
      const mockBenchmark = { id: 'benchmark-1' } as Benchmark;
      testRunFinderService.findBenchmarkForApplicationDashboardOrNull.mockResolvedValue(
        mockBenchmark,
      );

      const result = await service.findBenchmarkForApplicationDashboardOrNull(
        appDashboard,
        'profile-benchmark-1',
        'load-test',
      );

      expect(testRunFinderService.findBenchmarkForApplicationDashboardOrNull).toHaveBeenCalledWith(
        appDashboard,
        'profile-benchmark-1',
        'load-test',
      );
      expect(result).toEqual(mockBenchmark);
    });
  });

  // ============================================
  // Dashboard Finder Methods (delegated)
  // ============================================

  describe('findAutoConfigGrafanaDashboards', () => {
    it('should delegate to DashboardFinderService', async () => {
      const mockDashboards: MappedAutoConfigDashboard[] = [
        {
          profile: 'profile-1',
          dashboardName: 'Test Dashboard',
          dashboardUid: 'dash-uid-1',
          grafana: 'grafana-prod',
        },
      ];
      dashboardFinderService.findAutoConfigGrafanaDashboards.mockResolvedValue(mockDashboards);

      const result = await service.findAutoConfigGrafanaDashboards();

      expect(dashboardFinderService.findAutoConfigGrafanaDashboards).toHaveBeenCalled();
      expect(result).toEqual(mockDashboards);
    });
  });

  describe('findGrafanaDashboardOrNull', () => {
    it('should delegate to DashboardFinderService', async () => {
      const mockDashboard: MappedGrafanaDashboard = {
        _id: 'dash-id-1',
        uid: 'dash-uid-1',
        grafana: 'grafana-prod',
        name: 'Test Dashboard',
        id: 123,
        postgresId: 'dash-id-1',
        tags: [],
        grafanaJson: null,
        usedBySUT: [],
        templatingVariables: [],
      };
      dashboardFinderService.findGrafanaDashboardOrNull.mockResolvedValue(mockDashboard);

      const result = await service.findGrafanaDashboardOrNull('grafana-prod', ['dash-uid-1']);

      expect(dashboardFinderService.findGrafanaDashboardOrNull).toHaveBeenCalledWith(
        'grafana-prod',
        ['dash-uid-1'],
      );
      expect(result).toEqual(mockDashboard);
    });
  });

  describe('findGrafanaDashboard', () => {
    it('should delegate to DashboardFinderService', async () => {
      const mockDashboard: MappedGrafanaDashboard = {
        _id: 'dash-id-1',
        uid: 'dash-uid-1',
        grafana: 'grafana-prod',
        name: 'Test Dashboard',
        id: 123,
        postgresId: 'dash-id-1',
        tags: [],
        grafanaJson: null,
        usedBySUT: [],
        templatingVariables: [],
      };
      dashboardFinderService.findGrafanaDashboard.mockResolvedValue(mockDashboard);

      const result = await service.findGrafanaDashboard('grafana-prod', ['dash-uid-1']);

      expect(dashboardFinderService.findGrafanaDashboard).toHaveBeenCalledWith('grafana-prod', [
        'dash-uid-1',
      ]);
      expect(result).toEqual(mockDashboard);
    });
  });

  describe('findApplicationDashboardsForSystemUnderTest', () => {
    it('should delegate to DashboardFinderService', async () => {
      const testRun: MappedTestRun = {
        testRunId: 'test-1',
        systemUnderTestName: 'my-app',
        testEnvironment: 'production',
        workload: 'load-test',
        end: new Date(),
        tags: [],
        variables: [],
      };
      const mockDashboards = [{ id: 'app-dash-1' }] as ApplicationDashboard[];
      dashboardFinderService.findApplicationDashboardsForSystemUnderTest.mockResolvedValue(
        mockDashboards,
      );

      const result = await service.findApplicationDashboardsForSystemUnderTest(
        testRun,
        'grafana-prod',
        'dash-uid-1',
        'JVM Overview',
      );

      expect(
        dashboardFinderService.findApplicationDashboardsForSystemUnderTest,
      ).toHaveBeenCalledWith(testRun, 'grafana-prod', 'dash-uid-1', 'JVM Overview');
      expect(result).toEqual(mockDashboards);
    });
  });

  describe('findExistingGrafanaDashboards', () => {
    it('should delegate to DashboardFinderService', async () => {
      const mockDashboards = [{ id: 'dash-1', uid: 'uid-1' }];
      dashboardFinderService.findExistingGrafanaDashboards.mockResolvedValue(mockDashboards as any);

      const result = await service.findExistingGrafanaDashboards('grafana-prod', ['uid-1']);

      expect(dashboardFinderService.findExistingGrafanaDashboards).toHaveBeenCalledWith(
        'grafana-prod',
        ['uid-1'],
      );
      expect(result).toEqual(mockDashboards);
    });
  });

  describe('findGrafanaConfiguration', () => {
    it('should delegate to DashboardFinderService', async () => {
      const mockConfig: MappedGrafanaConfig = {
        label: 'grafana-prod',
        serverUrl: 'http://localhost:3000',
        clientUrl: 'http://localhost:3000',
        apiKey: 'test-api-key',
        orgId: 1,
      };
      dashboardFinderService.findGrafanaConfiguration.mockResolvedValue(mockConfig);

      const result = await service.findGrafanaConfiguration('grafana-prod');

      expect(dashboardFinderService.findGrafanaConfiguration).toHaveBeenCalledWith('grafana-prod');
      expect(result).toEqual(mockConfig);
    });
  });

  describe('findGenericDeepLinks', () => {
    it('should delegate to TestRunFinderService', async () => {
      testRunFinderService.findGenericDeepLinks.mockResolvedValue([]);

      const result = await service.findGenericDeepLinks();

      expect(testRunFinderService.findGenericDeepLinks).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('findGenericReportPanels', () => {
    it('should delegate to TestRunFinderService', async () => {
      testRunFinderService.findGenericReportPanels.mockResolvedValue([]);

      const result = await service.findGenericReportPanels();

      expect(testRunFinderService.findGenericReportPanels).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('findApplicationDashboardsByTemplateDashboardUid', () => {
    it('should delegate to DashboardFinderService', async () => {
      const mockDashboards = [{ id: 'app-dash-1' }] as ApplicationDashboard[];
      dashboardFinderService.findApplicationDashboardsByTemplateDashboardUid.mockResolvedValue(
        mockDashboards,
      );

      const result = await service.findApplicationDashboardsByTemplateDashboardUid(
        'template-uid',
        'my-app',
        'production',
      );

      expect(
        dashboardFinderService.findApplicationDashboardsByTemplateDashboardUid,
      ).toHaveBeenCalledWith('template-uid', 'my-app', 'production', undefined);
      expect(result).toEqual(mockDashboards);
    });
  });

  describe('findDeepLinkForTestRunOrNull', () => {
    it('should delegate to TestRunFinderService', async () => {
      const testRun: MappedTestRun = {
        testRunId: 'test-1',
        systemUnderTestName: 'app',
        testEnvironment: 'test',
        workload: 'load',
        end: new Date(),
        tags: [],
        variables: [],
      };
      testRunFinderService.findDeepLinkForTestRunOrNull.mockResolvedValue(null);

      const result = await service.findDeepLinkForTestRunOrNull({}, testRun);

      expect(testRunFinderService.findDeepLinkForTestRunOrNull).toHaveBeenCalledWith({}, testRun);
      expect(result).toBeNull();
    });
  });

  describe('findReportPanelForApplicationDashboardOrNull', () => {
    it('should delegate to DashboardFinderService', async () => {
      const appDashboard = { id: 'app-dash-1' } as ApplicationDashboard;
      dashboardFinderService.findReportPanelForApplicationDashboardOrNull.mockResolvedValue(null);

      const result = await service.findReportPanelForApplicationDashboardOrNull(
        appDashboard,
        'panel-id',
        'load-test',
      );

      expect(
        dashboardFinderService.findReportPanelForApplicationDashboardOrNull,
      ).toHaveBeenCalledWith(appDashboard, 'panel-id', 'load-test');
      expect(result).toBeNull();
    });
  });
});
