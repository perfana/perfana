/**
 * Unit tests for ReportShareController
 *
 * Tests for public report sharing controller including:
 * - Public report access by share ID
 * - Error handling for invalid/expired/disabled shares
 * - Health check endpoint
 * - Edge cases and security scenarios
 */

// Mock TypeORM decorators before any imports
jest.mock('@nestjs/typeorm', () => ({
  ...jest.requireActual('@nestjs/typeorm'),
  InjectRepository: () => () => undefined,
}));

import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ReportShareController } from '../controllers/report-share.controller';
import { ReportShareService } from '../services/report-share.service';
import { ShareParamsDto } from '../dto';

describe('ReportShareController', () => {
  let controller: ReportShareController;
  let reportShareService: jest.Mocked<ReportShareService>;

  // ==================== Mock Factories ====================

  const createMockPublicReport = (overrides?: Record<string, unknown>) => ({
    reportId: '123e4567-e89b-12d3-a456-426614174001',
    reportName: 'Test Report',
    htmlContent: '<html><body>Report Content</body></html>',
    generatedBy: 'test-user@example.com',
    generatedAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportShareController],
      providers: [
        {
          provide: ReportShareService,
          useValue: {
            getPublicReport: jest.fn(),
            validateShareLink: jest.fn(),
            findByShareId: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ReportShareController>(ReportShareController);
    reportShareService = module.get(ReportShareService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Module Initialization', () => {
    it('should be defined', () => {
      expect(controller).toBeDefined();
    });

    it('should have service injected', () => {
      expect(reportShareService).toBeDefined();
    });
  });

  // ==================== Public Report Access ====================

  describe('getPublicReport', () => {
    it('should return public report content', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'share-uuid-001' };
      const mockPublicReport = createMockPublicReport();
      reportShareService.getPublicReport.mockResolvedValue(mockPublicReport);

      // Act
      const result = await controller.getPublicReport(params);

      // Assert
      expect(result.html_content).toBe('<html><body>Report Content</body></html>');
      expect(result.name).toBe('Test Report');
      expect(result.generated_at).toBeDefined();
      expect(reportShareService.getPublicReport).toHaveBeenCalledWith('share-uuid-001');
    });

    it('should return report with all fields', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'share-uuid-001' };
      const mockPublicReport = createMockPublicReport({
        htmlContent: '<!DOCTYPE html><html><head></head><body>Full Report</body></html>',
        reportName: 'Performance Analysis Report - January 2026',
        generatedAt: new Date('2026-01-15T14:30:00Z'),
      });
      reportShareService.getPublicReport.mockResolvedValue(mockPublicReport);

      // Act
      const result = await controller.getPublicReport(params);

      // Assert
      expect(result.html_content).toContain('<!DOCTYPE html>');
      expect(result.name).toBe('Performance Analysis Report - January 2026');
      expect(result.generated_at).toEqual(new Date('2026-01-15T14:30:00Z'));
    });

    it('should handle missing generatedAt with current date', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'share-uuid-001' };
      const mockPublicReport = createMockPublicReport({
        generatedAt: undefined,
      });
      reportShareService.getPublicReport.mockResolvedValue(mockPublicReport);

      // Act
      const result = await controller.getPublicReport(params);

      // Assert
      expect(result.generated_at).toBeDefined();
      expect(result.generated_at instanceof Date).toBe(true);
    });

    // ==================== Error Scenarios ====================

    it('should throw NOT_FOUND when report not found', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'non-existent' };
      reportShareService.getPublicReport.mockRejectedValue(
        new Error('Shared Report not found'),
      );

      // Act & Assert
      await expect(controller.getPublicReport(params)).rejects.toThrow(HttpException);
      await expect(controller.getPublicReport(params)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('should throw NOT_FOUND when sharing is disabled', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'disabled-share' };
      reportShareService.getPublicReport.mockRejectedValue(
        new Error('Sharing is not enabled for this report'),
      );

      // Act & Assert
      await expect(controller.getPublicReport(params)).rejects.toThrow(HttpException);
      await expect(controller.getPublicReport(params)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('should throw NOT_FOUND when share link has expired', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'expired-share' };
      reportShareService.getPublicReport.mockRejectedValue(
        new Error('The share link has expired'),
      );

      // Act & Assert
      await expect(controller.getPublicReport(params)).rejects.toThrow(HttpException);
      await expect(controller.getPublicReport(params)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('should throw NOT_FOUND when content is not yet available', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'pending-report' };
      reportShareService.getPublicReport.mockRejectedValue(
        new Error('Report content is not yet available'),
      );

      // Act & Assert
      await expect(controller.getPublicReport(params)).rejects.toThrow(HttpException);
      await expect(controller.getPublicReport(params)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('should throw INTERNAL_SERVER_ERROR for unknown errors', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'share-uuid-001' };
      reportShareService.getPublicReport.mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(controller.getPublicReport(params)).rejects.toThrow(HttpException);
      await expect(controller.getPublicReport(params)).rejects.toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      });
    });

    it('should handle non-Error thrown values', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'share-uuid-001' };
      reportShareService.getPublicReport.mockRejectedValue('String error');

      // Act & Assert
      await expect(controller.getPublicReport(params)).rejects.toThrow(HttpException);
      await expect(controller.getPublicReport(params)).rejects.toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      });
    });
  });

  // ==================== Health Check ====================

  describe('getHealth', () => {
    it('should return health check status', () => {
      // Act
      const result = controller.getHealth();

      // Assert
      expect(result).toEqual({
        status: 'ok',
        module: 'reports-share',
      });
    });

    it('should be a synchronous method', () => {
      // Act
      const result = controller.getHealth();

      // Assert - should not be a promise
      expect(result).not.toBeInstanceOf(Promise);
      expect(result.status).toBe('ok');
    });
  });

  // ==================== Concurrent Operations ====================

  describe('Concurrent Operations', () => {
    it('should handle concurrent public report requests', async () => {
      // Arrange
      const mockPublicReport = createMockPublicReport();
      reportShareService.getPublicReport.mockResolvedValue(mockPublicReport);

      // Act
      const promises = [
        controller.getPublicReport({ shareId: 'share-1' }),
        controller.getPublicReport({ shareId: 'share-2' }),
        controller.getPublicReport({ shareId: 'share-3' }),
      ];
      const results = await Promise.all(promises);

      // Assert
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.html_content).toBeDefined();
        expect(result.name).toBeDefined();
      });
      expect(reportShareService.getPublicReport).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed success and failure concurrent requests', async () => {
      // Arrange
      reportShareService.getPublicReport
        .mockResolvedValueOnce(createMockPublicReport())
        .mockRejectedValueOnce(new Error('Shared Report not found'))
        .mockResolvedValueOnce(createMockPublicReport());

      // Act
      const promises = [
        controller.getPublicReport({ shareId: 'share-1' }).catch((e) => e),
        controller.getPublicReport({ shareId: 'share-2' }).catch((e) => e),
        controller.getPublicReport({ shareId: 'share-3' }).catch((e) => e),
      ];
      const results = await Promise.all(promises);

      // Assert
      expect(results[0]).toHaveProperty('html_content');
      expect(results[1]).toBeInstanceOf(HttpException);
      expect(results[2]).toHaveProperty('html_content');
    });
  });

  // ==================== Edge Cases ====================

  describe('Edge Cases', () => {
    it('should handle very long share IDs', async () => {
      // Arrange
      const longShareId = 'a'.repeat(100);
      const params: ShareParamsDto = { shareId: longShareId };
      reportShareService.getPublicReport.mockRejectedValue(
        new Error('Shared Report not found'),
      );

      // Act & Assert
      await expect(controller.getPublicReport(params)).rejects.toThrow(HttpException);
      expect(reportShareService.getPublicReport).toHaveBeenCalledWith(longShareId);
    });

    it('should handle share ID with special characters', async () => {
      // Arrange - UUID format is validated by DTO, but test edge case
      const params: ShareParamsDto = { shareId: '123e4567-e89b-12d3-a456-426614174000' };
      reportShareService.getPublicReport.mockResolvedValue(createMockPublicReport());

      // Act
      const result = await controller.getPublicReport(params);

      // Assert
      expect(result.html_content).toBeDefined();
    });

    it('should handle empty HTML content', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'share-uuid-001' };
      const mockPublicReport = createMockPublicReport({
        htmlContent: '',
      });
      reportShareService.getPublicReport.mockResolvedValue(mockPublicReport);

      // Act
      const result = await controller.getPublicReport(params);

      // Assert
      expect(result.html_content).toBe('');
    });

    it('should handle HTML content with special characters', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'share-uuid-001' };
      const specialHtml = '<html><body>Report with &amp; special &lt;chars&gt;</body></html>';
      const mockPublicReport = createMockPublicReport({
        htmlContent: specialHtml,
      });
      reportShareService.getPublicReport.mockResolvedValue(mockPublicReport);

      // Act
      const result = await controller.getPublicReport(params);

      // Assert
      expect(result.html_content).toBe(specialHtml);
    });

    it('should handle HTML content with Unicode characters', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'share-uuid-001' };
      const unicodeHtml = '<html><body>Performance Report 性能报告 🚀</body></html>';
      const mockPublicReport = createMockPublicReport({
        htmlContent: unicodeHtml,
      });
      reportShareService.getPublicReport.mockResolvedValue(mockPublicReport);

      // Act
      const result = await controller.getPublicReport(params);

      // Assert
      expect(result.html_content).toBe(unicodeHtml);
    });

    it('should handle very large HTML content', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'share-uuid-001' };
      const largeHtml = `<html><body>${'<p>Content</p>'.repeat(10000)}</body></html>`;
      const mockPublicReport = createMockPublicReport({
        htmlContent: largeHtml,
      });
      reportShareService.getPublicReport.mockResolvedValue(mockPublicReport);

      // Act
      const result = await controller.getPublicReport(params);

      // Assert
      expect(result.html_content.length).toBeGreaterThan(100000);
    });

    it('should handle report name with special characters', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'share-uuid-001' };
      const specialName = 'Performance Report - Q1 2026 (v2.0) [Final]';
      const mockPublicReport = createMockPublicReport({
        reportName: specialName,
      });
      reportShareService.getPublicReport.mockResolvedValue(mockPublicReport);

      // Act
      const result = await controller.getPublicReport(params);

      // Assert
      expect(result.name).toBe(specialName);
    });
  });

  // ==================== Security Scenarios ====================

  describe('Security Scenarios', () => {
    it('should not expose internal error details', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'share-uuid-001' };
      reportShareService.getPublicReport.mockRejectedValue(
        new Error('CRITICAL: Database credentials exposed in error'),
      );

      // Act & Assert
      try {
        await controller.getPublicReport(params);
        fail('Expected HttpException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const httpError = error as HttpException;
        // Should return generic message, not the internal error
        expect(httpError.message).toBe('Failed to retrieve shared report');
      }
    });

    it('should handle potential SQL injection in share ID', async () => {
      // Arrange - DTO validation would normally catch this, but test controller behavior
      const params: ShareParamsDto = { shareId: "'; DROP TABLE reports; --" } as any;
      reportShareService.getPublicReport.mockRejectedValue(
        new Error('Shared Report not found'),
      );

      // Act & Assert
      await expect(controller.getPublicReport(params)).rejects.toThrow(HttpException);
      expect(reportShareService.getPublicReport).toHaveBeenCalledWith(params.shareId);
    });

    it('should handle XSS attempt in response gracefully', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'share-uuid-001' };
      const xssHtml = '<html><body><script>alert("XSS")</script></body></html>';
      const mockPublicReport = createMockPublicReport({
        htmlContent: xssHtml,
      });
      reportShareService.getPublicReport.mockResolvedValue(mockPublicReport);

      // Act
      const result = await controller.getPublicReport(params);

      // Assert - Controller returns HTML as-is; frontend handles sandboxing
      expect(result.html_content).toBe(xssHtml);
    });
  });

  // ==================== Error Message Mapping ====================

  describe('Error Message Mapping', () => {
    const notFoundMessages = [
      'not found',
      'Shared Report',
      'Sharing is not enabled',
      'share link has expired',
      'content is not yet available',
    ];

    notFoundMessages.forEach((message) => {
      it(`should return 404 for error containing "${message}"`, async () => {
        // Arrange
        const params: ShareParamsDto = { shareId: 'share-uuid-001' };
        reportShareService.getPublicReport.mockRejectedValue(new Error(message));

        // Act & Assert
        await expect(controller.getPublicReport(params)).rejects.toMatchObject({
          status: HttpStatus.NOT_FOUND,
        });
      });
    });

    const internalErrorMessages = [
      'Database connection failed',
      'Internal server error',
      'Unexpected error occurred',
    ];

    internalErrorMessages.forEach((message) => {
      it(`should return 500 for error "${message}"`, async () => {
        // Arrange
        const params: ShareParamsDto = { shareId: 'share-uuid-001' };
        reportShareService.getPublicReport.mockRejectedValue(new Error(message));

        // Act & Assert
        await expect(controller.getPublicReport(params)).rejects.toMatchObject({
          status: HttpStatus.INTERNAL_SERVER_ERROR,
        });
      });
    });
  });

  // ==================== Response Format ====================

  describe('Response Format', () => {
    it('should return response with correct field names', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'share-uuid-001' };
      const mockPublicReport = createMockPublicReport();
      reportShareService.getPublicReport.mockResolvedValue(mockPublicReport);

      // Act
      const result = await controller.getPublicReport(params);

      // Assert - should use snake_case for API response
      expect(result).toHaveProperty('html_content');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('generated_at');
      // Should NOT have camelCase properties
      expect(result).not.toHaveProperty('htmlContent');
      expect(result).not.toHaveProperty('generatedAt');
    });

    it('should return Date object for generated_at', async () => {
      // Arrange
      const params: ShareParamsDto = { shareId: 'share-uuid-001' };
      const mockPublicReport = createMockPublicReport({
        generatedAt: new Date('2026-01-15T10:00:00Z'),
      });
      reportShareService.getPublicReport.mockResolvedValue(mockPublicReport);

      // Act
      const result = await controller.getPublicReport(params);

      // Assert
      expect(result.generated_at).toBeInstanceOf(Date);
    });
  });
});
