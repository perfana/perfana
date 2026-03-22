/**
 * ComparePresetsController Test Suite
 *
 * Comprehensive tests for compare preset controller including:
 * - CRUD operations (Create, Read, Update, Delete)
 * - User ownership validation
 * - Query parameter filtering (testRunId)
 * - Request/Response DTO mapping
 * - Global preset access
 * - Error handling (403, 404)
 * - Edge cases and security scenarios
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ComparePresetsController } from './compare-presets.controller';
import { ComparePresetsService } from './compare-presets.service';
import { CreateComparePresetDto, PresetType } from './dto/create-compare-preset.dto';
import { UpdateComparePresetDto } from './dto/update-compare-preset.dto';
import { ComparePresetResponseDto } from './dto/compare-preset-response.dto';
import { UserContext } from '../../common/decorators/user-context.decorator';

describe('ComparePresetsController', () => {
  let controller: ComparePresetsController;
  let service: jest.Mocked<ComparePresetsService>;

  const mockUserContext: UserContext = {
    userId: 'user-123',
    roles: ['user'],
    organizations: ['org-123'],
    teams: ['team-456'],
    organizationId: 'org-123',
    teamId: 'team-456',
  };

  // Mock data fixtures
  const mockPresetResponse: ComparePresetResponseDto = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Response Time Analysis',
    description: 'Shows percentiles for response time metrics',
    preset_type: PresetType.GENERIC,
    series_search_text: 'response',
    show_percentiles: true,
    application_dashboard_id: '660e8400-e29b-41d4-a716-446655440000',
    source: 'grafana',
    panel_id: 5,
    panel_title: 'Response Time',
    baseline_test_run_id: 'MyApp-prod-loadTest-00042',
    baseline_application_release: 'v2.1.0',
    baseline_annotations: ['Performance fix'],
    dashboard_label: 'Production Dashboard',
    is_global: false,
    created_by: 'user-123',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
  };

  const mockGlobalPreset: ComparePresetResponseDto = {
    ...mockPresetResponse,
    id: '770e8400-e29b-41d4-a716-446655440000',
    name: 'Global Preset',
    is_global: true,
    created_by: 'admin-user',
  };

  const mockSpecificPreset: ComparePresetResponseDto = {
    ...mockPresetResponse,
    id: '880e8400-e29b-41d4-a716-446655440000',
    name: 'Specific Test Run Preset',
    preset_type: PresetType.SPECIFIC,
  };

  const mockServiceFactory = () => ({
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ComparePresetsController],
      providers: [
        {
          provide: ComparePresetsService,
          useValue: mockServiceFactory(),
        },
      ],
    }).compile();

    controller = module.get<ComparePresetsController>(ComparePresetsController);
    service = module.get(ComparePresetsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Happy Path - Create Preset', () => {
    describe('create', () => {
      it('should create a new generic compare preset', async () => {
        // Arrange
        const createDto: CreateComparePresetDto = {
          name: 'Response Time Analysis',
          description: 'Shows percentiles for response time metrics',
          preset_type: PresetType.GENERIC,
          series_search_text: 'response',
          show_percentiles: true,
          application_dashboard_id: '660e8400-e29b-41d4-a716-446655440000',
          source: 'grafana',
          dashboard_label: 'Production Dashboard',
          panel_id: 5,
          panel_title: 'Response Time',
          baseline_test_run_id: 'MyApp-prod-loadTest-00042',
          is_global: false,
        };
        service.create.mockResolvedValue(mockPresetResponse);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result).toEqual(mockPresetResponse);
        expect(service.create).toHaveBeenCalledWith(createDto, 'user-123', ['user']);
        expect(service.create).toHaveBeenCalledTimes(1);
      });

      it('should create a new specific compare preset with created_for_test_run_id', async () => {
        // Arrange
        const createDto: CreateComparePresetDto = {
          name: 'Specific Test Run Preset',
          preset_type: PresetType.SPECIFIC,
          series_search_text: 'latency',
          show_percentiles: true,
          is_global: false,
          created_for_test_run_id: 'MyApp-prod-loadTest-00042',
        };
        const userContext: UserContext = { ...mockUserContext, userId: 'user-456' };
        service.create.mockResolvedValue(mockSpecificPreset);

        // Act
        const result = await controller.create(createDto, userContext);

        // Assert
        expect(result).toEqual(mockSpecificPreset);
        expect(service.create).toHaveBeenCalledWith(createDto, 'user-456', ['user']);
      });

      it('should create a global preset', async () => {
        // Arrange
        const createDto: CreateComparePresetDto = {
          name: 'Global Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: true,
          is_global: true,
        };
        const adminContext: UserContext = { ...mockUserContext, userId: 'admin-user' };
        service.create.mockResolvedValue(mockGlobalPreset);

        // Act
        const result = await controller.create(createDto, adminContext);

        // Assert
        expect(result.is_global).toBe(true);
        expect(service.create).toHaveBeenCalledWith(createDto, 'admin-user', ['user']);
      });

      it('should create preset with minimal required fields', async () => {
        // Arrange
        const createDto: CreateComparePresetDto = {
          name: 'Minimal Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
        };
        const minimalResponse: ComparePresetResponseDto = {
          id: 'new-id',
          name: 'Minimal Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
          created_by: 'user-123',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        service.create.mockResolvedValue(minimalResponse);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result).toEqual(minimalResponse);
        expect(result.name).toBe('Minimal Preset');
      });
    });
  });

  describe('Happy Path - List Presets', () => {
    describe('findAll', () => {
      it('should return all accessible presets without testRunId filter', async () => {
        // Arrange
        const mockPresets = [mockPresetResponse, mockGlobalPreset];
        service.findAll.mockResolvedValue(mockPresets);

        // Act
        const result = await controller.findAll(mockUserContext);

        // Assert
        expect(result).toEqual(mockPresets);
        expect(service.findAll).toHaveBeenCalledWith('user-123', undefined, ['user'], undefined);
        expect(result.length).toBe(2);
      });

      it('should return filtered presets with testRunId parameter', async () => {
        // Arrange
        const testRunId = 'MyApp-prod-loadTest-00042';
        const mockPresets = [mockPresetResponse, mockSpecificPreset];
        service.findAll.mockResolvedValue(mockPresets);

        // Act
        const result = await controller.findAll(mockUserContext, testRunId);

        // Assert
        expect(result).toEqual(mockPresets);
        expect(service.findAll).toHaveBeenCalledWith('user-123', testRunId, ['user'], undefined);
      });

      it('should return both user presets and global presets', async () => {
        // Arrange
        const mockPresets = [
          mockPresetResponse, // User's own preset
          mockGlobalPreset, // Global preset by another user
        ];
        service.findAll.mockResolvedValue(mockPresets);

        // Act
        const result = await controller.findAll(mockUserContext);

        // Assert
        expect(result.length).toBe(2);
        expect(result[0]?.created_by).toBe('user-123');
        expect(result[1]?.is_global).toBe(true);
        expect(result[1]?.created_by).toBe('admin-user');
      });

      it('should return empty array when no presets exist', async () => {
        // Arrange
        service.findAll.mockResolvedValue([]);

        // Act
        const result = await controller.findAll(mockUserContext);

        // Assert
        expect(result).toEqual([]);
        expect(result.length).toBe(0);
      });

      it('should filter specific presets by testRunId', async () => {
        // Arrange
        const testRunId = 'MyApp-prod-loadTest-00042';
        const filteredPresets = [mockSpecificPreset]; // Only specific presets for this test run
        service.findAll.mockResolvedValue(filteredPresets);

        // Act
        const result = await controller.findAll(mockUserContext, testRunId);

        // Assert
        expect(result.length).toBe(1);
        expect(result[0]?.preset_type).toBe(PresetType.SPECIFIC);
      });

      it('should pass roles to service for access control', async () => {
        // Arrange
        const adminContext: UserContext = {
          ...mockUserContext,
          roles: ['admin', 'user'],
        };
        service.findAll.mockResolvedValue([mockPresetResponse]);

        // Act
        await controller.findAll(adminContext);

        // Assert
        expect(service.findAll).toHaveBeenCalledWith('user-123', undefined, ['admin', 'user'], undefined);
      });
    });
  });

  describe('Happy Path - Get Single Preset', () => {
    describe('findOne', () => {
      it('should return a specific preset by ID', async () => {
        // Arrange
        const presetId = mockPresetResponse.id;
        service.findOne.mockResolvedValue(mockPresetResponse);

        // Act
        const result = await controller.findOne(presetId, mockUserContext);

        // Assert
        expect(result).toEqual(mockPresetResponse);
        expect(service.findOne).toHaveBeenCalledWith(presetId, 'user-123', ['user']);
      });

      it('should allow user to access their own preset', async () => {
        // Arrange
        const presetId = mockPresetResponse.id;
        service.findOne.mockResolvedValue(mockPresetResponse);

        // Act
        const result = await controller.findOne(presetId, mockUserContext);

        // Assert
        expect(result.created_by).toBe('user-123');
        expect(service.findOne).toHaveBeenCalledWith(presetId, 'user-123', ['user']);
      });

      it('should allow user to access global preset created by another user', async () => {
        // Arrange
        const presetId = mockGlobalPreset.id;
        service.findOne.mockResolvedValue(mockGlobalPreset);

        // Act
        const result = await controller.findOne(presetId, mockUserContext);

        // Assert
        expect(result.is_global).toBe(true);
        expect(result.created_by).toBe('admin-user');
        expect(result.created_by).not.toBe('user-123'); // Different user
      });
    });
  });

  describe('Happy Path - Update Preset', () => {
    describe('update', () => {
      it('should update own preset successfully', async () => {
        // Arrange
        const presetId = mockPresetResponse.id;
        const updateDto: UpdateComparePresetDto = {
          name: 'Updated Response Time Analysis',
          description: 'Updated description',
          show_percentiles: false,
        };
        const updatedPreset: ComparePresetResponseDto = {
          ...mockPresetResponse,
          name: 'Updated Response Time Analysis',
          description: 'Updated description',
          show_percentiles: false,
          updated_at: '2024-01-16T10:00:00Z',
        };
        service.update.mockResolvedValue(updatedPreset);

        // Act
        const result = await controller.update(presetId, updateDto, mockUserContext);

        // Assert
        expect(result).toEqual(updatedPreset);
        expect(result.name).toBe('Updated Response Time Analysis');
        expect(result.show_percentiles).toBe(false);
        expect(service.update).toHaveBeenCalledWith(presetId, updateDto, 'user-123', ['user']);
      });

      it('should update preset with partial fields', async () => {
        // Arrange
        const presetId = mockPresetResponse.id;
        const updateDto: UpdateComparePresetDto = {
          name: 'New Name Only',
        };
        const updatedPreset = { ...mockPresetResponse, name: 'New Name Only' };
        service.update.mockResolvedValue(updatedPreset);

        // Act
        const result = await controller.update(presetId, updateDto, mockUserContext);

        // Assert
        expect(result.name).toBe('New Name Only');
        expect(result.description).toBe(mockPresetResponse.description); // Unchanged
        expect(service.update).toHaveBeenCalledWith(presetId, updateDto, 'user-123', ['user']);
      });

      it('should update series_search_text', async () => {
        // Arrange
        const presetId = mockPresetResponse.id;
        const updateDto: UpdateComparePresetDto = {
          series_search_text: 'latency',
        };
        const updatedPreset = { ...mockPresetResponse, series_search_text: 'latency' };
        service.update.mockResolvedValue(updatedPreset);

        // Act
        const result = await controller.update(presetId, updateDto, mockUserContext);

        // Assert
        expect(result.series_search_text).toBe('latency');
      });

      it('should update baseline_test_run_id', async () => {
        // Arrange
        const presetId = mockPresetResponse.id;
        const updateDto: UpdateComparePresetDto = {
          baseline_test_run_id: 'MyApp-prod-loadTest-00050',
        };
        const updatedPreset = {
          ...mockPresetResponse,
          baseline_test_run_id: 'MyApp-prod-loadTest-00050',
        };
        service.update.mockResolvedValue(updatedPreset);

        // Act
        const result = await controller.update(presetId, updateDto, mockUserContext);

        // Assert
        expect(result.baseline_test_run_id).toBe('MyApp-prod-loadTest-00050');
      });

      it('should update is_global flag', async () => {
        // Arrange
        const presetId = mockPresetResponse.id;
        const updateDto: UpdateComparePresetDto = {
          is_global: true,
        };
        const updatedPreset = { ...mockPresetResponse, is_global: true };
        service.update.mockResolvedValue(updatedPreset);

        // Act
        const result = await controller.update(presetId, updateDto, mockUserContext);

        // Assert
        expect(result.is_global).toBe(true);
      });
    });
  });

  describe('Happy Path - Delete Preset', () => {
    describe('remove', () => {
      it('should delete own preset successfully', async () => {
        // Arrange
        const presetId = mockPresetResponse.id;
        service.remove.mockResolvedValue(undefined);

        // Act
        await controller.remove(presetId, mockUserContext);

        // Assert
        expect(service.remove).toHaveBeenCalledWith(presetId, 'user-123', ['user']);
        expect(service.remove).toHaveBeenCalledTimes(1);
      });

      it('should return void on successful deletion', async () => {
        // Arrange
        const presetId = mockPresetResponse.id;
        service.remove.mockResolvedValue(undefined);

        // Act
        const result = await controller.remove(presetId, mockUserContext);

        // Assert
        expect(result).toBeUndefined();
      });
    });
  });

  describe('Error Scenarios', () => {
    describe('create - Error Handling', () => {
      it('should propagate service errors during creation', async () => {
        // Arrange
        const createDto: CreateComparePresetDto = {
          name: 'Test Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: false,
          is_global: false,
        };
        const error = new Error('Database connection failed');
        service.create.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.create(createDto, mockUserContext)).rejects.toThrow(
          'Database connection failed',
        );
      });
    });

    describe('findAll - Error Handling', () => {
      it('should propagate service errors during findAll', async () => {
        // Arrange
        const error = new Error('Failed to fetch presets');
        service.findAll.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.findAll(mockUserContext)).rejects.toThrow(
          'Failed to fetch presets',
        );
      });
    });

    describe('findOne - Error Handling', () => {
      it('should propagate NotFoundException from service', async () => {
        // Arrange
        const presetId = 'non-existent-id';
        const error = new Error('Compare preset with ID non-existent-id not found');
        error.name = 'NotFoundException';
        service.findOne.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.findOne(presetId, mockUserContext)).rejects.toThrow(
          'Compare preset with ID non-existent-id not found',
        );
      });
    });

    describe('update - Error Handling', () => {
      it('should propagate ForbiddenException when user tries to update another user preset', async () => {
        // Arrange
        const presetId = mockPresetResponse.id;
        const updateDto: UpdateComparePresetDto = { name: 'Hacked Name' };
        const differentUserContext: UserContext = { ...mockUserContext, userId: 'different-user' };
        const error = new Error('You can only update your own presets');
        error.name = 'ForbiddenException';
        service.update.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.update(presetId, updateDto, differentUserContext)).rejects.toThrow(
          'You can only update your own presets',
        );
      });

      it('should propagate NotFoundException when preset does not exist', async () => {
        // Arrange
        const presetId = 'non-existent-id';
        const updateDto: UpdateComparePresetDto = { name: 'New Name' };
        const error = new Error('Compare preset with ID non-existent-id not found');
        error.name = 'NotFoundException';
        service.update.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.update(presetId, updateDto, mockUserContext)).rejects.toThrow(
          'Compare preset with ID non-existent-id not found',
        );
      });
    });

    describe('remove - Error Handling', () => {
      it('should propagate ForbiddenException when user tries to delete another user preset', async () => {
        // Arrange
        const presetId = mockPresetResponse.id;
        const differentUserContext: UserContext = { ...mockUserContext, userId: 'different-user' };
        const error = new Error('You can only delete your own presets');
        error.name = 'ForbiddenException';
        service.remove.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.remove(presetId, differentUserContext)).rejects.toThrow(
          'You can only delete your own presets',
        );
      });

      it('should propagate NotFoundException when preset does not exist', async () => {
        // Arrange
        const presetId = 'non-existent-id';
        const error = new Error('Compare preset with ID non-existent-id not found');
        error.name = 'NotFoundException';
        service.remove.mockRejectedValue(error);

        // Act & Assert
        await expect(controller.remove(presetId, mockUserContext)).rejects.toThrow(
          'Compare preset with ID non-existent-id not found',
        );
      });
    });
  });

  describe('Edge Cases and Security', () => {
    describe('Global Preset Access', () => {
      it('should return global presets even if created by different user', async () => {
        // Arrange
        service.findAll.mockResolvedValue([mockGlobalPreset]);

        // Act
        const result = await controller.findAll(mockUserContext);

        // Assert
        expect(result).toHaveLength(1);
        expect(result[0]?.is_global).toBe(true);
        expect(result[0]?.created_by).not.toBe('user-123');
      });

      it('should allow reading global preset by any user', async () => {
        // Arrange
        const presetId = mockGlobalPreset.id;
        const differentUserContext: UserContext = { ...mockUserContext, userId: 'different-user' };
        service.findOne.mockResolvedValue(mockGlobalPreset);

        // Act
        const result = await controller.findOne(presetId, differentUserContext);

        // Assert
        expect(result.is_global).toBe(true);
        expect(result.created_by).not.toBe('different-user');
      });
    });

    describe('Test Run Filtering', () => {
      it('should handle empty testRunId parameter', async () => {
        // Arrange
        service.findAll.mockResolvedValue([mockPresetResponse]);

        // Act
        await controller.findAll(mockUserContext, '');

        // Assert
        expect(service.findAll).toHaveBeenCalledWith('user-123', '', ['user'], undefined);
      });

      it('should handle special characters in testRunId', async () => {
        // Arrange
        const specialTestRunId = 'MyApp-$#@-loadTest-001';
        service.findAll.mockResolvedValue([]);

        // Act
        await controller.findAll(mockUserContext, specialTestRunId);

        // Assert
        expect(service.findAll).toHaveBeenCalledWith('user-123', specialTestRunId, ['user'], undefined);
      });

      it('should handle very long testRunId', async () => {
        // Arrange
        const longTestRunId = 'A'.repeat(500);
        service.findAll.mockResolvedValue([]);

        // Act
        await controller.findAll(mockUserContext, longTestRunId);

        // Assert
        expect(service.findAll).toHaveBeenCalledWith('user-123', longTestRunId, ['user'], undefined);
      });
    });


    describe('Concurrent Operations', () => {
      it('should handle concurrent findAll requests', async () => {
        // Arrange
        service.findAll.mockResolvedValue([mockPresetResponse]);

        // Act
        const results = await Promise.all([
          controller.findAll(mockUserContext),
          controller.findAll(mockUserContext),
          controller.findAll(mockUserContext),
        ]);

        // Assert
        expect(results).toHaveLength(3);
        results.forEach((result) => expect(result).toEqual([mockPresetResponse]));
        expect(service.findAll).toHaveBeenCalledTimes(3);
      });
    });

    describe('Preset Type Variations', () => {
      it('should handle generic preset type', async () => {
        // Arrange
        const createDto: CreateComparePresetDto = {
          name: 'Generic Preset',
          preset_type: PresetType.GENERIC,
          show_percentiles: true,
          is_global: false,
        };
        const response = { ...mockPresetResponse, preset_type: PresetType.GENERIC };
        service.create.mockResolvedValue(response);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result.preset_type).toBe(PresetType.GENERIC);
      });

      it('should handle specific preset type', async () => {
        // Arrange
        const createDto: CreateComparePresetDto = {
          name: 'Specific Preset',
          preset_type: PresetType.SPECIFIC,
          show_percentiles: false,
          is_global: false,
          created_for_test_run_id: 'test-run-123',
        };
        const response = { ...mockSpecificPreset };
        service.create.mockResolvedValue(response);

        // Act
        const result = await controller.create(createDto, mockUserContext);

        // Assert
        expect(result.preset_type).toBe(PresetType.SPECIFIC);
      });
    });

    describe('User Context Variations', () => {
      it('should pass different user IDs correctly', async () => {
        // Arrange
        const otherUserContext: UserContext = {
          userId: 'other-user-456',
          roles: ['admin'],
          organizations: ['org-789'],
          teams: ['team-abc'],
          organizationId: 'org-789',
          teamId: 'team-abc',
        };
        service.findAll.mockResolvedValue([]);

        // Act
        await controller.findAll(otherUserContext);

        // Assert
        expect(service.findAll).toHaveBeenCalledWith('other-user-456', undefined, ['admin'], undefined);
      });

      it('should handle user context with multiple roles', async () => {
        // Arrange
        const multiRoleContext: UserContext = {
          userId: 'user-123',
          roles: ['user', 'admin', 'super-admin'],
          organizations: ['org-123'],
          teams: ['team-456'],
          organizationId: 'org-123',
          teamId: 'team-456',
        };
        service.findAll.mockResolvedValue([]);

        // Act
        await controller.findAll(multiRoleContext);

        // Assert
        expect(service.findAll).toHaveBeenCalledWith('user-123', undefined, ['user', 'admin', 'super-admin'], undefined);
      });

      it('should handle user context with empty roles', async () => {
        // Arrange
        const noRolesContext: UserContext = {
          userId: 'user-123',
          roles: [],
          organizations: ['org-123'],
          teams: [],
          organizationId: 'org-123',
          teamId: undefined,
        };
        service.findAll.mockResolvedValue([]);

        // Act
        await controller.findAll(noRolesContext);

        // Assert
        expect(service.findAll).toHaveBeenCalledWith('user-123', undefined, [], undefined);
      });
    });
  });
});
