import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';
import { MetricsSourcesService } from './metrics-sources.service';
import { MetricsSource as MetricsSourceEntity } from '../../entities';
import { CreateMetricsSourceDto } from './dto/create-metrics-source.dto';
import { UpdateMetricsSourceDto } from './dto/update-metrics-source.dto';
import { createAuthorizationServiceMock } from '../../../test/mocks/authorization-service.mock';
import { AuthorizationService } from '../../common/services/authorization.service';

describe('MetricsSourcesService', () => {
  let service: MetricsSourcesService;
  let repo: jest.Mocked<Repository<MetricsSourceEntity>>;

  const mockUserId = 'test-user-id';
  const mockRoles = ['user'];
  const mockDate = new Date('2024-01-15T10:00:00.000Z');

  const mockSystemUnderTest = {
    id: 'system-uuid',
    name: 'Test System',
  };

  const mockMetricsSourceEntity: MetricsSourceEntity = {
    id: 'ms-uuid',
    systemUnderTestId: 'system-uuid',
    testEnvironment: 'production',
    sourceType: 'grafana',
    sourceConfigId: 'grafana-instance-uuid',
    externalRef: 'jvm-memory-uid',
    displayName: 'JVM Memory Usage',
    displayLabel: 'JVM Memory - Production',
    workload: 'load-test',
    tags: ['performance', 'jvm'],
    metadata: { panelCount: 5 },
    organizationId: 'org-uuid',
    teamId: 'team-uuid',
    createdBy: 'creator-user',
    createdAt: mockDate,
    updatedAt: mockDate,
    systemUnderTest: mockSystemUnderTest as any,
  };

  const createMockQueryBuilder = (returnData: any[] = []) => ({
    createQueryBuilder: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(returnData),
    getOne: jest.fn().mockResolvedValue(returnData[0] ?? null),
  });

  beforeEach(async () => {
    const mockRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsSourcesService,
        {
          provide: getRepositoryToken(MetricsSourceEntity),
          useValue: mockRepo,
        },
        {
          provide: AuthorizationService,
          useValue: createAuthorizationServiceMock(),
        },
      ],
    }).compile();

    service = module.get<MetricsSourcesService>(MetricsSourcesService);
    repo = module.get(getRepositoryToken(MetricsSourceEntity));

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAll', () => {
    it('should return all metrics sources without filters', async () => {
      const qb = createMockQueryBuilder([mockMetricsSourceEntity]);
      repo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.findAll(mockUserId, mockRoles, {});

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'ms-uuid',
        system_under_test_id: 'system-uuid',
        test_environment: 'production',
        source_type: 'grafana',
        display_name: 'JVM Memory Usage',
        display_label: 'JVM Memory - Production',
      });
    });

    it('should include system_under_test relation', async () => {
      const qb = createMockQueryBuilder([mockMetricsSourceEntity]);
      repo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.findAll(mockUserId, mockRoles, {});

      expect(result[0]?.system_under_test).toEqual({
        id: 'system-uuid',
        name: 'Test System',
      });
    });

    it('should filter by systemId', async () => {
      const qb = createMockQueryBuilder([]);
      repo.createQueryBuilder.mockReturnValue(qb as any);

      await service.findAll(mockUserId, mockRoles, { systemId: 'system-uuid' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'ms.systemUnderTestId = :systemId',
        { systemId: 'system-uuid' },
      );
    });

    it('should filter by sourceType', async () => {
      const qb = createMockQueryBuilder([]);
      repo.createQueryBuilder.mockReturnValue(qb as any);

      await service.findAll(mockUserId, mockRoles, { sourceType: 'dynatrace' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'ms.sourceType = :sourceType',
        { sourceType: 'dynatrace' },
      );
    });

    it('should filter by displayName with ILIKE', async () => {
      const qb = createMockQueryBuilder([]);
      repo.createQueryBuilder.mockReturnValue(qb as any);

      await service.findAll(mockUserId, mockRoles, { displayName: 'JVM' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'ms.displayName ILIKE :displayName',
        { displayName: '%JVM%' },
      );
    });

    it('should filter by tags', async () => {
      const qb = createMockQueryBuilder([]);
      repo.createQueryBuilder.mockReturnValue(qb as any);

      await service.findAll(mockUserId, mockRoles, { tags: ['performance'] });

      expect(qb.andWhere).toHaveBeenCalledWith('ms.tags && :tags', { tags: ['performance'] });
    });

    it('should not filter by tags when empty array', async () => {
      const qb = createMockQueryBuilder([]);
      repo.createQueryBuilder.mockReturnValue(qb as any);

      await service.findAll(mockUserId, mockRoles, { tags: [] });

      expect(qb.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('tags'),
        expect.anything(),
      );
    });

    it('should order results by display_name and display_label', async () => {
      const qb = createMockQueryBuilder([]);
      repo.createQueryBuilder.mockReturnValue(qb as any);

      await service.findAll(mockUserId, mockRoles, {});

      expect(qb.orderBy).toHaveBeenCalledWith('ms.displayName', 'ASC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('ms.displayLabel', 'ASC');
    });

    it('should return empty array when no results', async () => {
      const qb = createMockQueryBuilder([]);
      repo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.findAll(mockUserId, mockRoles, {});

      expect(result).toEqual([]);
    });

    it('should handle database errors', async () => {
      const qb = {
        ...createMockQueryBuilder([]),
        getMany: jest.fn().mockRejectedValue(new Error('DB error')),
      };
      repo.createQueryBuilder.mockReturnValue(qb as any);

      await expect(service.findAll(mockUserId, mockRoles, {})).rejects.toThrow('DB error');
    });
  });

  describe('findOne', () => {
    it('should return metrics source by ID', async () => {
      const qb = createMockQueryBuilder([mockMetricsSourceEntity]);
      repo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.findOne('ms-uuid', mockUserId, mockRoles);

      expect(result.id).toBe('ms-uuid');
      expect(result.source_type).toBe('grafana');
      expect(qb.where).toHaveBeenCalledWith('ms.id = :id', { id: 'ms-uuid' });
    });

    it('should throw NotFoundException when not found', async () => {
      const qb = createMockQueryBuilder([]);
      repo.createQueryBuilder.mockReturnValue(qb as any);

      await expect(service.findOne('non-existent', mockUserId, mockRoles))
        .rejects.toThrow('MetricsSource with ID non-existent not found');
    });

    it('should map all fields to snake_case response', async () => {
      const qb = createMockQueryBuilder([mockMetricsSourceEntity]);
      repo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.findOne('ms-uuid', mockUserId, mockRoles);

      expect(result).toMatchObject({
        id: 'ms-uuid',
        system_under_test_id: 'system-uuid',
        test_environment: 'production',
        source_type: 'grafana',
        source_config_id: 'grafana-instance-uuid',
        external_ref: 'jvm-memory-uid',
        display_name: 'JVM Memory Usage',
        display_label: 'JVM Memory - Production',
        workload: 'load-test',
        tags: ['performance', 'jvm'],
        metadata: { panelCount: 5 },
        organization_id: 'org-uuid',
        team_id: 'team-uuid',
        created_by: 'creator-user',
        created_at: '2024-01-15T10:00:00.000Z',
        updated_at: '2024-01-15T10:00:00.000Z',
      });
    });
  });

  describe('create', () => {
    const createDto: CreateMetricsSourceDto = {
      systemUnderTestId: 'system-uuid',
      testEnvironment: 'production',
      sourceType: 'grafana',
      sourceConfigId: 'grafana-instance-uuid',
      externalRef: 'jvm-memory-uid',
      displayName: 'JVM Memory Usage',
      displayLabel: 'JVM Memory - Production',
      workload: 'load-test',
      tags: ['performance', 'jvm'],
      metadata: { panelCount: 5 },
      organizationId: 'org-uuid',
      teamId: 'team-uuid',
    };

    it('should create metrics source with all fields', async () => {
      repo.create.mockReturnValue(mockMetricsSourceEntity);
      repo.save.mockResolvedValue(mockMetricsSourceEntity);
      repo.findOne.mockResolvedValue(mockMetricsSourceEntity);

      const result = await service.create(createDto, mockUserId, mockRoles);

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
        systemUnderTestId: 'system-uuid',
        testEnvironment: 'production',
        sourceType: 'grafana',
        displayName: 'JVM Memory Usage',
        createdBy: mockUserId,
      }));
      expect(result.id).toBe('ms-uuid');
    });

    it('should use default empty tags when not provided', async () => {
      const dtoNoTags = { ...createDto, tags: undefined };
      repo.create.mockReturnValue(mockMetricsSourceEntity);
      repo.save.mockResolvedValue(mockMetricsSourceEntity);
      repo.findOne.mockResolvedValue(mockMetricsSourceEntity);

      await service.create(dtoNoTags, mockUserId, mockRoles);

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ tags: [] }));
    });

    it('should throw when fetch after create fails', async () => {
      repo.create.mockReturnValue(mockMetricsSourceEntity);
      repo.save.mockResolvedValue(mockMetricsSourceEntity);
      repo.findOne.mockResolvedValue(null);

      await expect(service.create(createDto, mockUserId, mockRoles))
        .rejects.toThrow('Failed to fetch created metrics source');
    });

    it('should handle save errors', async () => {
      repo.create.mockReturnValue(mockMetricsSourceEntity);
      repo.save.mockRejectedValue(new Error('Unique constraint violation'));

      await expect(service.create(createDto, mockUserId, mockRoles))
        .rejects.toThrow('Unique constraint violation');
    });
  });

  describe('update', () => {
    const updateDto: UpdateMetricsSourceDto = {
      displayLabel: 'Updated Label',
      tags: ['updated'],
    };

    it('should update metrics source', async () => {
      repo.findOne.mockResolvedValueOnce(mockMetricsSourceEntity);
      const updatedEntity = { ...mockMetricsSourceEntity, displayLabel: 'Updated Label' };
      const qb = createMockQueryBuilder([updatedEntity]);
      repo.createQueryBuilder.mockReturnValue(qb as any);
      repo.update.mockResolvedValue({} as any);

      const result = await service.update('ms-uuid', updateDto, mockUserId, mockRoles);

      expect(repo.update).toHaveBeenCalledWith('ms-uuid', expect.objectContaining({
        displayLabel: 'Updated Label',
        tags: ['updated'],
      }));
      expect(result.display_label).toBe('Updated Label');
    });

    it('should throw NotFoundException when not found', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.update('non-existent', updateDto, mockUserId, mockRoles))
        .rejects.toThrow('MetricsSource with id non-existent not found');
    });

    it('should only update provided fields', async () => {
      repo.findOne.mockResolvedValueOnce(mockMetricsSourceEntity);
      const qb = createMockQueryBuilder([mockMetricsSourceEntity]);
      repo.createQueryBuilder.mockReturnValue(qb as any);
      repo.update.mockResolvedValue({} as any);

      await service.update('ms-uuid', { displayName: 'New Name' }, mockUserId, mockRoles);

      const updateCall = (repo.update as jest.Mock).mock.calls[0][1];
      expect(updateCall).toHaveProperty('displayName', 'New Name');
      expect(updateCall).not.toHaveProperty('testEnvironment');
      expect(updateCall).not.toHaveProperty('sourceType');
    });
  });

  describe('delete', () => {
    it('should delete metrics source', async () => {
      repo.findOne.mockResolvedValue(mockMetricsSourceEntity);
      repo.delete.mockResolvedValue({} as any);

      await service.delete('ms-uuid', mockUserId, mockRoles);

      expect(repo.delete).toHaveBeenCalledWith('ms-uuid');
    });

    it('should throw NotFoundException when not found', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.delete('non-existent', mockUserId, mockRoles))
        .rejects.toThrow('MetricsSource with id non-existent not found');
    });
  });
});
