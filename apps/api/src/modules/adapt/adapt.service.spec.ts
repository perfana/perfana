import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdaptService } from './adapt.service';
import {
  DsAdaptTrackedResults,
  DsAdaptConclusion,
  DsAdaptResults,
  TestRun as TestRunEntity,
  DsMetrics,
} from '../../entities';
import { TrackedRegressionStatus } from './dto/tracked-regression.dto';
import { createMockRepository, MockRepository } from '../../../test/helpers/mock-repository.factory';
import { AuthorizationService } from '../../common/services/authorization.service';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';

describe('AdaptService', () => {
  let service: AdaptService;
  let trackedResultsRepo: MockRepository<DsAdaptTrackedResults>;
  let conclusionRepo: MockRepository<DsAdaptConclusion>;
  let testRunRepo: MockRepository<TestRunEntity>;

  const mockTrackedResult: DsAdaptTrackedResults = {
    id: 'tracked-uuid',
    test_run_id: 'test-123',
    control_group_id: 'control-123',
    tracked_test_run_id: 'tracked-test-123',
    tracked_difference_id: 'diff-123',
    application_dashboard_id: 'dashboard-uuid',
    panel_id: 5,
    metric_name: 'response_time',
    dashboard_uid: 'dashboard-uid',
    dashboard_label: 'Test Dashboard',
    panel_title: 'Response Time',
    unit: 'ms',
    benchmark_ids: ['benchmark-1', 'benchmark-2'],
    test_run_start: new Date('2024-01-15T10:00:00.000Z'),
    updated_at: new Date('2024-01-15T11:00:00.000Z'),
    mean: {
      test: 150,
      control: 100,
      pctDiff: 50,
    },
    median: {
      test: 145,
      control: 95,
    },
    min_value: 50,
    max_value: 300,
    std_dev: 25,
    q95: 200,
    compare_config: {},
    metric_classification: { type: 'latency' },
    thresholds: {
      upper: 120,
      lower: 80,
    },
    checks: {},
    conclusion: {
      label: 'regression',
      confidence: 0.85,
    },
    tracked_conclusion: {
      label: 'tracked_regression',
      resolved: false,
    },
  } as any;

  const mockTestRun = {
    testRunId: 'tracked-test-123',
    startTime: new Date('2024-01-15T10:00:00.000Z'),
    applicationRelease: 'v1.0.0',
    annotations: 'Test annotation',
    systemUnderTestId: 'system-uuid',
    testEnvironment: 'production',
    workload: 'load-test',
  } as unknown as TestRunEntity;

  beforeEach(async () => {
    // Use mock repository factory for consistent mocking patterns
    const mockTrackedResultsRepo = createMockRepository<DsAdaptTrackedResults>();
    const mockConclusionRepo = createMockRepository<DsAdaptConclusion>();
    const mockTestRunRepo = createMockRepository<TestRunEntity>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdaptService,
        {
          provide: getRepositoryToken(DsAdaptTrackedResults),
          useValue: mockTrackedResultsRepo,
        },
        {
          provide: getRepositoryToken(DsAdaptConclusion),
          useValue: mockConclusionRepo,
        },
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: mockTestRunRepo,
        },
        {
          provide: getRepositoryToken(DsAdaptResults),
          useValue: createMockRepository<DsAdaptResults>(),
        },
        {
          provide: getRepositoryToken(DsMetrics),
          useValue: createMockRepository<DsMetrics>(),
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
      ],
    }).compile();

    service = module.get<AdaptService>(AdaptService);
    trackedResultsRepo = module.get(getRepositoryToken(DsAdaptTrackedResults));
    conclusionRepo = module.get(getRepositoryToken(DsAdaptConclusion));
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Status Computation Logic', () => {
    describe('computeStatus', () => {
      it('should return UNRESOLVED when no conclusion provided', async () => {
        // Arrange
        const result = { ...mockTrackedResult, conclusion: null as any, tracked_conclusion: null as any };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.status).toBe(TrackedRegressionStatus.UNRESOLVED);
      });

      it('should return ACCEPTED when resolution is accepted', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          tracked_conclusion: {
            resolved: true,
            resolution: 'accepted',
          },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.status).toBe(TrackedRegressionStatus.ACCEPTED);
      });

      it('should return DENIED when resolution is denied', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          tracked_conclusion: {
            resolved: true,
            resolution: 'denied',
          },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.status).toBe(TrackedRegressionStatus.DENIED);
      });

      it('should return UNRESOLVED when conclusion label is regression', async () => {
        // Arrange
        trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.status).toBe(TrackedRegressionStatus.UNRESOLVED);
      });

      it('should return UNRESOLVED when tracked conclusion label is tracked_regression', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          conclusion: { label: 'no_regression' },
          tracked_conclusion: {
            label: 'tracked_regression',
            resolved: false,
          },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.status).toBe(TrackedRegressionStatus.UNRESOLVED);
      });

      it('should handle resolution with mixed case (ACCEPTED)', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          tracked_conclusion: {
            resolved: true,
            resolution: 'ACCEPTED',
          },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.status).toBe(TrackedRegressionStatus.ACCEPTED);
      });

      it('should handle resolution with mixed case (DENIED)', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          tracked_conclusion: {
            resolved: true,
            resolution: 'DENIED',
          },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.status).toBe(TrackedRegressionStatus.DENIED);
      });

      it('should return ACCEPTED when resolution is unknown value (resolved=true)', async () => {
        // Arrange - any resolved regression with non-accepted/denied resolution is treated as accepted
        const result = {
          ...mockTrackedResult,
          tracked_conclusion: {
            resolved: true,
            resolution: 'unknown_status',
          },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.status).toBe(TrackedRegressionStatus.ACCEPTED);
      });
    });

    describe('computePercentageChange', () => {
      it('should calculate from pctDiff when available', async () => {
        // Arrange
        trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.percentageChange).toBe(50);
      });

      it('should calculate from test and control values', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: {
            test: 150,
            control: 100,
          },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.percentageChange).toBe(50);
      });

      it('should return 0 when control is 0', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: {
            test: 150,
            control: 0,
          },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.percentageChange).toBe(0);
      });

      it('should return 0 when mean is not an object', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: null as any,
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.percentageChange).toBe(0);
      });

      it('should handle negative pctDiff and return absolute value', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: {
            test: 80,
            control: 100,
            pctDiff: -20,
          },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.percentageChange).toBe(20);
      });

      it('should handle string numbers in pctDiff', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: {
            test: 150,
            control: 100,
            pctDiff: '50' as any,
          },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.percentageChange).toBe(50);
      });

      it('should return 0 when pctDiff is NaN', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: {
            pctDiff: 'not-a-number' as any,
          },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.percentageChange).toBe(0);
      });

      it('should calculate negative percentage change correctly', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: {
            test: 75,
            control: 100,
          },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.percentageChange).toBe(25);
      });
    });

    describe('computeSeverity', () => {
      it('should return high severity for percentage change >= 50%', async () => {
        // Arrange
        trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.severity).toBe('high');
      });

      it('should return high severity for confidence >= 0.95', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: { test: 110, control: 100, pctDiff: 10 },
          conclusion: { label: 'regression', confidence: 0.95 },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.severity).toBe('high');
      });

      it('should return medium severity for percentage change >= 20%', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: { test: 125, control: 100, pctDiff: 25 },
          conclusion: { label: 'regression', confidence: 0.75 },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.severity).toBe('medium');
      });

      it('should return medium severity for confidence >= 0.8', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: { test: 105, control: 100, pctDiff: 5 },
          conclusion: { label: 'regression', confidence: 0.8 },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.severity).toBe('medium');
      });

      it('should return low severity for small changes', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: { test: 105, control: 100, pctDiff: 5 },
          conclusion: { label: 'regression', confidence: 0.6 },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.severity).toBe('low');
      });

      it('should handle missing confidence and default to 0', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: { test: 105, control: 100, pctDiff: 5 },
          conclusion: undefined,
        };
        trackedResultsRepo.find.mockResolvedValue([result as any]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.severity).toBe('low');
      });

      it('should return high severity when exactly at 50% threshold', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: { test: 150, control: 100, pctDiff: 50 },
          conclusion: { label: 'regression', confidence: 0.5 },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.severity).toBe('high');
      });

      it('should return medium severity when exactly at 20% threshold', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: { test: 120, control: 100, pctDiff: 20 },
          conclusion: { label: 'regression', confidence: 0.5 },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.severity).toBe('medium');
      });
    });
  });

  describe('getTrackedRegressions', () => {
    it('should return tracked regressions for test run', async () => {
      // Arrange
      trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);
      conclusionRepo.findOne.mockResolvedValue({
        test_run_id: 'test-123',
        tracked_regressions: ['tracked-uuid'],
      } as any);
      testRunRepo.findOne.mockResolvedValue(mockTestRun);

      // Act
      const result = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

      // Assert
      expect(result.regressions).toHaveLength(1);
      expect(result.regressions[0]?.testRunId).toBe('test-123');
      expect(result.regressions[0]?.metricName).toBe('response_time');
      expect(result.totalTracked).toBe(1);
    });

    it('should return empty array when no conclusion found', async () => {
      // Arrange
      conclusionRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

      // Assert
      expect(result.regressions).toEqual([]);
      expect(result.totalTracked).toBe(0);
      expect(result.unresolvedCount).toBe(0);
    });

    it('should return empty array when no tracked regressions in conclusion', async () => {
      // Arrange
      conclusionRepo.findOne.mockResolvedValue({
        test_run_id: 'test-123',
        tracked_regressions: [],
      } as any);

      // Act
      const result = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

      // Assert
      expect(result.regressions).toEqual([]);
      expect(result.totalTracked).toBe(0);
    });

    it('should enrich with test run metadata', async () => {
      // Arrange
      trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);
      conclusionRepo.findOne.mockResolvedValue({
        test_run_id: 'test-123',
        tracked_regressions: ['tracked-uuid'],
      } as any);
      testRunRepo.findOne.mockResolvedValue(mockTestRun);

      // Act
      const result = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

      // Assert
      expect(result.regressions[0]?.version).toBe('v1.0.0');
      expect(result.regressions[0]?.annotations).toBe('Test annotation');
      expect(result.regressions[0]?.systemUnderTest).toBe('system-uuid');
      expect(result.regressions[0]?.environment).toBe('production');
      expect(result.regressions[0]?.workload).toBe('load-test');
      expect(testRunRepo.findOne).toHaveBeenCalledWith({
        where: { testRunId: 'tracked-test-123' },
      });
    });

    it('should handle array annotations', async () => {
      // Arrange
      trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);
      conclusionRepo.findOne.mockResolvedValue({
        test_run_id: 'test-123',
        tracked_regressions: ['tracked-uuid'],
      } as any);
      testRunRepo.findOne.mockResolvedValue({
        ...mockTestRun,
        annotations: ['Annotation 1', 'Annotation 2'],
      } as any);

      // Act
      const result = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

      // Assert
      expect(result.regressions[0]?.annotations).toBe('Annotation 1\nAnnotation 2');
    });

    it('should handle test run metadata fetch failure gracefully', async () => {
      // Arrange
      trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);
      conclusionRepo.findOne.mockResolvedValue({
        test_run_id: 'test-123',
        tracked_regressions: ['tracked-uuid'],
      } as any);
      testRunRepo.findOne.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

      // Assert
      expect(result.regressions[0]?.version).toBeUndefined();
      expect(result.regressions[0]?.annotations).toBeUndefined();
    });

    it('should count unresolved regressions', async () => {
      // Arrange
      const resolvedResult = {
        ...mockTrackedResult,
        id: 'resolved-uuid',
        tracked_conclusion: {
          resolved: true,
          resolution: 'accepted',
        },
      };
      trackedResultsRepo.find.mockResolvedValue([mockTrackedResult, resolvedResult]);
      conclusionRepo.findOne.mockResolvedValue({
        test_run_id: 'test-123',
        tracked_regressions: ['tracked-uuid', 'resolved-uuid'],
      } as any);

      // Act
      const result = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

      // Assert
      expect(result.totalTracked).toBe(2);
      expect(result.unresolvedCount).toBe(1);
    });

    it('should handle when test run is not found (null)', async () => {
      // Arrange
      trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);
      conclusionRepo.findOne.mockResolvedValue({
        test_run_id: 'test-123',
        tracked_regressions: ['tracked-uuid'],
      } as any);
      testRunRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

      // Assert
      expect(result.regressions[0]?.version).toBeUndefined();
      expect(result.regressions[0]?.annotations).toBeUndefined();
    });

    it('should use tracked regression start time when test run has no start time', async () => {
      // Arrange
      trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);
      conclusionRepo.findOne.mockResolvedValue({
        test_run_id: 'test-123',
        tracked_regressions: ['tracked-uuid'],
      } as any);
      testRunRepo.findOne.mockResolvedValue({
        ...mockTestRun,
        startTime: null,
      } as any);

      // Act
      const result = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

      // Assert
      expect(result.regressions[0]?.testRunStart).toEqual(mockTrackedResult.test_run_start);
    });

    it('should accept optional system, environment, and workload parameters', async () => {
      // Arrange
      trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);
      conclusionRepo.findOne.mockResolvedValue({
        test_run_id: 'test-123',
        tracked_regressions: ['tracked-uuid'],
      } as any);

      // Act
      await service.getTrackedRegressions('test-123', 'system-1', 'prod', 'load', ['admin'], []);

      // Assert
      expect(conclusionRepo.findOne).toHaveBeenCalled();
    });

    it('should handle empty array annotations', async () => {
      // Arrange
      trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);
      conclusionRepo.findOne.mockResolvedValue({
        test_run_id: 'test-123',
        tracked_regressions: ['tracked-uuid'],
      } as any);
      testRunRepo.findOne.mockResolvedValue({
        ...mockTestRun,
        annotations: [],
      } as any);

      // Act
      const result = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

      // Assert
      // Empty array joins to empty string, then '' || undefined becomes undefined
      expect(result.regressions[0]?.annotations).toBeUndefined();
    });
  });

  describe('getTrackedRegressionsCount', () => {
    it('should return count of tracked regressions', async () => {
      // Arrange
      trackedResultsRepo.count.mockResolvedValue(5);

      // Act
      const result = await service.getTrackedRegressionsCount('test-123', ['admin'], []);

      // Assert
      expect(result.count).toBe(5);
      expect(trackedResultsRepo.count).toHaveBeenCalledWith({
        where: { test_run_id: 'test-123' },
      });
    });

    it('should return 0 on error', async () => {
      // Arrange
      trackedResultsRepo.count.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.getTrackedRegressionsCount('test-123', ['admin'], []);

      // Assert
      expect(result.count).toBe(0);
    });

    it('should return 0 when no regressions exist', async () => {
      // Arrange
      trackedResultsRepo.count.mockResolvedValue(0);

      // Act
      const result = await service.getTrackedRegressionsCount('test-123', ['admin'], []);

      // Assert
      expect(result.count).toBe(0);
    });
  });

  describe('resolveTrackedRegression', () => {
    it('should resolve tracked regression as accepted', async () => {
      // Arrange
      trackedResultsRepo.findOne.mockResolvedValue(mockTrackedResult);
      trackedResultsRepo.update.mockResolvedValue({} as any);

      // Act
      const result = await service.resolveTrackedRegression('tracked-uuid', {
        resolution: 'accepted',
        excludeFromBaseline: false,
        comment: 'Expected behavior',
      }, ['admin'], []);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('marked as accepted');
      expect(trackedResultsRepo.update).toHaveBeenCalledWith(
        { id: 'tracked-uuid' },
        expect.objectContaining({
          tracked_conclusion: expect.objectContaining({
            resolved: true,
            resolution: 'accepted',
            excludeFromBaseline: false,
            comment: 'Expected behavior',
          }),
        })
      );
    });

    it('should resolve tracked regression as denied', async () => {
      // Arrange
      trackedResultsRepo.findOne.mockResolvedValue(mockTrackedResult);
      trackedResultsRepo.update.mockResolvedValue({} as any);

      // Act
      const result = await service.resolveTrackedRegression('tracked-uuid', {
        resolution: 'denied',
        excludeFromBaseline: true,
      }, ['admin'], []);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('marked as denied');
    });

    it('should return failure when regression not found', async () => {
      // Arrange
      trackedResultsRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.resolveTrackedRegression('non-existent-id', {
        resolution: 'accepted',
        excludeFromBaseline: false,
      }, ['admin'], []);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      trackedResultsRepo.findOne.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.resolveTrackedRegression('tracked-uuid', {
        resolution: 'accepted',
        excludeFromBaseline: false,
      }, ['admin'], []);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to resolve regression');
    });

    it('should preserve existing tracked conclusion data', async () => {
      // Arrange
      const existingConclusion = {
        label: 'tracked_regression',
        existingField: 'existingValue',
      };
      const regressionWithData = {
        ...mockTrackedResult,
        tracked_conclusion: existingConclusion,
      };
      trackedResultsRepo.findOne.mockResolvedValue(regressionWithData);
      trackedResultsRepo.update.mockResolvedValue({} as any);

      // Act
      await service.resolveTrackedRegression('tracked-uuid', {
        resolution: 'accepted',
        excludeFromBaseline: false,
        comment: 'Test comment',
      }, ['admin'], []);

      // Assert
      expect(trackedResultsRepo.update).toHaveBeenCalledWith(
        { id: 'tracked-uuid' },
        expect.objectContaining({
          tracked_conclusion: expect.objectContaining({
            existingField: 'existingValue',
            resolved: true,
            resolution: 'accepted',
          }),
        })
      );
    });

    it('should set resolvedAt timestamp', async () => {
      // Arrange
      trackedResultsRepo.findOne.mockResolvedValue(mockTrackedResult);
      trackedResultsRepo.update.mockResolvedValue({} as any);
      const beforeTime = new Date();

      // Act
      await service.resolveTrackedRegression('tracked-uuid', {
        resolution: 'accepted',
        excludeFromBaseline: false,
      }, ['admin'], []);

      const afterTime = new Date();

      // Assert
      const updateCall = trackedResultsRepo.update.mock.calls[0]?.[1] as any;
      const resolvedAtStr = updateCall.tracked_conclusion.resolvedAt;
      const resolvedAtDate = new Date(resolvedAtStr);
      expect(resolvedAtDate.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(resolvedAtDate.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('should update updated_at timestamp', async () => {
      // Arrange
      trackedResultsRepo.findOne.mockResolvedValue(mockTrackedResult);
      trackedResultsRepo.update.mockResolvedValue({} as any);

      // Act
      await service.resolveTrackedRegression('tracked-uuid', {
        resolution: 'accepted',
        excludeFromBaseline: false,
      }, ['admin'], []);

      // Assert
      const updateCall = trackedResultsRepo.update.mock.calls[0]?.[1] as any;
      expect(updateCall.updated_at).toBeInstanceOf(Date);
    });

    it('should handle resolution without comment', async () => {
      // Arrange
      trackedResultsRepo.findOne.mockResolvedValue(mockTrackedResult);
      trackedResultsRepo.update.mockResolvedValue({} as any);

      // Act
      const result = await service.resolveTrackedRegression('tracked-uuid', {
        resolution: 'accepted',
        excludeFromBaseline: false,
      }, ['admin'], []);

      // Assert
      expect(result.success).toBe(true);
      expect(trackedResultsRepo.update).toHaveBeenCalledWith(
        { id: 'tracked-uuid' },
        expect.objectContaining({
          tracked_conclusion: expect.objectContaining({
            comment: undefined,
          }),
        })
      );
    });
  });

  describe('resolveTrackedRegressionsByTestRun', () => {
    it('should resolve all regressions for test run', async () => {
      // Arrange
      const regressions = [
        mockTrackedResult,
        { ...mockTrackedResult, id: 'tracked-uuid-2' },
      ];
      trackedResultsRepo.find.mockResolvedValue(regressions);
      trackedResultsRepo.update.mockResolvedValue({} as any);

      // Act
      const result = await service.resolveTrackedRegressionsByTestRun('tracked-test-123', 'accepted', ['admin'], []);

      // Assert
      expect(result.success).toBe(true);
      expect(result.resolvedCount).toBe(2);
      expect(result.message).toContain('Successfully resolved 2 tracked regressions');
      expect(trackedResultsRepo.update).toHaveBeenCalledTimes(2);
    });

    it('should return failure when no regressions found', async () => {
      // Arrange
      trackedResultsRepo.find.mockResolvedValue([]);

      // Act
      const result = await service.resolveTrackedRegressionsByTestRun('tracked-test-123', 'accepted', ['admin'], []);

      // Assert
      expect(result.success).toBe(false);
      expect(result.resolvedCount).toBe(0);
      expect(result.message).toContain('No tracked regressions found');
    });

    it('should set excludeFromBaseline to true when resolution is regression', async () => {
      // Arrange
      trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);
      trackedResultsRepo.update.mockResolvedValue({} as any);

      // Act
      await service.resolveTrackedRegressionsByTestRun('tracked-test-123', 'regression', ['admin'], []);

      // Assert
      expect(trackedResultsRepo.update).toHaveBeenCalledWith(
        { id: 'tracked-uuid' },
        expect.objectContaining({
          tracked_conclusion: expect.objectContaining({
            excludeFromBaseline: true,
            resolution: 'regression',
          }),
        })
      );
    });

    it('should set excludeFromBaseline to false when resolution is not regression', async () => {
      // Arrange
      trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);
      trackedResultsRepo.update.mockResolvedValue({} as any);

      // Act
      await service.resolveTrackedRegressionsByTestRun('tracked-test-123', 'denied', ['admin'], []);

      // Assert
      expect(trackedResultsRepo.update).toHaveBeenCalledWith(
        { id: 'tracked-uuid' },
        expect.objectContaining({
          tracked_conclusion: expect.objectContaining({
            excludeFromBaseline: false,
            resolution: 'denied',
          }),
        })
      );
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      trackedResultsRepo.find.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.resolveTrackedRegressionsByTestRun('tracked-test-123', 'accepted', ['admin'], []);

      // Assert
      expect(result.success).toBe(false);
      expect(result.resolvedCount).toBe(0);
    });

    it('should preserve existing tracked conclusion data when resolving', async () => {
      // Arrange
      const regressionWithData = {
        ...mockTrackedResult,
        tracked_conclusion: {
          label: 'tracked_regression',
          existingData: 'preserved',
        },
      };
      trackedResultsRepo.find.mockResolvedValue([regressionWithData]);
      trackedResultsRepo.update.mockResolvedValue({} as any);

      // Act
      await service.resolveTrackedRegressionsByTestRun('tracked-test-123', 'accepted', ['admin'], []);

      // Assert
      expect(trackedResultsRepo.update).toHaveBeenCalledWith(
        { id: 'tracked-uuid' },
        expect.objectContaining({
          tracked_conclusion: expect.objectContaining({
            existingData: 'preserved',
            resolved: true,
          }),
        })
      );
    });

    it('should include error message in failure response', async () => {
      // Arrange
      trackedResultsRepo.find.mockRejectedValue(new Error('Connection timeout'));

      // Act
      const result = await service.resolveTrackedRegressionsByTestRun('tracked-test-123', 'accepted', ['admin'], []);

      // Assert
      expect(result.message).toContain('Connection timeout');
    });
  });

  describe('getTrackedDifferencesChart', () => {
    it('should return chart data for metric', async () => {
      // Arrange
      trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);

      // Act
      const result = await service.getTrackedDifferencesChart('response_time', 'test-123', 50, ['admin'], []);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].testRunId).toBe('test-123');
      expect(result[0].value).toBe(150);
      expect(result[0].selectedTestRun).toBe(true);
      expect(result[0].regression).toBe(true);
      expect(trackedResultsRepo.find).toHaveBeenCalledWith({
        where: { metric_name: 'response_time' },
        order: { test_run_start: 'DESC' },
        take: 50,
      });
    });

    it('should handle number mean value', async () => {
      // Arrange
      const result = { ...mockTrackedResult, mean: 150 as any };
      trackedResultsRepo.find.mockResolvedValue([result]);

      // Act
      const chartData = await service.getTrackedDifferencesChart('response_time', 'test-123', 50, ['admin'], []);

      // Assert
      expect(chartData[0].value).toBe(150);
    });

    it('should handle mean.value property', async () => {
      // Arrange
      const result = { ...mockTrackedResult, mean: { value: 175 } };
      trackedResultsRepo.find.mockResolvedValue([result]);

      // Act
      const chartData = await service.getTrackedDifferencesChart('response_time', 'test-123', 50, ['admin'], []);

      // Assert
      expect(chartData[0].value).toBe(175);
    });

    it('should return 0 for invalid mean value', async () => {
      // Arrange
      const result = { ...mockTrackedResult, mean: null as any };
      trackedResultsRepo.find.mockResolvedValue([result]);

      // Act
      const chartData = await service.getTrackedDifferencesChart('response_time', 'test-123', 50, ['admin'], []);

      // Assert
      expect(chartData[0].value).toBe(0);
    });

    it('should return empty array on error', async () => {
      // Arrange
      trackedResultsRepo.find.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.getTrackedDifferencesChart('response_time', 'test-123', 50, ['admin'], []);

      // Assert
      expect(result).toEqual([]);
    });

    it('should use default limit of 50 when not specified', async () => {
      // Arrange
      trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);

      // Act
      await service.getTrackedDifferencesChart('response_time', 'test-123', 50, ['admin'], []);

      // Assert
      expect(trackedResultsRepo.find).toHaveBeenCalledWith({
        where: { metric_name: 'response_time' },
        order: { test_run_start: 'DESC' },
        take: 50,
      });
    });

    it('should mark controlGroup as false when different from test_run_id', async () => {
      // Arrange
      const result = {
        ...mockTrackedResult,
        control_group_id: 'different-id',
        test_run_id: 'test-123',
      };
      trackedResultsRepo.find.mockResolvedValue([result]);

      // Act
      const chartData = await service.getTrackedDifferencesChart('response_time', 'test-123', 50, ['admin'], []);

      // Assert
      expect(chartData[0].controlGroup).toBe(false);
    });

    it('should calculate default thresholds when not provided', async () => {
      // Arrange
      const result = { ...mockTrackedResult, thresholds: undefined };
      trackedResultsRepo.find.mockResolvedValue([result as any]);

      // Act
      const chartData = await service.getTrackedDifferencesChart('response_time', 'test-123', 50, ['admin'], []);

      // Assert
      expect(chartData[0].thresholds.upper).toBe(150 * 1.1);
      expect(chartData[0].thresholds.lower).toBe(150 * 0.9);
    });

    it('should use provided thresholds when available', async () => {
      // Arrange
      trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);

      // Act
      const chartData = await service.getTrackedDifferencesChart('response_time', 'test-123', 50, ['admin'], []);

      // Assert
      expect(chartData[0].thresholds.upper).toBe(120);
      expect(chartData[0].thresholds.lower).toBe(80);
    });

    it('should handle conclusion with different labels', async () => {
      // Arrange
      const result = {
        ...mockTrackedResult,
        conclusion: { label: 'no_regression' },
      };
      trackedResultsRepo.find.mockResolvedValue([result]);

      // Act
      const chartData = await service.getTrackedDifferencesChart('response_time', 'test-123', 50, ['admin'], []);

      // Assert
      expect(chartData[0].regression).toBe(false);
    });

    it('should handle missing conclusion', async () => {
      // Arrange
      const result = { ...mockTrackedResult, conclusion: undefined };
      trackedResultsRepo.find.mockResolvedValue([result as any]);

      // Act
      const chartData = await service.getTrackedDifferencesChart('response_time', 'test-123', 50, ['admin'], []);

      // Assert
      expect(chartData[0].regression).toBe(false);
    });

    it('should handle undefined mean gracefully', async () => {
      // Arrange
      const result = { ...mockTrackedResult, mean: undefined };
      trackedResultsRepo.find.mockResolvedValue([result]);

      // Act
      const chartData = await service.getTrackedDifferencesChart('response_time', 'test-123', 50, ['admin'], []);

      // Assert
      expect(chartData[0].value).toBe(0);
    });
  });

  describe('getCorrelatedRegressions', () => {
    it('should find correlated regressions within time window', async () => {
      // Arrange
      const correlatedResult = { ...mockTrackedResult, id: 'correlated-uuid' };
      trackedResultsRepo.findOne.mockResolvedValue(mockTrackedResult);

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([correlatedResult]),
      };

      trackedResultsRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.getCorrelatedRegressions('tracked-uuid', 'test-123', ['admin'], []);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('correlated-uuid');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('tr.id != :regressionId', {
        regressionId: 'tracked-uuid',
      });
    });

    it('should return empty array when main regression not found', async () => {
      // Arrange
      trackedResultsRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.getCorrelatedRegressions('non-existent-id', 'test-123', ['admin'], []);

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      trackedResultsRepo.findOne.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.getCorrelatedRegressions('tracked-uuid', 'test-123', ['admin'], []);

      // Assert
      expect(result).toEqual([]);
    });

    it('should query with correct time window (7 days before and after)', async () => {
      // Arrange
      trackedResultsRepo.findOne.mockResolvedValue(mockTrackedResult);

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      trackedResultsRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.getCorrelatedRegressions('tracked-uuid', 'test-123', ['admin'], []);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'tr.test_run_start >= :startDate',
        expect.objectContaining({
          startDate: expect.any(Date),
        })
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'tr.test_run_start <= :endDate',
        expect.objectContaining({
          endDate: expect.any(Date),
        })
      );
    });

    it('should filter by control group and dashboard', async () => {
      // Arrange
      trackedResultsRepo.findOne.mockResolvedValue(mockTrackedResult);

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      trackedResultsRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.getCorrelatedRegressions('tracked-uuid', 'test-123', ['admin'], []);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(tr.control_group_id = :controlGroupId OR tr.application_dashboard_id = :dashboardId)',
        {
          controlGroupId: 'control-123',
          dashboardId: 'dashboard-uuid',
        }
      );
    });

    it('should limit results to 10', async () => {
      // Arrange
      trackedResultsRepo.findOne.mockResolvedValue(mockTrackedResult);

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      trackedResultsRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.getCorrelatedRegressions('tracked-uuid', 'test-123', ['admin'], []);

      // Assert
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    });

    it('should order by test_run_start descending', async () => {
      // Arrange
      trackedResultsRepo.findOne.mockResolvedValue(mockTrackedResult);

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      trackedResultsRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.getCorrelatedRegressions('tracked-uuid', 'test-123', ['admin'], []);

      // Assert
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('tr.test_run_start', 'DESC');
    });
  });

  describe('getDsAdaptConclusion', () => {
    it('should return conclusion for test run', async () => {
      // Arrange
      const conclusion = {
        test_run_id: 'test-123',
        tracked_regressions: ['tracked-uuid'],
      };
      conclusionRepo.findOne.mockResolvedValue(conclusion as any);

      // Act
      const result = await service.getDsAdaptConclusion('test-123', ['admin'], []);

      // Assert
      expect(result).toEqual(conclusion);
      expect(conclusionRepo.findOne).toHaveBeenCalledWith({
        where: { test_run_id: 'test-123' },
      });
    });

    it('should return null when conclusion not found', async () => {
      // Arrange
      conclusionRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.getDsAdaptConclusion('test-123', ['admin'], []);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      // Arrange
      conclusionRepo.findOne.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.getDsAdaptConclusion('test-123', ['admin'], []);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle network timeout errors gracefully', async () => {
      // Arrange
      conclusionRepo.findOne.mockRejectedValue(new Error('ETIMEDOUT'));

      // Act
      const result = await service.getDsAdaptConclusion('test-123', ['admin'], []);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('Edge Cases and Complex Scenarios', () => {
    describe('mapEntityToDatabase', () => {
      it('should handle panel_id conversion to string', async () => {
        // Arrange
        const entityWithPanelId = {
          ...mockTrackedResult,
          panel_id: 12345,
        };
        trackedResultsRepo.find.mockResolvedValue([entityWithPanelId]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const result = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(result.regressions[0]?.panelId).toBe('12345');
      });
    });

    describe('Special Characters and Unicode', () => {
      it('should handle metric names with special characters', async () => {
        // Arrange
        const specialMetric = {
          ...mockTrackedResult,
          metric_name: 'response_time_p99.9_µs',
        };
        trackedResultsRepo.find.mockResolvedValue([specialMetric]);

        // Act
        const chartData = await service.getTrackedDifferencesChart('response_time_p99.9_µs', 'test-123', 50, ['admin'], []);

        // Assert
        expect(chartData).toHaveLength(1);
      });

      it('should handle dashboard labels with emojis', async () => {
        // Arrange
        const emojiDashboard = {
          ...mockTrackedResult,
          dashboard_label: 'Dashboard 📊 Performance',
        };
        trackedResultsRepo.find.mockResolvedValue([emojiDashboard]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const result = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(result.regressions[0]?.dashboardLabel).toBe('Dashboard 📊 Performance');
      });
    });

    describe('Large Data Sets', () => {
      it('should handle large number of tracked regressions', async () => {
        // Arrange
        const largeSet = Array.from({ length: 1000 }, (_, i) => ({
          ...mockTrackedResult,
          id: `uuid-${i}`,
        }));
        const trackedIds = largeSet.map(r => r.id);
        trackedResultsRepo.find.mockResolvedValue(largeSet);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: trackedIds,
        } as any);

        // Act
        const result = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(result.regressions).toHaveLength(1000);
        expect(result.totalTracked).toBe(1000);
      });

      it('should handle resolving large batch of regressions', async () => {
        // Arrange
        const largeSet = Array.from({ length: 100 }, (_, i) => ({
          ...mockTrackedResult,
          id: `uuid-${i}`,
        }));
        trackedResultsRepo.find.mockResolvedValue(largeSet);
        trackedResultsRepo.update.mockResolvedValue({} as any);

        // Act
        const result = await service.resolveTrackedRegressionsByTestRun('tracked-test-123', 'accepted', ['admin'], []);

        // Assert
        expect(result.resolvedCount).toBe(100);
        expect(trackedResultsRepo.update).toHaveBeenCalledTimes(100);
      });
    });

    describe('Boundary Values', () => {
      it('should handle zero percentage change', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: { test: 100, control: 100, pctDiff: 0 },
          conclusion: { label: 'regression', confidence: 0.5 },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.percentageChange).toBe(0);
        expect(response.regressions[0]?.severity).toBe('low');
      });

      it('should handle very high confidence (1.0)', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: { test: 105, control: 100, pctDiff: 5 },
          conclusion: { label: 'regression', confidence: 1.0 },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.severity).toBe('high');
      });

      it('should handle negative control value', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: { test: -50, control: -100 },
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.percentageChange).toBe(50);
      });
    });

    describe('Null and Undefined Handling', () => {
      it('should handle null benchmark_ids', async () => {
        // Arrange
        const result = { ...mockTrackedResult, benchmark_ids: null as any };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.benchmarkIds).toBeNull();
      });

      it('should handle empty benchmark_ids array', async () => {
        // Arrange
        const result = { ...mockTrackedResult, benchmark_ids: [] };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.benchmarkIds).toEqual([]);
      });

      it('should handle null thresholds in chart data', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          thresholds: undefined,
          mean: 0 as any,
        };
        trackedResultsRepo.find.mockResolvedValue([result as any]);

        // Act
        const chartData = await service.getTrackedDifferencesChart('response_time', 'test-123', 50, ['admin'], []);

        // Assert
        expect(chartData[0].thresholds.upper).toBe(0);
        expect(chartData[0].thresholds.lower).toBe(0);
      });

      it('should handle undefined thresholds object', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          thresholds: undefined,
        };
        trackedResultsRepo.find.mockResolvedValue([result]);

        // Act
        const chartData = await service.getTrackedDifferencesChart('response_time', 'test-123', 50, ['admin'], []);

        // Assert
        expect(chartData[0].thresholds).toBeDefined();
      });
    });

    describe('Date Handling', () => {
      it('should handle ISO date strings', async () => {
        // Arrange
        const isoDate = '2024-01-15T10:00:00.000Z';
        const result = {
          ...mockTrackedResult,
          test_run_start: new Date(isoDate),
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.testRunStart).toBeInstanceOf(Date);
      });

      it('should handle future dates in test runs', async () => {
        // Arrange
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 1);
        const result = {
          ...mockTrackedResult,
          test_run_start: futureDate,
        };
        trackedResultsRepo.find.mockResolvedValue([result]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.testRunStart.getFullYear()).toBe(futureDate.getFullYear());
      });
    });

    describe('Concurrency and Race Conditions', () => {
      it('should handle concurrent resolution attempts', async () => {
        // Arrange
        trackedResultsRepo.findOne.mockResolvedValue(mockTrackedResult);
        trackedResultsRepo.update.mockResolvedValue({} as any);

        // Act
        const results = await Promise.all([
          service.resolveTrackedRegression('tracked-uuid', {
            resolution: 'accepted',
            excludeFromBaseline: false,
          }, ['admin'], []),
          service.resolveTrackedRegression('tracked-uuid', {
            resolution: 'denied',
            excludeFromBaseline: true,
          }, ['admin'], []),
        ]);

        // Assert
        expect(results[0].success).toBe(true);
        expect(results[1].success).toBe(true);
        expect(trackedResultsRepo.update).toHaveBeenCalledTimes(2);
      });
    });

    describe('Empty and Missing Data', () => {
      it('should handle regression with no statistical data', async () => {
        // Arrange
        const result = {
          ...mockTrackedResult,
          mean: undefined,
          median: undefined,
          min_value: undefined,
          max_value: undefined,
          std_dev: undefined,
          q95: undefined,
        };
        trackedResultsRepo.find.mockResolvedValue([result as any]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);

        // Act
        const response = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        expect(response.regressions[0]?.percentageChange).toBe(0);
        expect(response.regressions).toHaveLength(1);
      });

      it('should handle empty string annotations', async () => {
        // Arrange
        trackedResultsRepo.find.mockResolvedValue([mockTrackedResult]);
        conclusionRepo.findOne.mockResolvedValue({
          test_run_id: 'test-123',
          tracked_regressions: ['tracked-uuid'],
        } as any);
        testRunRepo.findOne.mockResolvedValue({
          ...mockTestRun,
          annotations: '',
        } as any);

        // Act
        const result = await service.getTrackedRegressions('test-123', undefined, undefined, undefined, ['admin'], []);

        // Assert
        // Empty string '' || undefined becomes undefined
        expect(result.regressions[0]?.annotations).toBeUndefined();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// getCorrelationGroups — TDD tests (Task 3)
// ---------------------------------------------------------------------------

const correlationAdaptRows = [
  { id: 'a', metric_name: 'cpu', dashboard_label: 'svc', dashboard_uid: 'u', panel_id: 1, application_dashboard_id: 'd', panel_title: 'p', conclusion: { label: 'regression' } },
  { id: 'b', metric_name: 'latency', dashboard_label: 'svc', dashboard_uid: 'u', panel_id: 2, application_dashboard_id: 'd', panel_title: 'p', conclusion: { label: 'regression' } },
  { id: 'c', metric_name: 'noise', dashboard_label: 'svc', dashboard_uid: 'u', panel_id: 3, application_dashboard_id: 'd', panel_title: 'p', conclusion: { label: 'regression' } },
];

const seriesByMetric: Record<string, number[]> = {
  cpu: [1, 2, 3, 4, 5, 6],
  latency: [2, 4, 6, 8, 10, 12], // r=1 with cpu
  noise: [5, 1, 9, 2, 8, 3],     // uncorrelated
};

function buildCorrelationModule(conclusionReturn: unknown) {
  const dsMetricsRepo = {
    find: jest.fn(async (opts: { where: { metric_name: string } }) =>
      seriesByMetric[opts.where.metric_name].map((value, i) => ({ time: new Date(i * 1000), value })),
    ),
  };
  return Test.createTestingModule({
    providers: [
      AdaptService,
      { provide: getRepositoryToken(DsAdaptTrackedResults), useValue: {} },
      { provide: getRepositoryToken(DsAdaptConclusion), useValue: { findOne: jest.fn(async () => conclusionReturn) } },
      { provide: getRepositoryToken(TestRunEntity), useValue: {} },
      { provide: getRepositoryToken(DsAdaptResults), useValue: { find: jest.fn(async () => correlationAdaptRows) } },
      { provide: getRepositoryToken(DsMetrics), useValue: dsMetricsRepo },
      { provide: AuthorizationService, useValue: { isGlobalAdmin: () => true, getAccessibleOrganizations: jest.fn(async () => []) } },
    ],
  }).compile();
}

describe('AdaptService.getCorrelationGroups', () => {
  describe('with three regressions (two correlated, one noise)', () => {
    let service: AdaptService;

    const conclusion = { test_run_id: 't1', regressions: ['a', 'b', 'c'] };

    beforeEach(async () => {
      const moduleRef = await buildCorrelationModule(conclusion);
      service = moduleRef.get(AdaptService);
    });

    it('groups correlated regressions and leaves the independent one ungrouped', async () => {
      const result = await service.getCorrelationGroups('t1', 'admin', ['super-admin']);
      expect(result).not.toBeNull();
      expect(result!.groups).toHaveLength(1);
      expect(result!.groups[0].members.map((m) => m.resultId).sort()).toEqual(['a', 'b']);
      expect(result!.ungrouped.map((u) => u.resultId)).toEqual(['c']);
    });
  });

  describe('with fewer than two regressions', () => {
    let service: AdaptService;

    const conclusion = { test_run_id: 't1', regressions: ['a'] };

    beforeEach(async () => {
      const moduleRef = await buildCorrelationModule(conclusion);
      service = moduleRef.get(AdaptService);
    });

    it('returns empty groups and empty ungrouped', async () => {
      const single = await service.getCorrelationGroups('t1', 'admin', ['super-admin']);
      expect(single!.groups).toHaveLength(0);
      expect(single!.ungrouped).toHaveLength(0);
    });
  });
});
