/**
 * Unit tests for ReportTemplateService
 *
 * Tests for report template management including:
 * - CRUD operations for templates
 * - Section validation and management
 * - Default template management
 * - Filtering and pagination
 * - Template duplication
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ReportTemplateService,
  CreateTemplateOptions,
  UpdateTemplateOptions,
  TemplateQueryOptions,
} from '../services/report-template.service';
import {
  ReportTemplate,
  ReportSectionConfig,
  ReportStyling,
  SystemUnderTest,
} from '../../../entities';
import {
  ResourceNotFoundException,
  DatabaseException,
  ValidationException,
  ResourceExistsException,
} from '../../../common/exceptions/business.exception';
import {
  createMockRepository,
  createMockQueryBuilder,
  MockRepository,
  MockSelectQueryBuilder,
} from '../../../../test/helpers/mock-repository.factory';
import { AuditService } from '../../audit/audit.service';

describe('ReportTemplateService', () => {
  let service: ReportTemplateService;
  let templateRepo: MockRepository<ReportTemplate>;
  let mockQueryBuilder: MockSelectQueryBuilder<ReportTemplate>;
  let auditService: jest.Mocked<AuditService>;

  // ==================== Mock Factories ====================

  const createMockTemplate = (overrides?: Partial<ReportTemplate>): ReportTemplate =>
    ({
      id: '123e4567-e89b-12d3-a456-426614174001',
      name: 'Test Template',
      description: 'A test template',
      created_by: 'test-user',
      system_id: 'system-001',
      test_environment: 'staging',
      workload: 'load-test',
      sections: [
        { type: 'header', order: 0 },
        { type: 'slo', order: 1 },
      ] as ReportSectionConfig[],
      styling: { primaryColor: '#1976d2' } as ReportStyling,
      is_default: false,
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-01-01'),
      ...overrides,
    }) as ReportTemplate;

  const createValidSections = (): ReportSectionConfig[] => [
    { type: 'header', order: 0, config: { title: 'Test' } },
    { type: 'slo', order: 1, comment: 'SLO results' },
  ];

  beforeEach(async () => {
    mockQueryBuilder = createMockQueryBuilder<ReportTemplate>();
    templateRepo = createMockRepository<ReportTemplate>();
    templateRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportTemplateService,
        {
          provide: getRepositoryToken(ReportTemplate),
          useValue: templateRepo,
        },
        {
          provide: getRepositoryToken(SystemUnderTest),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: 'system-mock',
              organization_id: 'org-mock',
              team_id: undefined,
            }),
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

    service = module.get<ReportTemplateService>(ReportTemplateService);
    templateRepo = module.get(getRepositoryToken(ReportTemplate));
    auditService = module.get(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==================== create ====================

  describe('create', () => {
    it('should create a new template successfully', async () => {
      // Arrange
      const options: CreateTemplateOptions = {
        name: 'New Template',
        description: 'A new template',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections: createValidSections(),
        styling: { primaryColor: '#1976d2' },
        isDefault: false,
      };
      const mockTemplate = createMockTemplate({ name: 'New Template' });

      templateRepo.findOne.mockResolvedValue(null); // No existing template
      templateRepo.create.mockReturnValue(mockTemplate);
      templateRepo.save.mockResolvedValue(mockTemplate);

      // Act
      const result = await service.create(options);

      // Assert
      expect(result).toEqual(mockTemplate);
      expect(templateRepo.create).toHaveBeenCalled();
      expect(templateRepo.save).toHaveBeenCalled();
    });

    it('should throw ResourceExistsException for duplicate name in scope', async () => {
      // Arrange
      const options: CreateTemplateOptions = {
        name: 'Existing Template',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections: createValidSections(),
      };
      const existingTemplate = createMockTemplate({ name: 'Existing Template' });
      templateRepo.findOne.mockResolvedValue(existingTemplate);

      // Act & Assert
      await expect(service.create(options)).rejects.toThrow(ResourceExistsException);
    });

    it('should throw ValidationException for invalid sections', async () => {
      // Arrange
      const options: CreateTemplateOptions = {
        name: 'Invalid Template',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections: [{ type: 'invalid_type' as any, order: 0 }],
      };
      templateRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.create(options)).rejects.toThrow(ValidationException);
    });

    it('should throw ValidationException for too many sections', async () => {
      // Arrange
      const sections = Array.from({ length: 51 }, (_, i) => ({
        type: 'slo' as const,
        order: i,
      }));
      const options: CreateTemplateOptions = {
        name: 'Too Many Sections',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections,
      };
      templateRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.create(options)).rejects.toThrow(ValidationException);
    });

    it('should throw ValidationException for duplicate section orders', async () => {
      // Arrange
      const options: CreateTemplateOptions = {
        name: 'Duplicate Orders',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections: [
          { type: 'header', order: 0 },
          { type: 'slo', order: 0 }, // Duplicate order
        ],
      };
      templateRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.create(options)).rejects.toThrow(ValidationException);
    });

    it('should clear default in scope when creating new default template', async () => {
      // Arrange
      const options: CreateTemplateOptions = {
        name: 'New Default',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections: createValidSections(),
        isDefault: true,
      };
      const mockTemplate = createMockTemplate({ is_default: true });

      templateRepo.findOne.mockResolvedValue(null);
      templateRepo.create.mockReturnValue(mockTemplate);
      templateRepo.save.mockResolvedValue(mockTemplate);

      // Act
      await service.create(options);

      // Assert
      expect(templateRepo.createQueryBuilder).toHaveBeenCalled();
    });
  });

  // ==================== findById ====================

  describe('findById', () => {
    it('should find template by ID', async () => {
      // Arrange
      const mockTemplate = createMockTemplate();
      templateRepo.findOne.mockResolvedValue(mockTemplate);

      // Act
      const result = await service.findById(mockTemplate.id);

      // Assert
      expect(result).toEqual(mockTemplate);
      expect(templateRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockTemplate.id },
      });
    });

    it('should throw ResourceNotFoundException when not found', async () => {
      // Arrange
      templateRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findById('non-existent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw DatabaseException on query failure', async () => {
      // Arrange
      templateRepo.findOne.mockRejectedValue(new Error('Connection failed'));

      // Act & Assert
      await expect(service.findById('some-id')).rejects.toThrow(DatabaseException);
    });
  });

  // ==================== findAll ====================

  describe('findAll', () => {
    it('should return paginated templates', async () => {
      // Arrange
      const mockTemplates = [createMockTemplate(), createMockTemplate({ id: 'template-2' })];
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockTemplates, 2]);

      // Act
      const result = await service.findAll();

      // Assert
      expect(result.items).toEqual(mockTemplates);
      expect(result.total).toBe(2);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(50);
    });

    it('should apply query options', async () => {
      // Arrange
      const options: TemplateQueryOptions = {
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        isDefault: true,
        search: 'performance',
        limit: 10,
        offset: 5,
        sortBy: 'name',
        sortOrder: 'asc',
      };

      // Act
      await service.findAll(options);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalled();
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(5);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    });

    it('should return empty list when no templates exist', async () => {
      // Arrange
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      // Act
      const result = await service.findAll();

      // Assert
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ==================== findByScope ====================

  describe('findByScope', () => {
    it('should return templates for scope', async () => {
      // Arrange
      const mockTemplates = [createMockTemplate({ is_default: true }), createMockTemplate({ id: 'template-2' })];
      templateRepo.find.mockResolvedValue(mockTemplates);

      // Act
      const result = await service.findByScope('system-001', 'staging', 'load-test');

      // Assert
      expect(result).toEqual(mockTemplates);
      expect(templateRepo.find).toHaveBeenCalledWith({
        where: {
          system_id: 'system-001',
          test_environment: 'staging',
          workload: 'load-test',
          is_adhoc: false,
        },
        order: { is_default: 'DESC', name: 'ASC' },
      });
    });

    it('should return empty array when no templates in scope', async () => {
      // Arrange
      templateRepo.find.mockResolvedValue([]);

      // Act
      const result = await service.findByScope('system-001', 'staging', 'load-test');

      // Assert
      expect(result).toEqual([]);
    });
  });

  // ==================== findDefault ====================

  describe('findDefault', () => {
    it('should return default template for scope', async () => {
      // Arrange
      const mockTemplate = createMockTemplate({ is_default: true });
      templateRepo.findOne.mockResolvedValue(mockTemplate);

      // Act
      const result = await service.findDefault('system-001', 'staging', 'load-test');

      // Assert
      expect(result).toEqual(mockTemplate);
      expect(templateRepo.findOne).toHaveBeenCalledWith({
        where: {
          system_id: 'system-001',
          test_environment: 'staging',
          workload: 'load-test',
          is_default: true,
          is_adhoc: false,
        },
      });
    });

    it('should return null when no default template', async () => {
      // Arrange
      templateRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.findDefault('system-001', 'staging', 'load-test');

      // Assert
      expect(result).toBeNull();
    });
  });

  // ==================== getSummaries ====================

  describe('getSummaries', () => {
    it('should return template summaries', async () => {
      // Arrange
      const mockTemplates = [
        createMockTemplate({ is_default: true }),
        createMockTemplate({ id: 'template-2', description: undefined }),
      ];
      templateRepo.find.mockResolvedValue(mockTemplates);

      // Act
      const result = await service.getSummaries('system-001', 'staging', 'load-test');

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(mockTemplates[0].id);
      expect(result[0].name).toBe(mockTemplates[0].name);
      expect(result[0].sectionCount).toBe(2);
      expect(result[0].isDefault).toBe(true);
    });
  });

  // ==================== update ====================

  describe('update', () => {
    it('should update template successfully', async () => {
      // Arrange
      const mockTemplate = createMockTemplate();
      const updateOptions: UpdateTemplateOptions = {
        name: 'Updated Template',
        description: 'Updated description',
      };
      templateRepo.findOne
        .mockResolvedValueOnce(mockTemplate)
        .mockResolvedValueOnce(null) // No conflict
        .mockResolvedValueOnce({ ...mockTemplate, ...updateOptions });
      templateRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      const result = await service.update(mockTemplate.id, updateOptions);

      // Assert
      expect(result.name).toBe('Updated Template');
      expect(templateRepo.update).toHaveBeenCalled();
    });

    it('should throw ResourceExistsException for name conflict', async () => {
      // Arrange
      const mockTemplate = createMockTemplate();
      const conflictingTemplate = createMockTemplate({ id: 'other-id', name: 'Conflicting Name' });
      const updateOptions: UpdateTemplateOptions = { name: 'Conflicting Name' };

      templateRepo.findOne
        .mockResolvedValueOnce(mockTemplate)
        .mockResolvedValueOnce(conflictingTemplate);

      // Act & Assert
      await expect(service.update(mockTemplate.id, updateOptions)).rejects.toThrow(
        ResourceExistsException,
      );
    });

    it('should validate sections when updating', async () => {
      // Arrange
      const mockTemplate = createMockTemplate();
      const updateOptions: UpdateTemplateOptions = {
        sections: [{ type: 'invalid_type' as any, order: 0 }],
      };
      templateRepo.findOne.mockResolvedValue(mockTemplate);

      // Act & Assert
      await expect(service.update(mockTemplate.id, updateOptions)).rejects.toThrow(
        ValidationException,
      );
    });

    it('should clear other defaults when setting as default', async () => {
      // Arrange
      const mockTemplate = createMockTemplate({ is_default: false });
      const updateOptions: UpdateTemplateOptions = { isDefault: true };

      templateRepo.findOne
        .mockResolvedValueOnce(mockTemplate)
        .mockResolvedValueOnce({ ...mockTemplate, is_default: true });
      templateRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      await service.update(mockTemplate.id, updateOptions);

      // Assert
      expect(templateRepo.createQueryBuilder).toHaveBeenCalled();
    });
  });

  // ==================== setAsDefault ====================

  describe('setAsDefault', () => {
    it('should set template as default', async () => {
      // Arrange
      const mockTemplate = createMockTemplate({ is_default: false });
      templateRepo.findOne
        .mockResolvedValueOnce(mockTemplate)
        .mockResolvedValueOnce({ ...mockTemplate, is_default: true });
      templateRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      const result = await service.setAsDefault(mockTemplate.id);

      // Assert
      expect(result.is_default).toBe(true);
    });
  });

  // ==================== addSection ====================

  describe('addSection', () => {
    it('should add section to template', async () => {
      // Arrange
      const mockTemplate = createMockTemplate({
        sections: [{ type: 'header', order: 0 }] as ReportSectionConfig[],
      });
      const newSection: ReportSectionConfig = { type: 'slo', order: 1 };
      const updatedTemplate = {
        ...mockTemplate,
        sections: [...mockTemplate.sections, newSection],
      };

      // addSection calls findById once, then update calls findById twice (start and end)
      templateRepo.findOne
        .mockResolvedValueOnce(mockTemplate)   // First findById in addSection
        .mockResolvedValueOnce(mockTemplate)   // Second findById in update (start)
        .mockResolvedValueOnce(updatedTemplate); // Third findById in update (end)
      templateRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      const result = await service.addSection(mockTemplate.id, newSection);

      // Assert
      expect(result.sections).toHaveLength(2);
    });

    it('should add section with specified order', async () => {
      // Arrange
      const mockTemplate = createMockTemplate({
        sections: [{ type: 'header', order: 0 }] as ReportSectionConfig[],
      });
      // Section must have a valid non-negative order (service validates before auto-assign)
      const newSection: ReportSectionConfig = { type: 'slo', order: 5 };
      const updatedTemplate = {
        ...mockTemplate,
        sections: [...mockTemplate.sections, { type: 'slo', order: 5 }],
      };

      templateRepo.findOne
        .mockResolvedValueOnce(mockTemplate)   // First findById in addSection
        .mockResolvedValueOnce(mockTemplate)   // Second findById in update (start)
        .mockResolvedValueOnce(updatedTemplate); // Third findById in update (end)
      templateRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      await service.addSection(mockTemplate.id, newSection);

      // Assert - verify that the update was called with the specified order
      expect(templateRepo.update).toHaveBeenCalledWith(
        mockTemplate.id,
        expect.objectContaining({
          sections: expect.arrayContaining([
            expect.objectContaining({ order: 5 }),
          ]),
        }),
      );
    });
  });

  // ==================== removeSection ====================

  describe('removeSection', () => {
    it('should remove section by order', async () => {
      // Arrange
      const mockTemplate = createMockTemplate({
        sections: [
          { type: 'header', order: 0 },
          { type: 'slo', order: 1 },
          { type: 'apdex', order: 2 },
        ] as ReportSectionConfig[],
      });
      const updatedTemplate = {
        ...mockTemplate,
        sections: [
          { type: 'header', order: 0 },
          { type: 'apdex', order: 1 },
        ],
      };

      // removeSection calls findById once, then update calls findById twice (start and end)
      templateRepo.findOne
        .mockResolvedValueOnce(mockTemplate)    // First findById in removeSection
        .mockResolvedValueOnce(mockTemplate)    // Second findById in update (start)
        .mockResolvedValueOnce(updatedTemplate); // Third findById in update (end)
      templateRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      const result = await service.removeSection(mockTemplate.id, 1);

      // Assert
      expect(result.sections).toHaveLength(2);
    });

    it('should re-order remaining sections', async () => {
      // Arrange
      const mockTemplate = createMockTemplate({
        sections: [
          { type: 'header', order: 0 },
          { type: 'slo', order: 1 },
          { type: 'apdex', order: 2 },
        ] as ReportSectionConfig[],
      });

      templateRepo.findOne.mockResolvedValue(mockTemplate);
      templateRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      await service.removeSection(mockTemplate.id, 0);

      // Assert
      expect(templateRepo.update).toHaveBeenCalledWith(
        mockTemplate.id,
        expect.objectContaining({
          sections: [
            { type: 'slo', order: 0 },
            { type: 'apdex', order: 1 },
          ],
        }),
      );
    });
  });

  // ==================== reorderSections ====================

  describe('reorderSections', () => {
    it('should reorder sections', async () => {
      // Arrange
      const mockTemplate = createMockTemplate({
        sections: [
          { type: 'header', order: 0 },
          { type: 'slo', order: 1 },
          { type: 'apdex', order: 2 },
        ] as ReportSectionConfig[],
      });

      templateRepo.findOne.mockResolvedValue(mockTemplate);
      templateRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      await service.reorderSections(mockTemplate.id, [2, 0, 1]);

      // Assert
      expect(templateRepo.update).toHaveBeenCalled();
    });

    it('should throw ValidationException for invalid section order', async () => {
      // Arrange
      const mockTemplate = createMockTemplate({
        sections: [{ type: 'header', order: 0 }] as ReportSectionConfig[],
      });
      templateRepo.findOne.mockResolvedValue(mockTemplate);

      // Act & Assert
      await expect(
        service.reorderSections(mockTemplate.id, [0, 99]),
      ).rejects.toThrow(ValidationException);
    });
  });

  // ==================== delete ====================

  describe('delete', () => {
    it('should delete template by ID', async () => {
      // Arrange
      const mockTemplate = createMockTemplate({ id: 'template-id' });
      templateRepo.findOne.mockResolvedValue(mockTemplate);
      templateRepo.remove.mockResolvedValue(mockTemplate);

      // Act
      await service.delete('template-id');

      // Assert
      expect(templateRepo.remove).toHaveBeenCalledWith(mockTemplate);
    });

    it('should throw ResourceNotFoundException when not found', async () => {
      // Arrange
      templateRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.delete('non-existent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  // ==================== duplicate ====================

  describe('duplicate', () => {
    it('should duplicate template with new name', async () => {
      // Arrange
      const originalTemplate = createMockTemplate({ name: 'Original' });
      const duplicatedTemplate = createMockTemplate({
        id: 'new-id',
        name: 'Duplicated Template',
        description: 'A test template (duplicated from Original)',
        is_default: false,
      });

      templateRepo.findOne
        .mockResolvedValueOnce(originalTemplate) // findById call
        .mockResolvedValueOnce(null); // create - no conflict
      templateRepo.create.mockReturnValue(duplicatedTemplate);
      templateRepo.save.mockResolvedValue(duplicatedTemplate);

      // Act
      const result = await service.duplicate(
        originalTemplate.id,
        'Duplicated Template',
        'copy-user',
      );

      // Assert
      expect(result.name).toBe('Duplicated Template');
      expect(result.is_default).toBe(false);
    });

    it('should throw ResourceNotFoundException for non-existent template', async () => {
      // Arrange
      templateRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.duplicate('non-existent', 'New Name', 'user'),
      ).rejects.toThrow(ResourceNotFoundException);
    });
  });

  // ==================== Section Validation Edge Cases ====================

  describe('Section Validation', () => {
    it('should reject negative order values', async () => {
      // Arrange
      const options: CreateTemplateOptions = {
        name: 'Negative Order',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections: [{ type: 'header', order: -1 }],
      };
      templateRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.create(options)).rejects.toThrow(ValidationException);
    });

    it('should accept all valid section types', async () => {
      // Arrange
      const validTypes = [
        'header',
        'text_block',
        'slo',
        'apdex',
        'transaction_response_times',
        'regressions',
        'awr',
        'trends',
        'comparisons',
        'graphs',
      ] as const;
      const sections: ReportSectionConfig[] = validTypes.map((type, index) => ({
        type,
        order: index,
      }));
      const options: CreateTemplateOptions = {
        name: 'All Types',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections,
      };
      const mockTemplate = createMockTemplate({ sections });

      templateRepo.findOne.mockResolvedValue(null);
      templateRepo.create.mockReturnValue(mockTemplate);
      templateRepo.save.mockResolvedValue(mockTemplate);

      // Act
      const result = await service.create(options);

      // Assert
      expect(result.sections).toHaveLength(validTypes.length);
    });

    it('should allow comments on data sections', async () => {
      // Arrange
      const options: CreateTemplateOptions = {
        name: 'Comments Template',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections: [
          { type: 'header', order: 0 },
          { type: 'slo', order: 1, comment: 'SLO analysis results' },
          { type: 'regressions', order: 2, comment: 'Performance regressions detected' },
        ],
      };
      const mockTemplate = createMockTemplate({ sections: options.sections });

      templateRepo.findOne.mockResolvedValue(null);
      templateRepo.create.mockReturnValue(mockTemplate);
      templateRepo.save.mockResolvedValue(mockTemplate);

      // Act
      const result = await service.create(options);

      // Assert
      expect(result.sections).toHaveLength(3);
    });

    it('should allow text on header sections', async () => {
      // Arrange
      const options: CreateTemplateOptions = {
        name: 'Header Text Template',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections: [{ type: 'header', order: 0, text: 'Introductory text' }],
      };
      const mockTemplate = createMockTemplate({ sections: options.sections });

      templateRepo.findOne.mockResolvedValue(null);
      templateRepo.create.mockReturnValue(mockTemplate);
      templateRepo.save.mockResolvedValue(mockTemplate);

      // Act
      const result = await service.create(options);

      // Assert
      expect(result.sections).toHaveLength(1);
    });

    it('should reject comments on text_block sections', async () => {
      // Arrange
      const options: CreateTemplateOptions = {
        name: 'Invalid Text Block Comment',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections: [
          { type: 'text_block', order: 0, comment: 'Should not be allowed' },
        ],
      };
      templateRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.create(options)).rejects.toThrow(ValidationException);
    });

    it('should reject non-array sections', async () => {
      // Arrange
      const options: CreateTemplateOptions = {
        name: 'Non-Array Sections',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections: 'not-an-array' as any,
      };
      templateRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.create(options)).rejects.toThrow(ValidationException);
    });
  });

  // ==================== Edge Cases ====================

  describe('Edge Cases', () => {
    it('should handle concurrent template creation', async () => {
      // Arrange
      const options: CreateTemplateOptions = {
        name: 'Concurrent Template',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections: createValidSections(),
      };
      const mockTemplate = createMockTemplate();

      templateRepo.findOne.mockResolvedValue(null);
      templateRepo.create.mockReturnValue(mockTemplate);
      templateRepo.save.mockResolvedValue(mockTemplate);

      // Act
      const results = await Promise.all([
        service.create(options),
        service.create({ ...options, name: 'Concurrent Template 2' }),
      ]);

      // Assert
      expect(results).toHaveLength(2);
    });

    it('should handle empty sections array', async () => {
      // Arrange - empty sections is valid for templates
      const mockTemplate = createMockTemplate({ sections: [] });
      templateRepo.findOne.mockResolvedValue(null);
      templateRepo.create.mockReturnValue(mockTemplate);
      templateRepo.save.mockResolvedValue(mockTemplate);

      const options: CreateTemplateOptions = {
        name: 'Empty Sections',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections: [],
      };

      // Act
      const result = await service.create(options);

      // Assert
      expect(result.sections).toEqual([]);
    });
  });

  // ==================== Audit logging — Phase 5a PR17 ====================

  // ReportTemplate is full-CRUD per the brainstorm. Each user-facing mutation
  // (create / update / delete) emits exactly one audit row; the bulk
  // is_default clear in clearDefaultInScope() is intentionally not audited
  // (covered by `audit-skip:` on that helper).
  describe('Audit logging — Phase 5a PR17', () => {
    it('logs CREATE on create()', async () => {
      const options: CreateTemplateOptions = {
        name: 'Audited Template',
        createdBy: 'test-user',
        systemId: 'system-001',
        testEnvironment: 'staging',
        workload: 'load-test',
        sections: createValidSections(),
      };
      const mockTemplate = createMockTemplate({ name: 'Audited Template' });
      templateRepo.findOne.mockResolvedValue(null);
      templateRepo.create.mockReturnValue(mockTemplate);
      templateRepo.save.mockResolvedValue(mockTemplate);

      await service.create(options);

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      const [ref] = (auditService.logCreate as jest.Mock).mock.calls[0];
      expect(ref).toBe(mockTemplate);
    });

    it('logs UPDATE on update() with the pre-mutation snapshot as `before`', async () => {
      const before = createMockTemplate({ name: 'Old Name', description: 'Old desc' });
      const after = createMockTemplate({ name: 'Old Name', description: 'New desc' });
      templateRepo.findOne
        .mockResolvedValueOnce(before) // findById in update
        .mockResolvedValueOnce(after); // findById after templateRepo.update
      templateRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.update(before.id, { description: 'New desc' });

      expect(auditService.logUpdate).toHaveBeenCalledTimes(1);
      const [b, a] = (auditService.logUpdate as jest.Mock).mock.calls[0];
      // The cloned `before` preserves the description and prototype.
      expect(b).toMatchObject({ id: before.id, description: 'Old desc' });
      expect(a).toBe(after);
    });

    it('logs DELETE before remove() so a remove failure still leaves a row', async () => {
      const mockTemplate = createMockTemplate({ id: 'tpl-1' });
      templateRepo.findOne.mockResolvedValue(mockTemplate);
      const callOrder: string[] = [];
      (auditService.logDelete as jest.Mock).mockImplementation(() => {
        callOrder.push('logDelete');
      });
      templateRepo.remove.mockImplementation(async () => {
        callOrder.push('remove');
        return mockTemplate;
      });

      await service.delete('tpl-1');

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      const [ref] = (auditService.logDelete as jest.Mock).mock.calls[0];
      expect(ref).toBe(mockTemplate);
      expect(callOrder).toEqual(['logDelete', 'remove']);
    });
  });

  // ==================== validateSections ====================
  // Moved from services/report-template.service.spec.ts (Task 3 review, Finding 1):
  // validateSections is pure and reads no injected dependency, so calling it
  // directly off the service instance built above avoids constructing a second stub.

  describe('validateSections', () => {
    const validate = (sections: ReportSectionConfig[]) =>
      (service as unknown as { validateSections(s: ReportSectionConfig[]): void }).validateSections(sections);

    const section = (over: Partial<ReportSectionConfig>): ReportSectionConfig => ({
      type: 'slo',
      order: 0,
      ...over,
    });

    it('accepts text on a header section', () => {
      expect(() => validate([section({ type: 'header', text: 'intro' })])).not.toThrow();
    });

    it('accepts a top_10_lists section', () => {
      expect(() => validate([section({ type: 'top_10_lists' })])).not.toThrow();
    });

    it('rejects text on a text_block section', () => {
      expect(() => validate([section({ type: 'text_block', text: 'nope' })])).toThrow(
        /not allowed on 'text_block'/,
      );
    });

    it('rejects a legacy comment on a text_block section', () => {
      expect(() => validate([section({ type: 'text_block', comment: 'nope' })])).toThrow(
        /not allowed on 'text_block'/,
      );
    });

    it('still rejects an unknown section type', () => {
      expect(() => validate([section({ type: 'nonsense' as never })])).toThrow(/Invalid section type/);
    });

    it('still rejects duplicate orders', () => {
      expect(() => validate([section({ order: 0 }), section({ order: 0 })])).toThrow(
        /Duplicate section order/,
      );
    });
  });
});
