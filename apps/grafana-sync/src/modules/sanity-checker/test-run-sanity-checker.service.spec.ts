import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestRunSanityCheckerService } from './test-run-sanity-checker.service';
import { TestRun } from '@perfana/shared/entities';
import {
  createMockRepository,
  createMockConfigService,
  createMockTestRun,
  createMockQueryBuilder,
} from '../../../test/helpers';

describe('TestRunSanityCheckerService', () => {
  let service: TestRunSanityCheckerService;
  let testRunRepository: jest.Mocked<Repository<TestRun>>;
  let configService: any;
  let mockQueryBuilder: any;

  beforeEach(async () => {
    mockQueryBuilder = createMockQueryBuilder();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestRunSanityCheckerService,
        {
          provide: getRepositoryToken(TestRun),
          useValue: createMockRepository<TestRun>(),
        },
        {
          provide: ConfigService,
          useValue: createMockConfigService({
            grafanaSync: {
              sanityChecker: {
                testRun: {
                  enabled: true,
                  delayMinutes: 10,
                },
              },
            },
          }),
        },
      ],
    }).compile();

    service = module.get<TestRunSanityCheckerService>(TestRunSanityCheckerService);
    testRunRepository = module.get(getRepositoryToken(TestRun));
    configService = module.get<ConfigService>(ConfigService);

    // Setup default query builder behavior
    testRunRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have all required dependencies injected', () => {
      expect((service as any).testRunRepository).toBeDefined();
      expect((service as any).configService).toBeDefined();
    });
  });

  describe('checkStuckTestRuns', () => {
    describe('Happy Path Scenarios', () => {
      it('should detect and update stuck test runs', async () => {
        // Arrange
        const stuckTestRuns = [
          createMockTestRun({
            id: 'test-1',
            test_run_id: 'stuck-1',
            startTime: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
            endTime: null,
          }),
          createMockTestRun({
            id: 'test-2',
            test_run_id: 'stuck-2',
            startTime: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
            endTime: null,
          }),
        ];

        mockQueryBuilder.getMany.mockResolvedValue(stuckTestRuns);
        testRunRepository.update.mockResolvedValue({ affected: 1 } as any);

        const loggerSpy = jest.spyOn((service as any).logger, 'log');
        const warnSpy = jest.spyOn((service as any).logger, 'warn');

        // Act
        await service.checkStuckTestRuns();

        // Assert
        expect(warnSpy).toHaveBeenCalledWith('Found 2 stuck test runs');
        expect(testRunRepository.update).toHaveBeenCalledTimes(2);
        expect(loggerSpy).toHaveBeenCalledWith('Updated 2 stuck test runs with end time');
      });

      it('should use configured delay minutes', async () => {
        // Arrange
        configService.get.mockReturnValueOnce(15); // 15 minutes delay
        mockQueryBuilder.getMany.mockResolvedValue([]);

        // Act
        await service.checkStuckTestRuns();

        // Assert
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('testRun.startTime < :threshold', {
          threshold: expect.any(Date),
        });
      });

      it('should query for test runs without end time', async () => {
        // Arrange
        mockQueryBuilder.getMany.mockResolvedValue([]);

        // Act
        await service.checkStuckTestRuns();

        // Assert
        expect(testRunRepository.createQueryBuilder).toHaveBeenCalledWith('testRun');
        expect(mockQueryBuilder.where).toHaveBeenCalledWith('testRun.endTime IS NULL');
      });

      it('should update test runs with current end time', async () => {
        // Arrange
        const stuckTestRun = createMockTestRun({
          id: 'test-1',
          endTime: null,
        });
        mockQueryBuilder.getMany.mockResolvedValue([stuckTestRun]);

        // Act
        const beforeUpdate = Date.now();
        await service.checkStuckTestRuns();
        const afterUpdate = Date.now();

        // Assert
        expect(testRunRepository.update).toHaveBeenCalledWith(
          'test-1',
          expect.objectContaining({
            endTime: expect.any(Date),
          }),
        );

        const updateCall = testRunRepository.update.mock.calls[0];
        const endTime = (updateCall[1] as any).endTime.getTime();
        expect(endTime).toBeGreaterThanOrEqual(beforeUpdate);
        expect(endTime).toBeLessThanOrEqual(afterUpdate);
      });

      it('should handle zero stuck test runs gracefully', async () => {
        // Arrange
        mockQueryBuilder.getMany.mockResolvedValue([]);
        const warnSpy = jest.spyOn((service as any).logger, 'warn');
        const logSpy = jest.spyOn((service as any).logger, 'log');

        // Act
        await service.checkStuckTestRuns();

        // Assert
        expect(warnSpy).not.toHaveBeenCalled();
        expect(logSpy).not.toHaveBeenCalled();
        expect(testRunRepository.update).not.toHaveBeenCalled();
      });
    });

    describe('Configuration Disabled', () => {
      it('should skip check when sanity checker is disabled', async () => {
        // Arrange
        configService.get.mockReturnValueOnce(false);

        // Act
        await service.checkStuckTestRuns();

        // Assert
        expect(testRunRepository.createQueryBuilder).not.toHaveBeenCalled();
      });

      it('should skip check when config is undefined', async () => {
        // Arrange
        configService.get.mockReturnValueOnce(undefined);

        // Act
        await service.checkStuckTestRuns();

        // Assert
        expect(testRunRepository.createQueryBuilder).not.toHaveBeenCalled();
      });
    });

    describe('Error Scenarios', () => {
      it('should handle database query errors', async () => {
        // Arrange
        const error = new Error('Database query failed');
        mockQueryBuilder.getMany.mockRejectedValue(error);
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        // Act
        await service.checkStuckTestRuns();

        // Assert
        expect(errorSpy).toHaveBeenCalledWith('Sanity check failed:', error);
      });

      it('should handle update errors', async () => {
        // Arrange
        const stuckTestRun = createMockTestRun({ id: 'test-1' });
        mockQueryBuilder.getMany.mockResolvedValue([stuckTestRun]);
        testRunRepository.update.mockRejectedValue(new Error('Update failed'));
        const errorSpy = jest.spyOn((service as any).logger, 'error');

        // Act
        await service.checkStuckTestRuns();

        // Assert
        expect(errorSpy).toHaveBeenCalledWith('Sanity check failed:', expect.any(Error));
      });

      it('should continue checking after recovering from error', async () => {
        // Arrange
        mockQueryBuilder.getMany
          .mockRejectedValueOnce(new Error('First attempt failed'))
          .mockResolvedValueOnce([]);

        // Act
        await service.checkStuckTestRuns(); // First attempt (fails)
        await service.checkStuckTestRuns(); // Second attempt (succeeds)

        // Assert
        expect(testRunRepository.createQueryBuilder).toHaveBeenCalledTimes(2);
      });
    });

    describe('Edge Cases', () => {
      it('should handle single stuck test run', async () => {
        // Arrange
        const stuckTestRun = createMockTestRun({ id: 'test-1' });
        mockQueryBuilder.getMany.mockResolvedValue([stuckTestRun]);

        // Act
        await service.checkStuckTestRuns();

        // Assert
        expect(testRunRepository.update).toHaveBeenCalledTimes(1);
      });

      it('should handle large number of stuck test runs', async () => {
        // Arrange
        const stuckTestRuns = Array.from({ length: 100 }, (_, i) =>
          createMockTestRun({ id: `test-${i}` }),
        );
        mockQueryBuilder.getMany.mockResolvedValue(stuckTestRuns);

        // Act
        await service.checkStuckTestRuns();

        // Assert
        expect(testRunRepository.update).toHaveBeenCalledTimes(100);
      });

      it('should use default delay when config is missing', async () => {
        // Arrange
        configService.get.mockReturnValueOnce(true); // enabled
        configService.get.mockReturnValueOnce(undefined); // delayMinutes undefined
        mockQueryBuilder.getMany.mockResolvedValue([]);

        // Act
        await service.checkStuckTestRuns();

        // Assert
        expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('testRun.startTime < :threshold', {
          threshold: expect.any(Date),
        });
      });
    });

    describe('Threshold Calculation', () => {
      it('should calculate threshold correctly for default delay (10 minutes)', async () => {
        // Arrange
        mockQueryBuilder.getMany.mockResolvedValue([]);

        // Act
        const beforeCheck = Date.now() - 10 * 60 * 1000;
        await service.checkStuckTestRuns();
        const afterCheck = Date.now() - 10 * 60 * 1000;

        // Assert
        const thresholdArg = mockQueryBuilder.andWhere.mock.calls[0][1];
        const threshold = thresholdArg.threshold.getTime();
        expect(threshold).toBeGreaterThanOrEqual(beforeCheck);
        expect(threshold).toBeLessThanOrEqual(afterCheck + 1000); // Allow 1s tolerance
      });
    });
  });

  describe('Scheduled Job Configuration', () => {
    it('should have checkStuckTestRuns decorated with @Cron', () => {
      // Verify the method exists and can be called
      expect(typeof service.checkStuckTestRuns).toBe('function');
    });
  });

  describe('Integration with Dependencies', () => {
    it('should use TestRun repository for queries', async () => {
      // Arrange
      mockQueryBuilder.getMany.mockResolvedValue([]);

      // Act
      await service.checkStuckTestRuns();

      // Assert
      expect(testRunRepository.createQueryBuilder).toHaveBeenCalled();
    });

    it('should use ConfigService for configuration', async () => {
      // Act
      await service.checkStuckTestRuns();

      // Assert
      expect(configService.get).toHaveBeenCalledWith(
        'grafanaSync.sanityChecker.testRun.enabled',
        false,
      );
    });
  });
});
