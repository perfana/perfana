import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GrafanaSyncService } from './grafana-sync.service';
import { StoreDashboardService } from './store-dashboard.service';
import { RestoreDashboardService } from './restore-dashboard.service';
import { UpdateDashboardsService } from './update-dashboards.service';
import { createMockConfigService } from '../../../test/helpers';

describe('GrafanaSyncService', () => {
  let service: GrafanaSyncService;
  let configService: any;
  let storeDashboardService: jest.Mocked<StoreDashboardService>;
  let restoreDashboardService: jest.Mocked<RestoreDashboardService>;
  let updateDashboardsService: jest.Mocked<UpdateDashboardsService>;

  beforeEach(async () => {
    // Create mock services
    const mockStoreDashboardService = {
      addNewDashboards: jest.fn().mockResolvedValue(5),
    };

    const mockRestoreDashboardService = {
      restoreDashboards: jest.fn().mockResolvedValue(2),
    };

    const mockUpdateDashboardsService = {
      updateDashboards: jest.fn().mockResolvedValue(3),
      updateTemplateDashboards: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrafanaSyncService,
        {
          provide: ConfigService,
          useValue: createMockConfigService({
            grafanaSync: {
              propagateTemplateUpdates: false,
            },
          }),
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
      ],
    }).compile();

    service = module.get<GrafanaSyncService>(GrafanaSyncService);
    configService = module.get<ConfigService>(ConfigService);
    storeDashboardService = module.get(StoreDashboardService);
    restoreDashboardService = module.get(RestoreDashboardService);
    updateDashboardsService = module.get(UpdateDashboardsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize with isSyncing as false', () => {
      expect((service as any).isSyncing).toBe(false);
    });

    it('should have all required dependencies injected', () => {
      expect((service as any).configService).toBeDefined();
      expect((service as any).storeDashboardService).toBeDefined();
      expect((service as any).restoreDashboardService).toBeDefined();
      expect((service as any).updateDashboardsService).toBeDefined();
    });
  });

  describe('handleGrafanaSync', () => {
    describe('Happy Path Scenarios', () => {
      it('should execute full sync workflow successfully', async () => {
        // Arrange
        const loggerSpy = jest.spyOn((service as any).logger, 'log');

        // Act
        await service.handleGrafanaSync();

        // Assert
        expect(storeDashboardService.addNewDashboards).toHaveBeenCalledTimes(1);
        expect(updateDashboardsService.updateDashboards).toHaveBeenCalledTimes(1);
        expect(restoreDashboardService.restoreDashboards).toHaveBeenCalledTimes(1);
        expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Sync completed'));
        expect(loggerSpy).toHaveBeenCalledWith(
          expect.stringContaining('5 added, 3 updated, 2 restored'),
        );
      });

      it('should execute sync operations in correct order', async () => {
        // Arrange
        const callOrder: string[] = [];

        storeDashboardService.addNewDashboards.mockImplementation(async () => {
          callOrder.push('store');
          return 5;
        });

        updateDashboardsService.updateDashboards.mockImplementation(async () => {
          callOrder.push('update');
          return 3;
        });

        restoreDashboardService.restoreDashboards.mockImplementation(async () => {
          callOrder.push('restore');
          return 2;
        });

        // Act
        await service.handleGrafanaSync();

        // Assert
        expect(callOrder).toEqual(['store', 'update', 'restore']);
      });

      it('should reset isSyncing flag after successful sync', async () => {
        // Act
        await service.handleGrafanaSync();

        // Assert
        expect((service as any).isSyncing).toBe(false);
      });

      it('should log sync duration', async () => {
        // Arrange
        const loggerSpy = jest.spyOn((service as any).logger, 'log');

        // Act
        await service.handleGrafanaSync();

        // Assert
        expect(loggerSpy).toHaveBeenCalledWith(expect.stringMatching(/Sync completed in \d+ms:/));
      });
    });

    describe('Sync Locking Mechanism', () => {
      it('should skip sync when already in progress', async () => {
        // Arrange
        (service as any).isSyncing = true;
        const warnSpy = jest.spyOn((service as any).logger, 'warn');

        // Act
        await service.handleGrafanaSync();

        // Assert
        expect(warnSpy).toHaveBeenCalledWith('Sync already in progress, skipping...');
        expect(storeDashboardService.addNewDashboards).not.toHaveBeenCalled();
        expect(updateDashboardsService.updateDashboards).not.toHaveBeenCalled();
        expect(restoreDashboardService.restoreDashboards).not.toHaveBeenCalled();
      });

      it('should set isSyncing flag during sync', async () => {
        // Arrange
        let syncingDuringExecution = false;

        storeDashboardService.addNewDashboards.mockImplementation(async () => {
          syncingDuringExecution = (service as any).isSyncing;
          return 5;
        });

        // Act
        await service.handleGrafanaSync();

        // Assert
        expect(syncingDuringExecution).toBe(true);
      });

      it('should handle concurrent sync attempts correctly', async () => {
        // Arrange
        const warnSpy = jest.spyOn((service as any).logger, 'warn');

        // Make the first sync take some time
        storeDashboardService.addNewDashboards.mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(5), 100)),
        );

        // Act
        const sync1 = service.handleGrafanaSync();
        const sync2 = service.handleGrafanaSync(); // Should be skipped

        await Promise.all([sync1, sync2]);

        // Assert
        expect(warnSpy).toHaveBeenCalledWith('Sync already in progress, skipping...');
        expect(storeDashboardService.addNewDashboards).toHaveBeenCalledTimes(1);
      });
    });

    describe('Error Scenarios', () => {
      it('should handle errors in addNewDashboards and continue', async () => {
        // Arrange
        const error = new Error('Failed to add dashboards');
        storeDashboardService.addNewDashboards.mockRejectedValue(error);
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        // Act
        await service.handleGrafanaSync();

        // Assert
        expect(errorSpy).toHaveBeenCalledWith('Sync failed:', error);
      });

      it('should reset isSyncing flag after error', async () => {
        // Arrange
        storeDashboardService.addNewDashboards.mockRejectedValue(new Error('Sync failed'));

        // Act
        await service.handleGrafanaSync();

        // Assert
        expect((service as any).isSyncing).toBe(false);
      });

      it('should handle errors in updateDashboards', async () => {
        // Arrange
        updateDashboardsService.updateDashboards.mockRejectedValue(new Error('Update failed'));
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        // Act
        await service.handleGrafanaSync();

        // Assert
        expect(errorSpy).toHaveBeenCalledWith('Sync failed:', expect.any(Error));
      });

      it('should handle errors in restoreDashboards', async () => {
        // Arrange
        restoreDashboardService.restoreDashboards.mockRejectedValue(new Error('Restore failed'));
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        // Act
        await service.handleGrafanaSync();

        // Assert
        expect(errorSpy).toHaveBeenCalledWith('Sync failed:', expect.any(Error));
      });
    });

    describe('Edge Cases', () => {
      it('should handle sync with zero changes', async () => {
        // Arrange
        storeDashboardService.addNewDashboards.mockResolvedValue(0);
        updateDashboardsService.updateDashboards.mockResolvedValue(0);
        restoreDashboardService.restoreDashboards.mockResolvedValue(0);
        const loggerSpy = jest.spyOn((service as any).logger, 'log');

        // Act
        await service.handleGrafanaSync();

        // Assert
        expect(loggerSpy).toHaveBeenCalledWith(
          expect.stringContaining('0 added, 0 updated, 0 restored'),
        );
      });

      it('should handle sync with large number of changes', async () => {
        // Arrange
        storeDashboardService.addNewDashboards.mockResolvedValue(1000);
        updateDashboardsService.updateDashboards.mockResolvedValue(500);
        restoreDashboardService.restoreDashboards.mockResolvedValue(250);
        const loggerSpy = jest.spyOn((service as any).logger, 'log');

        // Act
        await service.handleGrafanaSync();

        // Assert
        expect(loggerSpy).toHaveBeenCalledWith(
          expect.stringContaining('1000 added, 500 updated, 250 restored'),
        );
      });
    });
  });

  describe('handleTemplateUpdates', () => {
    describe('Happy Path Scenarios', () => {
      it('should execute template updates when enabled', async () => {
        // Arrange
        configService.get.mockReturnValue(true);

        // Act
        await service.handleTemplateUpdates();

        // Assert
        expect(updateDashboardsService.updateTemplateDashboards).toHaveBeenCalledTimes(1);
      });

      it('should log debug message when starting template updates', async () => {
        // Arrange
        configService.get.mockReturnValue(true);
        const debugSpy = jest.spyOn((service as any).logger, 'debug');

        // Act
        await service.handleTemplateUpdates();

        // Assert
        expect(debugSpy).toHaveBeenCalledWith('Starting template dashboard updates...');
      });
    });

    describe('Configuration Disabled', () => {
      it('should skip template updates when disabled', async () => {
        // Arrange
        configService.get.mockReturnValue(false);

        // Act
        await service.handleTemplateUpdates();

        // Assert
        expect(updateDashboardsService.updateTemplateDashboards).not.toHaveBeenCalled();
      });

      it('should skip template updates when config is undefined', async () => {
        // Arrange
        configService.get.mockReturnValue(undefined);

        // Act
        await service.handleTemplateUpdates();

        // Assert
        expect(updateDashboardsService.updateTemplateDashboards).not.toHaveBeenCalled();
      });
    });

    describe('Error Scenarios', () => {
      it('should handle errors in template updates', async () => {
        // Arrange
        configService.get.mockReturnValue(true);
        updateDashboardsService.updateTemplateDashboards.mockRejectedValue(
          new Error('Template update failed'),
        );
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        // Act
        await service.handleTemplateUpdates();

        // Assert
        expect(errorSpy).toHaveBeenCalledWith('Template update failed:', expect.any(Error));
      });
    });
  });

  describe('triggerManualSync', () => {
    describe('Happy Path Scenarios', () => {
      it('should trigger sync manually', async () => {
        // Arrange
        const loggerSpy = jest.spyOn((service as any).logger, 'log');

        // Act
        await service.triggerManualSync();

        // Assert
        expect(loggerSpy).toHaveBeenCalledWith('Manual sync triggered');
        expect(storeDashboardService.addNewDashboards).toHaveBeenCalled();
      });

      it('should complete manual sync successfully', async () => {
        // Act
        await service.triggerManualSync();

        // Assert
        expect((service as any).isSyncing).toBe(false);
      });
    });

    describe('Error Scenarios', () => {
      it('should throw error when sync already in progress', async () => {
        // Arrange
        (service as any).isSyncing = true;

        // Act & Assert
        await expect(service.triggerManualSync()).rejects.toThrow('Sync already in progress');
      });

      it('should not execute sync when already in progress', async () => {
        // Arrange
        (service as any).isSyncing = true;

        // Act
        try {
          await service.triggerManualSync();
        } catch (error) {
          // Expected error
        }

        // Assert
        expect(storeDashboardService.addNewDashboards).not.toHaveBeenCalled();
      });
    });
  });

  describe('getSyncStatus', () => {
    it('should return syncing status as false initially', () => {
      // Act
      const status = service.getSyncStatus();

      // Assert
      expect(status).toEqual({ syncing: false });
    });

    it('should return syncing status as true during sync', async () => {
      // Arrange
      let statusDuringSync: { syncing: boolean } | undefined;

      storeDashboardService.addNewDashboards.mockImplementation(async () => {
        statusDuringSync = service.getSyncStatus();
        return 5;
      });

      // Act
      await service.handleGrafanaSync();

      // Assert
      expect(statusDuringSync).toEqual({ syncing: true });
    });

    it('should return syncing status as false after sync completes', async () => {
      // Act
      await service.handleGrafanaSync();
      const status = service.getSyncStatus();

      // Assert
      expect(status).toEqual({ syncing: false });
    });
  });
});
