/**
 * Unit tests for ReportGenerationService
 *
 * Tests for report generation including:
 * - Creating reports from templates
 * - Creating ad-hoc reports
 * - Status management and transitions
 * - HTML generation and storage
 * - Report queries and pagination
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ReportGenerationService,
  CreateReportFromTemplateOptions,
  CreateAdHocReportOptions,
  ListReportsQueryOptions,
} from '../services/report-generation.service';
import {
  GeneratedReport,
  ReportTemplate,
  TestRun,
  ReportStatus,
  ReportSectionConfig,
  SystemUnderTest,
} from '../../../entities';
import {
  ResourceNotFoundException,
  DatabaseException,
  ValidationException,
  InvalidStateException,
} from '../../../common/exceptions/business.exception';
import { ReportGenerationValidatorService } from '../services/report-generation-validator.service';
import { ReportDataFetcherService } from '../services/report-data-fetcher.service';
import { ReportUtilsService } from '../services/report-utils.service';
import { ReportHtmlCompilerService } from '../services/report-html-compiler.service';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AuditService } from '../../audit/audit.service';

describe('ReportGenerationService', () => {
  let service: ReportGenerationService;
  let reportRepo: jest.Mocked<Repository<GeneratedReport>>;
  let templateRepo: jest.Mocked<Repository<ReportTemplate>>;
  let testRunRepo: jest.Mocked<Repository<TestRun>>;
  let auditService: jest.Mocked<AuditService>;

  // ==================== Mock Factories ====================

  const createMockTestRun = (overrides?: Partial<TestRun>): TestRun =>
    ({
      id: '123e4567-e89b-12d3-a456-426614174001',
      testRunId: 'test-run-001',
      testEnvironment: 'staging',
      workload: 'load-test',
      systemUnderTestId: 'system-001',
      startTime: new Date('2025-01-01T10:00:00Z'),
      endTime: new Date('2025-01-01T11:00:00Z'),
      ...overrides,
    }) as TestRun;

  const createMockTemplate = (overrides?: Partial<ReportTemplate>): ReportTemplate =>
    ({
      id: '123e4567-e89b-12d3-a456-426614174002',
      name: 'Test Template',
      description: 'A test template',
      created_by: 'test-user',
      system_id: 'system-001',
      test_environment: 'staging',
      workload: 'load-test',
      sections: [
        { type: 'header', order: 0, config: { title: 'Test Report' } },
        { type: 'slo', order: 1 },
      ] as ReportSectionConfig[],
      styling: { primaryColor: '#1976d2' },
      is_default: false,
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-01-01'),
      ...overrides,
    }) as ReportTemplate;

  const createMockReport = (overrides?: Partial<GeneratedReport>): GeneratedReport =>
    ({
      id: '123e4567-e89b-12d3-a456-426614174003',
      test_run_id: '123e4567-e89b-12d3-a456-426614174001',
      template_id: '123e4567-e89b-12d3-a456-426614174002',
      name: 'Test Report',
      generated_by: 'test-user',
      status: 'pending' as ReportStatus,
      share_id: 'share-uuid-001',
      share_enabled: false,
      share_view_count: 0,
      retry_count: 0,
      max_retries: 3,
      download_count: 0,
      mime_type: 'application/pdf',
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-01-01'),
      ...overrides,
    }) as GeneratedReport;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportGenerationService,
        {
          provide: getRepositoryToken(GeneratedReport),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            findAndCount: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            remove: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              leftJoinAndSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
            }),
          },
        },
        {
          provide: getRepositoryToken(ReportTemplate),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TestRun),
          useValue: {
            findOne: jest.fn(),
            query: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnThis(),
              leftJoinAndSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getOne: jest.fn().mockResolvedValue(null),
            }),
          },
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
          provide: AuthorizationService,
          useValue: {
            isGlobalAdmin: jest.fn().mockReturnValue(true),
            getAccessibleOrganizations: jest.fn().mockResolvedValue(['org-1']),
            canAccessResource: jest.fn().mockResolvedValue({ allowed: true, reason: 'mocked' }),
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
        {
          provide: ReportGenerationValidatorService,
          useValue: {
            validateStatusTransition: jest.fn(),
          },
        },
        {
          provide: ReportDataFetcherService,
          useValue: {
            getRampUpCutoffTime: jest.fn(),
            getScenarioDataFromDatabase: jest.fn(),
            getApdexDataFromDatabase: jest.fn(),
            getThroughputStatsForReport: jest.fn(),
            getVirtualUserStatsForReport: jest.fn(),
            getMockScenarioData: jest.fn(),
          },
        },
        {
          provide: ReportUtilsService,
          useValue: {
            escapeHtml: jest.fn((text) => text),
            formatDuration: jest.fn((seconds) => `${seconds}s`),
            getApdexRating: jest.fn((score) => 'Good'),
            getSectionTitle: jest.fn((type) => type),
            getDefaultStyling: jest.fn(() => ({ primaryColor: '#1976d2', secondaryColor: '#9c27b0', fontFamily: 'sans-serif' })),
          },
        },
        {
          provide: ReportHtmlCompilerService,
          useValue: {
            renderSections: jest.fn().mockResolvedValue('<div>Sections HTML</div>'),
            compileHtml: jest.fn().mockReturnValue('<!DOCTYPE html><html>...</html>'),
            compilePreviewHtml: jest.fn().mockReturnValue('<!DOCTYPE html><html>Preview</html>'),
          },
        },
      ],
    }).compile();

    service = module.get<ReportGenerationService>(ReportGenerationService);
    reportRepo = module.get(getRepositoryToken(GeneratedReport));
    templateRepo = module.get(getRepositoryToken(ReportTemplate));
    testRunRepo = module.get(getRepositoryToken(TestRun));
    auditService = module.get(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==================== createFromTemplate ====================

  describe('createFromTemplate', () => {
    it('should create a report from a template successfully', async () => {
      // Arrange
      const options: CreateReportFromTemplateOptions = {
        testRunId: '123e4567-e89b-12d3-a456-426614174001',
        templateId: '123e4567-e89b-12d3-a456-426614174002',
        generatedBy: 'test-user',
        roles: ['admin'],
      };
      const mockTestRun = createMockTestRun();
      const mockTemplate = createMockTemplate();
      const mockReport = createMockReport();

      testRunRepo.findOne.mockResolvedValue(mockTestRun);
      templateRepo.findOne.mockResolvedValue(mockTemplate);
      reportRepo.create.mockReturnValue(mockReport);
      reportRepo.save.mockResolvedValue(mockReport);

      // Act
      const result = await service.createFromTemplate(options);

      // Assert
      expect(result).toEqual(mockReport);
      expect(testRunRepo.findOne).toHaveBeenCalledWith({
        where: { id: options.testRunId },
        relations: ['systemUnderTest', 'systemUnderTest.team'],
      });
      expect(templateRepo.findOne).toHaveBeenCalledWith({
        where: { id: options.templateId },
      });
      expect(reportRepo.create).toHaveBeenCalled();
      expect(reportRepo.save).toHaveBeenCalled();
    });

    it('should use provided name when specified', async () => {
      // Arrange
      const options: CreateReportFromTemplateOptions = {
        testRunId: '123e4567-e89b-12d3-a456-426614174001',
        templateId: '123e4567-e89b-12d3-a456-426614174002',
        name: 'Custom Report Name',
        generatedBy: 'test-user',
        roles: ['admin'],
      };
      const mockTestRun = createMockTestRun();
      const mockTemplate = createMockTemplate();
      const mockReport = createMockReport({ name: 'Custom Report Name' });

      testRunRepo.findOne.mockResolvedValue(mockTestRun);
      templateRepo.findOne.mockResolvedValue(mockTemplate);
      reportRepo.create.mockReturnValue(mockReport);
      reportRepo.save.mockResolvedValue(mockReport);

      // Act
      const result = await service.createFromTemplate(options);

      // Assert
      expect(result.name).toBe('Custom Report Name');
    });

    it('should throw ResourceNotFoundException when test run not found', async () => {
      // Arrange
      const options: CreateReportFromTemplateOptions = {
        testRunId: 'non-existent',
        templateId: '123e4567-e89b-12d3-a456-426614174002',
        generatedBy: 'test-user',
        roles: ['admin'],
      };
      testRunRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.createFromTemplate(options)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw ResourceNotFoundException when template not found', async () => {
      // Arrange
      const options: CreateReportFromTemplateOptions = {
        testRunId: '123e4567-e89b-12d3-a456-426614174001',
        templateId: 'non-existent',
        generatedBy: 'test-user',
        roles: ['admin'],
      };
      testRunRepo.findOne.mockResolvedValue(createMockTestRun());
      templateRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.createFromTemplate(options)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw DatabaseException on save failure', async () => {
      // Arrange
      const options: CreateReportFromTemplateOptions = {
        testRunId: '123e4567-e89b-12d3-a456-426614174001',
        templateId: '123e4567-e89b-12d3-a456-426614174002',
        generatedBy: 'test-user',
        roles: ['admin'],
      };
      testRunRepo.findOne.mockResolvedValue(createMockTestRun());
      templateRepo.findOne.mockResolvedValue(createMockTemplate());
      reportRepo.create.mockReturnValue(createMockReport());
      reportRepo.save.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.createFromTemplate(options)).rejects.toThrow(DatabaseException);
    });
  });

  // ==================== createAdHocReport ====================

  describe('createAdHocReport', () => {
    it('should create an ad-hoc report successfully', async () => {
      // Arrange
      const sections: ReportSectionConfig[] = [
        { type: 'header', order: 0 },
        { type: 'slo', order: 1 },
      ];
      const options: CreateAdHocReportOptions = {
        testRunId: '123e4567-e89b-12d3-a456-426614174001',
        name: 'Ad-hoc Report',
        sections,
        generatedBy: 'test-user',
      };
      const mockTestRun = createMockTestRun();
      const mockTemplate = createMockTemplate();
      const mockReport = createMockReport({ name: 'Ad-hoc Report' });

      testRunRepo.findOne.mockResolvedValue(mockTestRun);
      templateRepo.create.mockReturnValue(mockTemplate);
      templateRepo.save.mockResolvedValue(mockTemplate);
      reportRepo.create.mockReturnValue(mockReport);
      reportRepo.save.mockResolvedValue(mockReport);

      // Act
      const result = await service.createAdHocReport(options);

      // Assert
      expect(result).toEqual(mockReport);
      expect(templateRepo.create).toHaveBeenCalled();
      expect(templateRepo.save).toHaveBeenCalled();
    });

    it('should throw ValidationException when no sections provided', async () => {
      // Arrange
      const options: CreateAdHocReportOptions = {
        testRunId: '123e4567-e89b-12d3-a456-426614174001',
        name: 'Empty Report',
        sections: [],
        generatedBy: 'test-user',
      };
      testRunRepo.findOne.mockResolvedValue(createMockTestRun());

      // Act & Assert
      await expect(service.createAdHocReport(options)).rejects.toThrow(ValidationException);
    });

    it('should throw ValidationException when too many sections provided', async () => {
      // Arrange
      const sections = Array.from({ length: 51 }, (_, i) => ({
        type: 'slo' as const,
        order: i,
      }));
      const options: CreateAdHocReportOptions = {
        testRunId: '123e4567-e89b-12d3-a456-426614174001',
        name: 'Too Many Sections',
        sections,
        generatedBy: 'test-user',
      };
      testRunRepo.findOne.mockResolvedValue(createMockTestRun());

      // Act & Assert
      await expect(service.createAdHocReport(options)).rejects.toThrow(ValidationException);
    });

    it('should reject saveAsTemplate when the template name already exists in scope', async () => {
      // uq_report_templates_name_scope spans (name, system, environment, workload) —
      // the pre-check must fail fast with a clear message, not a DB 500.
      const options: CreateAdHocReportOptions = {
        testRunId: '123e4567-e89b-12d3-a456-426614174001',
        name: 'Report with duplicate template name',
        sections: [{ type: 'header', order: 0 }],
        generatedBy: 'test-user',
        saveAsTemplate: true,
        templateName: 'Compare',
      };
      testRunRepo.findOne.mockResolvedValue(createMockTestRun());
      templateRepo.findOne.mockResolvedValue(createMockTemplate()); // name taken

      await expect(service.createAdHocReport(options)).rejects.toThrow(/already exists/);
      expect(templateRepo.create).not.toHaveBeenCalled();
    });

    it('should de-collide the derived ad-hoc template name instead of failing', async () => {
      const options: CreateAdHocReportOptions = {
        testRunId: '123e4567-e89b-12d3-a456-426614174001',
        name: 'Report - 09/07/2026, 19:52:45',
        sections: [{ type: 'header', order: 0 }],
        generatedBy: 'test-user',
      };
      const mockTemplate = createMockTemplate();
      const mockReport = createMockReport();
      testRunRepo.findOne.mockResolvedValue(createMockTestRun());
      templateRepo.findOne.mockResolvedValue(mockTemplate); // derived name taken
      templateRepo.create.mockReturnValue(mockTemplate);
      templateRepo.save.mockResolvedValue(mockTemplate);
      reportRepo.create.mockReturnValue(mockReport);
      reportRepo.save.mockResolvedValue(mockReport);

      await service.createAdHocReport(options);

      const created = templateRepo.create.mock.calls[0]![0] as { name: string };
      expect(created.name).toMatch(/^Ad-hoc: Report - 09\/07\/2026, 19:52:45 \(\d+\)$/);
    });

    it('should use provided templateId when specified', async () => {
      // Arrange
      const sections: ReportSectionConfig[] = [{ type: 'header', order: 0 }];
      const options: CreateAdHocReportOptions = {
        testRunId: '123e4567-e89b-12d3-a456-426614174001',
        name: 'Report with Template',
        sections,
        generatedBy: 'test-user',
        templateId: 'existing-template-id',
      };
      const mockTestRun = createMockTestRun();
      const mockReport = createMockReport();

      testRunRepo.findOne.mockResolvedValue(mockTestRun);
      reportRepo.create.mockReturnValue(mockReport);
      reportRepo.save.mockResolvedValue(mockReport);

      // Act
      await service.createAdHocReport(options);

      // Assert
      expect(templateRepo.create).not.toHaveBeenCalled();
      expect(reportRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ template_id: 'existing-template-id' }),
      );
    });
  });

  // ==================== findById ====================

  describe('findById', () => {
    it('should find report by ID', async () => {
      // Arrange
      const mockReport = createMockReport();
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.findById(mockReport.id, 'test-user', ['admin']);

      // Assert
      expect(result).toEqual(mockReport);
      expect(reportRepo.findOne).toHaveBeenCalledWith({
        where: { id: mockReport.id },
        // test_run.systemUnderTest: renderers display the SUT name, not its id
        relations: ['template', 'test_run', 'test_run.systemUnderTest'],
      });
    });

    it('should throw ResourceNotFoundException when report not found', async () => {
      // Arrange
      reportRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findById('non-existent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw DatabaseException on query failure', async () => {
      // Arrange
      reportRepo.findOne.mockRejectedValue(new Error('Connection failed'));

      // Act & Assert
      await expect(service.findById('some-id')).rejects.toThrow(DatabaseException);
    });
  });

  // ==================== findByTestRunId ====================

  describe('findByTestRunId', () => {
    it('should return paginated reports for test run', async () => {
      // Arrange
      const mockReports = [createMockReport(), createMockReport({ id: 'report-2' })];
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockReports, 2]),
      };
      reportRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.findByTestRunId('test-run-id', { roles: ['admin'] });

      // Assert
      expect(result.items).toEqual(mockReports);
      expect(result.total).toBe(2);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(10);
    });

    it('should apply query options', async () => {
      // Arrange
      const options: ListReportsQueryOptions = {
        status: 'html_complete',
        limit: 10,
        offset: 5,
        sortBy: 'name',
        sortOrder: 'asc',
        roles: ['admin'],
      };
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      reportRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      await service.findByTestRunId('test-run-id', options);

      // Assert
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'report.status = :status',
        { status: 'html_complete' },
      );
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(5);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    });

    it('should return empty list when no reports exist', async () => {
      // Arrange - uses the default mock from beforeEach which returns [[], 0]

      // Act
      const result = await service.findByTestRunId('test-run-id');

      // Assert
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ==================== getSummary ====================

  describe('getSummary', () => {
    it('should return report summary for test run', async () => {
      // Arrange
      const mockTestRun = createMockTestRun();
      const mockReports = [
        createMockReport({ status: 'html_complete', download_count: 5 }),
        createMockReport({ status: 'pending', id: 'report-2' }),
        createMockReport({ status: 'failed', id: 'report-3' }),
      ];
      // getSummary uses createQueryBuilder, not findOne
      const mockQueryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockTestRun),
      };
      (testRunRepo.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);
      reportRepo.find.mockResolvedValue(mockReports);

      // Act
      const result = await service.getSummary('test-run-id', 'test-user', ['admin']);

      // Assert
      expect(result.totalReports).toBe(3);
      expect(result.completedReports).toBe(1);
      expect(result.pendingReports).toBe(1);
      expect(result.failedReports).toBe(1);
      expect(result.latestReport).toEqual(mockReports[0]);
      expect(result.totalDownloads).toBe(5);
    });

    it('should return zero counts when no reports exist', async () => {
      // Arrange
      const mockTestRun = createMockTestRun();
      // getSummary uses createQueryBuilder, not findOne
      const mockQueryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockTestRun),
      };
      (testRunRepo.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);
      reportRepo.find.mockResolvedValue([]);

      // Act
      const result = await service.getSummary('test-run-id');

      // Assert
      expect(result.totalReports).toBe(0);
      expect(result.completedReports).toBe(0);
      expect(result.pendingReports).toBe(0);
      expect(result.failedReports).toBe(0);
      expect(result.latestReport).toBeUndefined();
    });
  });

  // ==================== getPendingReports ====================

  describe('getPendingReports', () => {
    it('should return pending reports up to limit', async () => {
      // Arrange
      const mockReports = [
        createMockReport({ status: 'pending' }),
        createMockReport({ status: 'pending', id: 'report-2' }),
      ];
      // getPendingReports uses createQueryBuilder
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockReports),
      };
      reportRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act
      const result = await service.getPendingReports(10, 'test-user', ['admin']);

      // Assert
      expect(result).toEqual(mockReports);
    });

    it('should throw DatabaseException on error', async () => {
      // Arrange
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockRejectedValue(new Error('Database error')),
      };
      reportRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      // Act & Assert
      await expect(service.getPendingReports(10, 'test-user', ['admin'])).rejects.toThrow(DatabaseException);
    });
  });

  // ==================== updateStatus ====================

  describe('updateStatus', () => {
    it('should update status from pending to processing', async () => {
      // Arrange
      const mockReport = createMockReport({ status: 'pending' });
      reportRepo.findOne.mockResolvedValue(mockReport);
      reportRepo.save.mockResolvedValue({ ...mockReport, status: 'processing' });

      // Act
      await service.updateStatus(mockReport.id, 'processing', undefined, undefined, 'test-user', ['admin']);

      // Assert
      expect(reportRepo.save).toHaveBeenCalled();
    });

    it('should update status with error message when failed', async () => {
      // Arrange
      const mockReport = createMockReport({ status: 'processing' });
      reportRepo.findOne.mockResolvedValue(mockReport);
      reportRepo.save.mockResolvedValue({ ...mockReport, status: 'failed' });

      // Act
      await service.updateStatus(
        mockReport.id,
        'failed',
        'Generation failed',
        'GEN_ERROR',
        'test-user',
        ['admin'],
      );

      // Assert
      expect(reportRepo.save).toHaveBeenCalled();
    });

    it('should throw InvalidStateException for invalid transition', async () => {
      // Arrange
      const mockReport = createMockReport({ status: 'pdf_complete' });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Get the validator mock from the module
      const validatorService = (service as any).validator;
      validatorService.validateStatusTransition.mockImplementation(() => {
        throw new InvalidStateException('Invalid transition from pdf_complete to processing');
      });

      // Act & Assert
      await expect(
        service.updateStatus(mockReport.id, 'processing', undefined, undefined, 'test-user', ['admin']),
      ).rejects.toThrow(InvalidStateException);
    });

    it('should throw ResourceNotFoundException when report not found', async () => {
      // Arrange
      reportRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateStatus('non-existent', 'processing', undefined, undefined, 'test-user', ['admin']),
      ).rejects.toThrow(ResourceNotFoundException);
    });

    it('should allow retry transition from failed to pending', async () => {
      // Arrange
      const mockReport = createMockReport({ status: 'failed' });
      reportRepo.findOne.mockResolvedValue(mockReport);
      reportRepo.save.mockResolvedValue({ ...mockReport, status: 'pending' });

      // Act
      await service.updateStatus(mockReport.id, 'pending', undefined, undefined, 'test-user', ['admin']);

      // Assert
      expect(reportRepo.save).toHaveBeenCalled();
    });
  });

  // ==================== storeHtmlContent ====================

  describe('storeHtmlContent', () => {
    it('should store HTML content and update status', async () => {
      // Arrange
      const mockReport = createMockReport({ status: 'processing' });
      const htmlContent = '<html><body>Report</body></html>';
      // storeHtmlContent calls findById (which uses findOne), then save, then updateStatus (which also uses findOne and save)
      reportRepo.findOne.mockResolvedValue(mockReport);
      reportRepo.save.mockResolvedValue(mockReport);

      // Act
      await service.storeHtmlContent(mockReport.id, htmlContent, 'test-user', ['admin']);

      // Assert
      expect(reportRepo.save).toHaveBeenCalled();
    });

    it('should throw ResourceNotFoundException when report not found', async () => {
      // Arrange
      reportRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.storeHtmlContent('non-existent', '<html></html>'),
      ).rejects.toThrow(ResourceNotFoundException);
    });
  });

  // ==================== updateJobId ====================

  describe('updateJobId', () => {
    it('should update job ID', async () => {
      // Arrange
      reportRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      await service.updateJobId('report-id', 'job-123');

      // Assert
      expect(reportRepo.update).toHaveBeenCalledWith('report-id', { job_id: 'job-123' });
    });

    it('should succeed even when report not found (silent update)', async () => {
      // Arrange - TypeORM update doesn't throw on non-existent ID
      reportRepo.update.mockResolvedValue({ affected: 0 } as any);

      // Act & Assert - should complete without throwing
      await expect(service.updateJobId('non-existent', 'job-123')).resolves.toBeUndefined();
    });
  });

  // ==================== incrementRetryCount ====================

  describe('incrementRetryCount', () => {
    it('should increment retry count', async () => {
      // Arrange
      const mockReport = createMockReport({ retry_count: 1 });
      reportRepo.findOne.mockResolvedValue(mockReport);
      reportRepo.save.mockResolvedValue({ ...mockReport, retry_count: 2 });

      // Act
      const result = await service.incrementRetryCount(mockReport.id, 'test-user', ['admin']);

      // Assert
      expect(result).toBe(2);
      expect(reportRepo.save).toHaveBeenCalled();
    });

    it('should throw ResourceNotFoundException when report not found', async () => {
      // Arrange
      reportRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.incrementRetryCount('non-existent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  // ==================== delete ====================

  describe('delete', () => {
    it('should delete report by ID', async () => {
      // Arrange
      const mockReport = createMockReport();
      reportRepo.findOne.mockResolvedValue(mockReport);
      reportRepo.remove.mockResolvedValue(mockReport);

      // Act
      await service.delete(mockReport.id, 'test-user', ['admin']);

      // Assert
      expect(reportRepo.findOne).toHaveBeenCalled();
      expect(reportRepo.remove).toHaveBeenCalledWith(mockReport);
    });

    it('should throw ResourceNotFoundException when report not found', async () => {
      // Arrange
      reportRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.delete('non-existent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    // Phase 5a PR17 — GeneratedReport is DELETE-only. The audit row must
    // resolve organization_id via the parent test_run (or template) since
    // the entity itself has no organization_id column.
    it('logs DELETE with organizationIdOverride from the parent test_run', async () => {
      const mockTestRun = createMockTestRun({ organizationId: 'org-from-tr' } as Partial<TestRun>);
      const mockReport = createMockReport({
        template: undefined,
        test_run: mockTestRun,
      });
      reportRepo.findOne.mockResolvedValue(mockReport);
      reportRepo.remove.mockResolvedValue(mockReport);

      await service.delete(mockReport.id, 'test-user', ['admin']);

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      const [ref, options] = (auditService.logDelete as jest.Mock).mock.calls[0];
      expect(ref).toBe(mockReport);
      expect(options).toEqual({ organizationIdOverride: 'org-from-tr' });
    });

    it('prefers the parent template organizationId when both relations are loaded', async () => {
      const mockTemplate = createMockTemplate({ organizationId: 'org-from-tpl' } as Partial<ReportTemplate>);
      const mockTestRun = createMockTestRun({ organizationId: 'org-from-tr' } as Partial<TestRun>);
      const mockReport = createMockReport({
        template: mockTemplate,
        test_run: mockTestRun,
      });
      reportRepo.findOne.mockResolvedValue(mockReport);
      reportRepo.remove.mockResolvedValue(mockReport);

      await service.delete(mockReport.id, 'test-user', ['admin']);

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      const [, options] = (auditService.logDelete as jest.Mock).mock.calls[0];
      expect(options).toEqual({ organizationIdOverride: 'org-from-tpl' });
    });

    it('audits DELETE before remove (so a remove failure still leaves a row)', async () => {
      const mockReport = createMockReport({
        test_run: createMockTestRun({ organizationId: 'org-1' } as Partial<TestRun>),
      });
      reportRepo.findOne.mockResolvedValue(mockReport);
      const callOrder: string[] = [];
      (auditService.logDelete as jest.Mock).mockImplementation(() => {
        callOrder.push('logDelete');
      });
      reportRepo.remove.mockImplementation(async () => {
        callOrder.push('remove');
        return mockReport;
      });

      await service.delete(mockReport.id, 'test-user', ['admin']);

      expect(callOrder).toEqual(['logDelete', 'remove']);
    });
  });

  // ==================== generateHtml ====================

  describe('generateHtml', () => {
    it('should generate HTML content from template', async () => {
      // Arrange
      const mockTemplate = createMockTemplate({
        sections: [
          { type: 'header', order: 0, config: { title: 'Test Report' } },
        ] as ReportSectionConfig[],
      });
      const mockTestRun = createMockTestRun();
      const mockReport = createMockReport({
        status: 'pending',
        template: mockTemplate,
        test_run: mockTestRun,
      });

      // generateHtml calls findOne once, then updateStatus and storeHtmlContent also call findById (which uses findOne)
      reportRepo.findOne.mockResolvedValue(mockReport);
      reportRepo.save.mockResolvedValue(mockReport);
      reportRepo.update.mockResolvedValue({ affected: 1 } as any);
      testRunRepo.findOne.mockResolvedValue(mockTestRun);

      // Act
      const result = await service.generateHtml(mockReport.id, 'test-user', ['admin']);

      // Assert
      expect(result.html).toBeDefined();
      expect(result.html).toContain('<!DOCTYPE html>');
      expect(result.sectionCount).toBe(1);
      expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should throw ResourceNotFoundException when report not found', async () => {
      // Arrange
      reportRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.generateHtml('non-existent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw ValidationException when template not found', async () => {
      // Arrange
      const mockReport = createMockReport({ template: undefined });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act & Assert
      await expect(service.generateHtml(mockReport.id, 'test-user', ['admin'])).rejects.toThrow(
        ValidationException,
      );
    });

    it('should update status to failed on error', async () => {
      // Arrange
      const mockReport = createMockReport({
        status: 'pending',
        template: createMockTemplate(),
        test_run: undefined,
      });
      reportRepo.findOne.mockResolvedValueOnce(mockReport);
      reportRepo.update.mockResolvedValue({ affected: 1 } as any);
      testRunRepo.findOne.mockResolvedValue(null); // Will cause error

      // Act & Assert
      await expect(service.generateHtml(mockReport.id)).rejects.toThrow(ResourceNotFoundException);
    });
  });

  // ==================== Audit logging — Phase 5a PR17 ====================

  // GeneratedReport is DELETE-only per the brainstorm: report row creates,
  // status transitions, file storage, retry/job/download bookkeeping, and HTML
  // content stores are all bucket-2 background-pipeline output. Only delete()
  // emits a row, exercised in the `delete` describe above. The internally
  // created ReportTemplate inside createAdHocReport IS audited (full CRUD on
  // templates per the burndown).
  describe('Audit logging — Phase 5a PR17', () => {
    it('does not call auditService on createFromTemplate (DELETE-only)', async () => {
      const options: CreateReportFromTemplateOptions = {
        testRunId: '123e4567-e89b-12d3-a456-426614174001',
        templateId: '123e4567-e89b-12d3-a456-426614174002',
        generatedBy: 'test-user',
        roles: ['admin'],
      };
      testRunRepo.findOne.mockResolvedValue(createMockTestRun());
      templateRepo.findOne.mockResolvedValue(createMockTemplate());
      reportRepo.create.mockReturnValue(createMockReport());
      reportRepo.save.mockResolvedValue(createMockReport());

      await service.createFromTemplate(options);

      expect(auditService.logCreate).not.toHaveBeenCalled();
      expect(auditService.logUpdate).not.toHaveBeenCalled();
      expect(auditService.logDelete).not.toHaveBeenCalled();
    });

    it('logs CREATE on the inline-created ReportTemplate inside createAdHocReport', async () => {
      const sections: ReportSectionConfig[] = [{ type: 'header', order: 0 }];
      const options: CreateAdHocReportOptions = {
        testRunId: '123e4567-e89b-12d3-a456-426614174001',
        name: 'Ad-hoc Report',
        sections,
        generatedBy: 'test-user',
        saveAsTemplate: true,
        templateName: 'Saved Template',
      };
      const mockTemplate = createMockTemplate({ name: 'Saved Template', is_adhoc: false });

      testRunRepo.findOne.mockResolvedValue(createMockTestRun());
      templateRepo.create.mockReturnValue(mockTemplate);
      templateRepo.save.mockResolvedValue(mockTemplate);
      reportRepo.create.mockReturnValue(createMockReport());
      reportRepo.save.mockResolvedValue(createMockReport());

      await service.createAdHocReport(options);

      expect(auditService.logCreate).toHaveBeenCalledTimes(1);
      const [ref] = (auditService.logCreate as jest.Mock).mock.calls[0];
      expect(ref).toBe(mockTemplate);
      // GeneratedReport itself is intentionally not audited (DELETE-only).
      expect(auditService.logCreate).not.toHaveBeenCalledWith(
        expect.objectContaining({ test_run_id: expect.anything() }),
      );
    });

    it('does not call auditService when createAdHocReport reuses an existing templateId', async () => {
      const options: CreateAdHocReportOptions = {
        testRunId: '123e4567-e89b-12d3-a456-426614174001',
        name: 'Report with Template',
        sections: [{ type: 'header', order: 0 }],
        generatedBy: 'test-user',
        templateId: 'existing-template-id',
      };
      testRunRepo.findOne.mockResolvedValue(createMockTestRun());
      reportRepo.create.mockReturnValue(createMockReport());
      reportRepo.save.mockResolvedValue(createMockReport());

      await service.createAdHocReport(options);

      // No new template created → no audit row. Report itself is DELETE-only.
      expect(auditService.logCreate).not.toHaveBeenCalled();
    });

    it('does not call auditService on updateStatus (bucket-2 status flow)', async () => {
      const mockReport = createMockReport({ status: 'pending' });
      reportRepo.findOne.mockResolvedValue(mockReport);
      reportRepo.save.mockResolvedValue({ ...mockReport, status: 'processing' });

      await service.updateStatus(mockReport.id, 'processing', undefined, undefined, 'test-user', ['admin']);

      expect(auditService.logUpdate).not.toHaveBeenCalled();
    });

    it('does not call auditService on incrementRetryCount (bucket-2 queue bookkeeping)', async () => {
      const mockReport = createMockReport({ retry_count: 1 });
      reportRepo.findOne.mockResolvedValue(mockReport);
      reportRepo.save.mockResolvedValue({ ...mockReport, retry_count: 2 });

      await service.incrementRetryCount(mockReport.id, 'test-user', ['admin']);

      expect(auditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  // ==================== Edge Cases ====================

  describe('Edge Cases', () => {
    it('should handle concurrent report creation', async () => {
      // Arrange
      const options: CreateReportFromTemplateOptions = {
        testRunId: '123e4567-e89b-12d3-a456-426614174001',
        templateId: '123e4567-e89b-12d3-a456-426614174002',
        generatedBy: 'test-user',
        roles: ['admin'],
      };
      const mockTestRun = createMockTestRun();
      const mockTemplate = createMockTemplate();

      testRunRepo.findOne.mockResolvedValue(mockTestRun);
      templateRepo.findOne.mockResolvedValue(mockTemplate);
      reportRepo.create.mockReturnValue(createMockReport());
      reportRepo.save.mockResolvedValue(createMockReport());

      // Act
      const results = await Promise.all([
        service.createFromTemplate(options),
        service.createFromTemplate(options),
        service.createFromTemplate(options),
      ]);

      // Assert
      expect(results).toHaveLength(3);
      expect(reportRepo.save).toHaveBeenCalledTimes(3);
    });

    it('should handle reports with undefined download_count', async () => {
      // Arrange
      const mockTestRun = createMockTestRun();
      const mockReports = [
        createMockReport({ download_count: undefined as any }),
        createMockReport({ download_count: 10, id: 'report-2' }),
      ];
      const mockQueryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockTestRun),
      };
      (testRunRepo.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);
      reportRepo.find.mockResolvedValue(mockReports);

      // Act
      const result = await service.getSummary('test-run-id', 'test-user', ['admin']);

      // Assert
      expect(result.totalDownloads).toBe(10);
    });

    it('should handle reports with undefined share_view_count', async () => {
      // Arrange
      const mockTestRun = createMockTestRun();
      const mockReports = [
        createMockReport({ share_view_count: undefined as any }),
        createMockReport({ share_view_count: 5, id: 'report-2' }),
      ];
      const mockQueryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockTestRun),
      };
      (testRunRepo.createQueryBuilder as jest.Mock).mockReturnValue(mockQueryBuilder);
      reportRepo.find.mockResolvedValue(mockReports);

      // Act
      const result = await service.getSummary('test-run-id', 'test-user', ['admin']);

      // Assert
      expect(result.totalShareViews).toBe(5);
    });
  });
});
