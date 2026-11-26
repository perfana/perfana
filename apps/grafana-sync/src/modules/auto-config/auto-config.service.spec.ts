/**
 * Copyright 2025 Perfana Contributors
 *
 * Comprehensive unit tests for AutoConfigService
 * Tests orchestration logic for automatic dashboard configuration
 */

// Mock entities to avoid circular dependency
jest.mock('@perfana/shared/entities', () => ({
  TestRun: class TestRun {},
  Profile: class Profile {},
  ProfileGrafanaDashboard: class ProfileGrafanaDashboard {},
  ProfileBenchmark: class ProfileBenchmark {},
  Benchmark: class Benchmark {},
  GrafanaDashboard: class GrafanaDashboard {},
  GrafanaInstance: class GrafanaInstance {},
  ProxyServer: class ProxyServer {},
  ApplicationDashboard: class ApplicationDashboard {},
  SystemUnderTest: class SystemUnderTest {},
  AuditLog: class AuditLog {},
}));

// Break the @InjectRepository(AuditLog) circular dep in grafana-sync-audit.service.ts
jest.mock('../audit/grafana-sync-audit.service');

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AutoConfigService } from './auto-config.service';
import { TestRunFinderService } from './test-run-finder.service';
import { DashboardFinderService } from './dashboard-finder.service';
import { DashboardConfiguratorService } from './dashboard-configurator.service';
import { BenchmarkProcessorService } from './benchmark-processor.service';
import { GroupingRuleProcessorService } from './grouping-rule-processor.service';
import { createMockConfigService } from '../../../test/helpers';

describe('AutoConfigService', () => {
  let service: AutoConfigService;
  let configService: any;
  let testRunFinderService: jest.Mocked<TestRunFinderService>;
  let dashboardFinderService: jest.Mocked<DashboardFinderService>;
  let dashboardConfiguratorService: jest.Mocked<DashboardConfiguratorService>;
  let benchmarkProcessorService: jest.Mocked<BenchmarkProcessorService>;
  const groupingRuleProcessorService = {
    findProfileGroupingRules: jest.fn().mockResolvedValue([]),
    processProfileGroupingRules: jest.fn().mockResolvedValue(undefined),
  };

  // Mock data
  const mockTestRun: any = {
    testRunId: 'test-run-1',
    systemUnderTest: { name: 'my-app' },
    systemUnderTestId: 'sut-id',
    testEnvironment: 'production',
    workload: 'load-test',
    endTime: new Date('2024-01-02T00:00:00.000Z'),
    tags: ['profile-1', 'profile-2'],
    variables: [{ name: 'service', value: 'api' }],
    organizationId: 'org-123',
  };

  const mockProfile = {
    id: 'profile-1',
    name: 'Production Profile',
    tags: ['profile-1'],
    organizationId: 'org-123',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;

  const mockAutoConfigDashboard: any = {
    profile: 'Production Profile',
    dashboardName: 'JVM Overview',
    dashboardUid: 'jvm-overview-uid',
    grafanaLabel: 'grafana-prod',
    createSeparateDashboardForVariable: undefined,
    setHardcodedValueForVariables: undefined,
    matchRegexForVariables: undefined,
    readOnly: false,
  };

  beforeEach(async () => {
    // Create mocked services
    configService = createMockConfigService({ AUTO_CONFIG_ENABLED: true });

    testRunFinderService = {
      findRecentTestRuns: jest.fn(),
      findProfiles: jest.fn(),
      findProfileBenchmarks: jest.fn(),
      findBenchmarkForApplicationDashboardOrNull: jest.fn(),
    } as any;

    dashboardFinderService = {
      findAutoConfigGrafanaDashboards: jest.fn(),
      findGrafanaDashboardOrNull: jest.fn(),
      findGrafanaDashboard: jest.fn(),
      findGrafanaConfiguration: jest.fn(),
      findApplicationDashboardsForSystemUnderTest: jest.fn(),
      findExistingGrafanaDashboards: jest.fn(),
      findApplicationDashboardsByTemplateDashboardUid: jest.fn(),
      findApplicationDashboards: jest.fn(),
      findExistingGrafanaDashboardsByResolvedUid: jest.fn(),
    } as any;

    dashboardConfiguratorService = {
      processAutoConfigDashboard: jest.fn(),
    } as any;

    benchmarkProcessorService = {
      processProfileBenchmarks: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoConfigService,
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: TestRunFinderService,
          useValue: testRunFinderService,
        },
        {
          provide: DashboardFinderService,
          useValue: dashboardFinderService,
        },
        {
          provide: DashboardConfiguratorService,
          useValue: dashboardConfiguratorService,
        },
        {
          provide: BenchmarkProcessorService,
          useValue: benchmarkProcessorService,
        },
        {
          provide: GroupingRuleProcessorService,
          useValue: groupingRuleProcessorService,
        },
      ],
    }).compile();

    service = module.get<AutoConfigService>(AutoConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have all dependencies injected', () => {
      expect((service as any).configService).toBeDefined();
      expect((service as any).testRunFinderService).toBeDefined();
      expect((service as any).dashboardFinderService).toBeDefined();
      expect((service as any).dashboardConfiguratorService).toBeDefined();
      expect((service as any).benchmarkProcessorService).toBeDefined();
    });

    it('should initialize isProcessing to false', () => {
      expect((service as any).isProcessing).toBe(false);
    });
  });

  describe('handleAutoConfig', () => {
    describe('Happy Path Scenarios', () => {
      it('should process auto-config when enabled and not processing', async () => {
        // Arrange
        configService.get.mockReturnValue(true);
        jest.spyOn(service, 'processAutoConfigDashboards').mockResolvedValue();

        // Act
        await service.handleAutoConfig();

        // Assert
        expect(service.processAutoConfigDashboards).toHaveBeenCalled();
      });

      it('should set isProcessing flag during execution', async () => {
        // Arrange
        configService.get.mockReturnValue(true);
        let processingDuringExecution = false;

        jest.spyOn(service, 'processAutoConfigDashboards').mockImplementation(async () => {
          processingDuringExecution = (service as any).isProcessing;
        });

        // Act
        await service.handleAutoConfig();

        // Assert
        expect(processingDuringExecution).toBe(true);
        expect((service as any).isProcessing).toBe(false);
      });
    });

    describe('Edge Cases', () => {
      it('should skip when auto-config is disabled', async () => {
        // Arrange
        configService.get.mockReturnValue(false);
        jest.spyOn(service, 'processAutoConfigDashboards').mockResolvedValue();

        // Act
        await service.handleAutoConfig();

        // Assert
        expect(service.processAutoConfigDashboards).not.toHaveBeenCalled();
      });

      it('should skip when already processing', async () => {
        // Arrange
        configService.get.mockReturnValue(true);
        (service as any).isProcessing = true;
        jest.spyOn(service, 'processAutoConfigDashboards').mockResolvedValue();
        const warnSpy = jest.spyOn((service as any).logger, 'warn');

        // Act
        await service.handleAutoConfig();

        // Assert
        expect(service.processAutoConfigDashboards).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith('Auto-config already in progress, skipping...');
      });
    });

    describe('Error Scenarios', () => {
      it('should handle errors and reset processing flag', async () => {
        // Arrange
        configService.get.mockReturnValue(true);
        const error = new Error('Processing failed');
        jest.spyOn(service, 'processAutoConfigDashboards').mockRejectedValue(error);
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        // Act
        await service.handleAutoConfig();

        // Assert
        expect(errorSpy).toHaveBeenCalledWith('Auto-config failed:', error.stack);
        expect((service as any).isProcessing).toBe(false);
      });

      it('should handle non-Error exceptions', async () => {
        // Arrange
        configService.get.mockReturnValue(true);
        jest.spyOn(service, 'processAutoConfigDashboards').mockRejectedValue('String error');
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        // Act
        await service.handleAutoConfig();

        // Assert
        expect(errorSpy).toHaveBeenCalledWith('Auto-config failed:', 'String error');
        expect((service as any).isProcessing).toBe(false);
      });
    });
  });

  describe('processAutoConfigDashboards', () => {
    describe('Happy Path Scenarios', () => {
      it('should process test runs with profiles and dashboards', async () => {
        // Arrange
        testRunFinderService.findRecentTestRuns.mockResolvedValue([mockTestRun]);
        testRunFinderService.findProfiles.mockResolvedValue([mockProfile]);
        dashboardFinderService.findAutoConfigGrafanaDashboards.mockResolvedValue([
          mockAutoConfigDashboard,
        ]);
        testRunFinderService.findProfileBenchmarks.mockResolvedValue([]);

        // Act
        await service.processAutoConfigDashboards();

        // Assert
        expect(testRunFinderService.findRecentTestRuns).toHaveBeenCalled();
        expect(testRunFinderService.findProfiles).toHaveBeenCalled();
        expect(dashboardFinderService.findAutoConfigGrafanaDashboards).toHaveBeenCalled();
        expect(dashboardConfiguratorService.processAutoConfigDashboard).toHaveBeenCalledWith(
          mockTestRun,
          mockAutoConfigDashboard,
          [{ name: 'service', value: 'api' }],
        );
      });

      it('should filter test runs without tags and log them', async () => {
        // Arrange
        const testRunWithoutTags = {
          ...mockTestRun,
          tags: [] as string[],
        };

        testRunFinderService.findRecentTestRuns.mockResolvedValue([testRunWithoutTags]);
        testRunFinderService.findProfiles.mockResolvedValue([mockProfile]);
        dashboardFinderService.findAutoConfigGrafanaDashboards.mockResolvedValue([
          mockAutoConfigDashboard,
        ]);
        testRunFinderService.findProfileBenchmarks.mockResolvedValue([]);

        const logSpy = jest.spyOn((service as any).logger, 'log');

        // Act
        await service.processAutoConfigDashboards();

        // Assert
        expect(logSpy).toHaveBeenCalledWith(
          `No AutoConfig process for test run because there are no tags: ${testRunWithoutTags.testRunId}`,
        );
        expect(dashboardConfiguratorService.processAutoConfigDashboard).not.toHaveBeenCalled();
      });

      it('should process profile benchmarks when available', async () => {
        // Arrange
        const mockProfileBenchmark: any = {
          id: 'benchmark-1',
          profile_id: 'profile-1',
          profile: { name: 'Production Profile' },
          profile_dashboard_id: 'dash-1',
          workload_pattern: 'load-.*',
          source: 'gatling',
          exclude_ramp_up_time: true,
          average_all: false,
          validate_with_default_if_no_data: false,
          tags: [],
          metadata: {},
          read_only: false,
        };

        testRunFinderService.findRecentTestRuns.mockResolvedValue([mockTestRun]);
        testRunFinderService.findProfiles.mockResolvedValue([mockProfile]);
        dashboardFinderService.findAutoConfigGrafanaDashboards.mockResolvedValue([
          mockAutoConfigDashboard,
        ]);
        testRunFinderService.findProfileBenchmarks.mockResolvedValue([mockProfileBenchmark]);

        // Act
        await service.processAutoConfigDashboards();

        // Assert
        expect(benchmarkProcessorService.processProfileBenchmarks).toHaveBeenCalledWith(
          mockTestRun,
          ['Production Profile'],
          [mockProfileBenchmark],
        );
      });

      // Value: protects=auto-config hands the matched profiles' grouping rules to the processor, after the
      //   dashboards it needs exist, and skips it with no rules; fails_when=the rules are not threaded from the
      //   context, the call is dropped, or moved before dashboard configuration; why_new=the processor's own spec
      //   cannot see its caller; seam=none; no_claim=what the processor writes (mocked; unit only)
      it('provisions profile series grouping rules after the dashboards, and only when there are some', async () => {
        const groupingRule: any = {
          id: 'pr-1',
          profile: 'Production Profile',
          dashboard_uid: 'tmpl',
        };
        testRunFinderService.findRecentTestRuns.mockResolvedValue([mockTestRun]);
        testRunFinderService.findProfiles.mockResolvedValue([mockProfile]);
        dashboardFinderService.findAutoConfigGrafanaDashboards.mockResolvedValue([
          mockAutoConfigDashboard,
        ]);
        testRunFinderService.findProfileBenchmarks.mockResolvedValue([]);
        groupingRuleProcessorService.findProfileGroupingRules.mockResolvedValueOnce([groupingRule]);

        await service.processAutoConfigDashboards();

        expect(groupingRuleProcessorService.processProfileGroupingRules).toHaveBeenCalledWith(
          mockTestRun,
          ['Production Profile'],
          [groupingRule],
        );
        expect(
          dashboardConfiguratorService.processAutoConfigDashboard.mock.invocationCallOrder[0],
        ).toBeLessThan(
          groupingRuleProcessorService.processProfileGroupingRules.mock.invocationCallOrder[0]!,
        );

        groupingRuleProcessorService.processProfileGroupingRules.mockClear();
        await service.processAutoConfigDashboards();
        expect(groupingRuleProcessorService.processProfileGroupingRules).not.toHaveBeenCalled();
      });

      it('still processes profile benchmarks when the org has no profile dashboards', async () => {
        // A perf-test profile benchmark needs no Grafana template; the empty-dashboards
        // early return used to skip the whole pass for a JMeter-only org.
        const perfTestBenchmark: any = {
          id: 'benchmark-perf',
          profile: { name: 'Production Profile' },
          profile_dashboard_id: null,
          source: 'performance-metrics',
          workload_pattern: '.*',
        };
        testRunFinderService.findRecentTestRuns.mockResolvedValue([mockTestRun]);
        testRunFinderService.findProfiles.mockResolvedValue([mockProfile]);
        dashboardFinderService.findAutoConfigGrafanaDashboards.mockResolvedValue([]);
        testRunFinderService.findProfileBenchmarks.mockResolvedValue([perfTestBenchmark]);

        await service.processAutoConfigDashboards();

        expect(benchmarkProcessorService.processProfileBenchmarks).toHaveBeenCalledWith(
          mockTestRun,
          ['Production Profile'],
          [perfTestBenchmark],
        );
      });

      it('should filter profiles by organization_id when test run has organizationId', async () => {
        // Arrange
        const orgId = 'org-123';
        const testRunWithOrg: any = {
          ...mockTestRun,
          organizationId: orgId,
        };

        const profileInOrg = {
          ...mockProfile,
          id: 'profile-in-org',
          name: 'Production Profile', // Match mockAutoConfigDashboard.profile
          tags: ['profile-1'],
          organizationId: orgId,
        };

        const profileInDifferentOrg = {
          ...mockProfile,
          id: 'profile-different-org',
          name: 'Profile Different Org',
          tags: ['profile-1'],
          organizationId: 'org-456',
        };

        const profileWithNullOrg = {
          ...mockProfile,
          id: 'profile-null-org',
          name: 'Profile Null Org',
          tags: ['profile-1'],
          organizationId: null,
        };

        testRunFinderService.findRecentTestRuns.mockResolvedValue([testRunWithOrg]);
        testRunFinderService.findProfiles.mockResolvedValue([
          profileInOrg,
          profileInDifferentOrg,
          profileWithNullOrg,
        ]);
        dashboardFinderService.findAutoConfigGrafanaDashboards.mockResolvedValue([
          mockAutoConfigDashboard,
        ]);
        testRunFinderService.findProfileBenchmarks.mockResolvedValue([]);

        const logSpy = jest.spyOn((service as any).logger, 'log');

        // Act
        await service.processAutoConfigDashboards();

        // Assert - only the profile in the run's own organization: the shared matcher fails closed,
        // so a profile with no organization no longer matches every organization's runs.
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`matched 1 profiles`));
        expect(dashboardConfiguratorService.processAutoConfigDashboard).toHaveBeenCalled();
      });

      it('should match no profile when test run has no organizationId', async () => {
        // Arrange
        const testRunWithoutOrg: any = {
          ...mockTestRun,
          organizationId: undefined,
        };

        const profile1 = {
          ...mockProfile,
          id: 'profile-1',
          name: 'Profile 1',
          tags: ['profile-1'],
          organizationId: 'org-123',
        };

        const profile2 = {
          ...mockProfile,
          id: 'profile-2',
          name: 'Profile 2',
          tags: ['profile-2'],
          organizationId: 'org-456',
        };

        testRunFinderService.findRecentTestRuns.mockResolvedValue([testRunWithoutOrg]);
        testRunFinderService.findProfiles.mockResolvedValue([profile1, profile2]);
        dashboardFinderService.findAutoConfigGrafanaDashboards.mockResolvedValue([
          mockAutoConfigDashboard,
        ]);
        testRunFinderService.findProfileBenchmarks.mockResolvedValue([]);

        const logSpy = jest.spyOn((service as any).logger, 'log');

        // Act
        await service.processAutoConfigDashboards();

        // Assert - fails closed (packages/shared utils/profile-match): a run with no organization
        // matches no profile, where it used to match every organization's.
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`matched 0 profiles`));
      });
    });

    describe('Edge Cases', () => {
      it('should skip when no recent test runs found', async () => {
        // Arrange
        testRunFinderService.findRecentTestRuns.mockResolvedValue([]);
        const logSpy = jest.spyOn((service as any).logger, 'log');

        // Act
        await service.processAutoConfigDashboards();

        // Assert
        expect(logSpy).toHaveBeenCalledWith(
          'No recent test runs with tags found. AutoConfig processing skipped.',
        );
        expect(testRunFinderService.findProfiles).not.toHaveBeenCalled();
      });

      it('should skip when no profiles found', async () => {
        // Arrange
        testRunFinderService.findRecentTestRuns.mockResolvedValue([mockTestRun]);
        testRunFinderService.findProfiles.mockResolvedValue([]);
        dashboardFinderService.findAutoConfigGrafanaDashboards.mockResolvedValue([
          mockAutoConfigDashboard,
        ]);
        testRunFinderService.findProfileBenchmarks.mockResolvedValue([]);
        const logSpy = jest.spyOn((service as any).logger, 'log');

        // Act
        await service.processAutoConfigDashboards();

        // Assert
        expect(logSpy).toHaveBeenCalledWith('No profiles found. AutoConfig processing skipped.');
        // With parallel loading, all three queries run concurrently, but processing is skipped
        expect(dashboardConfiguratorService.processAutoConfigDashboard).not.toHaveBeenCalled();
      });

      it('should skip when no auto-config dashboards found', async () => {
        // Arrange
        testRunFinderService.findRecentTestRuns.mockResolvedValue([mockTestRun]);
        testRunFinderService.findProfiles.mockResolvedValue([mockProfile]);
        dashboardFinderService.findAutoConfigGrafanaDashboards.mockResolvedValue([]);
        testRunFinderService.findProfileBenchmarks.mockResolvedValue([]);
        const logSpy = jest.spyOn((service as any).logger, 'log');

        // Act
        await service.processAutoConfigDashboards();

        // Assert
        expect(logSpy).toHaveBeenCalledWith(
          'No auto config dashboards or profile benchmarks found. AutoConfig processing skipped.',
        );
      });
    });

    describe('Error Scenarios', () => {
      it('should handle errors for individual dashboards and continue processing', async () => {
        // Arrange
        const testRun2: any = {
          ...mockTestRun,
          testRunId: 'test-run-2',
        };

        testRunFinderService.findRecentTestRuns.mockResolvedValue([mockTestRun, testRun2]);
        testRunFinderService.findProfiles.mockResolvedValue([mockProfile]);
        dashboardFinderService.findAutoConfigGrafanaDashboards.mockResolvedValue([
          mockAutoConfigDashboard,
        ]);
        testRunFinderService.findProfileBenchmarks.mockResolvedValue([]);

        dashboardConfiguratorService.processAutoConfigDashboard
          .mockRejectedValueOnce(new Error('Processing failed'))
          .mockResolvedValueOnce(undefined);

        const errorSpy = jest.spyOn((service as any).logger, 'error');

        // Act
        await service.processAutoConfigDashboards();

        // Assert - Error is caught at dashboard level, not test run level
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Error processing auto config dashboard'),
          expect.any(Error),
        );
        // Both test runs should be processed even if first dashboard fails
        expect(dashboardConfiguratorService.processAutoConfigDashboard).toHaveBeenCalledTimes(2);
      });
    });
  });
  describe('additional SUT monitoring', () => {
    const k8sProfile = { ...mockProfile, id: 'p-k8s', name: 'k8s', tags: ['unrelated'] };
    const k8sDashboard = { ...mockAutoConfigDashboard, profile: 'k8s', dashboardUid: 'k8s-uid' };

    const runWith = async (
      additionalSutMonitoring: unknown,
      profiles = [mockProfile, k8sProfile],
    ) => {
      testRunFinderService.findRecentTestRuns.mockResolvedValue([
        { ...mockTestRun, additionalSutMonitoring },
      ]);
      testRunFinderService.findProfiles.mockResolvedValue(profiles);
      testRunFinderService.findProfileBenchmarks.mockResolvedValue([{ id: 'b1' }] as any);
      groupingRuleProcessorService.findProfileGroupingRules.mockResolvedValue([{ id: 'g1' }]);
      dashboardFinderService.findAutoConfigGrafanaDashboards.mockResolvedValue([
        mockAutoConfigDashboard,
        k8sDashboard,
      ]);
      await service.processAutoConfigDashboards();
    };

    it("applies the run's matched profiles to an entry without a profile, owned by the run", async () => {
      await runWith([{ systemUnderTest: 'payment-db', testEnvironment: 'acc' }]);

      const calls = dashboardConfiguratorService.processAutoConfigDashboard.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0]![0].systemUnderTest?.name).toBe('my-app');
      const [monitoringRun, dashboard] = calls[1]!;
      expect(monitoringRun.systemUnderTest?.name).toBe('payment-db');
      expect(monitoringRun.testEnvironment).toBe('acc');
      expect(dashboard).toBe(mockAutoConfigDashboard);

      // SLOs and rules get the run itself plus the combination they are scoped to.
      const target = { systemUnderTest: 'payment-db', testEnvironment: 'acc' };
      expect(benchmarkProcessorService.processProfileBenchmarks).toHaveBeenLastCalledWith(
        expect.objectContaining({ testRunId: 'test-run-1', testEnvironment: 'production' }),
        ['Production Profile'],
        expect.any(Array),
        target,
      );
      expect(groupingRuleProcessorService.processProfileGroupingRules).toHaveBeenLastCalledWith(
        expect.objectContaining({ testEnvironment: 'production' }),
        ['Production Profile'],
        expect.any(Array),
        target,
      );
    });

    it("applies a named profile instead of the run's, without needing its tags", async () => {
      await runWith([{ systemUnderTest: 'payment-db', testEnvironment: 'acc', profile: 'k8s' }]);

      const calls = dashboardConfiguratorService.processAutoConfigDashboard.mock.calls;
      expect(calls.map((c) => c[1])).toEqual([mockAutoConfigDashboard, k8sDashboard]);
      expect(benchmarkProcessorService.processProfileBenchmarks).toHaveBeenLastCalledWith(
        expect.anything(),
        ['k8s'],
        expect.any(Array),
        expect.objectContaining({ profile: 'k8s' }),
      );
    });

    it('skips an entry naming a profile of another organization', async () => {
      await runWith(
        [{ systemUnderTest: 'payment-db', testEnvironment: 'acc', profile: 'k8s' }],
        [mockProfile, { ...k8sProfile, organizationId: 'other-org' }],
      );

      expect(dashboardConfiguratorService.processAutoConfigDashboard).toHaveBeenCalledTimes(1);
      expect(benchmarkProcessorService.processProfileBenchmarks).toHaveBeenCalledTimes(1);
    });
  });
});
