import { Test, TestingModule } from '@nestjs/testing';
import { SystemsUnderTestService, LegacyCreateSystemUnderTestDto as CreateSystemUnderTestDto, UpdateSystemUnderTestDto } from './systems-under-test.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemUnderTest as SystemUnderTestEntity, PyroscopeInstance } from '../../entities';
import { NotFoundException } from '@nestjs/common';
import { AuthorizationService } from '../../common/services/authorization.service';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';

describe('SystemsUnderTestService', () => {
  let service: SystemsUnderTestService;
  let repository: jest.Mocked<Repository<SystemUnderTestEntity>>;
  let mockAuthzService: jest.Mocked<AuthorizationService>;

  // Test user context
  const testUserId = 'test-user-id';
  // Most tests exercise the admin path (the previous test suite leaned on the
  // mock's default `isGlobalAdmin -> true`). After Phase 3c C32 the service no
  // longer calls `isGlobalAdmin`; callers pass `isAdmin` directly. Tests that
  // need the non-admin path use `false` inline.
  const testIsAdmin = true;
  const adminIsAdmin = true;

  const mockSystemUnderTest: SystemUnderTestEntity = {
    id: 'sys-123',
    name: 'payment-service',
    description: 'Payment processing service',
    team_id: 'team-456',
    tracing_service: 'jaeger-payment',
    pyroscope_application: 'payment-app',
    pyroscope_profiler: 'java',
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
    testRuns: [],
    team: undefined,
    slos: [],
  } as SystemUnderTestEntity;

  const mockRepositoryFactory = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    })),
  });

  const mockPyroscopeRepoFactory = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
  });

  beforeEach(async () => {
    mockAuthzService = createAuthorizationServiceMock() as jest.Mocked<AuthorizationService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemsUnderTestService,
        {
          provide: getRepositoryToken(SystemUnderTestEntity),
          useValue: mockRepositoryFactory(),
        },
        {
          provide: getRepositoryToken(PyroscopeInstance),
          useValue: mockPyroscopeRepoFactory(),
        },
        {
          provide: AuthorizationService,
          useValue: mockAuthzService,
        },
      ],
    }).compile();

    service = module.get<SystemsUnderTestService>(SystemsUnderTestService);
    repository = module.get(getRepositoryToken(SystemUnderTestEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all systems under test', async () => {
      const mockSystems = [mockSystemUnderTest];
      repository.find.mockResolvedValue(mockSystems);

      const result = await service.findAll(testUserId, testIsAdmin);

      expect(result).toEqual(mockSystems);
      expect(repository.find).toHaveBeenCalledWith({
        relations: ['team'],
        order: {
          created_at: 'DESC',
        },
      });
    });

    it('should return empty array when no systems exist', async () => {
      repository.find.mockResolvedValue([]);

      const result = await service.findAll(testUserId, testIsAdmin);

      expect(result).toEqual([]);
    });

    it('should handle database errors', async () => {
      const error = new Error('Database connection failed');
      repository.find.mockRejectedValue(error);

      await expect(service.findAll(testUserId, testIsAdmin)).rejects.toThrow('Database connection failed');
    });

    it('should fetch systems with team relations', async () => {
      const systemWithTeam = {
        ...mockSystemUnderTest,
        team: {
          id: 'team-456',
          name: 'Backend Team',
          organization_id: 'org-1',
          created_at: new Date(),
          updated_at: new Date(),
          systems: [],
          organization: null as any,
        },
      };
      repository.find.mockResolvedValue([systemWithTeam] as SystemUnderTestEntity[]);

      const result = await service.findAll(testUserId, testIsAdmin);

      expect(result[0]?.team).toBeDefined();
      expect(result[0]?.team?.name).toBe('Backend Team');
    });

    it('should bypass org filtering when caller is admin', async () => {
      repository.find.mockResolvedValue([mockSystemUnderTest]);

      const result = await service.findAll(testUserId, adminIsAdmin);

      // Admin path uses repository.find (no query builder, no org-list lookup)
      expect(result).toEqual([mockSystemUnderTest]);
      expect(repository.find).toHaveBeenCalled();
      expect(mockAuthzService.getAccessibleOrganizations).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a system by ID', async () => {
      repository.findOne.mockResolvedValue(mockSystemUnderTest);

      const result = await service.findOne('sys-123', testUserId, testIsAdmin);

      expect(result).toEqual(mockSystemUnderTest);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 'sys-123' },
        relations: ['team'],
      });
    });

    it('should throw NotFoundException when system not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent', testUserId, testIsAdmin)).rejects.toThrow(NotFoundException);
      await expect(service.findOne('nonexistent', testUserId, testIsAdmin)).rejects.toThrow(
        'System under test with ID nonexistent not found'
      );
    });

    it('should handle database errors', async () => {
      const error = new Error('Database query failed');
      repository.findOne.mockRejectedValue(error);

      await expect(service.findOne('sys-123', testUserId, testIsAdmin)).rejects.toThrow('Database query failed');
    });

    it('should return system with team relation', async () => {
      const systemWithTeam = {
        ...mockSystemUnderTest,
        team: {
          id: 'team-456',
          name: 'Backend Team',
          organization_id: 'org-123',
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
      };
      repository.findOne.mockResolvedValue(systemWithTeam);

      const result = await service.findOne('sys-123', testUserId, testIsAdmin);

      expect(result.team).toBeDefined();
      expect(result.team?.name).toBe('Backend Team');
    });
  });

  describe('findSystemSummary', () => {
    // Helper to create a system mock with test runs
    const createSystemWithTestRuns = (testRuns: any[]) => ({
      id: 'sys-123',
      name: 'payment-service',
      description: 'Payment processing service',
      team_id: 'team-456',
      tracing_service: 'jaeger-payment',
      pyroscope_application: 'payment-app',
      pyroscope_profiler: 'java',
      created_at: new Date('2024-01-15T10:00:00Z'),
      updated_at: new Date('2024-01-15T10:00:00Z'),
      testRuns,
      team: undefined,
      slos: [],
    });

    it('should return system summary with environments and workloads', async () => {
      const systemWithTestRuns = createSystemWithTestRuns([
        { id: 'test-1', testEnvironment: 'production', workload: 'load-test' },
        { id: 'test-2', testEnvironment: 'production', workload: 'stress-test' },
        { id: 'test-3', testEnvironment: 'staging', workload: 'load-test' },
      ]);
      repository.findOne.mockResolvedValue(systemWithTestRuns);

      const result = await service.findSystemSummary('sys-123', testUserId, testIsAdmin);

      expect(result).toBeDefined();
      expect(result?.id).toBe('sys-123');
      expect(result?.name).toBe('payment-service');
      expect(result?.environments).toHaveLength(2);
      expect(result?.environments[0]?.environment).toBe('production');
      expect(result?.environments[0]?.workloads).toEqual(['load-test', 'stress-test']);
      expect(result?.environments[1]?.environment).toBe('staging');
      expect(result?.environments[1]?.workloads).toEqual(['load-test']);
    });

    it('should return null when system not found', async () => {
      repository.findOne.mockResolvedValue(null);

      const result = await service.findSystemSummary('nonexistent', testUserId, testIsAdmin);

      expect(result).toBeNull();
    });

    it('should handle system with no test runs', async () => {
      const systemWithoutTestRuns = createSystemWithTestRuns([]);
      repository.findOne.mockResolvedValue(systemWithoutTestRuns);

      const result = await service.findSystemSummary('sys-123', testUserId, testIsAdmin);

      expect(result).toBeDefined();
      expect(result?.environments).toEqual([]);
    });

    it('should sort environments alphabetically', async () => {
      const systemWithTestRuns = createSystemWithTestRuns([
        { id: 'test-1', testEnvironment: 'staging', workload: 'load-test' },
        { id: 'test-2', testEnvironment: 'production', workload: 'load-test' },
        { id: 'test-3', testEnvironment: 'development', workload: 'load-test' },
      ]);
      repository.findOne.mockResolvedValue(systemWithTestRuns);

      const result = await service.findSystemSummary('sys-123', testUserId, testIsAdmin);

      expect(result?.environments?.[0]?.environment).toBe('development');
      expect(result?.environments?.[1]?.environment).toBe('production');
      expect(result?.environments?.[2]?.environment).toBe('staging');
    });

    it('should sort workloads alphabetically within environments', async () => {
      const systemWithTestRuns = createSystemWithTestRuns([
        { id: 'test-1', testEnvironment: 'production', workload: 'stress-test' },
        { id: 'test-2', testEnvironment: 'production', workload: 'load-test' },
        { id: 'test-3', testEnvironment: 'production', workload: 'endurance-test' },
      ]);
      repository.findOne.mockResolvedValue(systemWithTestRuns);

      const result = await service.findSystemSummary('sys-123', testUserId, testIsAdmin);

      expect(result?.environments?.[0]?.workloads).toEqual([
        'endurance-test',
        'load-test',
        'stress-test',
      ]);
    });

    it('should handle duplicate workloads in same environment', async () => {
      const systemWithTestRuns = createSystemWithTestRuns([
        { id: 'test-1', testEnvironment: 'production', workload: 'load-test' },
        { id: 'test-2', testEnvironment: 'production', workload: 'load-test' },
        { id: 'test-3', testEnvironment: 'production', workload: 'load-test' },
      ]);
      repository.findOne.mockResolvedValue(systemWithTestRuns);

      const result = await service.findSystemSummary('sys-123', testUserId, testIsAdmin);

      expect(result?.environments?.[0]?.workloads).toEqual(['load-test']);
    });

    it('should handle database errors', async () => {
      const error = new Error('Database query failed');
      repository.findOne.mockRejectedValue(error);

      await expect(service.findSystemSummary('sys-123', testUserId, testIsAdmin)).rejects.toThrow('Database query failed');
    });

    it('should include created_at as ISO string', async () => {
      const systemWithTestRuns = createSystemWithTestRuns([]);
      repository.findOne.mockResolvedValue(systemWithTestRuns);

      const result = await service.findSystemSummary('sys-123', testUserId, testIsAdmin);

      expect(result?.created_at).toBe('2024-01-15T10:00:00.000Z');
    });
  });

  describe('findByName', () => {
    it('should return system by name', async () => {
      repository.findOne.mockResolvedValue(mockSystemUnderTest);

      const result = await service.findByName('payment-service', testUserId, testIsAdmin);

      expect(result).toEqual(mockSystemUnderTest);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { name: 'payment-service' },
        relations: ['team'],
      });
    });

    it('should return null when system not found', async () => {
      repository.findOne.mockResolvedValue(null);

      const result = await service.findByName('nonexistent-service', testUserId, testIsAdmin);

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      const error = new Error('Database query failed');
      repository.findOne.mockRejectedValue(error);

      await expect(service.findByName('payment-service', testUserId, testIsAdmin)).rejects.toThrow('Database query failed');
    });
  });

  describe('create', () => {
    const createDto: CreateSystemUnderTestDto = {
      name: 'new-service',
      description: 'A new service',
      team_id: 'team-789',
      tracing_service: 'jaeger-new',
    };

    it('should create a new system', async () => {
      const createdSystem = { ...mockSystemUnderTest, ...createDto };
      repository.create.mockReturnValue(createdSystem);
      repository.save.mockResolvedValue(createdSystem);
      repository.findOne.mockResolvedValue(createdSystem);

      const result = await service.create(createDto, testUserId, testIsAdmin);

      expect(result).toEqual(createdSystem);
      expect(repository.create).toHaveBeenCalledWith({
        ...createDto,
        created_by: testUserId,
        updated_by: testUserId,
        organization_id: undefined,
      });
      expect(repository.save).toHaveBeenCalledWith(createdSystem);
      expect(repository.findOne).toHaveBeenCalled();
    });

    it('should create system with minimal fields', async () => {
      const minimalDto: CreateSystemUnderTestDto = {
        name: 'minimal-service',
      };
      const createdSystem = { ...mockSystemUnderTest, name: 'minimal-service' };
      repository.create.mockReturnValue(createdSystem);
      repository.save.mockResolvedValue(createdSystem);
      repository.findOne.mockResolvedValue(createdSystem);

      const result = await service.create(minimalDto, testUserId, testIsAdmin);

      expect(result).toBeDefined();
      expect(result.name).toBe('minimal-service');
    });

    it('should handle database errors during creation', async () => {
      const error = new Error('Database insert failed');
      repository.create.mockReturnValue(mockSystemUnderTest);
      repository.save.mockRejectedValue(error);

      await expect(service.create(createDto, testUserId, testIsAdmin)).rejects.toThrow('Database insert failed');
    });

    it('should fetch created system with relations', async () => {
      const createdSystem = { ...mockSystemUnderTest, ...createDto };
      const systemWithTeam = {
        ...createdSystem,
        team: {
          id: 'team-789',
          name: 'New Team',
          organization_id: 'org-123',
          created_at: new Date(),
          updated_at: new Date(),
        } as any,
      };
      repository.create.mockReturnValue(createdSystem);
      repository.save.mockResolvedValue(createdSystem);
      repository.findOne.mockResolvedValue(systemWithTeam);

      const result = await service.create(createDto, testUserId, testIsAdmin);

      expect(result.team).toBeDefined();
      expect(result.team?.name).toBe('New Team');
    });
  });

  describe('update', () => {
    const updateDto: UpdateSystemUnderTestDto = {
      name: 'updated-service',
      description: 'Updated description',
      tracing_service: 'new-jaeger',
    };

    it('should update an existing system', async () => {
      const updatedSystem = { ...mockSystemUnderTest, ...updateDto };
      repository.findOne
        .mockResolvedValueOnce(mockSystemUnderTest) // First call in findOne (inside update)
        .mockResolvedValueOnce(updatedSystem); // Second call in findOne (return after update)
      repository.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      const result = await service.update('sys-123', updateDto, testUserId, testIsAdmin);

      expect(result).toEqual(updatedSystem);
      expect(repository.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when system not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.update('nonexistent', updateDto, testUserId, testIsAdmin)).rejects.toThrow(NotFoundException);
    });

    it('should partially update system', async () => {
      const partialUpdateDto: UpdateSystemUnderTestDto = {
        description: 'Only updating description',
      };
      const updatedSystem = { ...mockSystemUnderTest, description: 'Only updating description' };
      repository.findOne
        .mockResolvedValueOnce(mockSystemUnderTest)
        .mockResolvedValueOnce(updatedSystem);
      repository.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      const result = await service.update('sys-123', partialUpdateDto, testUserId, testIsAdmin);

      expect(result.description).toBe('Only updating description');
      expect(result.name).toBe(mockSystemUnderTest.name);
    });

    it('should handle database errors during update', async () => {
      const error = new Error('Database update failed');
      repository.findOne.mockResolvedValue(mockSystemUnderTest);
      repository.update.mockRejectedValue(error);

      await expect(service.update('sys-123', updateDto, testUserId, testIsAdmin)).rejects.toThrow('Database update failed');
    });
  });

  describe('remove', () => {
    it('should delete a system', async () => {
      repository.findOne.mockResolvedValue(mockSystemUnderTest);
      repository.remove.mockResolvedValue(mockSystemUnderTest);

      await service.remove('sys-123', testUserId, testIsAdmin);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 'sys-123' },
        relations: ['team'],
      });
      expect(repository.remove).toHaveBeenCalledWith(mockSystemUnderTest);
    });

    it('should throw NotFoundException when system not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.remove('nonexistent', testUserId, testIsAdmin)).rejects.toThrow(NotFoundException);
    });

    it('should handle database errors during deletion', async () => {
      const error = new Error('Database delete failed');
      repository.findOne.mockResolvedValue(mockSystemUnderTest);
      repository.remove.mockRejectedValue(error);

      await expect(service.remove('sys-123', testUserId, testIsAdmin)).rejects.toThrow('Database delete failed');
    });
  });

  describe('Logging', () => {
    it('should log successful creation', async () => {
      const createDto: CreateSystemUnderTestDto = { name: 'test-service' };
      const createdSystem = { ...mockSystemUnderTest, name: 'test-service' };
      const loggerSpy = jest.spyOn((service as any).logger, 'log');

      repository.create.mockReturnValue(createdSystem);
      repository.save.mockResolvedValue(createdSystem);
      repository.findOne.mockResolvedValue(createdSystem);

      await service.create(createDto, testUserId, testIsAdmin);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Created system under test: test-service')
      );
    });

    it('should log successful update', async () => {
      const updateDto: UpdateSystemUnderTestDto = { name: 'updated-service' };
      const loggerSpy = jest.spyOn((service as any).logger, 'log');

      repository.findOne
        .mockResolvedValueOnce(mockSystemUnderTest)
        .mockResolvedValueOnce({ ...mockSystemUnderTest, ...updateDto });
      repository.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await service.update('sys-123', updateDto, testUserId, testIsAdmin);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Updated system under test')
      );
    });

    it('should log successful deletion', async () => {
      const loggerSpy = jest.spyOn((service as any).logger, 'log');

      repository.findOne.mockResolvedValue(mockSystemUnderTest);
      repository.remove.mockResolvedValue(mockSystemUnderTest);

      await service.remove('sys-123', testUserId, testIsAdmin);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deleted system under test')
      );
    });

    it('should log errors', async () => {
      const error = new Error('Test error');
      const loggerSpy = jest.spyOn((service as any).logger, 'error');

      repository.find.mockRejectedValue(error);

      await expect(service.findAll(testUserId, testIsAdmin)).rejects.toThrow('Test error');
      expect(loggerSpy).toHaveBeenCalledWith(
        '[findAll] ERROR',
        error.stack
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string for optional fields', async () => {
      const createDto: CreateSystemUnderTestDto = {
        name: 'test-service',
        description: '',
        tracing_service: '',
      };
      const createdSystem = { ...mockSystemUnderTest, ...createDto };

      repository.create.mockReturnValue(createdSystem);
      repository.save.mockResolvedValue(createdSystem);
      repository.findOne.mockResolvedValue(createdSystem);

      const result = await service.create(createDto, testUserId, testIsAdmin);

      expect(result.description).toBe('');
      expect(result.tracing_service).toBe('');
    });

    it('should handle very long system names', async () => {
      const longName = 'a'.repeat(500);
      const createDto: CreateSystemUnderTestDto = { name: longName };
      const createdSystem = { ...mockSystemUnderTest, name: longName };

      repository.create.mockReturnValue(createdSystem);
      repository.save.mockResolvedValue(createdSystem);
      repository.findOne.mockResolvedValue(createdSystem);

      const result = await service.create(createDto, testUserId, testIsAdmin);

      expect(result.name).toBe(longName);
    });

    it('should handle special characters in system name', async () => {
      const specialName = 'test-service_v2.0@production#1';
      const createDto: CreateSystemUnderTestDto = { name: specialName };
      const createdSystem = { ...mockSystemUnderTest, name: specialName };

      repository.create.mockReturnValue(createdSystem);
      repository.save.mockResolvedValue(createdSystem);
      repository.findOne.mockResolvedValue(createdSystem);

      const result = await service.create(createDto, testUserId, testIsAdmin);

      expect(result.name).toBe(specialName);
    });
  });

  describe('Authorization context', () => {
    // Phase 3c C32: isAdmin is resolved at the controller boundary; the service
    // no longer calls authzService.isGlobalAdmin. These tests assert that the
    // admin / non-admin paths produce different lookup behavior.

    it('should look up accessible orgs for non-admin findAll', async () => {
      mockAuthzService.getAccessibleOrganizations.mockResolvedValue(['org-1']);
      mockAuthzService.getAccessibleTeams.mockResolvedValue([]);

      await service.findAll(testUserId, false);

      expect(mockAuthzService.getAccessibleOrganizations).toHaveBeenCalledWith(testUserId);
    });

    it('should skip org lookup for admin findAll', async () => {
      repository.find.mockResolvedValue([mockSystemUnderTest]);

      await service.findAll('admin-user', adminIsAdmin);

      expect(mockAuthzService.getAccessibleOrganizations).not.toHaveBeenCalled();
    });
  });

  describe('createSut', () => {
    const createDto = {
      name: 'new-service',
      description: 'A new service',
      organizationId: 'org-123',
    };
    const createdSut = { ...mockSystemUnderTest, name: 'new-service', id: 'new-id', organization_id: 'org-123' } as SystemUnderTestEntity;

    beforeEach(() => {
      // Mock the entity manager transaction used by createSut
      (repository as any).manager = {
        transaction: jest.fn().mockImplementation(async (fn: any) => {
          const mockManager = {
            create: jest.fn().mockImplementation((_Entity: any, data: any) => ({ ...data, id: 'new-id' })),
            save: jest.fn().mockImplementation(async (entity: any) => ({ ...entity, id: entity.id ?? 'new-id' })),
          };
          await fn(mockManager);
        }),
      };
    });

    it('should create a new SUT without environments', async () => {
      repository.findOne.mockResolvedValueOnce(null); // idempotency check
      repository.findOne.mockResolvedValueOnce(createdSut); // findOne after create
      mockAuthzService.isOrganizationMember.mockResolvedValue(true);

      const result = await service.createSut(createDto, testUserId, adminIsAdmin);

      expect((repository as any).manager.transaction).toHaveBeenCalled();
      expect(result.name).toBe('new-service');
    });

    it('should return existing SUT with conflict flag when name+org already exists', async () => {
      const existingSut = { ...mockSystemUnderTest, organization_id: 'org-123' } as SystemUnderTestEntity;
      repository.findOne.mockResolvedValueOnce(existingSut); // idempotency check
      repository.findOne.mockResolvedValueOnce(existingSut); // findOne auth check
      mockAuthzService.isOrganizationMember.mockResolvedValue(true);

      const result = await service.createSut(createDto, testUserId, adminIsAdmin);

      expect((repository as any).manager.transaction).not.toHaveBeenCalled();
      expect(result.conflict).toBe(true);
    });

    it('should verify org membership before creating (non-admin)', async () => {
      mockAuthzService.isOrganizationMember.mockResolvedValue(false);

      await expect(service.createSut(createDto, testUserId, false)).rejects.toThrow(NotFoundException);
      expect((repository as any).manager.transaction).not.toHaveBeenCalled();
    });

    it('should skip org check for global admins', async () => {
      repository.findOne.mockResolvedValueOnce(null);
      repository.findOne.mockResolvedValueOnce(createdSut);

      const result = await service.createSut(createDto, testUserId, adminIsAdmin);

      expect(mockAuthzService.isOrganizationMember).not.toHaveBeenCalled();
      expect(result.name).toBe('new-service');
    });
  });
});
