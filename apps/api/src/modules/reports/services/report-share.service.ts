import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GeneratedReport } from '@perfana/shared';
import {
  ResourceNotFoundException,
  DatabaseException,
  ValidationException,
} from '../../../common/exceptions/business.exception';

// ==================== Interfaces ====================

/**
 * Options for updating share settings
 */
export interface UpdateShareSettingsOptions {
  shareEnabled?: boolean;
  expiresAt?: Date | null;
}

/**
 * Share settings response
 */
export interface ShareSettingsResponse {
  reportId: string;
  shareId: string;
  shareEnabled: boolean;
  shareViewCount: number;
  lastSharedAt?: Date;
  expiresAt?: Date;
  shareUrl: string;
}

/**
 * Public share response for unauthenticated access
 */
export interface PublicShareResponse {
  reportId: string;
  reportName: string;
  htmlContent: string;
  generatedAt?: Date;
  generatedBy: string;
}

/**
 * Share validation result
 */
export interface ShareValidationResult {
  isValid: boolean;
  report?: GeneratedReport;
  errorCode?: 'NOT_FOUND' | 'SHARING_DISABLED' | 'EXPIRED' | 'NO_CONTENT';
  errorMessage?: string;
}

// ==================== Service ====================

/**
 * Service for managing report public sharing.
 *
 * Handles:
 * - Enabling/disabling public sharing
 * - View count tracking
 * - Share link expiration
 * - Public access validation
 */
@Injectable()
export class ReportShareService {
  private readonly logger = new Logger(ReportShareService.name);

  constructor(
    @InjectRepository(GeneratedReport)
    private readonly reportRepo: Repository<GeneratedReport>,
  ) {}

  // ==================== Share Settings Operations ====================

  /**
   * Get share settings for a report
   * @param reportId - Report UUID
   * @param baseUrl - Base URL for generating share links
   * @returns Share settings including the share URL
   */
  async getShareSettings(reportId: string, baseUrl: string = ''): Promise<ShareSettingsResponse> {
    try {
      const report = await this.reportRepo.findOne({
        where: { id: reportId },
      });

      if (!report) {
        throw new ResourceNotFoundException('Report', reportId);
      }

      return this.buildShareSettingsResponse(report, baseUrl);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to get share settings: ${(error as Error).message}`);
      throw new DatabaseException('Failed to get share settings', error);
    }
  }

  /**
   * Update share settings for a report
   * @param reportId - Report UUID
   * @param options - Share settings to update
   * @param baseUrl - Base URL for generating share links
   * @returns Updated share settings
   */
  async updateShareSettings(
    reportId: string,
    options: UpdateShareSettingsOptions,
    baseUrl: string = '',
  ): Promise<ShareSettingsResponse> {
    try {
      const report = await this.reportRepo.findOne({
        where: { id: reportId },
      });

      if (!report) {
        throw new ResourceNotFoundException('Report', reportId);
      }

      // Validate expiration date if provided
      if (options.expiresAt !== undefined && options.expiresAt !== null) {
        const expiresAt = new Date(options.expiresAt);
        if (expiresAt <= new Date()) {
          throw new ValidationException('Expiration date must be in the future');
        }
      }

      // Build update data
      const updateData: Partial<GeneratedReport> = {};

      if (options.shareEnabled !== undefined) {
        updateData.share_enabled = options.shareEnabled;

        // Update lastSharedAt when enabling sharing
        if (options.shareEnabled) {
          updateData.last_shared_at = new Date();
        }
      }

      if (options.expiresAt !== undefined) {
        updateData.expires_at = options.expiresAt || undefined;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.reportRepo.update(reportId, updateData as any);

      const updatedReport = await this.reportRepo.findOne({
        where: { id: reportId },
      });

      if (!updatedReport) {
        throw new ResourceNotFoundException('Report', reportId);
      }

      this.logger.log(
        `Updated share settings for report ${reportId}: enabled=${updatedReport.share_enabled}`,
      );

      return this.buildShareSettingsResponse(updatedReport, baseUrl);
    } catch (error) {
      if (error instanceof ResourceNotFoundException || error instanceof ValidationException) {
        throw error;
      }
      this.logger.error(`Failed to update share settings: ${(error as Error).message}`);
      throw new DatabaseException('Failed to update share settings', error);
    }
  }

  /**
   * Enable sharing for a report
   * @param reportId - Report UUID
   * @param expiresAt - Optional expiration date
   * @param baseUrl - Base URL for generating share links
   * @returns Updated share settings
   */
  async enableSharing(
    reportId: string,
    expiresAt?: Date,
    baseUrl: string = '',
  ): Promise<ShareSettingsResponse> {
    return this.updateShareSettings(
      reportId,
      { shareEnabled: true, expiresAt: expiresAt || null },
      baseUrl,
    );
  }

  /**
   * Disable sharing for a report
   * @param reportId - Report UUID
   * @param baseUrl - Base URL for generating share links
   * @returns Updated share settings
   */
  async disableSharing(reportId: string, baseUrl: string = ''): Promise<ShareSettingsResponse> {
    return this.updateShareSettings(reportId, { shareEnabled: false }, baseUrl);
  }

  /**
   * Regenerate share ID for a report (creates a new unique share link)
   * @param reportId - Report UUID
   * @param baseUrl - Base URL for generating share links
   * @returns Updated share settings with new share ID
   */
  async regenerateShareId(reportId: string, baseUrl: string = ''): Promise<ShareSettingsResponse> {
    try {
      const report = await this.reportRepo.findOne({
        where: { id: reportId },
      });

      if (!report) {
        throw new ResourceNotFoundException('Report', reportId);
      }

      // Generate new UUID using database function
      await this.reportRepo
        .createQueryBuilder()
        .update(GeneratedReport)
        .set({
          // Use raw SQL to generate new UUID
          share_view_count: 0, // Reset view count
          last_shared_at: new Date(),
        })
        .where('id = :id', { id: reportId })
        .execute();

      // Update share_id using raw query (to use gen_random_uuid())
      await this.reportRepo.query(
        'UPDATE generated_reports SET share_id = gen_random_uuid() WHERE id = $1',
        [reportId],
      );

      const updatedReport = await this.reportRepo.findOne({
        where: { id: reportId },
      });

      if (!updatedReport) {
        throw new ResourceNotFoundException('Report', reportId);
      }

      this.logger.log(`Regenerated share ID for report ${reportId}`);

      return this.buildShareSettingsResponse(updatedReport, baseUrl);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to regenerate share ID: ${(error as Error).message}`);
      throw new DatabaseException('Failed to regenerate share ID', error);
    }
  }

  // ==================== Public Access Operations ====================

  /**
   * Validate a share link and get report for public access
   * @param shareId - Share UUID from the public link
   * @returns Validation result with report if valid
   */
  async validateShareLink(shareId: string): Promise<ShareValidationResult> {
    try {
      const report = await this.reportRepo.findOne({
        where: { share_id: shareId },
      });

      // Report not found
      if (!report) {
        return {
          isValid: false,
          errorCode: 'NOT_FOUND',
          errorMessage: 'Shared report not found',
        };
      }

      // Sharing disabled
      if (!report.share_enabled) {
        return {
          isValid: false,
          report,
          errorCode: 'SHARING_DISABLED',
          errorMessage: 'Sharing is not enabled for this report',
        };
      }

      // Check expiration
      if (report.expires_at && new Date(report.expires_at) < new Date()) {
        return {
          isValid: false,
          report,
          errorCode: 'EXPIRED',
          errorMessage: 'This share link has expired',
        };
      }

      // No HTML content available
      if (!report.html_content) {
        return {
          isValid: false,
          report,
          errorCode: 'NO_CONTENT',
          errorMessage: 'Report content is not yet available',
        };
      }

      return {
        isValid: true,
        report,
      };
    } catch (error) {
      this.logger.error(`Failed to validate share link: ${(error as Error).message}`);
      throw new DatabaseException('Failed to validate share link', error);
    }
  }

  /**
   * Get report content for public share access
   * Also increments the view count.
   * @param shareId - Share UUID from the public link
   * @returns Report content for public display
   */
  async getPublicReport(shareId: string): Promise<PublicShareResponse> {
    try {
      const validation = await this.validateShareLink(shareId);

      if (!validation.isValid) {
        // Map error codes to appropriate exceptions
        switch (validation.errorCode) {
          case 'NOT_FOUND':
            throw new ResourceNotFoundException('Shared Report', shareId);
          case 'SHARING_DISABLED':
            throw new ValidationException('Sharing is not enabled for this report');
          case 'EXPIRED':
            throw new ValidationException('This share link has expired');
          case 'NO_CONTENT':
            throw new ValidationException('Report content is not yet available');
          default:
            throw new ValidationException('Unable to access shared report');
        }
      }

      const report = validation.report!;

      // Increment view count asynchronously (don't wait)
      this.incrementViewCount(report.id).catch((err) =>
        this.logger.warn(`Failed to increment view count for report ${report.id}: ${err}`),
      );

      return {
        reportId: report.id,
        reportName: report.name,
        htmlContent: report.html_content!,
        generatedAt: report.html_generated_at,
        generatedBy: report.generated_by,
      };
    } catch (error) {
      if (error instanceof ResourceNotFoundException || error instanceof ValidationException) {
        throw error;
      }
      this.logger.error(`Failed to get public report: ${(error as Error).message}`);
      throw new DatabaseException('Failed to get public report', error);
    }
  }

  /**
   * Get pre-generated PDF for a publicly shared report.
   * Returns the stored PDF data if available, null if PDF has not been generated yet.
   */
  async getPublicReportPdf(
    shareId: string,
  ): Promise<{ reportName: string; pdfData: Buffer } | null> {
    const validation = await this.validateShareLink(shareId);

    if (!validation.isValid) {
      switch (validation.errorCode) {
        case 'NOT_FOUND':
          throw new ResourceNotFoundException('Shared Report', shareId);
        case 'SHARING_DISABLED':
          throw new ValidationException('Sharing is not enabled for this report');
        case 'EXPIRED':
          throw new ValidationException('This share link has expired');
        case 'NO_CONTENT':
          throw new ValidationException('Report content is not yet available');
        default:
          throw new ValidationException('Unable to access shared report');
      }
    }

    const report = validation.report!;

    // Increment view count asynchronously
    this.incrementViewCount(report.id).catch((err) =>
      this.logger.warn(`Failed to increment view count for report ${report.id}: ${err}`),
    );

    if (!report.pdf_data) {
      return null;
    }

    return {
      reportName: report.name,
      pdfData: report.pdf_data,
    };
  }

  /**
   * Increment the view count for a report
   * @param reportId - Report UUID
   */
  async incrementViewCount(reportId: string): Promise<void> {
    try {
      await this.reportRepo
        .createQueryBuilder()
        .update(GeneratedReport)
        .set({
          share_view_count: () => 'share_view_count + 1',
        })
        .where('id = :id', { id: reportId })
        .execute();

      this.logger.debug(`Incremented view count for report ${reportId}`);
    } catch (error) {
      // Don't throw - view count increment is non-critical
      this.logger.warn(`Failed to increment view count: ${(error as Error).message}`);
    }
  }

  // ==================== Query Operations ====================

  /**
   * Find report by share ID (for internal use)
   * @param shareId - Share UUID
   * @returns Report entity or null
   */
  async findByShareId(shareId: string): Promise<GeneratedReport | null> {
    try {
      return await this.reportRepo.findOne({
        where: { share_id: shareId },
        relations: ['template'],
      });
    } catch (error) {
      this.logger.error(`Failed to find report by share ID: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Get shared reports (reports with sharing enabled)
   * @param testRunId - Optional test run ID filter
   * @param limit - Maximum results
   * @returns List of shared reports
   */
  async getSharedReports(testRunId?: string, limit: number = 50): Promise<GeneratedReport[]> {
    try {
      const queryBuilder = this.reportRepo
        .createQueryBuilder('report')
        .where('report.share_enabled = :enabled', { enabled: true });

      if (testRunId) {
        queryBuilder.andWhere('report.test_run_id = :testRunId', { testRunId });
      }

      return await queryBuilder
        .orderBy('report.last_shared_at', 'DESC')
        .take(limit)
        .getMany();
    } catch (error) {
      this.logger.error(`Failed to get shared reports: ${(error as Error).message}`);
      throw new DatabaseException('Failed to get shared reports', error);
    }
  }

  /**
   * Check if a share link is valid without incrementing view count
   * @param shareId - Share UUID
   * @returns True if valid, false otherwise
   */
  async isShareLinkValid(shareId: string): Promise<boolean> {
    const validation = await this.validateShareLink(shareId);
    return validation.isValid;
  }

  // ==================== Statistics Operations ====================

  /**
   * Get share statistics for a report
   * @param reportId - Report UUID
   * @returns Share statistics
   */
  async getShareStats(reportId: string): Promise<{
    viewCount: number;
    lastViewedAt?: Date;
    shareEnabled: boolean;
    expiresAt?: Date;
    isExpired: boolean;
  }> {
    try {
      const report = await this.reportRepo.findOne({
        where: { id: reportId },
      });

      if (!report) {
        throw new ResourceNotFoundException('Report', reportId);
      }

      const isExpired = report.expires_at ? new Date(report.expires_at) < new Date() : false;

      return {
        viewCount: report.share_view_count,
        lastViewedAt: report.last_shared_at,
        shareEnabled: report.share_enabled,
        expiresAt: report.expires_at,
        isExpired,
      };
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to get share stats: ${(error as Error).message}`);
      throw new DatabaseException('Failed to get share stats', error);
    }
  }

  // ==================== Private Helper Methods ====================

  /**
   * Build share settings response from report entity
   */
  private buildShareSettingsResponse(
    report: GeneratedReport,
    baseUrl: string,
  ): ShareSettingsResponse {
    const shareUrl = this.buildShareUrl(report.share_id, baseUrl);

    return {
      reportId: report.id,
      shareId: report.share_id,
      shareEnabled: report.share_enabled,
      shareViewCount: report.share_view_count,
      lastSharedAt: report.last_shared_at,
      expiresAt: report.expires_at,
      shareUrl,
    };
  }

  /**
   * Build the full share URL
   */
  private buildShareUrl(shareId: string, baseUrl: string): string {
    // If baseUrl is provided, use it; otherwise return relative path
    if (baseUrl) {
      const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      return `${normalizedBaseUrl}/reports/share/${shareId}`;
    }
    return `/reports/share/${shareId}`;
  }
}
