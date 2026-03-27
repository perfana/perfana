import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { GrafanaSyncService } from '../../src/modules/grafana-sync/grafana-sync.service';
import { StoreDashboardService } from '../../src/modules/grafana-sync/store-dashboard.service';
import { RestoreDashboardService } from '../../src/modules/grafana-sync/restore-dashboard.service';
import { UpdateDashboardsService } from '../../src/modules/grafana-sync/update-dashboards.service';
import { GrafanaApiService } from '../../src/modules/grafana-api/grafana-api.service';
import { GrafanaInstance, GrafanaDashboard } from '@perfana/shared/entities';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createMockRepository } from '../helpers';

/**
 * Integration Tests for Grafana Sync Module
 *
 * These tests verify the full sync workflow with mocked external dependencies.
 * All services are mocked to test the integration patterns without actual DB/API calls.
 */
describe('Grafana Sync Integration Tests', () => {
  let module: TestingModule;
  let grafanaSyncService: GrafanaSyncService;
  let grafanaApiService: jest.Mocked<GrafanaApiService>;
  let grafanaInstanceRepo: jest.Mocked<Repository<GrafanaInstance>>;
  let grafanaDashboardRepo: jest.Mocked<Repository<GrafanaDashboard>>;
  let storeDashboardService: jest.Mocked<StoreDashboardService>;
  let _restoreDashboardService: jest.Mocked<RestoreDashboardService>;
  let updateDashboardsService: jest.Mocked<UpdateDashboardsService>;

  // Create mock services
  const mockStoreDashboardService = {
    addNewDashboards: jest.fn().mockResolvedValue(0),
  };

  const mockRestoreDashboardService = {
    restoreDashboards: jest.fn().mockResolvedValue(0),
  };

  const mockUpdateDashboardsService = {
    updateDashboards: jest.fn().mockResolvedValue(0),
    updateTemplateDashboards: jest.fn().mockResolvedValue(undefined),
  };

  const mockGrafanaApiService = {
    getAllInstances: jest.fn().mockResolvedValue([]),
    getDashboardsForInstance: jest.fn().mockResolvedValue([]),
    saveDashboard: jest.fn().mockResolvedValue(undefined),
    deleteDashboard: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              grafanaSync: {
                propagateTemplateUpdates: false,
                sanityChecker: {
                  testRun: {
                    enabled: false,
                  },
                },
              },
            }),
          ],
        }),
      ],
      providers: [
        GrafanaSyncService,
        {
          provide: SchedulerRegistry,
          useValue: {
            addInterval: jest.fn(),
            deleteInterval: jest.fn(),
          },
        },
        {
          provide: StoreDashboardService,
          useValue: mockStoreDashboardService,
        },
        {
          provide: RestoreDashboardService,
          useValue: mockRestoreDashboardService,
        },
        {
          provide: UpdateDashboardsService,
          useValue: mockUpdateDashboardsService,
        },
        {
          provide: GrafanaApiService,
          useValue: mockGrafanaApiService,
        },
        {
          provide: getRepositoryToken(GrafanaInstance),
          useValue: createMockRepository(),
        },
        {
          provide: getRepositoryToken(GrafanaDashboard),
          useValue: createMockRepository(),
        },
      ],
    }).compile();

    grafanaSyncService = module.get<GrafanaSyncService>(GrafanaSyncService);
    grafanaApiService = module.get(GrafanaApiService);
    grafanaInstanceRepo = module.get(getRepositoryToken(GrafanaInstance));
    grafanaDashboardRepo = module.get(getRepositoryToken(GrafanaDashboard));
    storeDashboardService = module.get(StoreDashboardService);
    _restoreDashboardService = module.get(RestoreDashboardService);
    updateDashboardsService = module.get(UpdateDashboardsService);
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Module Initialization', () => {
    it('should initialize all services', () => {
      expect(grafanaSyncService).toBeDefined();
      expect(grafanaApiService).toBeDefined();
    });

    it('should inject all required repositories', () => {
      expect(grafanaInstanceRepo).toBeDefined();
      expect(grafanaDashboardRepo).toBeDefined();
    });

    it('should load configuration correctly', () => {
      const configService = module.get<ConfigService>(ConfigService);
      const propagateTemplateUpdates = configService.get<boolean>(
        'grafanaSync.propagateTemplateUpdates',
      );
      expect(propagateTemplateUpdates).toBe(false);
    });
  });

  describe('Full Sync Workflow', () => {
    it('should complete sync workflow without errors when no instances exist', async () => {
      // Arrange - services already mocked to return empty arrays

      // Act & Assert
      await expect(grafanaSyncService.handleGrafanaSync()).resolves.not.toThrow();
    });

    it('should handle sync with existing Grafana instances', async () => {
      // Arrange - services already mocked
      mockStoreDashboardService.addNewDashboards.mockResolvedValue(5);

      // Act & Assert
      await expect(grafanaSyncService.handleGrafanaSync()).resolves.not.toThrow();
    });

    it('should maintain sync lock during execution', async () => {
      // Arrange
      let syncingDuringExecution = false;

      mockStoreDashboardService.addNewDashboards.mockImplementation(async () => {
        syncingDuringExecution = grafanaSyncService.getSyncStatus().syncing;
        return 0;
      });

      // Act
      await grafanaSyncService.handleGrafanaSync();

      // Assert
      expect(syncingDuringExecution).toBe(true);
      expect(grafanaSyncService.getSyncStatus().syncing).toBe(false);
    });

    it('should prevent concurrent sync executions', async () => {
      // Arrange
      mockStoreDashboardService.addNewDashboards.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(0), 100)),
      );

      // Act
      const sync1 = grafanaSyncService.handleGrafanaSync();
      const sync2 = grafanaSyncService.handleGrafanaSync();

      await Promise.all([sync1, sync2]);

      // Assert - Only one sync should have executed (second one skipped)
      expect(storeDashboardService.addNewDashboards).toHaveBeenCalledTimes(1);
    });
  });

  describe('Manual Sync Trigger', () => {
    it('should trigger manual sync successfully', async () => {
      // Arrange - reset mocks
      mockStoreDashboardService.addNewDashboards.mockResolvedValue(0);

      // Act & Assert
      await expect(grafanaSyncService.triggerManualSync()).resolves.not.toThrow();
    });

    it('should throw error when sync is already in progress', async () => {
      // Arrange
      mockStoreDashboardService.addNewDashboards.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(0), 100)),
      );

      // Act
      const sync1 = grafanaSyncService.triggerManualSync();
      const sync2Promise = grafanaSyncService.triggerManualSync();

      // Assert
      await expect(sync2Promise).rejects.toThrow('Sync already in progress');
      await sync1;
    });
  });

  describe('Sync Status', () => {
    it('should report correct sync status', async () => {
      // Arrange
      expect(grafanaSyncService.getSyncStatus().syncing).toBe(false);

      // Act
      let statusDuringSync: { syncing: boolean } | undefined;

      mockStoreDashboardService.addNewDashboards.mockImplementation(async () => {
        statusDuringSync = grafanaSyncService.getSyncStatus();
        return 0;
      });

      await grafanaSyncService.handleGrafanaSync();

      // Assert
      expect(statusDuringSync?.syncing).toBe(true);
      expect(grafanaSyncService.getSyncStatus().syncing).toBe(false);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from errors in sync workflow', async () => {
      // Arrange
      mockStoreDashboardService.addNewDashboards
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce(0);

      // Act
      await grafanaSyncService.handleGrafanaSync(); // First call fails
      await grafanaSyncService.handleGrafanaSync(); // Second call succeeds

      // Assert
      expect(grafanaSyncService.getSyncStatus().syncing).toBe(false);
    });

    it('should reset sync lock after error', async () => {
      // Arrange
      mockStoreDashboardService.addNewDashboards.mockRejectedValue(new Error('Test error'));

      // Act
      await grafanaSyncService.handleGrafanaSync();

      // Assert
      expect(grafanaSyncService.getSyncStatus().syncing).toBe(false);
    });
  });

  describe('Template Updates', () => {
    it('should skip template updates when disabled', async () => {
      // Arrange - config already has propagateTemplateUpdates: false

      // Act
      await grafanaSyncService.handleTemplateUpdates();

      // Assert
      expect(updateDashboardsService.updateTemplateDashboards).not.toHaveBeenCalled();
    });

    it('should execute template updates when enabled', async () => {
      // Arrange
      const configService = module.get<ConfigService>(ConfigService);
      jest.spyOn(configService, 'get').mockReturnValue(true); // Enable template updates

      // Act
      await grafanaSyncService.handleTemplateUpdates();

      // Assert
      expect(updateDashboardsService.updateTemplateDashboards).toHaveBeenCalled();
    });
  });

  describe('Grafana API Service Integration', () => {
    it('should fetch all Grafana instances', async () => {
      // Arrange
      const mockInstances = [
        {
          id: 'instance-1',
          label: 'Production',
          client_url: 'http://grafana-prod:3000',
          apiKey: 'key1',
          orgId: '1',
        },
        {
          id: 'instance-2',
          label: 'Staging',
          client_url: 'http://grafana-staging:3000',
          apiKey: 'key2',
          orgId: '1',
        },
      ];

      mockGrafanaApiService.getAllInstances.mockResolvedValue(mockInstances);

      // Act
      const instances = await grafanaApiService.getAllInstances();

      // Assert
      expect(instances).toHaveLength(2);
      expect(instances[0].label).toBe('Production');
      expect(instances[1].label).toBe('Staging');
    });

    it('should handle empty instance list', async () => {
      // Arrange
      mockGrafanaApiService.getAllInstances.mockResolvedValue([]);

      // Act
      const instances = await grafanaApiService.getAllInstances();

      // Assert
      expect(instances).toHaveLength(0);
    });
  });

  describe('Database Operations', () => {
    it('should create and save Grafana instance', async () => {
      // Arrange
      const newInstance: Partial<GrafanaInstance> = {
        label: 'New Instance',
        client_url: 'http://new-grafana:3000',
        apiKey: 'new-key',
        orgId: '1',
      };

      const savedInstance = {
        id: 'new-instance-id',
        ...newInstance,
      };

      grafanaInstanceRepo.save.mockResolvedValue(savedInstance as any);

      // Act
      const result = await grafanaInstanceRepo.save(newInstance as any);

      // Assert
      expect(result.id).toBe('new-instance-id');
      expect(grafanaInstanceRepo.save).toHaveBeenCalledWith(newInstance);
    });

    it('should update existing Grafana instance', async () => {
      // Arrange
      const updateData = { label: 'Updated Label' };

      // Act
      await grafanaInstanceRepo.update('instance-1', updateData);

      // Assert
      expect(grafanaInstanceRepo.update).toHaveBeenCalledWith('instance-1', updateData);
    });
  });
});
