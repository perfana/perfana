import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ComparePresetsService } from './compare-presets.service';
import { CompareFilterPreset, ApplicationDashboard, TestRun as TestRunEntity } from '../../entities';
import { CreateComparePresetDto, PresetType } from './dto/create-compare-preset.dto';
import { UpdateComparePresetDto } from './dto/update-compare-preset.dto';
import { createMockRepository, MockRepository } from '../../../test/helpers/mock-repository.factory';
import { AuthorizationService } from '../../common/services/authorization.service';
import { AuditService } from '../audit/audit.service';

describe('ComparePresetsService', () => {
  let service: ComparePresetsService;
  let comparePresetRepo: MockRepository<CompareFilterPreset>;
  let testRunRepo: MockRepository<TestRunEntity>;
  let auditService: jest.Mocked<AuditService>;
  let module: import('@nestjs/testing').TestingModule;

  const userId = 'user-uuid';
  const otherUserId = 'other-user-uuid';

  const mockDate = new Date('2024-01-15T10:00:00.000Z');

  const mockPreset: CompareFilterPreset = {
    id: 'preset-uuid',
    name: 'Test Preset',
    description: 'Test description',
    presetType: 'generic',
    seriesSearchText: 'response',
    showPercentiles: true,
    applicationDashboardId: 'dashboard-uuid',
    source: 'grafana',
    dashboardLabel: 'Test Dashboard',
    panelId: 5,
    panelTitle: 'Response Time',
    baselineTestRunId: 'test-123',
    isGlobal: false,
    createdBy: userId,
    createdAt: mockDate,
    updatedAt: mockDate,
  } as CompareFilterPreset;

  const mockApplicationDashboard: ApplicationDashboard = {
    id: 'dashboard-uuid',
    dashboardLabel: 'Test Dashboard',
  } as ApplicationDashboard;

  const mockTestRun: Partial<TestRunEntity> = {
    testRunId: 'test-123',
    applicationRelease: 'v1.0.0',
    annotations: ['Test annotation'],
  };

  beforeEach(async () => {
    // Use mock repository factory for consistent mocking patterns
    const mockComparePresetRepo = createMockRepository<CompareFilterPreset>();
    const mockTestRunRepo = createMockRepository<TestRunEntity>();

    module = await Test.createTestingModule({
      providers: [
        ComparePresetsService,
        {
          provide: getRepositoryToken(CompareFilterPreset),
          useValue: mockComparePresetRepo,
        },
        {
          provide: getRepositoryToken(TestRunEntity),
          useValue: mockTestRunRepo,
        },
        {
          provide: AuthorizationService,
          useValue: {
            isGlobalAdmin: jest.fn().mockImplementation((roles: string[]) =>
              roles.some(r => ['perfana-admin', 'super-admin', 'admin'].includes(r)),
            ),
            getAccessibleOrganizations: jest.fn().mockResolvedValue(['org-1']),
          },
        },
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ComparePresetsService>(ComparePresetsService);
    comparePresetRepo = module.get(getRepositoryToken(CompareFilterPreset));
    testRunRepo = module.get(getRepositoryToken(TestRunEntity));
    auditService = module.get(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new compare preset', async () => {
      // Arrange
      const createDto: CreateComparePresetDto = {
        name: 'Test Preset',
        description: 'Test description',
        preset_type: PresetType.GENERIC,
        series_search_text: 'response',
        show_percentiles: true,
        application_dashboard_id: 'dashboard-uuid',
        source: 'grafana',
        dashboard_label: 'Test Dashboard',
        panel_id: 5,
        panel_title: 'Response Time',
        baseline_test_run_id: 'test-123',
        is_global: false,
      };

      comparePresetRepo.create.mockReturnValue(mockPreset);
      comparePresetRepo.save.mockResolvedValue(mockPreset);

      // Act
      const result = await service.create(createDto, userId, ['admin']);

      // Assert
      expect(comparePresetRepo.create).toHaveBeenCalledWith({
        name: createDto.name,
        description: createDto.description,
        presetType: createDto.preset_type,
        seriesSearchText: createDto.series_search_text,
        showPercentiles: createDto.show_percentiles,
        applicationDashboardId: createDto.application_dashboard_id,
        source: createDto.source,
        dashboardLabel: createDto.dashboard_label,
        panelId: createDto.panel_id,
        panelTitle: createDto.panel_title,
        baselineTestRunId: createDto.baseline_test_run_id,
        createdForTestRunId: createDto.created_for_test_run_id,
        isGlobal: createDto.is_global,
        createdBy: userId,
      });
      expect(comparePresetRepo.save).toHaveBeenCalledWith(mockPreset);
      expect(result.id).toBe('preset-uuid');
      expect(result.name).toBe('Test Preset');
    });

    it('should create preset with default show_percentiles false', async () => {
      // Arrange
      const createDto: CreateComparePresetDto = {
        name: 'Test Preset',
        preset_type: PresetType.GENERIC,
        show_percentiles: false,
        is_global: false,
      };

      const presetWithoutPercentiles = {
        ...mockPreset,
        showPercentiles: false,
      };

      comparePresetRepo.create.mockReturnValue(presetWithoutPercentiles);
      comparePresetRepo.save.mockResolvedValue(presetWithoutPercentiles);

      // Act
      const result = await service.create(createDto, userId, ['admin']);

      // Assert
      expect(result.show_percentiles).toBe(false);
    });

    it('should throw error when save fails', async () => {
      // Arrange
      const createDto: CreateComparePresetDto = {
        name: 'Test Preset',
        preset_type: PresetType.GENERIC,
        show_percentiles: true,
        is_global: false,
      };

      comparePresetRepo.create.mockReturnValue(mockPreset);
      comparePresetRepo.save.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.create(createDto, userId)).rejects.toThrow('Failed to create compare preset: Database error');
    });

    it('should save created_for_test_run_id when provided', async () => {
      // Arrange
      const createDto: CreateComparePresetDto = {
        name: 'Test Run Specific Preset',
        preset_type: PresetType.GENERIC,
        show_percentiles: false,
        created_for_test_run_id: 'PaymentService-prod-loadTest-20240115',
        is_global: false,
      };

      const presetWithTestRunId = {
        ...mockPreset,
        createdForTestRunId: 'PaymentService-prod-loadTest-20240115',
      };

      comparePresetRepo.create.mockReturnValue(presetWithTestRunId);
      comparePresetRepo.save.mockResolvedValue(presetWithTestRunId);

      // Act
      await service.create(createDto, userId, ['admin']);

      // Assert
      expect(comparePresetRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          createdForTestRunId: 'PaymentService-prod-loadTest-20240115',
        })
      );
      expect(comparePresetRepo.save).toHaveBeenCalledWith(presetWithTestRunId);
    });
  });

  describe('findAll', () => {
    it('should return user presets and global presets for non-admin users', async () => {
      // Arrange
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockPreset]),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act — use non-admin role to test ownership filter
      const result = await service.findAll(userId, undefined, ['user']);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        '(preset.createdBy = :userId OR preset.isGlobal = :isGlobal)',
        {
          userId,
          isGlobal: true,
        }
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('preset-uuid');
    });

    it('should filter by test run ID and show generic and specific presets for that test run', async () => {
      // Arrange
      const genericPreset = { ...mockPreset, presetType: 'generic' };
      const specificPreset = { ...mockPreset, id: 'preset-2', presetType: 'specific', createdForTestRunId: 'test-123', baselineTestRunId: 'baseline-999' };
      const otherSpecificPreset = { ...mockPreset, id: 'preset-3', presetType: 'specific', createdForTestRunId: 'test-999', baselineTestRunId: 'baseline-123' };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([genericPreset, specificPreset, otherSpecificPreset]),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findAll(userId, 'test-123', ['admin']);

      // Assert
      expect(result).toHaveLength(2);
      expect(result.find((p) => p.id === 'preset-uuid')).toBeDefined();
      expect(result.find((p) => p.id === 'preset-2')).toBeDefined();
      expect(result.find((p) => p.id === 'preset-3')).toBeUndefined();
    });

    it('should only show generic presets when no test run ID provided', async () => {
      // Arrange
      const genericPreset = { ...mockPreset, presetType: 'generic' };
      const specificPreset = { ...mockPreset, id: 'preset-2', presetType: 'specific', baselineTestRunId: 'test-123' };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([genericPreset, specificPreset]),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findAll(userId, undefined, ['admin']);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]?.preset_type).toBe('generic');
    });

    it('should enrich presets with test run data', async () => {
      // Arrange
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockPreset]),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
      testRunRepo.findOne.mockResolvedValue(mockTestRun as TestRunEntity);

      // Act
      const result = await service.findAll(userId, undefined, ['admin']);

      // Assert
      expect(testRunRepo.findOne).toHaveBeenCalledWith({
        where: { testRunId: 'test-123' },
        select: ['applicationRelease', 'annotations'],
      });
      expect(result[0]?.baseline_application_release).toBe('v1.0.0');
      expect(result[0]?.baseline_annotations).toEqual(['Test annotation']);
    });

    it('should handle test run data fetch failure gracefully', async () => {
      // Arrange
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockPreset]),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
      testRunRepo.findOne.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.findAll(userId, undefined, ['admin']);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]?.baseline_application_release).toBeUndefined();
    });

    it('should throw error when query fails', async () => {
      // Arrange
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockRejectedValue(new Error('Query error')),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act & Assert
      await expect(service.findAll(userId)).rejects.toThrow('Failed to fetch compare presets: Query error');
    });
  });

  describe('findOne', () => {
    it('should return preset when found and user has access', async () => {
      // Arrange
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockPreset),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findOne('preset-uuid', userId, ['admin']);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('preset.id = :id', { id: 'preset-uuid' });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(preset.createdBy = :userId OR preset.isGlobal = :isGlobal)',
        {
          userId,
          isGlobal: true,
        }
      );
      expect(result.id).toBe('preset-uuid');
    });

    it('should return global preset for any user', async () => {
      // Arrange
      const globalPreset = { ...mockPreset, isGlobal: true, createdBy: otherUserId };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(globalPreset),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findOne('preset-uuid', userId, ['admin']);

      // Assert
      expect(result.is_global).toBe(true);
    });

    it('should throw NotFoundException when preset not found', async () => {
      // Arrange
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act & Assert
      await expect(service.findOne('non-existent-id', userId, ['admin'])).rejects.toThrow(
        new NotFoundException('Compare preset with ID non-existent-id not found')
      );
    });

    it('should enrich preset with test run data', async () => {
      // Arrange
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockPreset),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
      testRunRepo.findOne.mockResolvedValue(mockTestRun as TestRunEntity);

      // Act
      const result = await service.findOne('preset-uuid', userId, ['admin']);

      // Assert
      expect(result.baseline_application_release).toBe('v1.0.0');
      expect(result.baseline_annotations).toEqual(['Test annotation']);
    });
  });

  describe('update', () => {
    it('should update preset when user owns it', async () => {
      // Arrange
      const updateDto: UpdateComparePresetDto = {
        name: 'Updated Preset',
        description: 'Updated description',
        show_percentiles: false,
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockPreset),
      };

      const updatedPreset = {
        ...mockPreset,
        name: 'Updated Preset',
        description: 'Updated description',
        showPercentiles: false,
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
      comparePresetRepo.update.mockResolvedValue({} as any);
      comparePresetRepo.findOne.mockResolvedValue(updatedPreset);

      // Act
      const result = await service.update('preset-uuid', updateDto, userId, ['admin']);

      // Assert
      expect(comparePresetRepo.update).toHaveBeenCalledWith(
        { id: 'preset-uuid', createdBy: userId },
        {
          name: 'Updated Preset',
          description: 'Updated description',
          showPercentiles: false,
        }
      );
      expect(result.name).toBe('Updated Preset');
      expect(result.show_percentiles).toBe(false);
    });

    it('should update only provided fields', async () => {
      // Arrange
      const updateDto: UpdateComparePresetDto = {
        series_search_text: 'latency',
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockPreset),
      };

      const updatedPreset = {
        ...mockPreset,
        seriesSearchText: 'latency',
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
      comparePresetRepo.update.mockResolvedValue({} as any);
      comparePresetRepo.findOne.mockResolvedValue(updatedPreset);

      // Act
      const result = await service.update('preset-uuid', updateDto, userId, ['admin']);

      // Assert
      expect(comparePresetRepo.update).toHaveBeenCalledWith(
        { id: 'preset-uuid', createdBy: userId },
        {
          seriesSearchText: 'latency',
        }
      );
      expect(result.series_search_text).toBe('latency');
    });

    it('should throw ForbiddenException when user does not own preset', async () => {
      // Arrange
      const updateDto: UpdateComparePresetDto = {
        name: 'Updated Preset',
      };

      const otherUserPreset = { ...mockPreset, createdBy: otherUserId };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(otherUserPreset),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act & Assert
      await expect(service.update('preset-uuid', updateDto, userId, ['admin'])).rejects.toThrow(
        new ForbiddenException('You can only update your own presets')
      );
    });

    it('should throw NotFoundException when preset not found', async () => {
      // Arrange
      const updateDto: UpdateComparePresetDto = {
        name: 'Updated Preset',
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act & Assert
      await expect(service.update('non-existent-id', updateDto, userId, ['admin'])).rejects.toThrow(NotFoundException);
    });

    it('should throw error when updated preset cannot be fetched', async () => {
      // Arrange
      const updateDto: UpdateComparePresetDto = {
        name: 'Updated Preset',
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockPreset),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
      comparePresetRepo.update.mockResolvedValue({} as any);
      comparePresetRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.update('preset-uuid', updateDto, userId, ['admin'])).rejects.toThrow('Failed to fetch updated preset');
    });
  });

  describe('remove', () => {
    it('should delete preset when user owns it', async () => {
      // Arrange
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockPreset),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
      comparePresetRepo.delete.mockResolvedValue({} as any);

      // Act
      await service.remove('preset-uuid', userId, ['admin']);

      // Assert
      expect(comparePresetRepo.delete).toHaveBeenCalledWith({
        id: 'preset-uuid',
        createdBy: userId,
      });
    });

    it('should throw ForbiddenException when user does not own preset', async () => {
      // Arrange
      const otherUserPreset = { ...mockPreset, createdBy: otherUserId };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(otherUserPreset),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act & Assert
      await expect(service.remove('preset-uuid', userId, ['admin'])).rejects.toThrow(
        new ForbiddenException('You can only delete your own presets')
      );
    });

    it('should throw NotFoundException when preset not found', async () => {
      // Arrange
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act & Assert
      await expect(service.remove('non-existent-id', userId, ['admin'])).rejects.toThrow(NotFoundException);
    });
  });

  describe('mapToDto', () => {
    it('should map preset with dashboard label from preset', async () => {
      // Arrange
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ ...mockPreset, dashboardLabel: 'Preset Label' }),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findOne('preset-uuid', userId, ['admin']);

      // Assert
      expect(result.dashboard_label).toBe('Preset Label');
    });

    it('should fall back to dashboard label from application dashboard', async () => {
      // Arrange
      const presetWithoutLabel = { ...mockPreset, dashboardLabel: null };
      presetWithoutLabel.applicationDashboard = mockApplicationDashboard;

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(presetWithoutLabel),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findOne('preset-uuid', userId, ['admin']);

      // Assert
      expect(result.dashboard_label).toBe('Test Dashboard');
    });

    it('should map all fields correctly', async () => {
      // Arrange
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockPreset),
      };

      comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findOne('preset-uuid', userId, ['admin']);

      // Assert
      expect(result.id).toBe('preset-uuid');
      expect(result.name).toBe('Test Preset');
      expect(result.description).toBe('Test description');
      expect(result.preset_type).toBe('generic');
      expect(result.series_search_text).toBe('response');
      expect(result.show_percentiles).toBe(true);
      expect(result.application_dashboard_id).toBe('dashboard-uuid');
      expect(result.source).toBe('grafana');
      expect(result.panel_id).toBe(5);
      expect(result.panel_title).toBe('Response Time');
      expect(result.baseline_test_run_id).toBe('test-123');
      expect(result.is_global).toBe(false);
      expect(result.created_by).toBe(userId);
      expect(result.created_at).toBe(mockDate.toISOString());
      expect(result.updated_at).toBe(mockDate.toISOString());
    });
  });

  describe('Edge Cases and Complex Scenarios', () => {
    describe('create - edge cases', () => {
      it('should create preset with empty description', async () => {
        // Arrange
        const createDto: CreateComparePresetDto = {
          name: 'Minimal Preset',
          description: '',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
        };

        const minimalPreset = {
          ...mockPreset,
          description: '',
        };

        comparePresetRepo.create.mockReturnValue(minimalPreset);
        comparePresetRepo.save.mockResolvedValue(minimalPreset);

        // Act
        const result = await service.create(createDto, userId, ['admin']);

        // Assert
        expect(result.description).toBe('');
      });

      it('should create preset with special characters in name', async () => {
        // Arrange
        const createDto: CreateComparePresetDto = {
          name: 'Test <> & "quotes" \'apostrophe\'',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
        };

        const specialCharPreset = {
          ...mockPreset,
          name: createDto.name,
        };

        comparePresetRepo.create.mockReturnValue(specialCharPreset);
        comparePresetRepo.save.mockResolvedValue(specialCharPreset);

        // Act
        const result = await service.create(createDto, userId, ['admin']);

        // Assert
        expect(result.name).toBe('Test <> & "quotes" \'apostrophe\'');
      });

      it('should create preset with maximum field lengths', async () => {
        // Arrange
        const longName = 'A'.repeat(255);
        const longDescription = 'B'.repeat(1000);
        const createDto: CreateComparePresetDto = {
          name: longName,
          description: longDescription,
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
          series_search_text: 'C'.repeat(255),
          dashboard_label: 'D'.repeat(255),
          panel_title: 'E'.repeat(255),
          baseline_test_run_id: 'F'.repeat(255),
        };

        const maxLengthPreset = {
          ...mockPreset,
          name: longName,
          description: longDescription,
        };

        comparePresetRepo.create.mockReturnValue(maxLengthPreset);
        comparePresetRepo.save.mockResolvedValue(maxLengthPreset);

        // Act
        const result = await service.create(createDto, userId, ['admin']);

        // Assert
        expect(result.name).toHaveLength(255);
        expect(result.description).toHaveLength(1000);
      });

      it('should create preset with undefined optional fields', async () => {
        // Arrange
        const createDto: CreateComparePresetDto = {
          name: 'Minimal',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
        };

        const minimalPreset = {
          ...mockPreset,
          description: undefined,
          seriesSearchText: undefined,
          applicationDashboardId: undefined,
          source: undefined,
          dashboardLabel: undefined,
          panelId: undefined,
          panelTitle: undefined,
          baselineTestRunId: undefined,
        };

        comparePresetRepo.create.mockReturnValue(minimalPreset);
        comparePresetRepo.save.mockResolvedValue(minimalPreset);

        // Act
        const result = await service.create(createDto, userId, ['admin']);

        // Assert
        expect(result.description).toBeUndefined();
        expect(result.series_search_text).toBeUndefined();
      });

      it('should handle database constraint violation error', async () => {
        // Arrange
        const createDto: CreateComparePresetDto = {
          name: 'Test Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
        };

        comparePresetRepo.create.mockReturnValue(mockPreset);
        comparePresetRepo.save.mockRejectedValue({
          code: '23505',
          message: 'duplicate key value violates unique constraint',
        });

        // Act & Assert
        await expect(service.create(createDto, userId)).rejects.toThrow(
          'Failed to create compare preset: duplicate key value violates unique constraint'
        );
      });

      it('should create global preset when is_global is true', async () => {
        // Arrange
        const createDto: CreateComparePresetDto = {
          name: 'Global Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: true,
          is_global: true,
        };

        const globalPreset = {
          ...mockPreset,
          isGlobal: true,
        };

        comparePresetRepo.create.mockReturnValue(globalPreset);
        comparePresetRepo.save.mockResolvedValue(globalPreset);

        // Act
        const result = await service.create(createDto, userId, ['admin']);

        // Assert
        expect(result.is_global).toBe(true);
        expect(comparePresetRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            isGlobal: true,
          })
        );
      });

      it('should create specific preset with created_for_test_run_id', async () => {
        // Arrange
        const testRunId = 'PaymentService-prod-loadTest-20240115';
        const createDto: CreateComparePresetDto = {
          name: 'Specific Preset',
          preset_type: PresetType.SPECIFIC,
          show_percentiles: false,
          created_for_test_run_id: testRunId,
          is_global: false,
        };

        const specificPreset = {
          ...mockPreset,
          presetType: 'specific',
          createdForTestRunId: testRunId,
        };

        comparePresetRepo.create.mockReturnValue(specificPreset);
        comparePresetRepo.save.mockResolvedValue(specificPreset);

        // Act
        await service.create(createDto, userId, ['admin']);

        // Assert
        expect(comparePresetRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            presetType: PresetType.SPECIFIC,
            createdForTestRunId: testRunId,
          })
        );
      });

      it('should handle non-Error thrown during save', async () => {
        // Arrange
        const createDto: CreateComparePresetDto = {
          name: 'Test Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
        };

        comparePresetRepo.create.mockReturnValue(mockPreset);
        comparePresetRepo.save.mockRejectedValue('String error');

        // Act & Assert
        await expect(service.create(createDto, userId)).rejects.toThrow(
          'Failed to create compare preset: Unknown error'
        );
      });
    });

    describe('findAll - edge cases', () => {
      it('should handle empty preset list', async () => {
        // Arrange
        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

        // Act
        const result = await service.findAll(userId, undefined, ['admin']);

        // Assert
        expect(result).toEqual([]);
      });

      it('should handle preset with null applicationDashboard', async () => {
        // Arrange
        const presetWithoutDashboard = {
          ...mockPreset,
          applicationDashboard: null,
        };

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([presetWithoutDashboard]),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

        // Act
        const result = await service.findAll(userId, undefined, ['admin']);

        // Assert
        expect(result).toHaveLength(1);
        expect(result[0]?.dashboard_label).toBe('Test Dashboard');
      });

      it('should filter out all specific presets when no test run ID provided', async () => {
        // Arrange
        const specific1 = { ...mockPreset, id: 's1', presetType: 'specific', createdForTestRunId: 'test-1' };
        const specific2 = { ...mockPreset, id: 's2', presetType: 'specific', createdForTestRunId: 'test-2' };

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([specific1, specific2]),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

        // Act
        const result = await service.findAll(userId, undefined, ['admin']);

        // Assert
        expect(result).toHaveLength(0);
      });

      it('should handle mix of user and global presets', async () => {
        // Arrange
        const userPreset = { ...mockPreset, id: 'user-1', createdBy: userId, isGlobal: false };
        const globalPreset = { ...mockPreset, id: 'global-1', createdBy: otherUserId, isGlobal: true };

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([userPreset, globalPreset]),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

        // Act
        const result = await service.findAll(userId, undefined, ['admin']);

        // Assert
        expect(result).toHaveLength(2);
        expect(result.find(p => p.id === 'user-1')).toBeDefined();
        expect(result.find(p => p.id === 'global-1')).toBeDefined();
      });

      it('should handle test run data with null annotations', async () => {
        // Arrange
        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([mockPreset]),
        };

        const testRunWithNullAnnotations = {
          testRunId: 'test-123',
          applicationRelease: 'v1.0.0',
          annotations: undefined,
        } as Partial<TestRunEntity>;

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
        testRunRepo.findOne.mockResolvedValue(testRunWithNullAnnotations as TestRunEntity);

        // Act
        const result = await service.findAll(userId, undefined, ['admin']);

        // Assert
        expect(result[0]?.baseline_annotations).toBeUndefined();
      });

      it('should handle preset without baseline_test_run_id', async () => {
        // Arrange
        const presetWithoutBaseline = {
          ...mockPreset,
          baselineTestRunId: null,
        };

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([presetWithoutBaseline]),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

        // Act
        const result = await service.findAll(userId, undefined, ['admin']);

        // Assert
        expect(testRunRepo.findOne).not.toHaveBeenCalled();
        expect(result[0]?.baseline_application_release).toBeUndefined();
      });

      it('should handle non-Error thrown during query', async () => {
        // Arrange
        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockRejectedValue(null),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

        // Act & Assert
        await expect(service.findAll(userId)).rejects.toThrow(
          'Failed to fetch compare presets: Unknown error'
        );
      });
    });

    describe('findOne - edge cases', () => {
      it('should handle preset owned by another user but is global', async () => {
        // Arrange
        const globalPreset = {
          ...mockPreset,
          createdBy: otherUserId,
          isGlobal: true,
        };

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(globalPreset),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

        // Act
        const result = await service.findOne('preset-uuid', userId, ['admin']);

        // Assert
        expect(result.created_by).toBe(otherUserId);
        expect(result.is_global).toBe(true);
      });

      it('should handle query returning null (not found)', async () => {
        // Arrange
        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(null),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

        // Act & Assert
        await expect(service.findOne('non-existent', userId, ['admin'])).rejects.toThrow(
          new NotFoundException('Compare preset with ID non-existent not found')
        );
      });

      it('should handle database error during query', async () => {
        // Arrange
        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockRejectedValue(new Error('Connection timeout')),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

        // Act & Assert
        await expect(service.findOne('preset-uuid', userId)).rejects.toThrow(
          'Failed to fetch compare preset: Connection timeout'
        );
      });

      it('should handle test run data fetch returning null', async () => {
        // Arrange
        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(mockPreset),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
        testRunRepo.findOne.mockResolvedValue(null);

        // Act
        const result = await service.findOne('preset-uuid', userId, ['admin']);

        // Assert
        expect(result.baseline_application_release).toBeUndefined();
        expect(result.baseline_annotations).toBeUndefined();
      });

      it('should log warning when test run data fetch fails', async () => {
        // Arrange
        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(mockPreset),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
        testRunRepo.findOne.mockRejectedValue(new Error('Database connection failed'));

        const loggerWarnSpy = jest.spyOn(service['logger'], 'warn');

        // Act
        const result = await service.findOne('preset-uuid', userId, ['admin']);

        // Assert
        expect(loggerWarnSpy).toHaveBeenCalledWith(
          `Failed to fetch test run data for ${mockPreset.baselineTestRunId}:`,
          expect.any(Error)
        );
        expect(result.baseline_application_release).toBeUndefined();
      });
    });

    describe('update - edge cases', () => {
      it('should update all fields when provided', async () => {
        // Arrange
        const updateDto: UpdateComparePresetDto = {
          name: 'Updated Name',
          description: 'Updated Description',
          preset_type: PresetType.SPECIFIC,
          series_search_text: 'updated_search',
          show_percentiles: true,
          application_dashboard_id: 'new-dashboard-id',
          panel_id: 10,
          panel_title: 'New Panel',
          baseline_test_run_id: 'new-baseline',
          is_global: true,
        };

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(mockPreset),
        };

        const fullyUpdatedPreset: CompareFilterPreset = {
          ...mockPreset,
          name: updateDto.name!,
          description: updateDto.description,
          presetType: updateDto.preset_type!,
          seriesSearchText: updateDto.series_search_text,
          showPercentiles: updateDto.show_percentiles!,
          applicationDashboardId: updateDto.application_dashboard_id,
          panelId: updateDto.panel_id,
          panelTitle: updateDto.panel_title,
          baselineTestRunId: updateDto.baseline_test_run_id,
          isGlobal: updateDto.is_global!,
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
        comparePresetRepo.update.mockResolvedValue({} as any);
        comparePresetRepo.findOne.mockResolvedValue(fullyUpdatedPreset);

        // Act
        const result = await service.update('preset-uuid', updateDto, userId, ['admin']);

        // Assert
        expect(result.name).toBe('Updated Name');
        expect(result.description).toBe('Updated Description');
        expect(result.preset_type).toBe(PresetType.SPECIFIC);
        expect(result.show_percentiles).toBe(true);
        expect(result.is_global).toBe(true);
      });

      it('should handle update with empty object', async () => {
        // Arrange
        const updateDto: UpdateComparePresetDto = {};

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(mockPreset),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
        comparePresetRepo.update.mockResolvedValue({} as any);
        comparePresetRepo.findOne.mockResolvedValue(mockPreset);

        // Act
        const result = await service.update('preset-uuid', updateDto, userId, ['admin']);

        // Assert
        expect(comparePresetRepo.update).toHaveBeenCalledWith(
          { id: 'preset-uuid', createdBy: userId },
          {}
        );
        expect(result).toBeDefined();
      });

      it('should throw ForbiddenException for global preset owned by another user', async () => {
        // Arrange
        const globalPresetOwnedByOther = {
          ...mockPreset,
          createdBy: otherUserId,
          isGlobal: true,
        };

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(globalPresetOwnedByOther),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

        // Act & Assert - use admin role to bypass org filtering so we can test ownership check
        await expect(
          service.update('preset-uuid', { name: 'New Name' }, userId, ['admin'])
        ).rejects.toThrow(new ForbiddenException('You can only update your own presets'));
      });

      it('should handle database error during update', async () => {
        // Arrange
        const updateDto: UpdateComparePresetDto = { name: 'Updated' };

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(mockPreset),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
        comparePresetRepo.update.mockRejectedValue(new Error('Update failed'));

        // Act & Assert
        await expect(service.update('preset-uuid', updateDto, userId, ['admin'])).rejects.toThrow(
          'Failed to update compare preset: Update failed'
        );
      });

      it('should update source and dashboard_label fields', async () => {
        // Arrange
        const updateDto: UpdateComparePresetDto = {
          // Cast to any to access non-standard fields
        } as any;
        updateDto.source = 'dynatrace';
        updateDto.dashboard_label = 'Dynatrace Dashboard';

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(mockPreset),
        };

        const updatedPreset = {
          ...mockPreset,
          source: 'dynatrace',
          dashboardLabel: 'Dynatrace Dashboard',
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
        comparePresetRepo.update.mockResolvedValue({} as any);
        comparePresetRepo.findOne.mockResolvedValue(updatedPreset);

        // Act
        await service.update('preset-uuid', updateDto, userId, ['admin']);

        // Assert
        expect(comparePresetRepo.update).toHaveBeenCalledWith(
          { id: 'preset-uuid', createdBy: userId },
          expect.objectContaining({
            source: 'dynatrace',
            dashboardLabel: 'Dynatrace Dashboard',
          })
        );
      });

      it('should log warning when test run data fetch fails during update', async () => {
        // Arrange
        const updateDto: UpdateComparePresetDto = { name: 'Updated' };

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(mockPreset),
        };

        const updatedPreset = {
          ...mockPreset,
          name: 'Updated',
          baselineTestRunId: 'test-456',
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
        comparePresetRepo.update.mockResolvedValue({} as any);
        comparePresetRepo.findOne.mockResolvedValue(updatedPreset);
        testRunRepo.findOne.mockRejectedValue(new Error('Test run not found'));

        const loggerWarnSpy = jest.spyOn(service['logger'], 'warn');

        // Act
        await service.update('preset-uuid', updateDto, userId, ['admin']);

        // Assert
        expect(loggerWarnSpy).toHaveBeenCalledWith(
          `Failed to fetch test run data for test-456:`,
          expect.any(Error)
        );
      });
    });

    describe('remove - edge cases', () => {
      it('should not delete global preset owned by another user', async () => {
        // Arrange
        const globalPresetOwnedByOther = {
          ...mockPreset,
          createdBy: otherUserId,
          isGlobal: true,
        };

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(globalPresetOwnedByOther),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

        // Act & Assert
        await expect(service.remove('preset-uuid', userId, ['admin'])).rejects.toThrow(
          new ForbiddenException('You can only delete your own presets')
        );
        expect(comparePresetRepo.delete).not.toHaveBeenCalled();
      });

      it('should handle database error during delete', async () => {
        // Arrange
        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(mockPreset),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
        comparePresetRepo.delete.mockRejectedValue(new Error('Delete failed'));

        // Act & Assert
        await expect(service.remove('preset-uuid', userId, ['admin'])).rejects.toThrow(
          'Failed to delete compare preset: Delete failed'
        );
      });

      it('should successfully delete preset with all constraints satisfied', async () => {
        // Arrange
        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(mockPreset),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
        comparePresetRepo.delete.mockResolvedValue({ affected: 1, raw: [] } as any);

        // Act
        await service.remove('preset-uuid', userId, ['admin']);

        // Assert
        expect(comparePresetRepo.delete).toHaveBeenCalledWith({
          id: 'preset-uuid',
          createdBy: userId,
        });
      });
    });

    describe('Concurrent Operations', () => {
      it('should handle concurrent preset creations', async () => {
        // Arrange
        const createDto1: CreateComparePresetDto = {
          name: 'Preset 1',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
        };

        const createDto2: CreateComparePresetDto = {
          name: 'Preset 2',
          preset_type: PresetType.GENERIC,
          show_percentiles: true,
          is_global: false,
        };

        const preset1 = { ...mockPreset, id: 'preset-1', name: 'Preset 1' };
        const preset2 = { ...mockPreset, id: 'preset-2', name: 'Preset 2' };

        comparePresetRepo.create.mockReturnValueOnce(preset1).mockReturnValueOnce(preset2);
        comparePresetRepo.save.mockResolvedValueOnce(preset1).mockResolvedValueOnce(preset2);

        // Act
        const results = await Promise.all([
          service.create(createDto1, userId),
          service.create(createDto2, userId),
        ]);

        // Assert
        expect(results).toHaveLength(2);
        expect(results[0]?.name).toBe('Preset 1');
        expect(results[1]?.name).toBe('Preset 2');
      });

      it('should handle concurrent updates to same preset', async () => {
        // Arrange
        const updateDto1: UpdateComparePresetDto = { name: 'Name 1' };
        const updateDto2: UpdateComparePresetDto = { description: 'Desc 2' };

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(mockPreset),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);
        comparePresetRepo.update.mockResolvedValue({} as any);
        comparePresetRepo.findOne.mockResolvedValue(mockPreset);

        // Act
        await Promise.all([
          service.update('preset-uuid', updateDto1, userId),
          service.update('preset-uuid', updateDto2, userId),
        ]);

        // Assert
        expect(comparePresetRepo.update).toHaveBeenCalledTimes(2);
      });
    });

    describe('Null and Undefined Handling', () => {
      it('should handle preset with null createdBy field', async () => {
        // Arrange
        const presetWithNullCreatedBy = {
          ...mockPreset,
          createdBy: null,
        };

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(presetWithNullCreatedBy),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

        // Act
        const result = await service.findOne('preset-uuid', userId, ['admin']);

        // Assert
        expect(result.created_by).toBe('');
      });

      it('should handle preset with all optional fields as undefined', async () => {
        // Arrange
        const minimalPreset = {
          id: 'preset-uuid',
          name: 'Minimal',
          presetType: 'generic',
          showPercentiles: false,
          isGlobal: false,
          createdBy: userId,
          createdAt: mockDate,
          updatedAt: mockDate,
        } as CompareFilterPreset;

        const mockQueryBuilder = {
          leftJoinAndSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(minimalPreset),
        };

        comparePresetRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

        // Act
        const result = await service.findOne('preset-uuid', userId, ['admin']);

        // Assert
        expect(result.description).toBeUndefined();
        expect(result.series_search_text).toBeUndefined();
        expect(result.application_dashboard_id).toBeUndefined();
      });
    });
  });

  // ─── Authorization paths (non-admin users, validateTestRunAccess) ─────────

  describe('Authorization and Organization Filtering', () => {
    // Helper: build the mock query builder used by findOne / update / remove
    const makeQueryBuilder = (preset: CompareFilterPreset | null) => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(preset),
    });

    // Helper: build the mock query builder used by findAll
    const makeFindAllQueryBuilder = (presets: CompareFilterPreset[]) => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(presets),
    });

    const mockDate = new Date('2024-01-15T10:00:00.000Z');

    const basePreset: CompareFilterPreset = {
      id: 'preset-uuid',
      name: 'Test Preset',
      presetType: 'generic',
      showPercentiles: false,
      isGlobal: false,
      createdBy: userId,
      createdAt: mockDate,
      updatedAt: mockDate,
    } as CompareFilterPreset;

    describe('validateTestRunAccess (via create)', () => {
      it('should bypass test-run access check for admin users', async () => {
        // Arrange
        const createDto: CreateComparePresetDto = {
          name: 'Admin Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
          baseline_test_run_id: 'any-run-id',
        };

        comparePresetRepo.create.mockReturnValue(basePreset);
        comparePresetRepo.save.mockResolvedValue(basePreset);

        // Act — admin role bypasses all access checks, testRunRepo.query must not be called
        await service.create(createDto, userId, ['perfana-admin']);

        // Assert
        expect(testRunRepo.query).not.toHaveBeenCalled();
        expect(comparePresetRepo.save).toHaveBeenCalled();
      });

      it('should deny create when non-admin user has no organization memberships', async () => {
        // Arrange — authzService returns empty org list
        const authzService = module.get(AuthorizationService);
        (authzService.getAccessibleOrganizations as jest.Mock).mockResolvedValueOnce([]);

        const createDto: CreateComparePresetDto = {
          name: 'Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
          baseline_test_run_id: 'run-no-access',
        };

        // Act & Assert
        await expect(service.create(createDto, userId, ['user'])).rejects.toThrow(
          /TestRun.*run-no-access/
        );
        expect(comparePresetRepo.save).not.toHaveBeenCalled();
      });

      it('should deny create when test run is not in any of the user organizations', async () => {
        // Arrange — query returns empty (run belongs to a different org)
        testRunRepo.query.mockResolvedValue([]);

        const createDto: CreateComparePresetDto = {
          name: 'Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
          baseline_test_run_id: 'run-other-org',
        };

        // Act & Assert
        await expect(service.create(createDto, userId, ['user'])).rejects.toThrow(
          /TestRun.*run-other-org/
        );
        expect(comparePresetRepo.save).not.toHaveBeenCalled();
      });

      it('should allow create when non-admin user has access to the baseline test run', async () => {
        // Arrange — query returns one row confirming org membership
        testRunRepo.query.mockResolvedValue([{ '?column?': 1 }]);

        const createDto: CreateComparePresetDto = {
          name: 'Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
          baseline_test_run_id: 'accessible-run',
        };

        comparePresetRepo.create.mockReturnValue(basePreset);
        comparePresetRepo.save.mockResolvedValue(basePreset);

        // Act
        const result = await service.create(createDto, userId, ['user']);

        // Assert
        expect(testRunRepo.query).toHaveBeenCalledWith(
          expect.stringContaining('test_run_id = $1'),
          ['accessible-run', ['org-1']],
        );
        expect(result.id).toBe('preset-uuid');
      });

      it('should check both baseline and created_for test run access for non-admin', async () => {
        // Arrange — both test runs are accessible
        testRunRepo.query.mockResolvedValue([{ '?column?': 1 }]);

        const createDto: CreateComparePresetDto = {
          name: 'Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
          baseline_test_run_id: 'baseline-run',
          created_for_test_run_id: 'context-run',
        };

        comparePresetRepo.create.mockReturnValue(basePreset);
        comparePresetRepo.save.mockResolvedValue(basePreset);

        // Act
        await service.create(createDto, userId, ['user']);

        // Assert — query called twice, once for each run
        expect(testRunRepo.query).toHaveBeenCalledTimes(2);
      });

      it('should deny create when created_for test run is inaccessible even if baseline is ok', async () => {
        // Arrange — first call (baseline) succeeds, second call (created_for) returns empty
        testRunRepo.query
          .mockResolvedValueOnce([{ '?column?': 1 }]) // baseline accessible
          .mockResolvedValueOnce([]);                  // created_for not accessible

        const createDto: CreateComparePresetDto = {
          name: 'Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
          baseline_test_run_id: 'baseline-run',
          created_for_test_run_id: 'inaccessible-context-run',
        };

        // Act & Assert
        await expect(service.create(createDto, userId, ['user'])).rejects.toThrow(
          /TestRun.*inaccessible-context-run/
        );
      });

      it('should skip access check when neither baseline nor context run is set', async () => {
        // Arrange — no test run IDs at all
        const createDto: CreateComparePresetDto = {
          name: 'Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
        };

        comparePresetRepo.create.mockReturnValue(basePreset);
        comparePresetRepo.save.mockResolvedValue(basePreset);

        // Act
        await service.create(createDto, userId, ['user']);

        // Assert
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });
    });

    describe('findAll - non-admin access filtering', () => {
      it('should include user own presets without org check', async () => {
        // Arrange — non-admin with a preset they own
        const ownPreset = { ...basePreset, createdBy: userId, isGlobal: false, presetType: 'generic' };
        comparePresetRepo.createQueryBuilder.mockReturnValue(
          makeFindAllQueryBuilder([ownPreset]) as ReturnType<typeof makeFindAllQueryBuilder>
        );

        // Act
        const result = await service.findAll(userId, undefined, ['user']);

        // Assert
        expect(result).toHaveLength(1);
        expect(result[0]?.created_by).toBe(userId);
        // query should not be called because the preset belongs to the user
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });

      it('should include global presets when referenced test runs are accessible', async () => {
        // Arrange — global preset owned by someone else, baseline accessible
        const globalPreset: CompareFilterPreset = {
          ...basePreset,
          id: 'global-1',
          createdBy: otherUserId,
          isGlobal: true,
          presetType: 'generic',
          baselineTestRunId: 'run-accessible',
        } as CompareFilterPreset;

        comparePresetRepo.createQueryBuilder.mockReturnValue(
          makeFindAllQueryBuilder([globalPreset]) as ReturnType<typeof makeFindAllQueryBuilder>
        );
        testRunRepo.query.mockResolvedValue([{ '?column?': 1 }]);

        // Act
        const result = await service.findAll(userId, undefined, ['user']);

        // Assert
        expect(result).toHaveLength(1);
        expect(result[0]?.is_global).toBe(true);
        expect(testRunRepo.query).toHaveBeenCalled();
      });

      it('should exclude global presets when baseline test run is inaccessible', async () => {
        // Arrange — global preset, baseline in a different org
        const globalPreset: CompareFilterPreset = {
          ...basePreset,
          id: 'global-2',
          createdBy: otherUserId,
          isGlobal: true,
          presetType: 'generic',
          baselineTestRunId: 'run-no-access',
        } as CompareFilterPreset;

        comparePresetRepo.createQueryBuilder.mockReturnValue(
          makeFindAllQueryBuilder([globalPreset]) as ReturnType<typeof makeFindAllQueryBuilder>
        );
        testRunRepo.query.mockResolvedValue([]); // no access

        // Act
        const result = await service.findAll(userId, undefined, ['user']);

        // Assert
        expect(result).toHaveLength(0);
      });

      it('should exclude global presets when created_for test run is inaccessible', async () => {
        // Arrange — global preset with accessible baseline but inaccessible created_for
        const globalPreset: CompareFilterPreset = {
          ...basePreset,
          id: 'global-3',
          createdBy: otherUserId,
          isGlobal: true,
          presetType: 'generic',
          baselineTestRunId: 'run-accessible',
          createdForTestRunId: 'run-no-access',
        } as CompareFilterPreset;

        comparePresetRepo.createQueryBuilder.mockReturnValue(
          makeFindAllQueryBuilder([globalPreset]) as ReturnType<typeof makeFindAllQueryBuilder>
        );
        // First call (baseline) ok, second call (created_for) denied
        testRunRepo.query
          .mockResolvedValueOnce([{ '?column?': 1 }])
          .mockResolvedValueOnce([]);

        // Act
        const result = await service.findAll(userId, undefined, ['user']);

        // Assert
        expect(result).toHaveLength(0);
      });

      it('should include global preset without any test run references', async () => {
        // Arrange — global preset with no baseline/context run IDs
        const globalPreset: CompareFilterPreset = {
          ...basePreset,
          id: 'global-4',
          createdBy: otherUserId,
          isGlobal: true,
          presetType: 'generic',
          baselineTestRunId: undefined,
          createdForTestRunId: undefined,
        } as CompareFilterPreset;

        comparePresetRepo.createQueryBuilder.mockReturnValue(
          makeFindAllQueryBuilder([globalPreset]) as ReturnType<typeof makeFindAllQueryBuilder>
        );

        // Act
        const result = await service.findAll(userId, undefined, ['user']);

        // Assert
        expect(result).toHaveLength(1);
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });

      it('should apply SUT context filter when currentTestRunId is provided', async () => {
        // Arrange — resolve the current test run to a SUT context
        const contextTestRun = {
          systemUnderTestId: 'sut-uuid',
          testEnvironment: 'production',
          workload: 'load-test',
        };
        testRunRepo.findOne.mockResolvedValueOnce(contextTestRun as TestRunEntity);

        const qb = makeFindAllQueryBuilder([]);
        comparePresetRepo.createQueryBuilder.mockReturnValue(qb as ReturnType<typeof makeFindAllQueryBuilder>);

        // Act
        await service.findAll(userId, 'context-run-id', ['admin']);

        // Assert — the query builder should receive a leftJoin for test_runs
        expect(qb.leftJoin).toHaveBeenCalledWith(
          'test_runs',
          'tr',
          'tr.test_run_id = preset.createdForTestRunId',
        );
      });

      it('should not apply SUT context filter when test run is not found', async () => {
        // Arrange — no matching test run for the given currentTestRunId
        testRunRepo.findOne.mockResolvedValueOnce(null);

        const qb = makeFindAllQueryBuilder([]);
        comparePresetRepo.createQueryBuilder.mockReturnValue(qb as ReturnType<typeof makeFindAllQueryBuilder>);

        // Act
        await service.findAll(userId, 'unknown-run-id', ['admin']);

        // Assert — no SUT context join should be added
        expect(qb.leftJoin).not.toHaveBeenCalled();
      });

      it('should apply metricsSourceId filter when provided', async () => {
        // Arrange
        const qb = makeFindAllQueryBuilder([]);
        comparePresetRepo.createQueryBuilder.mockReturnValue(qb as ReturnType<typeof makeFindAllQueryBuilder>);

        // Act
        await service.findAll(userId, undefined, ['admin'], 'metrics-source-uuid');

        // Assert
        expect(qb.andWhere).toHaveBeenCalledWith(
          'preset.metricsSourceId = :metricsSourceId',
          { metricsSourceId: 'metrics-source-uuid' },
        );
      });
    });

    describe('findOne - non-admin org access check', () => {
      it('should throw NotFoundException when non-admin accesses global preset with inaccessible baseline', async () => {
        // Arrange
        const globalPreset: CompareFilterPreset = {
          ...basePreset,
          createdBy: otherUserId,
          isGlobal: true,
          baselineTestRunId: 'inaccessible-baseline',
        } as CompareFilterPreset;

        comparePresetRepo.createQueryBuilder.mockReturnValue(
          makeQueryBuilder(globalPreset) as ReturnType<typeof makeQueryBuilder>
        );
        testRunRepo.query.mockResolvedValue([]); // no access

        // Act & Assert
        await expect(service.findOne('preset-uuid', userId, ['user'])).rejects.toThrow(
          new NotFoundException('Compare preset with ID preset-uuid not found')
        );
      });

      it('should throw NotFoundException when non-admin accesses global preset with inaccessible created_for run', async () => {
        // Arrange
        const globalPreset: CompareFilterPreset = {
          ...basePreset,
          createdBy: otherUserId,
          isGlobal: true,
          baselineTestRunId: undefined,
          createdForTestRunId: 'inaccessible-context',
        } as CompareFilterPreset;

        comparePresetRepo.createQueryBuilder.mockReturnValue(
          makeQueryBuilder(globalPreset) as ReturnType<typeof makeQueryBuilder>
        );
        testRunRepo.query.mockResolvedValue([]); // no access

        // Act & Assert
        await expect(service.findOne('preset-uuid', userId, ['user'])).rejects.toThrow(
          new NotFoundException('Compare preset with ID preset-uuid not found')
        );
      });

      it('should return global preset when non-admin has full access to all referenced runs', async () => {
        // Arrange
        const globalPreset: CompareFilterPreset = {
          ...basePreset,
          createdBy: otherUserId,
          isGlobal: true,
          baselineTestRunId: 'accessible-baseline',
          createdForTestRunId: 'accessible-context',
        } as CompareFilterPreset;

        comparePresetRepo.createQueryBuilder.mockReturnValue(
          makeQueryBuilder(globalPreset) as ReturnType<typeof makeQueryBuilder>
        );
        testRunRepo.query.mockResolvedValue([{ '?column?': 1 }]);

        // Act
        const result = await service.findOne('preset-uuid', userId, ['user']);

        // Assert
        expect(result.is_global).toBe(true);
        expect(testRunRepo.query).toHaveBeenCalledTimes(2);
      });

      it('should skip org access check for admin users even on global presets owned by others', async () => {
        // Arrange
        const globalPreset: CompareFilterPreset = {
          ...basePreset,
          createdBy: otherUserId,
          isGlobal: true,
          baselineTestRunId: 'some-run',
        } as CompareFilterPreset;

        comparePresetRepo.createQueryBuilder.mockReturnValue(
          makeQueryBuilder(globalPreset) as ReturnType<typeof makeQueryBuilder>
        );

        // Act — admin role bypasses org access check
        const result = await service.findOne('preset-uuid', userId, ['perfana-admin']);

        // Assert
        expect(testRunRepo.query).not.toHaveBeenCalled();
        expect(result.is_global).toBe(true);
      });

      it('should skip org access check for presets owned by the requesting user', async () => {
        // Arrange — preset belongs to the requesting user (non-admin)
        const ownPreset: CompareFilterPreset = {
          ...basePreset,
          createdBy: userId,
          isGlobal: true,
          baselineTestRunId: 'some-run',
        } as CompareFilterPreset;

        comparePresetRepo.createQueryBuilder.mockReturnValue(
          makeQueryBuilder(ownPreset) as ReturnType<typeof makeQueryBuilder>
        );
        testRunRepo.findOne.mockResolvedValue({
          applicationRelease: 'v1.0.0',
          annotations: [],
        } as unknown as TestRunEntity);

        // Act
        const result = await service.findOne('preset-uuid', userId, ['user']);

        // Assert — testRunRepo.query (org check) should not be called
        expect(testRunRepo.query).not.toHaveBeenCalled();
        expect(result.created_by).toBe(userId);
      });
    });

    describe('update - non-admin baseline test run access check', () => {
      it('should deny update when non-admin sets a new baseline test run they cannot access', async () => {
        // Arrange
        comparePresetRepo.createQueryBuilder.mockReturnValue(
          makeQueryBuilder(basePreset) as ReturnType<typeof makeQueryBuilder>
        );
        testRunRepo.query.mockResolvedValue([]); // no access to new baseline

        const updateDto: UpdateComparePresetDto = {
          baseline_test_run_id: 'inaccessible-baseline',
        };

        // Act & Assert
        await expect(service.update('preset-uuid', updateDto, userId, ['user'])).rejects.toThrow(
          /TestRun.*inaccessible-baseline/
        );
        expect(comparePresetRepo.update).not.toHaveBeenCalled();
      });

      it('should allow update when non-admin sets an accessible baseline test run', async () => {
        // Arrange
        comparePresetRepo.createQueryBuilder.mockReturnValue(
          makeQueryBuilder(basePreset) as ReturnType<typeof makeQueryBuilder>
        );
        testRunRepo.query.mockResolvedValue([{ '?column?': 1 }]); // accessible

        const updatedPreset = { ...basePreset, baselineTestRunId: 'accessible-baseline' };
        comparePresetRepo.update.mockResolvedValue({} as ReturnType<typeof comparePresetRepo.update>);
        comparePresetRepo.findOne.mockResolvedValue(updatedPreset);

        const updateDto: UpdateComparePresetDto = {
          baseline_test_run_id: 'accessible-baseline',
        };

        // Act
        const result = await service.update('preset-uuid', updateDto, userId, ['user']);

        // Assert
        expect(testRunRepo.query).toHaveBeenCalled();
        expect(comparePresetRepo.update).toHaveBeenCalled();
        expect(result.baseline_test_run_id).toBe('accessible-baseline');
      });

      it('should skip baseline access check when baseline_test_run_id is undefined in update', async () => {
        // Arrange — update that does not touch baseline_test_run_id
        comparePresetRepo.createQueryBuilder.mockReturnValue(
          makeQueryBuilder(basePreset) as ReturnType<typeof makeQueryBuilder>
        );
        const updatedPreset = { ...basePreset, name: 'New Name' };
        comparePresetRepo.update.mockResolvedValue({} as ReturnType<typeof comparePresetRepo.update>);
        comparePresetRepo.findOne.mockResolvedValue(updatedPreset);

        const updateDto: UpdateComparePresetDto = { name: 'New Name' };

        // Act
        await service.update('preset-uuid', updateDto, userId, ['user']);

        // Assert
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });

      it('should bypass baseline access check for admin users during update', async () => {
        // Arrange
        comparePresetRepo.createQueryBuilder.mockReturnValue(
          makeQueryBuilder(basePreset) as ReturnType<typeof makeQueryBuilder>
        );
        const updatedPreset = { ...basePreset, baselineTestRunId: 'any-run' };
        comparePresetRepo.update.mockResolvedValue({} as ReturnType<typeof comparePresetRepo.update>);
        comparePresetRepo.findOne.mockResolvedValue(updatedPreset);

        const updateDto: UpdateComparePresetDto = {
          baseline_test_run_id: 'any-run',
        };

        // Act — admin bypasses org check
        await service.update('preset-uuid', updateDto, userId, ['perfana-admin']);

        // Assert
        expect(testRunRepo.query).not.toHaveBeenCalled();
      });
    });
  });

  // -----------------------------------------------------------------
  // Phase 5a (PR12) — audit-logging invariants
  // -----------------------------------------------------------------
  describe('audit logging (Phase 5a, PR12)', () => {
    const orgId = 'org-1';
    const auditPreset = {
      ...mockPreset,
      organizationId: orgId,
    } as CompareFilterPreset;

    beforeEach(() => {
      // Default findOne for the access-check uses createQueryBuilder.
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(auditPreset),
      };
      comparePresetRepo.createQueryBuilder.mockReturnValue(qb as any);
    });

    it('logs CREATE with organizationIdOverride from the persisted entity', async () => {
      const createDto: CreateComparePresetDto = {
        name: auditPreset.name,
        description: auditPreset.description,
        preset_type: PresetType.GENERIC,
      };
      comparePresetRepo.create.mockReturnValue(auditPreset);
      comparePresetRepo.save.mockResolvedValue(auditPreset);

      await service.create(createDto, userId, ['admin']);

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      expect(auditService.logCreate).toHaveBeenCalledWith(
        auditPreset,
        { organizationIdOverride: orgId },
      );
    });

    it('logs UPDATE with cloned before-snapshot and organizationIdOverride', async () => {
      const before = { ...auditPreset, name: 'Before' } as CompareFilterPreset;
      const after = { ...auditPreset, name: 'After' } as CompareFilterPreset;
      comparePresetRepo.findOne
        // 1st call inside service.update — before-snapshot
        .mockResolvedValueOnce(before)
        // 2nd call inside service.update — refetch after persist
        .mockResolvedValueOnce(after);
      comparePresetRepo.update.mockResolvedValue({} as ReturnType<typeof comparePresetRepo.update>);

      await service.update('preset-uuid', { name: 'After' } as UpdateComparePresetDto, userId, ['user']);

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [beforeArg, afterArg, opts] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      expect(beforeArg).toEqual(expect.objectContaining({ id: 'preset-uuid', name: 'Before' }));
      expect(afterArg).toEqual(expect.objectContaining({ id: 'preset-uuid', name: 'After' }));
      expect(opts).toEqual({ organizationIdOverride: orgId });
    });

    it('logs DELETE before repository.delete', async () => {
      comparePresetRepo.findOne.mockResolvedValueOnce(auditPreset);
      comparePresetRepo.delete.mockResolvedValue({} as any);

      await service.remove('preset-uuid', userId, ['user']);

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      expect(auditService.logDelete).toHaveBeenCalledWith(
        auditPreset,
        { organizationIdOverride: orgId },
      );
      expect(
        (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(
        (comparePresetRepo.delete as jest.Mock).mock.invocationCallOrder[0],
      );
    });
  });
});
