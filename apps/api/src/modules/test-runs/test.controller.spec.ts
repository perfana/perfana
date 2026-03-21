import { Test, TestingModule } from '@nestjs/testing';
import { TestController } from './controllers/test.controller';
import { TestRunsService } from './test-runs.service';
import { UpdateRunningTestDto } from './dto/update-running-test.dto';
import { ValidationException } from '../../common/exceptions/business.exception';
import { UserContext } from '../../common/decorators/user-context.decorator';

describe('TestController', () => {
  let controller: TestController;
  let service: jest.Mocked<TestRunsService>;

  const mockUserContext: UserContext = {
    userId: 'test-user-123',
    roles: ['user'],
    organizations: ['org-123'],
    teams: ['team-456'],
    organizationId: 'org-123',
    teamId: 'team-456',
  };

  const mockTestRun = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    test_run_id: 'PaymentService-production-loadTest-20240115-103000',
    system_under_test_id: 'sys-123',
    test_environment: 'production',
    workload: 'loadTest',
    start_time: '2024-01-15T10:30:00.000Z',
    end_time: undefined,
    duration: 0,
    planned_duration: 3900,
    ramp_up: 300,
    completed: false,
    abort: false,
    application_release: '1.2.3',
    ci_build_results_url: 'https://jenkins.example.com/job/payment-service/123',
    annotations: ['Testing new payment gateway with increased load'],
    tags: ['performance', 'production', 'payment-gateway'],
    variables: [
      { placeholder: 'heap.size', value: '2048m' },
      { placeholder: 'thread.count', value: '10' },
    ],
    deep_links: {
      'Grafana Dashboard': 'https://grafana.example.com/dashboard/123',
    },
    created_at: '2024-01-15T10:30:00.000Z',
    updated_at: '2024-01-15T10:30:00.000Z',
  } as any;

  const mockServiceFactory = () => ({
    updateRunningTest: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestController],
      providers: [
        {
          provide: TestRunsService,
          useValue: mockServiceFactory(),
        },
      ],
    }).compile();

    controller = module.get<TestController>(TestController);
    service = module.get(TestRunsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy Path - Create/Update Test Run', () => {
    describe('createOrUpdateTest', () => {
      it('should create a new test run successfully', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-20240115-103000',
          completed: false,
          version: '1.2.3',
          start: '2024-01-15T10:30:00.000Z',
          duration: '3600',
          rampUp: '300',
          CIBuildResultsUrl: 'https://jenkins.example.com/job/payment-service/123',
          annotations: 'Testing new payment gateway with increased load',
          tags: ['performance', 'production', 'payment-gateway'],
          variables: [
            { placeholder: 'heap.size', value: '2048m' },
            { placeholder: 'thread.count', value: '10' },
          ],
          deepLinks: [
            {
              name: 'Grafana Dashboard',
              url: 'https://grafana.example.com/dashboard/123',
            },
          ],
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(service.updateRunningTest).toHaveBeenCalledWith(updateDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
        expect(service.updateRunningTest).toHaveBeenCalledTimes(1);
      });

      it('should update an existing running test', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-20240115-103000',
          completed: false,
          start: '2024-01-15T10:30:00.000Z',
        };
        const updatedTestRun = {
          ...mockTestRun,
          duration: 1800, // Updated duration
        };
        service.updateRunningTest.mockResolvedValue(updatedTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedTestRun);
        expect(result.duration).toBe(1800);
        expect(service.updateRunningTest).toHaveBeenCalledWith(updateDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
      });

      it('should complete a test run', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-20240115-103000',
          completed: true,
          start: '2024-01-15T10:30:00.000Z',
          end: '2024-01-15T11:30:00.000Z',
          duration: '3600',
        };
        const completedTestRun = {
          ...mockTestRun,
          completed: true,
          end_time: '2024-01-15T11:30:00.000Z',
          duration: 3600,
        };
        service.updateRunningTest.mockResolvedValue(completedTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(completedTestRun);
        expect(result.completed).toBe(true);
        expect(result.duration).toBe(3600);
      });

      it('should handle test run with minimal required fields', async () => {
        // Arrange
        const minimalDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
        };
        const minimalTestRun = {
          id: '1',
          test_run_id: minimalDto.testRunId,
          system_under_test_id: 'sys-123',
          test_environment: minimalDto.testEnvironment,
          workload: minimalDto.workload,
          completed: false,
          created_at: '2024-01-15T10:30:00.000Z',
          updated_at: '2024-01-15T10:30:00.000Z',
        };
        service.updateRunningTest.mockResolvedValue(minimalTestRun);

        // Act
        const result = await controller.createOrUpdateTest(minimalDto, mockUserContext);

        // Assert
        expect(result).toEqual(minimalTestRun);
        expect(service.updateRunningTest).toHaveBeenCalledWith(minimalDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
      });

      it('should handle test run with all optional fields', async () => {
        // Arrange
        const fullDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-20240115-103000',
          completed: false,
          version: '1.2.3',
          start: '2024-01-15T10:30:00.000Z',
          end: '2024-01-15T11:30:00.000Z',
          duration: '3600',
          rampUp: '300',
          CIBuildResultsUrl: 'https://jenkins.example.com/job/payment-service/123',
          annotations: 'Full test with all fields',
          tags: ['performance', 'production'],
          variables: [{ placeholder: 'heap.size', value: '2048m' }],
          deepLinks: [
            { name: 'Grafana', url: 'https://grafana.example.com/dashboard/123' },
          ],
          abort: false,
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(fullDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(service.updateRunningTest).toHaveBeenCalledWith(fullDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
      });
    });
  });

  describe('Happy Path - Abort Test Run', () => {
    describe('createOrUpdateTest', () => {
      it('should abort a running test', async () => {
        // Arrange
        const abortDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-20240115-103000',
          completed: true,
          abort: true,
          abortMessage: 'Test aborted due to excessive errors',
        };
        const abortedTestRun = {
          ...mockTestRun,
          completed: true,
          abort: true,
          end_time: '2024-01-15T10:45:00.000Z',
        };
        service.updateRunningTest.mockResolvedValue(abortedTestRun);

        // Act
        const result = await controller.createOrUpdateTest(abortDto, mockUserContext);

        // Assert
        expect(result).toEqual(abortedTestRun);
        expect(result.abort).toBe(true);
        expect(result.completed).toBe(true);
      });
    });
  });

  describe('Happy Path - Test Run with Variables', () => {
    describe('createOrUpdateTest', () => {
      it('should handle test run with single variable', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          variables: [{ placeholder: 'heap.size', value: '2048m' }],
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(service.updateRunningTest).toHaveBeenCalledWith(updateDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
      });

      it('should handle test run with multiple variables', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          variables: [
            { placeholder: 'heap.size', value: '2048m' },
            { placeholder: 'thread.count', value: '10' },
            { placeholder: 'db.pool.size', value: '50' },
          ],
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(updateDto.variables).toHaveLength(3);
      });

      it('should handle test run with empty variables array', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          variables: [],
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(updateDto.variables).toHaveLength(0);
      });
    });
  });

  describe('Happy Path - Test Run with Deep Links', () => {
    describe('createOrUpdateTest', () => {
      it('should handle test run with single deep link', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          deepLinks: [
            { name: 'Grafana', url: 'https://grafana.example.com/dashboard/123' },
          ],
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(updateDto.deepLinks).toHaveLength(1);
      });

      it('should handle test run with multiple deep links', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          deepLinks: [
            { name: 'Grafana', url: 'https://grafana.example.com/dashboard/123' },
            { name: 'Kibana', url: 'https://kibana.example.com/app/logs' },
            { name: 'Jaeger', url: 'https://jaeger.example.com/trace/abc123' },
          ],
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(updateDto.deepLinks).toHaveLength(3);
      });
    });
  });

  describe('Happy Path - Test Run with Tags and Annotations', () => {
    describe('createOrUpdateTest', () => {
      it('should handle test run with tags array', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          tags: ['performance', 'production', 'payment-gateway'],
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(updateDto.tags).toHaveLength(3);
      });

      it('should handle test run with single tag', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          tags: ['performance'],
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(updateDto.tags).toHaveLength(1);
      });

      it('should handle test run with annotations', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          annotations: 'Testing new payment gateway with increased load',
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(updateDto.annotations).toBe(
          'Testing new payment gateway with increased load',
        );
      });
    });
  });

  describe('Error Scenarios - Validation', () => {
    describe('createOrUpdateTest', () => {
      it('should throw ValidationException when testRunId is missing', async () => {
        // Arrange
        const invalidDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: '',
          completed: false,
        } as UpdateRunningTestDto;

        // Act & Assert
        await expect(controller.createOrUpdateTest(invalidDto, mockUserContext)).rejects.toThrow(
          ValidationException,
        );
        await expect(controller.createOrUpdateTest(invalidDto, mockUserContext)).rejects.toThrow(
          'testRunId is required',
        );
      });

      it('should throw ValidationException when testRunId is undefined', async () => {
        // Arrange
        const invalidDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          completed: false,
        } as any;

        // Act & Assert
        await expect(controller.createOrUpdateTest(invalidDto, mockUserContext)).rejects.toThrow(
          ValidationException,
        );
      });

      it('should throw ValidationException when testRunId is null', async () => {
        // Arrange
        const invalidDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: null,
          completed: false,
        } as any;

        // Act & Assert
        await expect(controller.createOrUpdateTest(invalidDto, mockUserContext)).rejects.toThrow(
          ValidationException,
        );
      });
    });
  });

  describe('Error Scenarios - Service Failures', () => {
    describe('createOrUpdateTest', () => {
      it('should propagate service errors', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
        };
        const serviceError = new Error('Database connection failed');
        service.updateRunningTest.mockRejectedValue(serviceError);

        // Act & Assert
        await expect(controller.createOrUpdateTest(updateDto, mockUserContext)).rejects.toThrow(
          'Database connection failed',
        );
        expect(service.updateRunningTest).toHaveBeenCalledWith(updateDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
      });

      it('should propagate validation errors from service', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
        };
        const validationError = new ValidationException('Invalid system under test');
        service.updateRunningTest.mockRejectedValue(validationError);

        // Act & Assert
        await expect(controller.createOrUpdateTest(updateDto, mockUserContext)).rejects.toThrow(
          ValidationException,
        );
        await expect(controller.createOrUpdateTest(updateDto, mockUserContext)).rejects.toThrow(
          'Invalid system under test',
        );
      });

      it('should propagate conflict errors (duplicate test run)', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
        };
        const conflictError = new Error(
          'Test run with ID PaymentService-production-loadTest-001 already exists and is completed',
        );
        service.updateRunningTest.mockRejectedValue(conflictError);

        // Act & Assert
        await expect(controller.createOrUpdateTest(updateDto, mockUserContext)).rejects.toThrow(
          conflictError,
        );
      });
    });
  });

  describe('Edge Cases', () => {
    describe('createOrUpdateTest', () => {
      it('should handle test run with zero duration', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          duration: '0',
        };
        const testRunWithZeroDuration = {
          ...mockTestRun,
          duration: 0,
        };
        service.updateRunningTest.mockResolvedValue(testRunWithZeroDuration);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(testRunWithZeroDuration);
        expect(result.duration).toBe(0);
      });

      it('should handle test run with zero rampUp', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          rampUp: '0',
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
      });

      it('should handle test run with very long testRunId', async () => {
        // Arrange
        const longTestRunId = 'A'.repeat(200); // Very long ID
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: longTestRunId,
          completed: false,
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(updateDto.testRunId).toBe(longTestRunId);
      });

      it('should handle test run with special characters in testRunId', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'Payment-Service_production.loadTest-2024-01-15',
          completed: false,
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
      });

      it('should handle test run with empty annotations string', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          annotations: '',
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(updateDto.annotations).toBe('');
      });

      it('should handle test run with empty tags array', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          tags: [],
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(updateDto.tags).toHaveLength(0);
      });
    });
  });

  describe('Boundary Values', () => {
    describe('createOrUpdateTest', () => {
      it('should handle maximum duration (7 days)', async () => {
        // Arrange
        const maxDuration = '604800'; // 7 days in seconds
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          duration: maxDuration,
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
      });

      it('should handle maximum rampUp (1 day)', async () => {
        // Arrange
        const maxRampUp = '86400'; // 1 day in seconds
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          rampUp: maxRampUp,
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
      });

      it('should handle maximum variables array (50 items)', async () => {
        // Arrange
        const maxVariables = Array.from({ length: 50 }, (_, i) => ({
          placeholder: `var${i}`,
          value: `value${i}`,
        }));
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          variables: maxVariables,
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(updateDto.variables).toHaveLength(50);
      });

      it('should handle maximum tags array (50 items)', async () => {
        // Arrange
        const maxTags = Array.from({ length: 50 }, (_, i) => `tag${i}`);
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          tags: maxTags,
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(updateDto.tags).toHaveLength(50);
      });

      it('should handle maximum deep links array (20 items)', async () => {
        // Arrange
        const maxDeepLinks = Array.from({ length: 20 }, (_, i) => ({
          name: `Link ${i}`,
          url: `https://example.com/link${i}`,
        }));
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
          deepLinks: maxDeepLinks,
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(updateDto.deepLinks).toHaveLength(20);
      });
    });
  });

  describe('Logger Behavior', () => {
    describe('createOrUpdateTest', () => {
      it('should log debug message when creating or updating test run', async () => {
        // Arrange
        const updateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-001',
          completed: false,
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Spy on logger
        const loggerSpy = jest.spyOn(controller['logger'], 'debug');

        // Act
        await controller.createOrUpdateTest(updateDto, mockUserContext);

        // Assert
        expect(loggerSpy).toHaveBeenCalledWith(
          'Creating or updating test run',
          { testRunId: updateDto.testRunId },
        );
        loggerSpy.mockRestore();
      });
    });
  });

  describe('Integration - Real World Scenarios', () => {
    describe('createOrUpdateTest', () => {
      it('should handle Gatling test submission', async () => {
        // Arrange - Simulates a Gatling performance test
        const gatlingDto: UpdateRunningTestDto = {
          systemUnderTest: 'ShoppingCart',
          workload: 'gatling-stress',
          testEnvironment: 'staging',
          testRunId: 'ShoppingCart-staging-gatling-stress-20240115-143022',
          completed: false,
          version: '2.1.5',
          start: '2024-01-15T14:30:22.000Z',
          duration: '1800',
          rampUp: '180',
          CIBuildResultsUrl: 'https://jenkins.example.com/job/shopping-cart/456',
          annotations: 'Stress test for Black Friday preparation',
          tags: ['gatling', 'stress', 'staging', 'black-friday'],
          variables: [
            { placeholder: 'concurrent.users', value: '5000' },
            { placeholder: 'duration.seconds', value: '1800' },
          ],
          deepLinks: [
            {
              name: 'Gatling Report',
              url: 'https://gatling.example.com/reports/shopping-cart-20240115',
            },
            {
              name: 'Grafana Dashboard',
              url: 'https://grafana.example.com/d/shopping-cart',
            },
          ],
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(gatlingDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(service.updateRunningTest).toHaveBeenCalledWith(gatlingDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
      });

      it('should handle JMeter test submission', async () => {
        // Arrange - Simulates a JMeter load test
        const jmeterDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentAPI',
          workload: 'jmeter-load',
          testEnvironment: 'production',
          testRunId: 'PaymentAPI-production-jmeter-load-20240115-090000',
          completed: true,
          version: '3.2.1',
          start: '2024-01-15T09:00:00.000Z',
          end: '2024-01-15T10:00:00.000Z',
          duration: '3600',
          rampUp: '300',
          CIBuildResultsUrl: 'https://jenkins.example.com/job/payment-api/789',
          annotations: 'Production load test - peak hours simulation',
          tags: ['jmeter', 'load', 'production', 'payment'],
        };
        service.updateRunningTest.mockResolvedValue({
          ...mockTestRun,
          completed: true,
        });

        // Act
        const result = await controller.createOrUpdateTest(jmeterDto, mockUserContext);

        // Assert
        expect(result.completed).toBe(true);
        expect(service.updateRunningTest).toHaveBeenCalledWith(jmeterDto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
      });

      it('should handle k6 test submission', async () => {
        // Arrange - Simulates a k6 smoke test
        const k6Dto: UpdateRunningTestDto = {
          systemUnderTest: 'UserService',
          workload: 'k6-smoke',
          testEnvironment: 'development',
          testRunId: 'UserService-development-k6-smoke-20240115-080000',
          completed: false,
          version: '1.0.0-alpha',
          start: '2024-01-15T08:00:00.000Z',
          duration: '300',
          rampUp: '30',
          annotations: 'Smoke test for new user authentication flow',
          tags: ['k6', 'smoke', 'development', 'auth'],
          variables: [
            { placeholder: 'virtual.users', value: '10' },
            { placeholder: 'test.duration', value: '5m' },
          ],
        };
        service.updateRunningTest.mockResolvedValue(mockTestRun);

        // Act
        const result = await controller.createOrUpdateTest(k6Dto, mockUserContext);

        // Assert
        expect(result).toEqual(mockTestRun);
        expect(service.updateRunningTest).toHaveBeenCalledWith(k6Dto, mockUserContext.userId, mockUserContext.roles, mockUserContext.organizationId);
      });

      it('should handle test run update during execution (progress update)', async () => {
        // Arrange - Simulates a mid-test progress update
        const progressUpdateDto: UpdateRunningTestDto = {
          systemUnderTest: 'PaymentService',
          workload: 'loadTest',
          testEnvironment: 'production',
          testRunId: 'PaymentService-production-loadTest-20240115-103000',
          completed: false,
          duration: '1800', // 30 minutes into the test
        };
        const progressTestRun = {
          ...mockTestRun,
          duration: 1800,
        };
        service.updateRunningTest.mockResolvedValue(progressTestRun);

        // Act
        const result = await controller.createOrUpdateTest(progressUpdateDto, mockUserContext);

        // Assert
        expect(result.duration).toBe(1800);
        expect(result.completed).toBe(false);
      });
    });
  });
});
