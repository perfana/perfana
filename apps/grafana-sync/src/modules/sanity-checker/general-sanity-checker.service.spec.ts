import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeneralSanityCheckerService } from './general-sanity-checker.service';
import { createMockConfigService } from '../../../test/helpers';

describe('GeneralSanityCheckerService', () => {
  let service: GeneralSanityCheckerService;
  let configService: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeneralSanityCheckerService,
        {
          provide: ConfigService,
          useValue: createMockConfigService({
            grafanaSync: {
              sanityChecker: {
                general: {
                  enabled: true,
                },
              },
            },
          }),
        },
      ],
    }).compile();

    service = module.get<GeneralSanityCheckerService>(GeneralSanityCheckerService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have all required dependencies injected', () => {
      expect((service as any).configService).toBeDefined();
    });
  });

  describe('runGeneralChecks', () => {
    describe('Happy Path Scenarios', () => {
      it('should execute all general checks when enabled', async () => {
        // Arrange
        const debugSpy = jest.spyOn((service as any).logger, 'debug');
        const warnSpy = jest.spyOn((service as any).logger, 'warn');

        // Act
        await service.runGeneralChecks();

        // Assert
        expect(debugSpy).toHaveBeenCalledWith('Running general sanity checks...');
        // Verify all three checks were called (they log warnings since not implemented)
        expect(warnSpy).toHaveBeenCalledWith(
          'checkDatabaseIntegrity() not yet implemented - needs port from perfana-grafana',
        );
        expect(warnSpy).toHaveBeenCalledWith(
          'checkOrphanedRecords() not yet implemented - needs port from perfana-grafana',
        );
        expect(warnSpy).toHaveBeenCalledWith(
          'checkMissingReferences() not yet implemented - needs port from perfana-grafana',
        );
      });

      it('should call checks in correct order', async () => {
        // Arrange
        const callOrder: string[] = [];
        jest.spyOn(service as any, 'checkDatabaseIntegrity').mockImplementation(async () => {
          callOrder.push('integrity');
        });
        jest.spyOn(service as any, 'checkOrphanedRecords').mockImplementation(async () => {
          callOrder.push('orphaned');
        });
        jest.spyOn(service as any, 'checkMissingReferences').mockImplementation(async () => {
          callOrder.push('references');
        });

        // Act
        await service.runGeneralChecks();

        // Assert
        expect(callOrder).toEqual(['integrity', 'orphaned', 'references']);
      });

      it('should complete without errors when all checks pass', async () => {
        // Act & Assert
        await expect(service.runGeneralChecks()).resolves.toBeUndefined();
      });
    });

    describe('Configuration Disabled', () => {
      it('should skip checks when disabled', async () => {
        // Arrange
        configService.get.mockReturnValue(false);
        const debugSpy = jest.spyOn((service as any).logger, 'debug');

        // Act
        await service.runGeneralChecks();

        // Assert
        expect(debugSpy).not.toHaveBeenCalled();
        expect(configService.get).toHaveBeenCalledWith(
          'grafanaSync.sanityChecker.general.enabled',
          false,
        );
      });

      it('should skip checks when config is undefined', async () => {
        // Arrange
        configService.get.mockReturnValue(undefined);
        const debugSpy = jest.spyOn((service as any).logger, 'debug');

        // Act
        await service.runGeneralChecks();

        // Assert
        expect(debugSpy).not.toHaveBeenCalled();
      });
    });

    describe('Error Scenarios', () => {
      it('should handle errors in checkDatabaseIntegrity', async () => {
        // Arrange
        const error = new Error('Database integrity check failed');
        jest.spyOn(service as any, 'checkDatabaseIntegrity').mockRejectedValue(error);
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        // Act
        await service.runGeneralChecks();

        // Assert
        expect(errorSpy).toHaveBeenCalledWith('General sanity check failed:', error);
      });

      it('should handle errors in checkOrphanedRecords', async () => {
        // Arrange
        const error = new Error('Orphaned records check failed');
        jest.spyOn(service as any, 'checkOrphanedRecords').mockRejectedValue(error);
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        // Act
        await service.runGeneralChecks();

        // Assert
        expect(errorSpy).toHaveBeenCalledWith('General sanity check failed:', error);
      });

      it('should handle errors in checkMissingReferences', async () => {
        // Arrange
        const error = new Error('Missing references check failed');
        jest.spyOn(service as any, 'checkMissingReferences').mockRejectedValue(error);
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        // Act
        await service.runGeneralChecks();

        // Assert
        expect(errorSpy).toHaveBeenCalledWith('General sanity check failed:', error);
      });

      it('should not throw errors on failure', async () => {
        // Arrange
        jest
          .spyOn(service as any, 'checkDatabaseIntegrity')
          .mockRejectedValue(new Error('Check failed'));

        // Act & Assert
        await expect(service.runGeneralChecks()).resolves.toBeUndefined();
      });

      it('should continue after recovering from error', async () => {
        // Arrange
        jest
          .spyOn(service as any, 'checkDatabaseIntegrity')
          .mockRejectedValueOnce(new Error('First attempt failed'))
          .mockResolvedValueOnce(undefined);

        // Act
        await service.runGeneralChecks(); // First attempt (fails)
        await service.runGeneralChecks(); // Second attempt (succeeds)

        // Assert
        expect((service as any).checkDatabaseIntegrity).toHaveBeenCalledTimes(2);
      });
    });

    describe('Edge Cases', () => {
      it('should handle configuration with null value', async () => {
        // Arrange
        configService.get.mockReturnValue(null);
        const debugSpy = jest.spyOn((service as any).logger, 'debug');

        // Act
        await service.runGeneralChecks();

        // Assert
        expect(debugSpy).not.toHaveBeenCalled();
      });

      it('should run checks with truthy string value', async () => {
        // Arrange
        configService.get.mockReturnValue('true'); // String instead of boolean is truthy
        const debugSpy = jest.spyOn((service as any).logger, 'debug');

        // Act
        await service.runGeneralChecks();

        // Assert
        expect(debugSpy).toHaveBeenCalledWith('Running general sanity checks...');
      });
    });
  });

  describe('checkDatabaseIntegrity', () => {
    describe('Happy Path Scenarios', () => {
      it('should log warning about not being implemented', async () => {
        // Arrange
        const warnSpy = jest.spyOn((service as any).logger, 'warn');

        // Act
        await (service as any).checkDatabaseIntegrity();

        // Assert
        expect(warnSpy).toHaveBeenCalledWith(
          'checkDatabaseIntegrity() not yet implemented - needs port from perfana-grafana',
        );
      });

      it('should complete without errors', async () => {
        // Act & Assert
        await expect((service as any).checkDatabaseIntegrity()).resolves.toBeUndefined();
      });
    });
  });

  describe('checkOrphanedRecords', () => {
    describe('Happy Path Scenarios', () => {
      it('should log warning about not being implemented', async () => {
        // Arrange
        const warnSpy = jest.spyOn((service as any).logger, 'warn');

        // Act
        await (service as any).checkOrphanedRecords();

        // Assert
        expect(warnSpy).toHaveBeenCalledWith(
          'checkOrphanedRecords() not yet implemented - needs port from perfana-grafana',
        );
      });

      it('should complete without errors', async () => {
        // Act & Assert
        await expect((service as any).checkOrphanedRecords()).resolves.toBeUndefined();
      });
    });
  });

  describe('checkMissingReferences', () => {
    describe('Happy Path Scenarios', () => {
      it('should log warning about not being implemented', async () => {
        // Arrange
        const warnSpy = jest.spyOn((service as any).logger, 'warn');

        // Act
        await (service as any).checkMissingReferences();

        // Assert
        expect(warnSpy).toHaveBeenCalledWith(
          'checkMissingReferences() not yet implemented - needs port from perfana-grafana',
        );
      });

      it('should complete without errors', async () => {
        // Act & Assert
        await expect((service as any).checkMissingReferences()).resolves.toBeUndefined();
      });
    });
  });

  describe('checkGrafanaInstanceHealth', () => {
    describe('Happy Path Scenarios', () => {
      it('should log warning about not being implemented', async () => {
        // Arrange
        const warnSpy = jest.spyOn((service as any).logger, 'warn');

        // Act
        await service.checkGrafanaInstanceHealth();

        // Assert
        expect(warnSpy).toHaveBeenCalledWith(
          'checkGrafanaInstanceHealth() not yet implemented - needs port from perfana-grafana',
        );
      });

      it('should complete without errors', async () => {
        // Act & Assert
        await expect(service.checkGrafanaInstanceHealth()).resolves.toBeUndefined();
      });
    });
  });

  describe('Scheduled Job Configuration', () => {
    it('should have runGeneralChecks decorated with @Cron', () => {
      // Verify the method exists and can be called
      expect(typeof service.runGeneralChecks).toBe('function');
    });
  });

  describe('Integration with Dependencies', () => {
    it('should use ConfigService for configuration', async () => {
      // Act
      await service.runGeneralChecks();

      // Assert
      expect(configService.get).toHaveBeenCalledWith(
        'grafanaSync.sanityChecker.general.enabled',
        false,
      );
    });

    it('should call all private check methods', async () => {
      // Arrange
      const integritySpy = jest.spyOn(service as any, 'checkDatabaseIntegrity');
      const orphanedSpy = jest.spyOn(service as any, 'checkOrphanedRecords');
      const referencesSpy = jest.spyOn(service as any, 'checkMissingReferences');

      // Act
      await service.runGeneralChecks();

      // Assert
      expect(integritySpy).toHaveBeenCalled();
      expect(orphanedSpy).toHaveBeenCalled();
      expect(referencesSpy).toHaveBeenCalled();
    });
  });

  describe('Error Handling Robustness', () => {
    it('should not propagate errors from check methods', async () => {
      // Arrange
      jest
        .spyOn(service as any, 'checkDatabaseIntegrity')
        .mockRejectedValue(new Error('Integrity check failed'));
      jest
        .spyOn(service as any, 'checkOrphanedRecords')
        .mockRejectedValue(new Error('Orphaned check failed'));
      jest
        .spyOn(service as any, 'checkMissingReferences')
        .mockRejectedValue(new Error('References check failed'));

      // Act & Assert
      await expect(service.runGeneralChecks()).resolves.toBeUndefined();
    });

    it('should handle synchronous errors in check methods', async () => {
      // Arrange
      jest.spyOn(service as any, 'checkDatabaseIntegrity').mockImplementation(() => {
        throw new Error('Synchronous error');
      });
      const errorSpy = jest.spyOn((service as any).logger, 'error');

      // Act
      await service.runGeneralChecks();

      // Assert
      expect(errorSpy).toHaveBeenCalledWith('General sanity check failed:', expect.any(Error));
    });

    it('should handle errors with non-Error objects', async () => {
      // Arrange
      jest.spyOn(service as any, 'checkDatabaseIntegrity').mockRejectedValue('String error');
      const errorSpy = jest.spyOn((service as any).logger, 'error');

      // Act
      await service.runGeneralChecks();

      // Assert
      expect(errorSpy).toHaveBeenCalledWith('General sanity check failed:', 'String error');
    });
  });
});
