import { Test, TestingModule } from '@nestjs/testing';
import { SystemsUnderTestController } from './systems-under-test.controller';
import { SystemsUnderTestService, SystemSummary } from './systems-under-test.service';
import { DeleteSystemUnderTestHandler } from './handlers/delete-system-under-test.handler';
import { SystemUnderTest as SystemUnderTestEntity } from '../../entities';
import { NotFoundException } from '@nestjs/common';
import { UserContext } from '../../common/decorators/user-context.decorator';
import { AuthorizationService } from '../../common/services/authorization.service';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';

describe('SystemsUnderTestController', () => {
  let controller: SystemsUnderTestController;
  let service: jest.Mocked<SystemsUnderTestService>;

  // Mock user context for authorization
  const mockUserContext: UserContext = {
    userId: 'test-user-123',
    roles: ['user'],
    organizations: ['org-123'],
    teams: ['team-456'],
    organizationId: 'org-123',
    teamId: 'team-456',
  };

  const mockSystemUnderTest: SystemUnderTestEntity = {
    id: 'sys-123',
    name: 'payment-service',
    description: 'Payment processing service',
    team_id: 'team-456',
    tracing_service: 'jaeger-payment',
    pyroscope_application: 'payment-app',
    pyroscope_profiler: 'java',
    created_at: new Date('2024-01-15T10:00:00Z'),
    updated_at: new Date('2024-01-15T10:00:00Z'),
    testRuns: [],
    team: undefined,
    slos: [],
  } as SystemUnderTestEntity;

  const mockSystemSummary: SystemSummary = {
    id: 'sys-123',
    name: 'payment-service',
    description: 'Payment processing service',
    environments: [
      {
        environment: 'production',
        workloads: ['load-test', 'stress-test'],
      },
      {
        environment: 'staging',
        workloads: ['load-test'],
      },
    ],
    created_at: '2024-01-15T10:00:00.000Z',
  };

  const mockServiceFactory = () => ({
    findAll: jest.fn(),
    findOne: jest.fn(),
    findSystemSummary: jest.fn(),
    findByName: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemsUnderTestController],
      providers: [
        {
          provide: SystemsUnderTestService,
          useValue: mockServiceFactory(),
        },
        {
          provide: DeleteSystemUnderTestHandler,
          useValue: {
            getDeletePreview: jest.fn(),
            execute: jest.fn(),
          },
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
      ],
    }).compile();

    controller = module.get<SystemsUnderTestController>(SystemsUnderTestController);
    service = module.get(SystemsUnderTestService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all systems under test', async () => {
      const mockSystems = [mockSystemUnderTest];
      service.findAll.mockResolvedValue(mockSystems);

      const result = await controller.findAll(mockUserContext);

      expect(result).toEqual(mockSystems);
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, true, undefined);
    });

    it('should return empty array when no systems exist', async () => {
      service.findAll.mockResolvedValue([]);

      const result = await controller.findAll(mockUserContext);

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should return multiple systems', async () => {
      const mockSystems = [
        mockSystemUnderTest,
        {
          ...mockSystemUnderTest,
          id: 'sys-456',
          name: 'user-service',
        },
        {
          ...mockSystemUnderTest,
          id: 'sys-789',
          name: 'order-service',
        },
      ];
      service.findAll.mockResolvedValue(mockSystems);

      const result = await controller.findAll(mockUserContext);

      expect(result).toHaveLength(3);
      expect(result[0]?.name).toBe('payment-service');
      expect(result[1]?.name).toBe('user-service');
      expect(result[2]?.name).toBe('order-service');
    });

    it('should include team information in response', async () => {
      const systemWithTeam = {
        ...mockSystemUnderTest,
        team: {
          id: 'team-456',
          name: 'Backend Team',
          organization_id: 'org-1',
          description: undefined,
          created_at: new Date(),
          updated_at: new Date(),
          systems: [],
          organization: null as any,
        },
      };
      service.findAll.mockResolvedValue([systemWithTeam] as SystemUnderTestEntity[]);

      const result = await controller.findAll(mockUserContext);

      expect(result[0]?.team).toBeDefined();
      expect(result[0]?.team?.name).toBe('Backend Team');
    });

    it('should handle service errors', async () => {
      const error = new Error('Database connection failed');
      service.findAll.mockRejectedValue(error);

      await expect(controller.findAll(mockUserContext)).rejects.toThrow('Database connection failed');
    });
  });

  describe('findOne', () => {
    it('should return system summary with environments and workloads', async () => {
      service.findSystemSummary.mockResolvedValue(mockSystemSummary);

      const result = await controller.findOne('sys-123', mockUserContext);

      expect(result).toEqual(mockSystemSummary);
      expect(service.findSystemSummary).toHaveBeenCalledWith('sys-123', mockUserContext.userId, true);
    });

    it('should throw NotFoundException when system not found', async () => {
      service.findSystemSummary.mockResolvedValue(null);

      await expect(controller.findOne('nonexistent', mockUserContext)).rejects.toThrow(NotFoundException);
      await expect(controller.findOne('nonexistent', mockUserContext)).rejects.toThrow(
        'System under test with ID nonexistent not found'
      );
    });

    it('should return system with no environments', async () => {
      const summaryWithoutEnvironments: SystemSummary = {
        ...mockSystemSummary,
        environments: [],
      };
      service.findSystemSummary.mockResolvedValue(summaryWithoutEnvironments);

      const result = await controller.findOne('sys-123', mockUserContext);

      expect(result.environments).toEqual([]);
    });

    it('should return system with single environment', async () => {
      const summaryWithOneEnvironment: SystemSummary = {
        ...mockSystemSummary,
        environments: [
          {
            environment: 'production',
            workloads: ['load-test'],
          },
        ],
      };
      service.findSystemSummary.mockResolvedValue(summaryWithOneEnvironment);

      const result = await controller.findOne('sys-123', mockUserContext);

      expect(result.environments).toHaveLength(1);
      expect(result.environments[0]?.environment).toBe('production');
      expect(result.environments[0]?.workloads).toEqual(['load-test']);
    });

    it('should return system with multiple environments', async () => {
      service.findSystemSummary.mockResolvedValue(mockSystemSummary);

      const result = await controller.findOne('sys-123', mockUserContext);

      expect(result.environments).toHaveLength(2);
      expect(result.environments[0]?.environment).toBe('production');
      expect(result.environments[1]?.environment).toBe('staging');
    });

    it('should return system with multiple workloads per environment', async () => {
      service.findSystemSummary.mockResolvedValue(mockSystemSummary);

      const result = await controller.findOne('sys-123', mockUserContext);

      expect(result.environments[0]?.workloads).toEqual(['load-test', 'stress-test']);
    });

    it('should include system metadata', async () => {
      service.findSystemSummary.mockResolvedValue(mockSystemSummary);

      const result = await controller.findOne('sys-123', mockUserContext);

      expect(result.id).toBe('sys-123');
      expect(result.name).toBe('payment-service');
      expect(result.description).toBe('Payment processing service');
      expect(result.created_at).toBe('2024-01-15T10:00:00.000Z');
    });

    it('should handle system without description', async () => {
      const summaryWithoutDescription: SystemSummary = {
        ...mockSystemSummary,
        description: undefined,
      };
      service.findSystemSummary.mockResolvedValue(summaryWithoutDescription);

      const result = await controller.findOne('sys-123', mockUserContext);

      expect(result.description).toBeUndefined();
    });

    it('should handle UUID format IDs', async () => {
      const uuidId = '550e8400-e29b-41d4-a716-446655440000';
      const summaryWithUuid: SystemSummary = {
        ...mockSystemSummary,
        id: uuidId,
      };
      service.findSystemSummary.mockResolvedValue(summaryWithUuid);

      const result = await controller.findOne(uuidId, mockUserContext);

      expect(result.id).toBe(uuidId);
      expect(service.findSystemSummary).toHaveBeenCalledWith(uuidId, mockUserContext.userId, true);
    });

    it('should handle service errors', async () => {
      const error = new Error('Database query failed');
      service.findSystemSummary.mockRejectedValue(error);

      await expect(controller.findOne('sys-123', mockUserContext)).rejects.toThrow('Database query failed');
    });
  });

  describe('Integration with Service', () => {
    it('should properly delegate to service methods', async () => {
      service.findAll.mockResolvedValue([mockSystemUnderTest]);
      service.findSystemSummary.mockResolvedValue(mockSystemSummary);

      await controller.findAll(mockUserContext);
      await controller.findOne('sys-123', mockUserContext);

      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, true, undefined);
      expect(service.findSystemSummary).toHaveBeenCalledWith('sys-123', mockUserContext.userId, true);
    });

    it('should not catch and transform service exceptions', async () => {
      const notFoundError = new NotFoundException('System not found');
      service.findSystemSummary.mockRejectedValue(notFoundError);

      await expect(controller.findOne('nonexistent', mockUserContext)).rejects.toThrow(NotFoundException);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long system IDs', async () => {
      const longId = 'a'.repeat(500);
      service.findSystemSummary.mockResolvedValue({
        ...mockSystemSummary,
        id: longId,
      });

      const result = await controller.findOne(longId, mockUserContext);

      expect(result.id).toBe(longId);
    });

    it('should handle special characters in system ID', async () => {
      const specialId = 'sys-123_v2.0@production#1';
      service.findSystemSummary.mockResolvedValue({
        ...mockSystemSummary,
        id: specialId,
      });

      const result = await controller.findOne(specialId, mockUserContext);

      expect(result.id).toBe(specialId);
    });

    it('should handle systems with no workloads in environment', async () => {
      const summaryWithEmptyWorkloads: SystemSummary = {
        ...mockSystemSummary,
        environments: [
          {
            environment: 'production',
            workloads: [],
          },
        ],
      };
      service.findSystemSummary.mockResolvedValue(summaryWithEmptyWorkloads);

      const result = await controller.findOne('sys-123', mockUserContext);

      expect(result.environments[0]?.workloads).toEqual([]);
    });

    it('should handle systems with many environments', async () => {
      const environments = Array.from({ length: 10 }, (_, i) => ({
        environment: `env-${i}`,
        workloads: [`workload-${i}`],
      }));
      const summaryWithManyEnvironments: SystemSummary = {
        ...mockSystemSummary,
        environments,
      };
      service.findSystemSummary.mockResolvedValue(summaryWithManyEnvironments);

      const result = await controller.findOne('sys-123', mockUserContext);

      expect(result.environments).toHaveLength(10);
    });

    it('should handle systems with many workloads', async () => {
      const workloads = Array.from({ length: 20 }, (_, i) => `workload-${i}`);
      const summaryWithManyWorkloads: SystemSummary = {
        ...mockSystemSummary,
        environments: [
          {
            environment: 'production',
            workloads,
          },
        ],
      };
      service.findSystemSummary.mockResolvedValue(summaryWithManyWorkloads);

      const result = await controller.findOne('sys-123', mockUserContext);

      expect(result.environments[0]?.workloads).toHaveLength(20);
    });
  });

  describe('API Response Format', () => {
    it('should return data in expected format for findAll', async () => {
      service.findAll.mockResolvedValue([mockSystemUnderTest]);

      const result = await controller.findAll(mockUserContext);

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('description');
      expect(result[0]).toHaveProperty('created_at');
    });

    it('should return data in expected format for findOne', async () => {
      service.findSystemSummary.mockResolvedValue(mockSystemSummary);

      const result = await controller.findOne('sys-123', mockUserContext);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('environments');
      expect(Array.isArray(result.environments)).toBe(true);
      if (result.environments.length > 0) {
        expect(result.environments[0]).toHaveProperty('environment');
        expect(result.environments[0]).toHaveProperty('workloads');
        expect(Array.isArray(result.environments[0]?.workloads)).toBe(true);
      }
    });
  });

  describe('Performance Scenarios', () => {
    it('should handle large system list efficiently', async () => {
      const largeMockSystems = Array.from({ length: 1000 }, (_, i) => ({
        ...mockSystemUnderTest,
        id: `sys-${i}`,
        name: `service-${i}`,
      }));
      service.findAll.mockResolvedValue(largeMockSystems);

      const result = await controller.findAll(mockUserContext);

      expect(result).toHaveLength(1000);
      expect(service.findAll).toHaveBeenCalledWith(mockUserContext.userId, true, undefined);
    });

    it('should handle system with large environment/workload data', async () => {
      const largeEnvironments = Array.from({ length: 50 }, (_, i) => ({
        environment: `environment-${i}`,
        workloads: Array.from({ length: 100 }, (_, j) => `workload-${j}`),
      }));
      const largeSummary: SystemSummary = {
        ...mockSystemSummary,
        environments: largeEnvironments,
      };
      service.findSystemSummary.mockResolvedValue(largeSummary);

      const result = await controller.findOne('sys-123', mockUserContext);

      expect(result.environments).toHaveLength(50);
      expect(result.environments[0]?.workloads).toHaveLength(100);
    });
  });

  describe('Controller Metadata', () => {
    it('should be defined', () => {
      expect(controller).toBeDefined();
    });

    it('should have findAll method', () => {
      expect(controller.findAll).toBeDefined();
      expect(typeof controller.findAll).toBe('function');
    });

    it('should have findOne method', () => {
      expect(controller.findOne).toBeDefined();
      expect(typeof controller.findOne).toBe('function');
    });
  });
});
