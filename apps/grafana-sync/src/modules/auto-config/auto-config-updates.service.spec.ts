/**
 * Copyright 2025 Perfana Contributors
 *
 * Comprehensive unit tests for AutoConfigUpdatesService
 * Tests all database write operations for auto-configuration
 */

// Mock entities to avoid circular dependency
jest.mock('@perfana/shared/entities', () => ({
  ApplicationDashboard: class ApplicationDashboard {},
  Benchmark: class Benchmark {},
  GrafanaDashboard: class GrafanaDashboard {},
  GrafanaInstance: class GrafanaInstance {},
  SystemUnderTest: class SystemUnderTest {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { AutoConfigUpdatesService } from './auto-config-updates.service';
// Use entity types directly instead of mapped interfaces
import { createMockRepository } from '../../../test/helpers';

describe('AutoConfigUpdatesService', () => {
  let service: AutoConfigUpdatesService;
  let applicationDashboardRepo: any;
  let benchmarkRepo: any;
  let grafanaDashboardRepo: any;
  let grafanaInstanceRepo: any;
  let systemUnderTestRepo: any;

  beforeEach(async () => {
    // Create mock repositories
    applicationDashboardRepo = createMockRepository();
    benchmarkRepo = createMockRepository();
    grafanaDashboardRepo = createMockRepository();
    grafanaInstanceRepo = createMockRepository();
    systemUnderTestRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: AutoConfigUpdatesService,
          useFactory: () => {
            const mockDataSource = {
              getRepository: jest.fn().mockReturnValue(createMockRepository()),
            };
            return new AutoConfigUpdatesService(
              applicationDashboardRepo,
              benchmarkRepo,
              grafanaDashboardRepo,
              grafanaInstanceRepo,
              systemUnderTestRepo,
              mockDataSource as any,
            );
          },
        },
      ],
    }).compile();

    service = module.get<AutoConfigUpdatesService>(AutoConfigUpdatesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have all required repositories injected', () => {
      expect((service as any).applicationDashboardRepo).toBeDefined();
      expect((service as any).benchmarkRepo).toBeDefined();
      expect((service as any).grafanaDashboardRepo).toBeDefined();
      expect((service as any).grafanaInstanceRepo).toBeDefined();
      expect((service as any).systemUnderTestRepo).toBeDefined();
    });
  });

  describe('insertApplicationDashboard', () => {
    describe('Happy Path Scenarios', () => {
      it('should insert application dashboard successfully', async () => {
        // Arrange
        const mockSut = { id: 'sut-1', name: 'my-app' };
        const mockGrafanaInstance = { id: 'grafana-1', label: 'grafana-prod' };
        const mockSavedDashboard = { id: 'dashboard-1' };

        const dashboardData = {
          application: 'my-app',
          testEnvironment: 'production',
          grafana: 'grafana-prod',
          dashboardName: 'JVM Overview',
          dashboardLabel: 'JVM',
          dashboardId: 123,
          dashboardUid: 'jvm-uid',
          tags: ['jvm', 'memory'],
          variables: [{ name: 'workload', values: ['load-test'] }],
        };

        systemUnderTestRepo.findOne.mockResolvedValue(mockSut);
        grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
        applicationDashboardRepo.save.mockResolvedValue(mockSavedDashboard);

        // Act
        const result = await service.insertApplicationDashboard(dashboardData);

        // Assert
        expect(result).toEqual({ insertedId: 'dashboard-1' });
        expect(systemUnderTestRepo.findOne).toHaveBeenCalledWith({ where: { name: 'my-app' } });
        expect(grafanaInstanceRepo.findOne).toHaveBeenCalledWith({
          where: { label: 'grafana-prod' },
        });
        expect(applicationDashboardRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            systemUnderTestId: 'sut-1',
            testEnvironment: 'production',
            grafanaInstanceId: 'grafana-1',
            dashboardName: 'JVM Overview',
            dashboardUid: 'jvm-uid',
          }),
        );
      });

      it('should handle dashboard with template UID', async () => {
        // Arrange
        const mockSut = { id: 'sut-1', name: 'my-app' };
        const mockGrafanaInstance = { id: 'grafana-1', label: 'grafana-prod' };
        const mockTemplateDashboard = { id: 'template-1', uid: 'template-uid' };
        const mockSavedDashboard = { id: 'dashboard-1' };

        const dashboardData = {
          application: 'my-app',
          testEnvironment: 'test',
          grafana: 'grafana-prod',
          dashboardName: 'Test Dashboard',
          dashboardLabel: 'Test',
          dashboardId: 456,
          dashboardUid: 'test-uid',
          templateDashboardUid: 'template-uid',
        };

        systemUnderTestRepo.findOne.mockResolvedValue(mockSut);
        grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
        grafanaDashboardRepo.findOne.mockResolvedValue(mockTemplateDashboard);
        applicationDashboardRepo.save.mockResolvedValue(mockSavedDashboard);

        // Act
        const result = await service.insertApplicationDashboard(dashboardData);

        // Assert
        expect(result).toEqual({ insertedId: 'dashboard-1' });
        expect(grafanaDashboardRepo.findOne).toHaveBeenCalledWith({
          where: {
            uid: 'template-uid',
            grafanaInstanceId: 'grafana-1',
          },
        });
        expect(applicationDashboardRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            grafanaDashboardId: 'template-1',
            templateDashboardUid: 'template-uid',
          }),
        );
      });

      it('should handle missing template dashboard gracefully', async () => {
        // Arrange
        const mockSut = { id: 'sut-1', name: 'my-app' };
        const mockGrafanaInstance = { id: 'grafana-1', label: 'grafana-prod' };
        const mockSavedDashboard = { id: 'dashboard-1' };

        const dashboardData = {
          application: 'my-app',
          testEnvironment: 'test',
          grafana: 'grafana-prod',
          dashboardName: 'Test Dashboard',
          dashboardLabel: 'Test',
          dashboardId: 456,
          dashboardUid: 'test-uid',
          templateDashboardUid: 'nonexistent-uid',
        };

        systemUnderTestRepo.findOne.mockResolvedValue(mockSut);
        grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
        grafanaDashboardRepo.findOne.mockResolvedValue(null);
        applicationDashboardRepo.save.mockResolvedValue(mockSavedDashboard);

        const warnSpy = jest.spyOn((service as any).logger, 'warn');

        // Act
        const result = await service.insertApplicationDashboard(dashboardData);

        // Assert
        expect(result).toEqual({ insertedId: 'dashboard-1' });
        expect(warnSpy).toHaveBeenCalledWith(
          'Template dashboard not found in grafana_dashboards table',
        );
        expect(applicationDashboardRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            grafanaDashboardId: null,
          }),
        );
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error when system under test not found', async () => {
        // Arrange
        const dashboardData = {
          application: 'nonexistent-app',
          testEnvironment: 'test',
          grafana: 'grafana-prod',
          dashboardName: 'Test',
          dashboardLabel: 'Test',
          dashboardId: 123,
          dashboardUid: 'test-uid',
        };

        systemUnderTestRepo.findOne.mockResolvedValue(null);

        // Act & Assert
        await expect(service.insertApplicationDashboard(dashboardData)).rejects.toThrow(
          "System under test 'nonexistent-app' not found",
        );
      });

      it('should throw error when grafana instance not found', async () => {
        // Arrange
        const mockSut = { id: 'sut-1', name: 'my-app' };
        const dashboardData = {
          application: 'my-app',
          testEnvironment: 'test',
          grafana: 'nonexistent-grafana',
          dashboardName: 'Test',
          dashboardLabel: 'Test',
          dashboardId: 123,
          dashboardUid: 'test-uid',
        };

        systemUnderTestRepo.findOne.mockResolvedValue(mockSut);
        grafanaInstanceRepo.findOne.mockResolvedValue(null);

        // Act & Assert
        await expect(service.insertApplicationDashboard(dashboardData)).rejects.toThrow(
          "Grafana instance 'nonexistent-grafana' not found",
        );
      });

      it('should propagate database errors', async () => {
        // Arrange
        const error = new Error('Database error');
        const dashboardData = {
          application: 'my-app',
          testEnvironment: 'test',
          grafana: 'grafana-prod',
          dashboardName: 'Test',
          dashboardLabel: 'Test',
          dashboardId: 123,
          dashboardUid: 'test-uid',
        };

        systemUnderTestRepo.findOne.mockRejectedValue(error);
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        // Act & Assert
        await expect(service.insertApplicationDashboard(dashboardData)).rejects.toThrow(error);
        expect(errorSpy).toHaveBeenCalledWith('insertApplicationDashboard failed:', error);
      });
    });
  });

  describe('updateApplicationDashboardVariables', () => {
    describe('Happy Path Scenarios', () => {
      it('should update dashboard variables successfully', async () => {
        // Arrange
        const mockDashboard = {
          id: 'dashboard-1',
          variables: [{ name: 'workload', values: ['stress-test'] }],
        } as any;

        applicationDashboardRepo.update.mockResolvedValue({ affected: 1 });

        // Act
        const result = await service.updateApplicationDashboardVariables(mockDashboard);

        // Assert
        expect(result).toEqual({ modifiedCount: 1 });
        expect(applicationDashboardRepo.update).toHaveBeenCalledWith('dashboard-1', {
          variables: [{ name: 'workload', values: ['stress-test'] }],
        });
      });
    });

    describe('Error Scenarios', () => {
      it('should propagate database errors', async () => {
        // Arrange
        const mockDashboard = { id: 'dashboard-1', variables: {} } as any;
        const error = new Error('Update failed');
        applicationDashboardRepo.update.mockRejectedValue(error);
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        // Act & Assert
        await expect(service.updateApplicationDashboardVariables(mockDashboard)).rejects.toThrow(
          error,
        );
        expect(errorSpy).toHaveBeenCalledWith('updateApplicationDashboardVariables failed:', error);
      });
    });
  });

  describe('upsertGrafanaDashboard', () => {
    describe('Happy Path Scenarios', () => {
      it('should insert new dashboard when it does not exist', async () => {
        // Arrange
        const mockGrafanaInstance = { id: 'grafana-1', label: 'grafana-prod' };
        const mockSavedDashboard = { id: 'dashboard-1', uid: 'dash-uid' };

        const dashboardData = {
          grafana: 'grafana-prod',
          uid: 'dash-uid',
          title: 'New Dashboard',
          id: 123,
          grafanaJson: { panels: [] },
          usedBySUT: ['app1'],
          panels: [],
        };

        grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
        grafanaDashboardRepo.findOne.mockResolvedValueOnce(null);
        grafanaDashboardRepo.save.mockResolvedValue(mockSavedDashboard);

        // Act
        const result = await service.upsertGrafanaDashboard(dashboardData);

        // Assert
        expect(result).toEqual({ value: mockSavedDashboard });
        expect(grafanaDashboardRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            grafanaInstanceId: 'grafana-1',
            uid: 'dash-uid',
            name: 'New Dashboard',
            grafanaId: 123,
          }),
        );
      });

      it('should update existing dashboard when it exists', async () => {
        // Arrange
        const mockGrafanaInstance = { id: 'grafana-1', label: 'grafana-prod' };
        const mockExistingDashboard = { id: 'dashboard-1', uid: 'dash-uid' };
        const mockUpdatedDashboard = {
          id: 'dashboard-1',
          uid: 'dash-uid',
          name: 'Updated Dashboard',
        };

        const dashboardData = {
          grafana: 'grafana-prod',
          uid: 'dash-uid',
          title: 'Updated Dashboard',
          id: 123,
        };

        grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
        grafanaDashboardRepo.findOne
          .mockResolvedValueOnce(mockExistingDashboard)
          .mockResolvedValueOnce(mockUpdatedDashboard);
        grafanaDashboardRepo.update.mockResolvedValue({ affected: 1 });

        // Act
        const result = await service.upsertGrafanaDashboard(dashboardData);

        // Assert
        expect(result).toEqual({ value: mockUpdatedDashboard });
        expect(grafanaDashboardRepo.update).toHaveBeenCalledWith(
          'dashboard-1',
          expect.objectContaining({
            name: 'Updated Dashboard',
          }),
        );
      });

      it('should handle grafanaJson as string', async () => {
        // Arrange
        const mockGrafanaInstance = { id: 'grafana-1', label: 'grafana-prod' };
        const mockSavedDashboard = { id: 'dashboard-1' };

        const dashboardData = {
          grafana: 'grafana-prod',
          uid: 'dash-uid',
          title: 'Dashboard',
          id: 123,
          grafanaJson: '{"panels": []}',
        };

        grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
        grafanaDashboardRepo.findOne.mockResolvedValue(null);
        grafanaDashboardRepo.save.mockResolvedValue(mockSavedDashboard);

        // Act
        await service.upsertGrafanaDashboard(dashboardData);

        // Assert
        expect(grafanaDashboardRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            grafanaJson: { panels: [] },
          }),
        );
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error when grafana instance not found', async () => {
        // Arrange
        const dashboardData = {
          grafana: 'nonexistent',
          uid: 'dash-uid',
          title: 'Dashboard',
          id: 123,
        };

        grafanaInstanceRepo.findOne.mockResolvedValue(null);

        // Act & Assert
        await expect(service.upsertGrafanaDashboard(dashboardData)).rejects.toThrow(
          "Grafana instance 'nonexistent' not found",
        );
      });

      it('should throw error when upsert fails', async () => {
        // Arrange
        const mockGrafanaInstance = { id: 'grafana-1' };
        const mockExisting = { id: 'dashboard-1' };
        const dashboardData = {
          grafana: 'grafana-prod',
          uid: 'dash-uid',
          title: 'Dashboard',
          id: 123,
        };

        grafanaInstanceRepo.findOne.mockResolvedValue(mockGrafanaInstance);
        grafanaDashboardRepo.findOne
          .mockResolvedValueOnce(mockExisting)
          .mockResolvedValueOnce(null);
        grafanaDashboardRepo.update.mockResolvedValue({ affected: 1 });

        // Act & Assert
        await expect(service.upsertGrafanaDashboard(dashboardData)).rejects.toThrow(
          'Failed to upsert grafana dashboard',
        );
      });
    });
  });

  describe('updateUsedBySut', () => {
    describe('Happy Path Scenarios', () => {
      it('should add application to usedBySUT array', async () => {
        // Arrange
        const mockDashboard = { id: 'dash-1', usedBySut: ['app1'] };
        const templateDashboard = { id: 'dash-1' };

        grafanaDashboardRepo.findOne.mockResolvedValue(mockDashboard);
        grafanaDashboardRepo.update.mockResolvedValue({ affected: 1 });

        // Act
        const result = await service.updateUsedBySut(templateDashboard, 'app2');

        // Assert
        expect(result).toEqual({ modifiedCount: 1 });
        expect(grafanaDashboardRepo.update).toHaveBeenCalledWith('dash-1', {
          usedBySut: ['app1', 'app2'],
        });
      });

      it('should not add duplicate application', async () => {
        // Arrange
        const mockDashboard = { id: 'dash-1', usedBySut: ['app1'] };
        const templateDashboard = { id: 'dash-1' };

        grafanaDashboardRepo.findOne.mockResolvedValue(mockDashboard);
        grafanaDashboardRepo.update.mockResolvedValue({ affected: 1 });

        const logSpy = jest.spyOn((service as any).logger, 'log');

        // Act
        const result = await service.updateUsedBySut(templateDashboard, 'app1');

        // Assert
        expect(result).toEqual({ modifiedCount: 1 });
        expect(logSpy).toHaveBeenCalledWith('app1 already in usedBySUT array');
        expect(grafanaDashboardRepo.update).toHaveBeenCalledWith('dash-1', {
          usedBySut: ['app1'],
        });
      });

      it('should initialize usedBySUT array when null', async () => {
        // Arrange
        const mockDashboard = { id: 'dash-1', usedBySut: null };
        const templateDashboard = { id: 'dash-1' };

        grafanaDashboardRepo.findOne.mockResolvedValue(mockDashboard);
        grafanaDashboardRepo.update.mockResolvedValue({ affected: 1 });

        // Act
        const result = await service.updateUsedBySut(templateDashboard, 'app1');

        // Assert
        expect(result).toEqual({ modifiedCount: 1 });
        expect(grafanaDashboardRepo.update).toHaveBeenCalledWith('dash-1', {
          usedBySut: ['app1'],
        });
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error when dashboard not found', async () => {
        // Arrange
        const templateDashboard = { id: 'nonexistent' };
        grafanaDashboardRepo.findOne.mockResolvedValue(null);

        // Act & Assert
        await expect(service.updateUsedBySut(templateDashboard, 'app1')).rejects.toThrow(
          'Dashboard not found with ID: nonexistent',
        );
      });
    });
  });

  describe('insertBenchmarkBasedOnProfileBenchmark', () => {
    describe('Happy Path Scenarios', () => {
      it('should insert benchmark successfully', async () => {
        // Arrange
        const mockSut = { id: 'sut-1', name: 'my-app' };
        const mockSavedBenchmark = { id: 'benchmark-1' };

        const profileBenchmark: any = {
          id: 'profile-benchmark-1',
          profile_id: 'profile-1',
          profile: { name: 'Production' },
          profile_dashboard_id: 'dash-1',
          workload_pattern: 'load-.*',
          source: 'gatling',
          grafana_instance: 'grafana-prod',
          dashboard_uid: 'jvm-uid',
          panel_id: 1,
          panel_title: 'Heap Usage',
          panel_type: 'graph',
          panel_description: 'Heap memory',
          evaluate_type: 'avg',
          metric_unit: 'MB',
          requirement_operator: '<',
          requirement_value: 1024,
          exclude_ramp_up_time: true,
          average_all: false,
          match_pattern: 'heap.*',
          validate_with_default_if_no_data: true,
          validate_with_default_if_no_data_value: 0,
          tags: ['jvm'],
          metadata: {},
          read_only: false,
        };

        const testRun: any = {
          testRunId: 'test-1',
          systemUnderTest: { name: 'my-app' },
          systemUnderTestId: 'sut-id',
          testEnvironment: 'production',
          workload: 'load-test',
          endTime: new Date(),
          tags: [],
          variables: [],
        };

        const applicationDashboard = {
          id: 'app-dash-1',
          grafanaInstance: 'grafana-prod',
          dashboardLabel: 'JVM Overview',
          dashboardId: 123,
          dashboardUid: 'jvm-uid',
        } as any;

        systemUnderTestRepo.findOne.mockResolvedValue(mockSut);
        benchmarkRepo.create.mockReturnValue({ id: 'benchmark-1' });
        benchmarkRepo.save.mockResolvedValue(mockSavedBenchmark);

        // Act
        const result = await service.insertBenchmarkBasedOnProfileBenchmark(
          profileBenchmark,
          testRun,
          applicationDashboard,
        );

        // Assert
        expect(result).toEqual({ insertedId: 'benchmark-1', wasCreated: true });
        expect(systemUnderTestRepo.findOne).toHaveBeenCalledWith({ where: { name: 'my-app' } });
        expect(benchmarkRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            workload: 'load-test',
            test_environment: 'production',
            source: 'gatling',
            grafana_instance: 'grafana-prod',
          }),
        );
      });

      it('should propagate organizationId from testRun (regression: snake_case key was silently dropped by TypeORM, causing NOT NULL violation)', async () => {
        const mockSut = { id: 'sut-1', name: 'my-app' };
        const mockSavedBenchmark = { id: 'benchmark-1' };

        const profileBenchmark: any = {
          id: 'pb-1',
          source: 'grafana',
          panel_id: 1,
          panel_title: 'Heap',
          panel_type: 'graph',
          tags: [],
          metadata: {},
          read_only: false,
        };

        const testRun: any = {
          testRunId: 'test-1',
          systemUnderTest: { name: 'my-app' },
          systemUnderTestId: 'sut-id',
          testEnvironment: 'acc',
          workload: 'loadTest',
          organizationId: 'eb9b3953-1593-405d-9135-9806570d2aec',
          endTime: new Date(),
          tags: [],
          variables: [],
        };

        const applicationDashboard = {
          id: 'app-dash-1',
          grafanaInstance: 'grafana-prod',
          dashboardLabel: 'JVM',
          dashboardId: 1,
          dashboardUid: 'jvm-uid',
        } as any;

        systemUnderTestRepo.findOne.mockResolvedValue(mockSut);
        benchmarkRepo.create.mockReturnValue({});
        benchmarkRepo.save.mockResolvedValue(mockSavedBenchmark);

        await service.insertBenchmarkBasedOnProfileBenchmark(
          profileBenchmark,
          testRun,
          applicationDashboard,
        );

        expect(benchmarkRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: 'eb9b3953-1593-405d-9135-9806570d2aec',
          }),
        );
        const createArg = benchmarkRepo.create.mock.calls[0][0];
        expect(createArg).not.toHaveProperty('organization_id');
      });

      it('should handle grafana instance from applicationDashboard object', async () => {
        // Arrange
        const mockSut = { id: 'sut-1' };
        const mockSavedBenchmark = { id: 'benchmark-1' };

        const profileBenchmark: any = {
          id: 'pb-1',
          profile_id: 'p-1',
          profile: { name: 'Test' },
          profile_dashboard_id: 'd-1',
          workload_pattern: 'load',
          source: 'jmeter',
          exclude_ramp_up_time: false,
          average_all: true,
          validate_with_default_if_no_data: false,
          tags: [],
          metadata: {},
          read_only: false,
        };

        const testRun: any = {
          testRunId: 'test-1',
          systemUnderTest: { name: 'app' },
          systemUnderTestId: 'sut-id',
          testEnvironment: 'test',
          workload: 'load',
          endTime: new Date(),
          tags: [],
          variables: [],
        };

        const applicationDashboard = {
          id: 'app-dash-1',
          grafanaInstance: { label: 'grafana-test' },
          dashboardLabel: 'Test',
          dashboardId: 1,
          dashboardUid: 'uid',
        } as any;

        systemUnderTestRepo.findOne.mockResolvedValue(mockSut);
        benchmarkRepo.create.mockReturnValue({});
        benchmarkRepo.save.mockResolvedValue(mockSavedBenchmark);

        // Act
        await service.insertBenchmarkBasedOnProfileBenchmark(
          profileBenchmark,
          testRun,
          applicationDashboard,
        );

        // Assert
        expect(benchmarkRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            grafana_instance: 'grafana-test',
          }),
        );
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error when system under test not found', async () => {
        // Arrange
        const profileBenchmark = { id: 'pb-1' } as any;
        const testRun = {
          testRunId: 'test-1',
          systemUnderTest: { name: 'nonexistent' },
          systemUnderTestId: 'sut-id',
        } as any;
        const applicationDashboard = { id: 'dash-1' } as any;

        systemUnderTestRepo.findOne.mockResolvedValue(null);

        // Act & Assert
        await expect(
          service.insertBenchmarkBasedOnProfileBenchmark(
            profileBenchmark,
            testRun,
            applicationDashboard,
          ),
        ).rejects.toThrow("System under test 'nonexistent' not found");
      });
    });
  });
});
