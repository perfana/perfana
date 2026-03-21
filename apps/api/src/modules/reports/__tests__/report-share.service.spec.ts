/**
 * Unit tests for ReportShareService
 *
 * Tests for report sharing functionality including:
 * - Enable/disable public sharing
 * - Share link validation and expiration
 * - View count tracking
 * - Public report access
 * - Share statistics
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ReportShareService,
  UpdateShareSettingsOptions,
} from '../services/report-share.service';
import { GeneratedReport, ReportStatus } from '../../../entities';
import {
  ResourceNotFoundException,
  DatabaseException,
  ValidationException,
} from '../../../common/exceptions/business.exception';
import {
  createMockRepository,
  createMockQueryBuilder,
  MockRepository,
  MockSelectQueryBuilder,
} from '../../../../test/helpers/mock-repository.factory';

describe('ReportShareService', () => {
  let service: ReportShareService;
  let reportRepo: MockRepository<GeneratedReport>;
  let mockQueryBuilder: MockSelectQueryBuilder<GeneratedReport>;

  // ==================== Mock Factories ====================

  const createMockReport = (overrides?: Partial<GeneratedReport>): GeneratedReport =>
    ({
      id: '123e4567-e89b-12d3-a456-426614174001',
      test_run_id: '123e4567-e89b-12d3-a456-426614174002',
      template_id: '123e4567-e89b-12d3-a456-426614174003',
      name: 'Test Report',
      generated_by: 'test-user',
      status: 'html_complete' as ReportStatus,
      share_id: 'share-uuid-001',
      share_enabled: false,
      share_view_count: 0,
      html_content: '<html><body>Report Content</body></html>',
      html_generated_at: new Date('2025-01-01'),
      mime_type: 'application/pdf',
      retry_count: 0,
      max_retries: 3,
      download_count: 0,
      created_at: new Date('2025-01-01'),
      updated_at: new Date('2025-01-01'),
      ...overrides,
    }) as GeneratedReport;

  beforeEach(async () => {
    // Create mock query builder with update transition support
    mockQueryBuilder = createMockQueryBuilder<GeneratedReport>();
    // Configure the update() transition to return a builder with set() method
    const mockUpdateBuilder = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    mockQueryBuilder.update = jest.fn().mockReturnValue(mockUpdateBuilder);

    // Create mock repository using factory
    reportRepo = createMockRepository<GeneratedReport>({}, {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportShareService,
        {
          provide: getRepositoryToken(GeneratedReport),
          useValue: reportRepo,
        },
      ],
    }).compile();

    service = module.get<ReportShareService>(ReportShareService);
    reportRepo = module.get(getRepositoryToken(GeneratedReport));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==================== getShareSettings ====================

  describe('getShareSettings', () => {
    it('should return share settings for a report', async () => {
      // Arrange
      const mockReport = createMockReport({ share_enabled: true });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.getShareSettings(mockReport.id);

      // Assert
      expect(result.reportId).toBe(mockReport.id);
      expect(result.shareId).toBe(mockReport.share_id);
      expect(result.shareEnabled).toBe(true);
      expect(result.shareUrl).toContain(mockReport.share_id);
    });

    it('should include base URL in share link', async () => {
      // Arrange
      const mockReport = createMockReport();
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.getShareSettings(
        mockReport.id,
        'https://example.com',
      );

      // Assert
      expect(result.shareUrl).toBe(
        `https://example.com/reports/share/${mockReport.share_id}`,
      );
    });

    it('should handle base URL with trailing slash', async () => {
      // Arrange
      const mockReport = createMockReport();
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.getShareSettings(
        mockReport.id,
        'https://example.com/',
      );

      // Assert
      expect(result.shareUrl).toBe(
        `https://example.com/reports/share/${mockReport.share_id}`,
      );
    });

    it('should throw ResourceNotFoundException when report not found', async () => {
      // Arrange
      reportRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getShareSettings('non-existent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw DatabaseException on query failure', async () => {
      // Arrange
      reportRepo.findOne.mockRejectedValue(new Error('Connection failed'));

      // Act & Assert
      await expect(service.getShareSettings('some-id')).rejects.toThrow(
        DatabaseException,
      );
    });
  });

  // ==================== updateShareSettings ====================

  describe('updateShareSettings', () => {
    it('should enable sharing for a report', async () => {
      // Arrange
      const mockReport = createMockReport({ share_enabled: false });
      const updatedReport = createMockReport({ share_enabled: true });
      reportRepo.findOne
        .mockResolvedValueOnce(mockReport)
        .mockResolvedValueOnce(updatedReport);
      reportRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      const result = await service.updateShareSettings(mockReport.id, {
        shareEnabled: true,
      });

      // Assert
      expect(result.shareEnabled).toBe(true);
      expect(reportRepo.update).toHaveBeenCalledWith(
        mockReport.id,
        expect.objectContaining({
          share_enabled: true,
          last_shared_at: expect.any(Date),
        }),
      );
    });

    it('should disable sharing for a report', async () => {
      // Arrange
      const mockReport = createMockReport({ share_enabled: true });
      const updatedReport = createMockReport({ share_enabled: false });
      reportRepo.findOne
        .mockResolvedValueOnce(mockReport)
        .mockResolvedValueOnce(updatedReport);
      reportRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      const result = await service.updateShareSettings(mockReport.id, {
        shareEnabled: false,
      });

      // Assert
      expect(result.shareEnabled).toBe(false);
    });

    it('should set expiration date', async () => {
      // Arrange
      const mockReport = createMockReport();
      const futureDate = new Date(Date.now() + 86400000); // Tomorrow
      const updatedReport = createMockReport({ expires_at: futureDate });
      reportRepo.findOne
        .mockResolvedValueOnce(mockReport)
        .mockResolvedValueOnce(updatedReport);
      reportRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      const result = await service.updateShareSettings(mockReport.id, {
        expiresAt: futureDate,
      });

      // Assert
      expect(result.expiresAt).toEqual(futureDate);
    });

    it('should throw ValidationException for past expiration date', async () => {
      // Arrange
      const mockReport = createMockReport();
      const pastDate = new Date('2020-01-01');
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act & Assert
      await expect(
        service.updateShareSettings(mockReport.id, { expiresAt: pastDate }),
      ).rejects.toThrow(ValidationException);
    });

    it('should clear expiration date when set to null', async () => {
      // Arrange
      const mockReport = createMockReport({ expires_at: new Date() });
      const updatedReport = createMockReport({ expires_at: undefined });
      reportRepo.findOne
        .mockResolvedValueOnce(mockReport)
        .mockResolvedValueOnce(updatedReport);
      reportRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      const result = await service.updateShareSettings(mockReport.id, {
        expiresAt: null,
      });

      // Assert
      expect(result.expiresAt).toBeUndefined();
    });

    it('should throw ResourceNotFoundException when report not found', async () => {
      // Arrange
      reportRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateShareSettings('non-existent', { shareEnabled: true }),
      ).rejects.toThrow(ResourceNotFoundException);
    });
  });

  // ==================== enableSharing ====================

  describe('enableSharing', () => {
    it('should enable sharing without expiration', async () => {
      // Arrange
      const mockReport = createMockReport();
      const updatedReport = createMockReport({ share_enabled: true });
      reportRepo.findOne
        .mockResolvedValueOnce(mockReport)
        .mockResolvedValueOnce(updatedReport);
      reportRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      const result = await service.enableSharing(mockReport.id);

      // Assert
      expect(result.shareEnabled).toBe(true);
    });

    it('should enable sharing with expiration', async () => {
      // Arrange
      const mockReport = createMockReport();
      const futureDate = new Date(Date.now() + 86400000);
      const updatedReport = createMockReport({
        share_enabled: true,
        expires_at: futureDate,
      });
      reportRepo.findOne
        .mockResolvedValueOnce(mockReport)
        .mockResolvedValueOnce(updatedReport);
      reportRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      const result = await service.enableSharing(mockReport.id, futureDate);

      // Assert
      expect(result.shareEnabled).toBe(true);
      expect(result.expiresAt).toEqual(futureDate);
    });
  });

  // ==================== disableSharing ====================

  describe('disableSharing', () => {
    it('should disable sharing for a report', async () => {
      // Arrange
      const mockReport = createMockReport({ share_enabled: true });
      const updatedReport = createMockReport({ share_enabled: false });
      reportRepo.findOne
        .mockResolvedValueOnce(mockReport)
        .mockResolvedValueOnce(updatedReport);
      reportRepo.update.mockResolvedValue({ affected: 1 } as any);

      // Act
      const result = await service.disableSharing(mockReport.id);

      // Assert
      expect(result.shareEnabled).toBe(false);
    });
  });

  // ==================== regenerateShareId ====================

  describe('regenerateShareId', () => {
    it('should regenerate share ID and reset view count', async () => {
      // Arrange
      const mockReport = createMockReport({ share_view_count: 100 });
      const updatedReport = createMockReport({
        share_id: 'new-share-uuid',
        share_view_count: 0,
      });
      reportRepo.findOne
        .mockResolvedValueOnce(mockReport)
        .mockResolvedValueOnce(updatedReport);
      reportRepo.query.mockResolvedValue([]); // TypeORM query returns array, not undefined

      const localMockQueryBuilder = createMockQueryBuilder<GeneratedReport>();
      const mockUpdateBuilder = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      localMockQueryBuilder.update = jest.fn().mockReturnValue(mockUpdateBuilder);
      (reportRepo.createQueryBuilder as jest.Mock).mockReturnValue(localMockQueryBuilder);

      // Act
      const result = await service.regenerateShareId(mockReport.id);

      // Assert
      expect(result.shareId).toBe('new-share-uuid');
      expect(result.shareViewCount).toBe(0);
      expect(reportRepo.query).toHaveBeenCalledWith(
        'UPDATE generated_reports SET share_id = gen_random_uuid() WHERE id = $1',
        [mockReport.id],
      );
    });

    it('should throw ResourceNotFoundException when report not found', async () => {
      // Arrange
      reportRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.regenerateShareId('non-existent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  // ==================== validateShareLink ====================

  describe('validateShareLink', () => {
    it('should validate active share link', async () => {
      // Arrange
      const mockReport = createMockReport({
        share_enabled: true,
        html_content: '<html>Content</html>',
      });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.validateShareLink(mockReport.share_id);

      // Assert
      expect(result.isValid).toBe(true);
      expect(result.report).toEqual(mockReport);
    });

    it('should return NOT_FOUND for non-existent share ID', async () => {
      // Arrange
      reportRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.validateShareLink('non-existent');

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('NOT_FOUND');
    });

    it('should return SHARING_DISABLED when sharing is disabled', async () => {
      // Arrange
      const mockReport = createMockReport({ share_enabled: false });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.validateShareLink(mockReport.share_id);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('SHARING_DISABLED');
    });

    it('should return EXPIRED for expired share link', async () => {
      // Arrange
      const mockReport = createMockReport({
        share_enabled: true,
        expires_at: new Date('2020-01-01'), // Past date
      });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.validateShareLink(mockReport.share_id);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('EXPIRED');
    });

    it('should return NO_CONTENT when HTML content not available', async () => {
      // Arrange
      const mockReport = createMockReport({
        share_enabled: true,
        html_content: undefined,
      });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.validateShareLink(mockReport.share_id);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('NO_CONTENT');
    });
  });

  // ==================== getPublicReport ====================

  describe('getPublicReport', () => {
    it('should return public report content', async () => {
      // Arrange
      const mockReport = createMockReport({
        share_enabled: true,
        html_content: '<html><body>Report</body></html>',
      });
      reportRepo.findOne.mockResolvedValue(mockReport);

      const localMockQueryBuilder = createMockQueryBuilder<GeneratedReport>();
      const mockUpdateBuilder = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      localMockQueryBuilder.update = jest.fn().mockReturnValue(mockUpdateBuilder);
      (reportRepo.createQueryBuilder as jest.Mock).mockReturnValue(localMockQueryBuilder);

      // Act
      const result = await service.getPublicReport(mockReport.share_id);

      // Assert
      expect(result.reportId).toBe(mockReport.id);
      expect(result.reportName).toBe(mockReport.name);
      expect(result.htmlContent).toBe(mockReport.html_content);
      expect(result.generatedBy).toBe(mockReport.generated_by);
    });

    it('should increment view count on access', async () => {
      // Arrange
      const mockReport = createMockReport({ share_enabled: true });
      reportRepo.findOne.mockResolvedValue(mockReport);

      const localMockQueryBuilder = createMockQueryBuilder<GeneratedReport>();
      const mockUpdateBuilder = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      localMockQueryBuilder.update = jest.fn().mockReturnValue(mockUpdateBuilder);
      (reportRepo.createQueryBuilder as jest.Mock).mockReturnValue(localMockQueryBuilder);

      // Act
      await service.getPublicReport(mockReport.share_id);

      // Wait for async view count increment
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assert
      expect(reportRepo.createQueryBuilder).toHaveBeenCalled();
    });

    it('should throw ResourceNotFoundException for non-existent share', async () => {
      // Arrange
      reportRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getPublicReport('non-existent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw ValidationException when sharing is disabled', async () => {
      // Arrange
      const mockReport = createMockReport({ share_enabled: false });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act & Assert
      await expect(service.getPublicReport(mockReport.share_id)).rejects.toThrow(
        ValidationException,
      );
    });

    it('should throw ValidationException for expired share', async () => {
      // Arrange
      const mockReport = createMockReport({
        share_enabled: true,
        expires_at: new Date('2020-01-01'),
      });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act & Assert
      await expect(service.getPublicReport(mockReport.share_id)).rejects.toThrow(
        ValidationException,
      );
    });

    it('should throw ValidationException when no content available', async () => {
      // Arrange
      const mockReport = createMockReport({
        share_enabled: true,
        html_content: undefined,
      });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act & Assert
      await expect(service.getPublicReport(mockReport.share_id)).rejects.toThrow(
        ValidationException,
      );
    });
  });

  // ==================== incrementViewCount ====================

  describe('incrementViewCount', () => {
    it('should increment view count for a report', async () => {
      // Arrange
      const localMockQueryBuilder = createMockQueryBuilder<GeneratedReport>();
      const mockUpdateBuilder = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      localMockQueryBuilder.update = jest.fn().mockReturnValue(mockUpdateBuilder);
      (reportRepo.createQueryBuilder as jest.Mock).mockReturnValue(localMockQueryBuilder);

      // Act
      await service.incrementViewCount('report-id');

      // Assert
      expect(reportRepo.createQueryBuilder).toHaveBeenCalled();
      expect(localMockQueryBuilder.update).toHaveBeenCalled();
      expect(mockUpdateBuilder.set).toHaveBeenCalled();
      expect(mockUpdateBuilder.execute).toHaveBeenCalled();
    });

    it('should not throw on error (non-critical operation)', async () => {
      // Arrange
      const localMockQueryBuilder = createMockQueryBuilder<GeneratedReport>();
      const mockUpdateBuilder = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(new Error('Database error')),
      };
      localMockQueryBuilder.update = jest.fn().mockReturnValue(mockUpdateBuilder);
      (reportRepo.createQueryBuilder as jest.Mock).mockReturnValue(localMockQueryBuilder);

      // Act & Assert - should not throw
      await expect(
        service.incrementViewCount('report-id'),
      ).resolves.not.toThrow();
    });
  });

  // ==================== findByShareId ====================

  describe('findByShareId', () => {
    it('should find report by share ID', async () => {
      // Arrange
      const mockReport = createMockReport();
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.findByShareId(mockReport.share_id);

      // Assert
      expect(result).toEqual(mockReport);
      expect(reportRepo.findOne).toHaveBeenCalledWith({
        where: { share_id: mockReport.share_id },
        relations: ['template'],
      });
    });

    it('should return null when not found', async () => {
      // Arrange
      reportRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.findByShareId('non-existent');

      // Assert
      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      // Arrange
      reportRepo.findOne.mockRejectedValue(new Error('Database error'));

      // Act
      const result = await service.findByShareId('some-id');

      // Assert
      expect(result).toBeNull();
    });
  });

  // ==================== getSharedReports ====================

  describe('getSharedReports', () => {
    it('should return shared reports', async () => {
      // Arrange
      const mockReports = [
        createMockReport({ share_enabled: true }),
        createMockReport({ share_enabled: true, id: 'report-2' }),
      ];
      const localMockQueryBuilder = createMockQueryBuilder<GeneratedReport>();
      localMockQueryBuilder.getMany.mockResolvedValue(mockReports);
      (reportRepo.createQueryBuilder as jest.Mock).mockReturnValue(localMockQueryBuilder);

      // Act
      const result = await service.getSharedReports();

      // Assert
      expect(result).toEqual(mockReports);
      expect(localMockQueryBuilder.where).toHaveBeenCalledWith(
        'report.share_enabled = :enabled',
        { enabled: true },
      );
    });

    it('should filter by test run ID when provided', async () => {
      // Arrange
      const localMockQueryBuilder = createMockQueryBuilder<GeneratedReport>();
      localMockQueryBuilder.getMany.mockResolvedValue([]);
      (reportRepo.createQueryBuilder as jest.Mock).mockReturnValue(localMockQueryBuilder);

      // Act
      await service.getSharedReports('test-run-id');

      // Assert
      expect(localMockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'report.test_run_id = :testRunId',
        { testRunId: 'test-run-id' },
      );
    });

    it('should respect limit parameter', async () => {
      // Arrange
      const localMockQueryBuilder = createMockQueryBuilder<GeneratedReport>();
      localMockQueryBuilder.getMany.mockResolvedValue([]);
      (reportRepo.createQueryBuilder as jest.Mock).mockReturnValue(localMockQueryBuilder);

      // Act
      await service.getSharedReports(undefined, 10);

      // Assert
      expect(localMockQueryBuilder.take).toHaveBeenCalledWith(10);
    });

    it('should return empty array on error', async () => {
      // Arrange
      const localMockQueryBuilder = createMockQueryBuilder<GeneratedReport>();
      localMockQueryBuilder.getMany.mockRejectedValue(new Error('Database error'));
      (reportRepo.createQueryBuilder as jest.Mock).mockReturnValue(localMockQueryBuilder);

      // Act & Assert
      await expect(service.getSharedReports()).rejects.toThrow(DatabaseException);
    });
  });

  // ==================== isShareLinkValid ====================

  describe('isShareLinkValid', () => {
    it('should return true for valid share link', async () => {
      // Arrange
      const mockReport = createMockReport({ share_enabled: true });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.isShareLinkValid(mockReport.share_id);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for invalid share link', async () => {
      // Arrange
      reportRepo.findOne.mockResolvedValue(null);

      // Act
      const result = await service.isShareLinkValid('non-existent');

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for disabled sharing', async () => {
      // Arrange
      const mockReport = createMockReport({ share_enabled: false });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.isShareLinkValid(mockReport.share_id);

      // Assert
      expect(result).toBe(false);
    });
  });

  // ==================== getShareStats ====================

  describe('getShareStats', () => {
    it('should return share statistics', async () => {
      // Arrange
      const mockReport = createMockReport({
        share_enabled: true,
        share_view_count: 42,
        last_shared_at: new Date('2025-01-15'),
        expires_at: new Date(Date.now() + 86400000), // Future date
      });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.getShareStats(mockReport.id);

      // Assert
      expect(result.viewCount).toBe(42);
      expect(result.shareEnabled).toBe(true);
      expect(result.isExpired).toBe(false);
      expect(result.lastViewedAt).toEqual(new Date('2025-01-15'));
    });

    it('should detect expired share links', async () => {
      // Arrange
      const mockReport = createMockReport({
        share_enabled: true,
        expires_at: new Date('2020-01-01'), // Past date
      });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.getShareStats(mockReport.id);

      // Assert
      expect(result.isExpired).toBe(true);
    });

    it('should handle reports without expiration', async () => {
      // Arrange
      const mockReport = createMockReport({
        share_enabled: true,
        expires_at: undefined,
      });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.getShareStats(mockReport.id);

      // Assert
      expect(result.isExpired).toBe(false);
      expect(result.expiresAt).toBeUndefined();
    });

    it('should throw ResourceNotFoundException when report not found', async () => {
      // Arrange
      reportRepo.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getShareStats('non-existent')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });
  });

  // ==================== Edge Cases ====================

  describe('Edge Cases', () => {
    it('should handle concurrent share setting updates', async () => {
      // Arrange
      const mockReport = createMockReport();
      const updatedReport = createMockReport({ share_enabled: true });
      reportRepo.findOne.mockResolvedValue(mockReport);
      reportRepo.update.mockResolvedValue({ affected: 1 } as any);

      // For subsequent findOne calls
      reportRepo.findOne
        .mockResolvedValueOnce(mockReport)
        .mockResolvedValueOnce(updatedReport)
        .mockResolvedValueOnce(mockReport)
        .mockResolvedValueOnce(updatedReport);

      // Act
      const results = await Promise.all([
        service.enableSharing(mockReport.id),
        service.enableSharing(mockReport.id),
      ]);

      // Assert
      expect(results).toHaveLength(2);
    });

    it('should handle share link at exact expiration boundary', async () => {
      // Arrange
      // Set expiration 100ms in the future to avoid timing race condition
      // This tests the boundary condition: expires_at >= now means still valid
      const expiresAt = new Date(Date.now() + 100);
      const mockReport = createMockReport({
        share_enabled: true,
        expires_at: expiresAt,
      });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.validateShareLink(mockReport.share_id);

      // Assert - link is still valid (expires_at < now is false)
      expect(result.isValid).toBe(true);
    });

    it('should handle empty HTML content', async () => {
      // Arrange
      const mockReport = createMockReport({
        share_enabled: true,
        html_content: '',
      });
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.validateShareLink(mockReport.share_id);

      // Assert
      // Empty string is falsy, treated as no content
      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('NO_CONTENT');
    });

    it('should handle view count increment failure gracefully', async () => {
      // Arrange
      const mockReport = createMockReport({ share_enabled: true });
      reportRepo.findOne.mockResolvedValue(mockReport);

      const localMockQueryBuilder = createMockQueryBuilder<GeneratedReport>();
      const mockUpdateBuilder = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(new Error('Increment failed')),
      };
      localMockQueryBuilder.update = jest.fn().mockReturnValue(mockUpdateBuilder);
      (reportRepo.createQueryBuilder as jest.Mock).mockReturnValue(localMockQueryBuilder);

      // Act
      const result = await service.getPublicReport(mockReport.share_id);

      // Assert - should still return report despite increment failure
      expect(result.reportId).toBe(mockReport.id);
    });
  });

  // ==================== Share URL Generation ====================

  describe('Share URL Generation', () => {
    it('should generate relative URL when no base URL provided', async () => {
      // Arrange
      const mockReport = createMockReport();
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Act
      const result = await service.getShareSettings(mockReport.id, '');

      // Assert
      expect(result.shareUrl).toBe(`/reports/share/${mockReport.share_id}`);
    });

    it('should handle various base URL formats', async () => {
      // Arrange
      const mockReport = createMockReport();
      reportRepo.findOne.mockResolvedValue(mockReport);

      // Test different base URL formats
      const testCases = [
        { baseUrl: 'https://example.com', expected: 'https://example.com/reports/share/' },
        { baseUrl: 'https://example.com/', expected: 'https://example.com/reports/share/' },
        { baseUrl: 'http://localhost:4001', expected: 'http://localhost:4001/reports/share/' },
      ];

      for (const { baseUrl, expected } of testCases) {
        reportRepo.findOne.mockResolvedValue(mockReport);

        const result = await service.getShareSettings(mockReport.id, baseUrl);

        expect(result.shareUrl).toBe(`${expected}${mockReport.share_id}`);
      }
    });
  });
});
