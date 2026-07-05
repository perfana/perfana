/**
 * Unit tests for ReportGenerationController
 *
 * Tests for report generation controller including:
 * - Report listing with pagination and filtering
 * - Report generation from templates and ad-hoc
 * - PDF generation
 * - Share management
 * - Report CRUD operations
 * - Retry functionality
 * - Error handling
 */

// Mock TypeORM decorators before any imports
jest.mock('@nestjs/typeorm', () => ({
  ...jest.requireActual('@nestjs/typeorm'),
  InjectRepository: () => () => undefined,
}));

import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ReportGenerationController } from '../controllers/report-generation.controller';
import { ReportGenerationService } from '../services/report-generation.service';
import { ReportShareService } from '../services/report-share.service';
import { HtmlGenerationProcessor } from '../processors/html-generation.processor';
import { PdfGenerationProcessor } from '../processors/pdf-generation.processor';
import {
  GenerateReportFromTemplateDto,
  GenerateAdHocReportDto,
  GeneratePdfDto,
  UpdateShareSettingsDto,
  ListReportsQueryDto,
} from '../dto';

// Import types only for type assertions
type ReportStatus = 'pending' | 'processing' | 'html_complete' | 'pdf_processing' | 'pdf_complete' | 'failed';

interface ReportTemplate {
  id: string;
  name: string;
  description?: string;
  created_by: string;
  system_id: string;
  test_environment: string;
  workload: string;
  sections: Array<{ type: string; order: number; config?: Record<string, unknown> }>;
  styling?: Record<string, unknown>;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

interface GeneratedReport {
  id: string;
  test_run_id: string;
  template_id: string;
  name: string;
  generated_by: string;
  status: ReportStatus;
  share_id: string;
  share_enabled: boolean;
  share_view_count: number;
  download_count: number;
  retry_count: number;
  max_retries: number;
  mime_type: string;
  html_content?: string;
  html_generated_at?: Date;
  file_size?: number;
  error_code?: string;
  error_message?: string;
  job_id?: string;
  last_shared_at?: Date;
  last_downloaded_at?: Date;
  expires_at?: Date;
  started_at?: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
  template?: ReportTemplate;
}

describe('ReportGenerationController', () => {
  let controller: ReportGenerationController;
  let reportGenerationService: jest.Mocked<ReportGenerationService>;
  let reportShareService: jest.Mocked<ReportShareService>;

  // ==================== Mock Factories ====================

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
      ],
      styling: { primaryColor: '#1976d2' },
      is_default: false,
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-01-01'),
      ...overrides,
    }) as ReportTemplate;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMockReport = (overrides?: Partial<GeneratedReport>): any => ({
    id: '123e4567-e89b-12d3-a456-426614174003',
    test_run_id: '123e4567-e89b-12d3-a456-426614174001',
    template_id: '123e4567-e89b-12d3-a456-426614174002',
    name: 'Test Report',
    generated_by: 'test-user@example.com',
    status: 'pending' as ReportStatus,
    share_id: 'share-uuid-001',
    share_enabled: false,
    share_view_count: 0,
    retry_count: 0,
    max_retries: 3,
    download_count: 0,
    mime_type: 'text/html',
    html_content: '<html><body>Report</body></html>',
    created_at: new Date('2025-01-01'),
    updated_at: new Date('2025-01-01'),
    template: createMockTemplate(),
    ...overrides,
  });

  const createMockRequest = (overrides?: Record<string, unknown>): { user: Record<string, unknown> } => ({
    user: {
      email: 'test-user@example.com',
      preferred_username: 'testuser',
      ...overrides,
    },
  });

  const mockUserCtx = {
    userId: 'test-user-id',
    roles: ['admin'],
    organizations: [],
    teams: [],
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportGenerationController],
      providers: [
        {
          provide: ReportGenerationService,
          useValue: {
            findById: jest.fn(),
            findAll: jest.fn(),
            findByTestRunId: jest.fn(),
            getSummary: jest.fn(),
            createFromTemplate: jest.fn(),
            createAdHocReport: jest.fn(),
            updateStatus: jest.fn(),
            incrementRetryCount: jest.fn(),
            incrementDownloadCount: jest.fn(),
            delete: jest.fn(),
            updateJobId: jest.fn(),
          },
        },
        {
          provide: ReportShareService,
          useValue: {
            getShareSettings: jest.fn(),
            updateShareSettings: jest.fn(),
          },
        },
        {
          provide: HtmlGenerationProcessor,
          useValue: {
            generateHtml: jest.fn(),
            generatePreview: jest.fn(),
            addJob: jest.fn().mockResolvedValue('job-123'),
            processSync: jest.fn().mockResolvedValue(undefined),
            isAvailable: jest.fn().mockReturnValue(true),
          },
        },
        {
          provide: PdfGenerationProcessor,
          useValue: {
            generatePdf: jest.fn(),
            addJob: jest.fn().mockResolvedValue('pdf-job-123'),
            isAvailable: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    controller = module.get<ReportGenerationController>(ReportGenerationController);
    reportGenerationService = module.get(ReportGenerationService);
    reportShareService = module.get(ReportShareService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Module Initialization', () => {
    it('should be defined', () => {
      expect(controller).toBeDefined();
    });

    it('should have services injected', () => {
      expect(reportGenerationService).toBeDefined();
      expect(reportShareService).toBeDefined();
    });
  });

  // ==================== Report Listing ====================

  describe('findAll', () => {
    it('should return empty paginated list', async () => {
      // Arrange
      const query: ListReportsQueryDto = {};
      reportGenerationService.findAll.mockResolvedValue({
        items: [],
        total: 0,
        offset: 0,
        limit: 50,
      });

      // Act
      const result = await controller.findAll(query);

      // Assert
      expect(result).toEqual({
        items: [],
        total: 0,
        offset: 0,
        limit: 50,
      });
      expect(reportGenerationService.findAll).toHaveBeenCalled();
    });

    it('should use query parameters for pagination', async () => {
      // Arrange
      const query: ListReportsQueryDto = { limit: 20, offset: 10 };
      reportGenerationService.findAll.mockResolvedValue({
        items: [],
        total: 0,
        offset: 10,
        limit: 20,
      });

      // Act
      const result = await controller.findAll(query);

      // Assert
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(10);
    });
  });

  describe('findByTestRun', () => {
    it('should return paginated reports for test run', async () => {
      // Arrange
      const testRunId = '123e4567-e89b-12d3-a456-426614174001';
      const mockReports = [createMockReport(), createMockReport({ id: 'report-2' })];
      reportGenerationService.findByTestRunId.mockResolvedValue({
        items: mockReports,
        total: 2,
        offset: 0,
        limit: 50,
      });

      // Act
      const result = await controller.findByTestRun(testRunId, {}, mockUserCtx);

      // Assert
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(reportGenerationService.findByTestRunId).toHaveBeenCalledWith(
        testRunId,
        expect.any(Object),
      );
    });

    it('should apply status filter', async () => {
      // Arrange
      const testRunId = '123e4567-e89b-12d3-a456-426614174001';
      const query: ListReportsQueryDto = { status: 'html_complete' };
      reportGenerationService.findByTestRunId.mockResolvedValue({
        items: [],
        total: 0,
        offset: 0,
        limit: 50,
      });

      // Act
      await controller.findByTestRun(testRunId, query, mockUserCtx);

      // Assert
      expect(reportGenerationService.findByTestRunId).toHaveBeenCalledWith(
        testRunId,
        expect.objectContaining({ status: 'html_complete' }),
      );
    });

    it('should return empty list when no reports exist', async () => {
      // Arrange
      reportGenerationService.findByTestRunId.mockResolvedValue({
        items: [],
        total: 0,
        offset: 0,
        limit: 50,
      });

      // Act
      const result = await controller.findByTestRun('test-run-id', {}, mockUserCtx);

      // Assert
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should throw HttpException on service error', async () => {
      // Arrange
      reportGenerationService.findByTestRunId.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(controller.findByTestRun('test-run-id', {}, mockUserCtx)).rejects.toThrow(HttpException);
    });
  });

  describe('getSummary', () => {
    it('should return report summary for test run', async () => {
      // Arrange
      const testRunId = '123e4567-e89b-12d3-a456-426614174001';
      const mockSummary = {
        totalReports: 10,
        completedReports: 8,
        pendingReports: 1,
        failedReports: 1,
        latestReport: createMockReport({ status: 'html_complete' }),
        totalDownloads: 42,
        totalShareViews: 150,
      };
      reportGenerationService.getSummary.mockResolvedValue(mockSummary);

      // Act
      const result = await controller.getSummary(testRunId, mockUserCtx);

      // Assert
      expect(result.total_reports).toBe(10);
      expect(result.completed_reports).toBe(8);
      expect(result.pending_reports).toBe(1);
      expect(result.failed_reports).toBe(1);
      expect(result.total_downloads).toBe(42);
      expect(result.total_share_views).toBe(150);
      expect(result.latest_report).toBeDefined();
    });

    it('should handle missing latest report', async () => {
      // Arrange
      const mockSummary = {
        totalReports: 0,
        completedReports: 0,
        pendingReports: 0,
        failedReports: 0,
        latestReport: undefined,
        totalDownloads: 0,
        totalShareViews: 0,
      };
      reportGenerationService.getSummary.mockResolvedValue(mockSummary);

      // Act
      const result = await controller.getSummary('test-run-id', mockUserCtx);

      // Assert
      expect(result.latest_report).toBeUndefined();
      expect(result.total_reports).toBe(0);
    });

    it('should throw HttpException on error', async () => {
      // Arrange
      reportGenerationService.getSummary.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(controller.getSummary('test-run-id', mockUserCtx)).rejects.toThrow(HttpException);
    });
  });

  // ==================== Report Generation ====================

  describe('generateFromTemplate', () => {
    it('should generate report from template successfully', async () => {
      // Arrange
      const dto: GenerateReportFromTemplateDto = {
        test_run_id: '123e4567-e89b-12d3-a456-426614174001',
        template_id: '123e4567-e89b-12d3-a456-426614174002',
      };
      const mockReport = createMockReport({ job_id: 'job-123' });
      reportGenerationService.createFromTemplate.mockResolvedValue(mockReport);

      // Act
      const result = await controller.generateFromTemplate(dto, createMockRequest(), mockUserCtx);

      // Assert — job_id is precomputed (html-gen-<reportId>-<ts>) so it can be
      // returned before the after-commit enqueue runs (#421).
      expect(result.report_id).toBe(mockReport.id);
      expect(result.job_id).toMatch(new RegExp(`^html-gen-${mockReport.id}-\\d+$`));
      expect(reportGenerationService.updateJobId).toHaveBeenCalledWith(mockReport.id, result.job_id);
      expect(result.status).toBe('pending');
      expect(result.estimated_completion_seconds).toBe(30);
    });

    it('should use custom name when provided', async () => {
      // Arrange
      const dto: GenerateReportFromTemplateDto = {
        test_run_id: '123e4567-e89b-12d3-a456-426614174001',
        template_id: '123e4567-e89b-12d3-a456-426614174002',
        name: 'Custom Report Name',
      };
      const mockReport = createMockReport({ name: 'Custom Report Name' });
      reportGenerationService.createFromTemplate.mockResolvedValue(mockReport);

      // Act
      await controller.generateFromTemplate(dto, createMockRequest(), mockUserCtx);

      // Assert
      expect(reportGenerationService.createFromTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Custom Report Name' }),
      );
    });

    it('should extract email from request user', async () => {
      // Arrange
      const dto: GenerateReportFromTemplateDto = {
        test_run_id: '123e4567-e89b-12d3-a456-426614174001',
        template_id: '123e4567-e89b-12d3-a456-426614174002',
      };
      reportGenerationService.createFromTemplate.mockResolvedValue(createMockReport());

      // Act
      await controller.generateFromTemplate(dto, createMockRequest({ email: 'john@example.com' }), mockUserCtx);

      // Assert
      expect(reportGenerationService.createFromTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ generatedBy: 'john@example.com' }),
      );
    });

    it('should fallback to preferred_username when email not available', async () => {
      // Arrange
      const dto: GenerateReportFromTemplateDto = {
        test_run_id: '123e4567-e89b-12d3-a456-426614174001',
        template_id: '123e4567-e89b-12d3-a456-426614174002',
      };
      reportGenerationService.createFromTemplate.mockResolvedValue(createMockReport());

      // Act
      await controller.generateFromTemplate(dto, {
        user: { preferred_username: 'johndoe' },
      }, mockUserCtx);

      // Assert
      expect(reportGenerationService.createFromTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ generatedBy: 'johndoe' }),
      );
    });

    it('should throw NOT_FOUND when test run not found', async () => {
      // Arrange
      const dto: GenerateReportFromTemplateDto = {
        test_run_id: 'non-existent',
        template_id: '123e4567-e89b-12d3-a456-426614174002',
      };
      reportGenerationService.createFromTemplate.mockRejectedValue(
        new Error('Test run not found'),
      );

      // Act & Assert
      await expect(
        controller.generateFromTemplate(dto, createMockRequest(), mockUserCtx),
      ).rejects.toThrow(HttpException);
      await expect(
        controller.generateFromTemplate(dto, createMockRequest(), mockUserCtx),
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('should throw NOT_FOUND when template not found', async () => {
      // Arrange
      const dto: GenerateReportFromTemplateDto = {
        test_run_id: '123e4567-e89b-12d3-a456-426614174001',
        template_id: 'non-existent',
      };
      reportGenerationService.createFromTemplate.mockRejectedValue(
        new Error('Template not found'),
      );

      // Act & Assert
      await expect(
        controller.generateFromTemplate(dto, createMockRequest(), mockUserCtx),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('generateAdHoc', () => {
    it('should generate ad-hoc report successfully', async () => {
      // Arrange
      const dto: GenerateAdHocReportDto = {
        test_run_id: '123e4567-e89b-12d3-a456-426614174001',
        name: 'Ad-hoc Report',
        sections: [
          { type: 'header', order: 0 },
          { type: 'slo', order: 1 },
        ],
      };
      const mockReport = createMockReport({ name: 'Ad-hoc Report', job_id: 'job-456' });
      reportGenerationService.createAdHocReport.mockResolvedValue(mockReport);

      // Act
      const result = await controller.generateAdHoc(dto, createMockRequest(), mockUserCtx);

      // Assert
      expect(result.report_id).toBe(mockReport.id);
      // Job ID is precomputed and returned before the after-commit enqueue (#421).
      expect(result.job_id).toMatch(new RegExp(`^html-gen-${mockReport.id}-\\d+$`));
      expect(result.status).toBe('pending');
    });

    it('should pass styling options', async () => {
      // Arrange
      const dto: GenerateAdHocReportDto = {
        test_run_id: '123e4567-e89b-12d3-a456-426614174001',
        name: 'Styled Report',
        sections: [{ type: 'header', order: 0 }],
        styling: {
          primaryColor: '#1976d2',
          secondaryColor: '#9c27b0',
        },
      };
      reportGenerationService.createAdHocReport.mockResolvedValue(createMockReport());

      // Act
      await controller.generateAdHoc(dto, createMockRequest(), mockUserCtx);

      // Assert
      expect(reportGenerationService.createAdHocReport).toHaveBeenCalledWith(
        expect.objectContaining({
          styling: {
            primaryColor: '#1976d2',
            secondaryColor: '#9c27b0',
          },
        }),
      );
    });

    it('should throw BAD_REQUEST when no sections provided', async () => {
      // Arrange
      const dto: GenerateAdHocReportDto = {
        test_run_id: '123e4567-e89b-12d3-a456-426614174001',
        name: 'Empty Report',
        sections: [],
      };
      reportGenerationService.createAdHocReport.mockRejectedValue(
        new Error('At least one section is required'),
      );

      // Act & Assert
      await expect(controller.generateAdHoc(dto, createMockRequest(), mockUserCtx)).rejects.toThrow(
        HttpException,
      );
      await expect(
        controller.generateAdHoc(dto, createMockRequest(), mockUserCtx),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('should throw BAD_REQUEST when too many sections', async () => {
      // Arrange
      const sections = Array.from({ length: 51 }, (_, i) => ({
        type: 'slo' as const,
        order: i,
      }));
      const dto: GenerateAdHocReportDto = {
        test_run_id: '123e4567-e89b-12d3-a456-426614174001',
        name: 'Too Many Sections',
        sections,
      };
      reportGenerationService.createAdHocReport.mockRejectedValue(
        new Error('Maximum 50 sections allowed'),
      );

      // Act & Assert
      await expect(controller.generateAdHoc(dto, createMockRequest(), mockUserCtx)).rejects.toThrow(
        HttpException,
      );
    });
  });

  // ==================== Report CRUD ====================

  describe('findOne', () => {
    it('should return report details', async () => {
      // Arrange
      const mockReport = createMockReport({
        status: 'html_complete',
        html_content: '<html>Content</html>',
      });
      reportGenerationService.findById.mockResolvedValue(mockReport);

      // Act
      const result = await controller.findOne(mockReport.id, mockUserCtx);

      // Assert
      expect(result.id).toBe(mockReport.id);
      expect(result.status).toBe('html_complete');
      expect(result.html_content).toBe('<html>Content</html>');
    });

    it('should throw NOT_FOUND when report not found', async () => {
      // Arrange
      reportGenerationService.findById.mockRejectedValue(new Error('Report not found'));

      // Act & Assert
      await expect(controller.findOne('non-existent', mockUserCtx)).rejects.toThrow(HttpException);
      await expect(controller.findOne('non-existent', mockUserCtx)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('should handle reports with all optional fields', async () => {
      // Arrange
      const mockReport = createMockReport({
        status: 'pdf_complete',
        html_content: '<html>Content</html>',
        html_generated_at: new Date('2025-01-01T10:00:00Z'),
        file_size: 1024000,
        error_code: undefined,
        error_message: undefined,
        job_id: 'job-123',
        last_downloaded_at: new Date('2025-01-01T12:00:00Z'),
        expires_at: new Date('2026-01-01'),
        started_at: new Date('2025-01-01T09:55:00Z'),
        completed_at: new Date('2025-01-01T10:00:00Z'),
      });
      reportGenerationService.findById.mockResolvedValue(mockReport);

      // Act
      const result = await controller.findOne(mockReport.id, mockUserCtx);

      // Assert
      expect(result.has_pdf).toBe(true);
      expect(result.file_size).toBe(1024000);
      expect(result.job_id).toBe('job-123');
    });
  });

  describe('delete', () => {
    it('should delete report successfully', async () => {
      // Arrange
      reportGenerationService.delete.mockResolvedValue(undefined);

      // Act & Assert
      await expect(controller.delete('report-id', mockUserCtx)).resolves.not.toThrow();
      expect(reportGenerationService.delete).toHaveBeenCalledWith('report-id', 'test-user-id', ['admin']);
    });

    it('should throw NOT_FOUND when report not found', async () => {
      // Arrange
      reportGenerationService.delete.mockRejectedValue(new Error('Report not found'));

      // Act & Assert
      await expect(controller.delete('non-existent', mockUserCtx)).rejects.toThrow(HttpException);
      await expect(controller.delete('non-existent', mockUserCtx)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });
  });

  // ==================== PDF Generation ====================

  describe('generatePdf', () => {
    it('should start PDF generation for HTML complete report', async () => {
      // Arrange
      const mockReport = createMockReport({ status: 'html_complete' });
      reportGenerationService.findById.mockResolvedValue(mockReport);

      // Act
      const result = await controller.generatePdf(mockReport.id, {}, mockUserCtx);

      // Assert
      expect(result.report_id).toBe(mockReport.id);
      expect(result.status).toBe('pdf_processing');
      // Job ID comes from pdfGenerationProcessor.addJob mock
      expect(result.job_id).toBe('pdf-job-123');
    });

    it('should allow PDF regeneration for pdf_complete reports', async () => {
      // Arrange
      const mockReport = createMockReport({ status: 'pdf_complete' });
      reportGenerationService.findById.mockResolvedValue(mockReport);

      // Act
      const result = await controller.generatePdf(mockReport.id, {}, mockUserCtx);

      // Assert - when PDF is already complete, returns the existing status
      expect(result.status).toBe('pdf_complete');
    });

    it('should throw BAD_REQUEST when HTML not ready', async () => {
      // Arrange
      const mockReport = createMockReport({ status: 'pending' });
      reportGenerationService.findById.mockResolvedValue(mockReport);

      // Act & Assert
      await expect(controller.generatePdf(mockReport.id, {}, mockUserCtx)).rejects.toThrow(HttpException);
      await expect(controller.generatePdf(mockReport.id, {}, mockUserCtx)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('should throw NOT_FOUND when report not found', async () => {
      // Arrange
      reportGenerationService.findById.mockRejectedValue(new Error('Report not found'));

      // Act & Assert
      await expect(controller.generatePdf('non-existent', {}, mockUserCtx)).rejects.toThrow(HttpException);
    });

    it('should accept PDF options', async () => {
      // Arrange
      const mockReport = createMockReport({ status: 'html_complete' });
      const dto: GeneratePdfDto = {
        paperFormat: 'a4',
        orientation: 'landscape',
        includeHeader: true,
        includeFooter: true,
      };
      reportGenerationService.findById.mockResolvedValue(mockReport);
      reportGenerationService.updateStatus.mockResolvedValue(mockReport as any);

      // Act
      const result = await controller.generatePdf(mockReport.id, dto, mockUserCtx);

      // Assert
      expect(result.report_id).toBe(mockReport.id);
    });
  });

  // ==================== Share Management ====================

  describe('getShareSettings', () => {
    it('should return share settings for report', async () => {
      // Arrange
      const mockReport = createMockReport({
        share_enabled: true,
        share_id: 'share-uuid-001',
        share_view_count: 42,
        last_shared_at: new Date('2025-01-15'),
      });
      reportGenerationService.findById.mockResolvedValue(mockReport);

      // Act
      const result = await controller.getShareSettings(mockReport.id, mockUserCtx);

      // Assert
      expect(result.share_id).toBe('share-uuid-001');
      expect(result.share_enabled).toBe(true);
      expect(result.share_view_count).toBe(42);
      expect(result.share_url).toContain('share-uuid-001');
    });

    it('should return empty share_url when sharing disabled', async () => {
      // Arrange
      const mockReport = createMockReport({ share_enabled: false });
      reportGenerationService.findById.mockResolvedValue(mockReport);

      // Act
      const result = await controller.getShareSettings(mockReport.id, mockUserCtx);

      // Assert
      expect(result.share_enabled).toBe(false);
      expect(result.share_url).toBe('');
    });

    it('should throw NOT_FOUND when report not found', async () => {
      // Arrange
      reportGenerationService.findById.mockRejectedValue(new Error('Report not found'));

      // Act & Assert
      await expect(controller.getShareSettings('non-existent', mockUserCtx)).rejects.toThrow(HttpException);
    });
  });

  describe('updateShareSettings', () => {
    it('should enable sharing for report', async () => {
      // Arrange
      const dto: UpdateShareSettingsDto = { share_enabled: true };
      const updatedSettings = {
        reportId: 'report-id',
        shareId: 'share-uuid-001',
        shareEnabled: true,
        shareUrl: 'http://localhost:4001/reports/share/share-uuid-001',
        shareViewCount: 0,
        lastSharedAt: new Date(),
      };
      reportShareService.updateShareSettings.mockResolvedValue(updatedSettings);

      // Act
      const result = await controller.updateShareSettings('report-id', dto, mockUserCtx);

      // Assert
      expect(result.share_enabled).toBe(true);
      expect(result.share_url).toContain('share-uuid-001');
      expect(reportShareService.updateShareSettings).toHaveBeenCalledWith(
        'report-id',
        { shareEnabled: true, expiresAt: null },
        expect.any(String),
      );
    });

    it('should set expiration date', async () => {
      // Arrange
      const futureDate = '2026-02-28T00:00:00Z';
      const dto: UpdateShareSettingsDto = {
        share_enabled: true,
        expires_at: futureDate,
      };
      const updatedSettings = {
        reportId: 'report-id',
        shareId: 'share-uuid-001',
        shareEnabled: true,
        shareUrl: 'http://localhost:4001/reports/share/share-uuid-001',
        shareViewCount: 0,
        expiresAt: new Date(futureDate),
      };
      reportShareService.updateShareSettings.mockResolvedValue(updatedSettings);

      // Act
      const result = await controller.updateShareSettings('report-id', dto, mockUserCtx);

      // Assert
      expect(result.expires_at).toEqual(new Date(futureDate));
    });

    it('should disable sharing', async () => {
      // Arrange
      const dto: UpdateShareSettingsDto = { share_enabled: false };
      const updatedSettings = {
        reportId: 'report-id',
        shareId: 'share-uuid-001',
        shareEnabled: false,
        shareUrl: '',
        shareViewCount: 0,
      };
      reportShareService.updateShareSettings.mockResolvedValue(updatedSettings);

      // Act
      const result = await controller.updateShareSettings('report-id', dto, mockUserCtx);

      // Assert
      expect(result.share_enabled).toBe(false);
      expect(result.share_url).toBe('');
    });

    it('should throw NOT_FOUND when report not found', async () => {
      // Arrange
      const dto: UpdateShareSettingsDto = { share_enabled: true };
      reportShareService.updateShareSettings.mockRejectedValue(new Error('Report not found'));

      // Act & Assert
      await expect(controller.updateShareSettings('non-existent', dto, mockUserCtx)).rejects.toThrow(
        HttpException,
      );
    });
  });

  // ==================== Report Retry ====================

  describe('retryGeneration', () => {
    it('should retry failed report generation', async () => {
      // Arrange
      const mockReport = createMockReport({
        status: 'failed',
        retry_count: 0,
        max_retries: 3,
      });
      reportGenerationService.findById.mockResolvedValue(mockReport);
      reportGenerationService.updateStatus.mockResolvedValue(mockReport as any);
      reportGenerationService.incrementRetryCount.mockResolvedValue(1);

      // Act
      const result = await controller.retryGeneration(mockReport.id, mockUserCtx);

      // Assert
      expect(result.status).toBe('pending');
      expect(result.job_id).toBe(`retry-${mockReport.id}`);
      expect(reportGenerationService.updateStatus).toHaveBeenCalledWith(mockReport.id, 'pending');
      expect(reportGenerationService.incrementRetryCount).toHaveBeenCalledWith(mockReport.id);
    });

    it('should throw BAD_REQUEST when report is not failed', async () => {
      // Arrange
      const mockReport = createMockReport({ status: 'html_complete' });
      reportGenerationService.findById.mockResolvedValue(mockReport);

      // Act & Assert
      await expect(controller.retryGeneration(mockReport.id, mockUserCtx)).rejects.toThrow(HttpException);
      await expect(controller.retryGeneration(mockReport.id, mockUserCtx)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('should throw BAD_REQUEST when max retries exceeded', async () => {
      // Arrange
      const mockReport = createMockReport({
        status: 'failed',
        retry_count: 3,
        max_retries: 3,
      });
      reportGenerationService.findById.mockResolvedValue(mockReport);

      // Act & Assert
      await expect(controller.retryGeneration(mockReport.id, mockUserCtx)).rejects.toThrow(HttpException);
      await expect(controller.retryGeneration(mockReport.id, mockUserCtx)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('should throw NOT_FOUND when report not found', async () => {
      // Arrange
      reportGenerationService.findById.mockRejectedValue(new Error('Report not found'));

      // Act & Assert
      await expect(controller.retryGeneration('non-existent', mockUserCtx)).rejects.toThrow(HttpException);
    });
  });

  // ==================== Error Handling ====================

  describe('Error Handling', () => {
    it('should propagate HttpException as-is', async () => {
      // Arrange
      const httpError = new HttpException('Custom error', HttpStatus.CONFLICT);
      reportGenerationService.findById.mockRejectedValue(httpError);

      // Act & Assert
      await expect(controller.findOne('report-id', mockUserCtx)).rejects.toThrow(HttpException);
      await expect(controller.findOne('report-id', mockUserCtx)).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
      });
    });

    it('should handle unknown errors gracefully', async () => {
      // Arrange
      reportGenerationService.findById.mockRejectedValue('Unknown error type');

      // Act & Assert
      await expect(controller.findOne('report-id', mockUserCtx)).rejects.toThrow(HttpException);
      await expect(controller.findOne('report-id', mockUserCtx)).rejects.toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      });
    });
  });

  // ==================== Concurrent Operations ====================

  describe('Concurrent Operations', () => {
    it('should handle concurrent report listing requests', async () => {
      // Arrange
      const mockResult = {
        items: [createMockReport()],
        total: 1,
        offset: 0,
        limit: 50,
      };
      reportGenerationService.findByTestRunId.mockResolvedValue(mockResult);

      // Act
      const promises = [
        controller.findByTestRun('test-run-1', {}, mockUserCtx),
        controller.findByTestRun('test-run-2', {}, mockUserCtx),
        controller.findByTestRun('test-run-3', {}, mockUserCtx),
      ];
      const results = await Promise.all(promises);

      // Assert
      expect(results).toHaveLength(3);
      expect(reportGenerationService.findByTestRunId).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent report generation requests', async () => {
      // Arrange
      const dto: GenerateReportFromTemplateDto = {
        test_run_id: '123e4567-e89b-12d3-a456-426614174001',
        template_id: '123e4567-e89b-12d3-a456-426614174002',
      };
      reportGenerationService.createFromTemplate.mockResolvedValue(createMockReport());

      // Act
      const promises = [
        controller.generateFromTemplate(dto, createMockRequest(), mockUserCtx),
        controller.generateFromTemplate(dto, createMockRequest(), mockUserCtx),
        controller.generateFromTemplate(dto, createMockRequest(), mockUserCtx),
      ];
      const results = await Promise.all(promises);

      // Assert
      expect(results).toHaveLength(3);
      expect(reportGenerationService.createFromTemplate).toHaveBeenCalledTimes(3);
    });
  });

  // ==================== Edge Cases ====================

  describe('Edge Cases', () => {
    it('should handle report with undefined optional values', async () => {
      // Arrange
      const mockReport = createMockReport({
        share_view_count: undefined,
        download_count: undefined,
        file_size: undefined,
        html_content: undefined,
        error_code: undefined,
        error_message: undefined,
        job_id: undefined,
        template: undefined,
      } as any);
      reportGenerationService.findByTestRunId.mockResolvedValue({
        items: [mockReport],
        total: 1,
        offset: 0,
        limit: 50,
      });

      // Act
      const result = await controller.findByTestRun('test-run-id', {}, mockUserCtx);

      // Assert
      expect(result.items).toHaveLength(1);
      const firstItem = result.items[0];
      expect(firstItem).toBeDefined();
      expect(firstItem!.share_view_count).toBe(0);
      expect(firstItem!.download_count).toBe(0);
      expect(firstItem!.template_name).toBe('Unknown Template');
    });

    it('should handle request without user object', async () => {
      // Arrange
      const dto: GenerateReportFromTemplateDto = {
        test_run_id: '123e4567-e89b-12d3-a456-426614174001',
        template_id: '123e4567-e89b-12d3-a456-426614174002',
      };
      reportGenerationService.createFromTemplate.mockResolvedValue(createMockReport());

      // Act
      await controller.generateFromTemplate(dto, { user: {} }, mockUserCtx);

      // Assert
      expect(reportGenerationService.createFromTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ generatedBy: 'unknown' }),
      );
    });

    it('should handle report without job_id', async () => {
      // Arrange
      const dto: GenerateReportFromTemplateDto = {
        test_run_id: '123e4567-e89b-12d3-a456-426614174001',
        template_id: '123e4567-e89b-12d3-a456-426614174002',
      };
      const mockReport = createMockReport({ job_id: undefined });
      reportGenerationService.createFromTemplate.mockResolvedValue(mockReport);

      // Act
      const result = await controller.generateFromTemplate(dto, createMockRequest(), mockUserCtx);

      // Assert — job_id is precomputed regardless of the report's own job_id (#421).
      expect(result.job_id).toMatch(new RegExp(`^html-gen-${mockReport.id}-\\d+$`));
    });
  });
});
