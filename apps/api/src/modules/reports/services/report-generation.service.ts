import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  GeneratedReport,
  ReportTemplate,
  TestRun,
  ReportStatus,
  ReportSectionConfig,
  ReportStyling,
} from '@perfana/shared';
import {
  ResourceNotFoundException,
  DatabaseException,
  ValidationException,
  InvalidStateException,
} from '../../../common/exceptions/business.exception';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { ReportGenerationValidatorService } from './report-generation-validator.service';
import { ReportUtilsService } from './report-utils.service';
import { ReportHtmlCompilerService } from './report-html-compiler.service';

/**
 * Global admin roles that bypass organization filtering
 */
const ADMIN_ROLES = ['perfana-admin', 'super-admin', 'admin'];

// ==================== Interfaces ====================

/**
 * Options for creating a new report from a template
 */
export interface CreateReportFromTemplateOptions {
  testRunId: string;
  templateId: string;
  name?: string;
  generatedBy: string;
  userId?: string;
  roles?: string[];
}

/**
 * Options for creating an ad-hoc report
 */
export interface CreateAdHocReportOptions {
  testRunId: string;
  name: string;
  sections: ReportSectionConfig[];
  styling?: ReportStyling;
  generatedBy: string;
  templateId?: string; // If saving as template
  saveAsTemplate?: boolean; // Whether to save configuration as a reusable template
  templateName?: string; // Name for the saved template (required if saveAsTemplate is true)
  templateDescription?: string; // Description for the saved template
  userId?: string;
  roles?: string[];
}

/**
 * Options for listing reports
 */
export interface ListReportsQueryOptions {
  status?: ReportStatus;
  limit?: number;
  offset?: number;
  sortBy?: 'created_at' | 'name' | 'status';
  sortOrder?: 'asc' | 'desc';
  userId?: string;
  roles?: string[];
}

/**
 * Paginated report list response
 */
export interface ReportListResponse {
  items: GeneratedReport[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Report summary for test run card
 */
export interface ReportSummaryResponse {
  totalReports: number;
  completedReports: number;
  pendingReports: number;
  failedReports: number;
  latestReport?: GeneratedReport;
  totalDownloads: number;
  totalShareViews: number;
}

/**
 * HTML generation result
 */
export interface HtmlGenerationResult {
  html: string;
  generationTimeMs: number;
  sectionCount: number;
}

// ==================== Service ====================

/**
 * Service for report generation operations (Orchestrator)
 *
 * Thin orchestrator that delegates to specialized services:
 * - ReportGenerationValidatorService: Status validation
 * - ReportUtilsService: Utility functions
 * - ReportHtmlCompilerService: HTML compilation and section rendering
 *
 * Status flow: pending -> processing -> html_complete (-> pdf_processing -> pdf_complete)
 */
@Injectable()
export class ReportGenerationService {
  private readonly logger = new Logger(ReportGenerationService.name);

  constructor(
    @InjectRepository(GeneratedReport)
    private readonly reportRepo: Repository<GeneratedReport>,
    @InjectRepository(ReportTemplate)
    private readonly templateRepo: Repository<ReportTemplate>,
    @InjectRepository(TestRun)
    private readonly testRunRepo: Repository<TestRun>,
    private readonly authzService: AuthorizationService,
    private readonly validator: ReportGenerationValidatorService,
    private readonly utils: ReportUtilsService,
    private readonly htmlCompiler: ReportHtmlCompilerService,
  ) {}

  // ==================== Authorization Helpers ====================

  /**
   * Check if a user has global admin role
   */
  private isGlobalAdmin(roles: string[]): boolean {
    return roles.some(role => ADMIN_ROLES.includes(role));
  }

  /**
   * Apply organization filtering to a report query builder.
   * Uses test_run.organization_id directly with backward compatibility for legacy data (NULL org).
   */
  private applyReportOrganizationFilter(
    queryBuilder: SelectQueryBuilder<GeneratedReport>,
    organizationIds: string[],
    reportAlias: string = 'report',
  ): void {
    queryBuilder
      .leftJoin(`${reportAlias}.test_run`, 'tr_org')
      .andWhere(
        '(tr_org.organization_id IN (:...orgIds) OR tr_org.organization_id IS NULL)',
        { orgIds: organizationIds },
      );
  }

  /**
   * Check if a test run belongs to one of the user's accessible organizations
   * @returns true if accessible, false otherwise
   */
  private async isTestRunAccessible(
    testRunId: string,
    userId: string,
    roles: string[],
  ): Promise<{ accessible: boolean; testRun: TestRun | null }> {
    const isAdmin = this.isGlobalAdmin(roles);

    const testRun = await this.testRunRepo.findOne({
      where: { id: testRunId },
      relations: ['systemUnderTest', 'systemUnderTest.team'],
    });

    if (!testRun) {
      return { accessible: false, testRun: null };
    }

    // Internal/system calls (no userId) bypass auth — authorization was checked at the controller boundary
    // Admins can access all test runs
    if (!userId || isAdmin) {
      return { accessible: true, testRun };
    }

    // Check if test run's organization is in user's accessible organizations
    const testRunOrgId = testRun.organizationId;

    // Legacy test runs (null organization_id) are accessible to all authenticated users for backward compatibility
    if (!testRunOrgId) {
      this.logger.debug(`Test run ${testRunId} has no organization_id (legacy), allowing access`);
      return { accessible: true, testRun };
    }

    // Load organizations from database via AuthorizationService (like test-runs service does)
    const organizationIds = await this.authzService.getAccessibleOrganizations(userId);

    if (organizationIds.length === 0) {
      this.logger.debug('User has no organization memberships, denying access to test run');
      return { accessible: false, testRun: null };
    }

    if (!organizationIds.includes(testRunOrgId)) {
      this.logger.debug(`User not a member of organization ${testRunOrgId}, denying access to test run ${testRunId}`);
      return { accessible: false, testRun: null };
    }

    return { accessible: true, testRun };
  }

  /**
   * Check if a report belongs to one of the user's accessible organizations
   * @returns true if accessible, false otherwise
   */
  private async isReportAccessible(
    reportId: string,
    userId: string,
    roles: string[],
  ): Promise<{ accessible: boolean; report: GeneratedReport | null }> {
    const isAdmin = this.isGlobalAdmin(roles);

    const report = await this.reportRepo.findOne({
      where: { id: reportId },
      relations: ['template', 'test_run'],
    });

    if (!report) {
      return { accessible: false, report: null };
    }

    // Internal/system calls (no userId) bypass auth — authorization was checked at the controller boundary
    // Admins can access all reports
    if (!userId || isAdmin) {
      return { accessible: true, report };
    }

    // Use test_run.organization_id directly (not via systemUnderTest → team chain)
    const reportOrgId = report.test_run?.organizationId;

    // Legacy reports (null organization_id) are accessible to all authenticated users for backward compatibility
    if (!reportOrgId) {
      this.logger.debug(`Report ${reportId} has no organization_id (legacy), allowing access`);
      return { accessible: true, report };
    }

    // Load organizations from database via AuthorizationService
    const organizationIds = await this.authzService.getAccessibleOrganizations(userId);

    if (!organizationIds.includes(reportOrgId)) {
      this.logger.debug(`User not a member of organization ${reportOrgId}, denying access to report ${reportId}`);
      return { accessible: false, report: null };
    }

    return { accessible: true, report };
  }

  // ==================== Create Operations ====================

  /**
   * Create a new report from a template
   * @param options - Creation options including test run ID, template ID, roles and organizationIds for authorization
   * @returns Created report entity
   */
  async createFromTemplate(options: CreateReportFromTemplateOptions): Promise<GeneratedReport> {
    try {
      const roles = options.roles || [];
      const userId = options.userId || '';

      // Check if test run is accessible to the user
      const { accessible, testRun } = await this.isTestRunAccessible(
        options.testRunId,
        userId,
        roles,
      );

      if (!accessible || !testRun) {
        throw new ResourceNotFoundException('Test Run', options.testRunId);
      }

      const template = await this.templateRepo.findOne({
        where: { id: options.templateId },
      });

      if (!template) {
        throw new ResourceNotFoundException('Report Template', options.templateId);
      }

      const reportName = options.name || `${template.name} - ${new Date().toISOString().slice(0, 10)}`;

      const report = this.reportRepo.create({
        test_run_id: options.testRunId,
        template_id: options.templateId,
        name: reportName,
        generated_by: options.generatedBy,
        status: 'pending' as ReportStatus,
        share_enabled: true,
        retry_count: 0,
        max_retries: 3,
      });

      const savedReport = await this.reportRepo.save(report);

      this.logger.log(
        `Created report ${savedReport.id} from template ${options.templateId} for test run ${options.testRunId}`,
      );

      return savedReport;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to create report from template: ${(error as Error).message}`);
      throw new DatabaseException('Failed to create report from template', error);
    }
  }

  /**
   * Create a new ad-hoc report with custom sections
   * @param options - Creation options including sections configuration, roles and organizationIds for authorization
   * @returns Created report entity
   */
  async createAdHocReport(options: CreateAdHocReportOptions): Promise<GeneratedReport> {
    try {
      const roles = options.roles || [];
      const userId = options.userId || '';

      // Check if test run is accessible to the user
      const { accessible, testRun } = await this.isTestRunAccessible(
        options.testRunId,
        userId,
        roles,
      );

      if (!accessible || !testRun) {
        throw new ResourceNotFoundException('Test Run', options.testRunId);
      }

      if (!options.sections || options.sections.length === 0) {
        throw new ValidationException('At least one section is required');
      }

      if (options.sections.length > 50) {
        throw new ValidationException('Maximum 50 sections allowed per report');
      }

      let templateId = options.templateId;
      if (!templateId) {
        const isAdhoc = !options.saveAsTemplate;

        if (options.saveAsTemplate && (!options.templateName || options.templateName.trim() === '')) {
          throw new ValidationException('Template name is required when saving as template');
        }

        const templateName = options.saveAsTemplate && options.templateName
          ? options.templateName.trim()
          : `Ad-hoc: ${options.name}`;

        const templateDescription = options.saveAsTemplate && options.templateDescription
          ? options.templateDescription
          : isAdhoc
            ? 'Ephemeral template for ad-hoc report'
            : 'User-saved template from ad-hoc report';

        const template = this.templateRepo.create({
          name: templateName,
          description: templateDescription,
          created_by: options.generatedBy,
          system_id: testRun.systemUnderTestId,
          test_environment: testRun.testEnvironment,
          workload: testRun.workload,
          sections: options.sections,
          styling: options.styling || this.utils.getDefaultStyling(),
          is_adhoc: isAdhoc,
        });

        const savedTemplate = await this.templateRepo.save(template);
        templateId = savedTemplate.id;

        this.logger.log(
          `Created ${isAdhoc ? 'ad-hoc' : 'reusable'} template ${templateId} for report "${options.name}"`,
        );
      }

      const report = this.reportRepo.create({
        test_run_id: options.testRunId,
        template_id: templateId,
        name: options.name,
        generated_by: options.generatedBy,
        status: 'pending' as ReportStatus,
        share_enabled: true,
        retry_count: 0,
        max_retries: 3,
      });

      const savedReport = await this.reportRepo.save(report);

      this.logger.log(
        `Created ad-hoc report ${savedReport.id} for test run ${options.testRunId}`,
      );

      return savedReport;
    } catch (error) {
      if (error instanceof ResourceNotFoundException || error instanceof ValidationException) {
        throw error;
      }
      this.logger.error(`Failed to create ad-hoc report: ${(error as Error).message}`);
      throw new DatabaseException('Failed to create ad-hoc report', error);
    }
  }

  // ==================== Read Operations ====================

  /**
   * Find a report by ID
   * @param reportId - Report UUID
   * @param userId - User ID for loading accessible organizations
   * @param roles - User roles from JWT token (for admin bypass)
   * @returns Report entity with relations
   */
  async findById(
    reportId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<GeneratedReport> {
    try {
      // Check if report is accessible to the user
      const { accessible, report } = await this.isReportAccessible(
        reportId,
        userId,
        roles,
      );

      if (!accessible || !report) {
        throw new ResourceNotFoundException('Report', reportId);
      }

      return report;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to find report: ${(error as Error).message}`);
      throw new DatabaseException('Failed to find report', error);
    }
  }

  /**
   * Find all reports for a test run
   * @param testRunId - Test run UUID
   * @param options - Query options including roles and organizationIds for authorization
   * @returns Paginated report list
   */
  /**
   * Find all reports with optional filtering and pagination.
   * Applies organization-based access control.
   */
  async findAll(options?: ListReportsQueryOptions): Promise<ReportListResponse> {
    try {
      const roles = options?.roles || [];
      const userId = options?.userId || '';
      const isAdmin = this.isGlobalAdmin(roles);

      let organizationIds: string[] = [];
      if (!isAdmin) {
        if (userId) {
          organizationIds = await this.authzService.getAccessibleOrganizations(userId);
        }
        if (organizationIds.length === 0) {
          this.logger.debug('User has no organization memberships, returning empty report list');
          return { items: [], total: 0, offset: options?.offset || 0, limit: options?.limit || 50 };
        }
      }

      const limit = options?.limit || 50;
      const offset = options?.offset || 0;
      const sortBy = options?.sortBy || 'created_at';
      const sortOrder = options?.sortOrder || 'desc';

      const queryBuilder = this.reportRepo
        .createQueryBuilder('report')
        .leftJoinAndSelect('report.template', 'template');

      if (!isAdmin) {
        this.applyReportOrganizationFilter(queryBuilder, organizationIds, 'report');
      }

      if (options?.status) {
        queryBuilder.andWhere('report.status = :status', { status: options.status });
      }

      queryBuilder
        .orderBy(`report.${sortBy}`, sortOrder.toUpperCase() as 'ASC' | 'DESC')
        .skip(offset)
        .take(limit);

      const [items, total] = await queryBuilder.getManyAndCount();

      this.logger.log(`Retrieved ${items.length} reports (total: ${total})${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      return { items, total, offset, limit };
    } catch (error) {
      this.logger.error(`Failed to list all reports: ${(error as Error).message}`);
      throw new DatabaseException('Failed to list reports', error);
    }
  }

  async findByTestRunId(
    testRunId: string,
    options?: ListReportsQueryOptions,
  ): Promise<ReportListResponse> {
    try {
      const roles = options?.roles || [];
      const userId = options?.userId || '';
      const isAdmin = this.isGlobalAdmin(roles);

      // Load organizations from database for non-admin users
      let organizationIds: string[] = [];
      if (!isAdmin) {
        if (userId) {
          organizationIds = await this.authzService.getAccessibleOrganizations(userId);
        }
        if (organizationIds.length === 0) {
          this.logger.debug('User has no organization memberships, returning empty report list');
          return { items: [], total: 0, offset: options?.offset || 0, limit: options?.limit || 10 };
        }
      }

      const limit = options?.limit || 10;
      const offset = options?.offset || 0;
      const sortBy = options?.sortBy || 'created_at';
      const sortOrder = options?.sortOrder || 'desc';

      const queryBuilder = this.reportRepo
        .createQueryBuilder('report')
        .leftJoinAndSelect('report.template', 'template')
        .where('report.test_run_id = :testRunId', { testRunId });

      // Apply organization filtering for non-admin users
      if (!isAdmin) {
        this.applyReportOrganizationFilter(queryBuilder, organizationIds, 'report');
      }

      if (options?.status) {
        queryBuilder.andWhere('report.status = :status', { status: options.status });
      }

      queryBuilder
        .orderBy(`report.${sortBy}`, sortOrder.toUpperCase() as 'ASC' | 'DESC')
        .skip(offset)
        .take(limit);

      const [items, total] = await queryBuilder.getManyAndCount();

      this.logger.log(`Retrieved ${items.length} reports for test run ${testRunId}${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      return { items, total, offset, limit };
    } catch (error) {
      this.logger.error(`Failed to list reports: ${(error as Error).message}`);
      throw new DatabaseException('Failed to list reports', error);
    }
  }

  /**
   * Get report summary for a test run
   * @param testRunId - Test run UUID or string test_run_id
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   * @returns Report summary statistics
   */
  async getSummary(
    testRunId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<ReportSummaryResponse> {
    try {
      const isAdmin = this.isGlobalAdmin(roles);

      // Load organizations from database for non-admin users
      let organizationIds: string[] = [];
      if (!isAdmin) {
        if (userId) {
          organizationIds = await this.authzService.getAccessibleOrganizations(userId);
        }
        if (organizationIds.length === 0) {
          this.logger.debug('User has no organization memberships, returning empty report summary');
          return {
            totalReports: 0,
            completedReports: 0,
            pendingReports: 0,
            failedReports: 0,
            latestReport: undefined,
            totalDownloads: 0,
            totalShareViews: 0,
          };
        }
      }

      // First, try to find the test run to get its UUID
      // This handles both UUID and string test_run_id inputs
      const testRunQuery = this.testRunRepo
        .createQueryBuilder('tr')
        .leftJoin('tr.systemUnderTest', 'sut')
        .leftJoin('sut.team', 'team')
        .where('(tr.id = :testRunId OR tr.test_run_id = CAST(:testRunId AS text))', { testRunId });

      // Apply organization filtering for non-admin users
      if (!isAdmin) {
        testRunQuery.andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
      }

      const testRun = await testRunQuery.getOne();

      if (!testRun) {
        // If test run not found or not accessible, return empty summary instead of throwing
        // This allows the UI to display "0 reports" instead of an error
        return {
          totalReports: 0,
          completedReports: 0,
          pendingReports: 0,
          failedReports: 0,
          latestReport: undefined,
          totalDownloads: 0,
          totalShareViews: 0,
        };
      }

      const reports = await this.reportRepo.find({
        where: { test_run_id: testRun.id },
        relations: ['template'],
        order: { created_at: 'DESC' },
      });

      const totalReports = reports.length;
      const completedReports = reports.filter((r) => r.status === 'pdf_complete' || r.status === 'html_complete').length;
      const pendingReports = reports.filter((r) => r.status === 'pending' || r.status === 'processing').length;
      const failedReports = reports.filter((r) => r.status === 'failed').length;
      const latestReport = reports[0];
      const totalDownloads = reports.reduce((sum, r) => sum + (r.download_count || 0), 0);
      const totalShareViews = reports.reduce((sum, r) => sum + (r.share_view_count || 0), 0);

      this.logger.log(`Retrieved report summary for test run ${testRunId}: ${totalReports} total${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      return {
        totalReports,
        completedReports,
        pendingReports,
        failedReports,
        latestReport,
        totalDownloads,
        totalShareViews,
      };
    } catch (error) {
      this.logger.error(`Failed to get report summary: ${(error as Error).message}`);
      throw new DatabaseException('Failed to get report summary', error);
    }
  }

  /**
   * Get pending reports for queue processing
   * Note: This is typically called by background jobs which should use admin privileges
   * @param limit - Maximum number of reports to return
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   * @returns Array of pending reports
   */
  async getPendingReports(
    limit: number = 10,
    userId: string = '',
    roles: string[] = [],
  ): Promise<GeneratedReport[]> {
    try {
      const isAdmin = this.isGlobalAdmin(roles);

      // Load organizations from database for non-admin users
      let organizationIds: string[] = [];
      if (!isAdmin) {
        if (userId) {
          organizationIds = await this.authzService.getAccessibleOrganizations(userId);
        }
        if (organizationIds.length === 0) {
          this.logger.debug('User has no organization memberships, returning empty pending reports list');
          return [];
        }
      }

      const queryBuilder = this.reportRepo
        .createQueryBuilder('report')
        .leftJoinAndSelect('report.template', 'template')
        .leftJoinAndSelect('report.test_run', 'test_run')
        .where('report.status = :status', { status: 'pending' });

      // Apply organization filtering for non-admin users
      if (!isAdmin) {
        this.applyReportOrganizationFilter(queryBuilder, organizationIds, 'report');
      }

      queryBuilder
        .orderBy('report.created_at', 'ASC')
        .take(limit);

      const reports = await queryBuilder.getMany();

      this.logger.log(`Retrieved ${reports.length} pending reports${isAdmin ? ' (admin)' : ` (orgs: ${organizationIds.length})`}`);

      return reports;
    } catch (error) {
      this.logger.error(`Failed to get pending reports: ${(error as Error).message}`);
      throw new DatabaseException('Failed to get pending reports', error);
    }
  }

  // ==================== Update Operations ====================

  /**
   * Update report status with validation
   * @param reportId - Report UUID
   * @param newStatus - New status
   * @param errorMessage - Optional error message for failed status
   * @param errorCode - Optional error code for failed status
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   * @returns Updated report entity
   */
  async updateStatus(
    reportId: string,
    newStatus: ReportStatus,
    errorMessage?: string,
    errorCode?: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<GeneratedReport> {
    try {
      const report = await this.findById(reportId, userId, roles);

      this.validator.validateStatusTransition(report.status, newStatus);

      report.status = newStatus;

      if (newStatus === 'failed') {
        report.error_message = errorMessage || undefined;
        report.error_code = errorCode || undefined;
      }

      if (newStatus === 'html_complete') {
        report.html_generated_at = new Date();
      }

      if (newStatus === 'pdf_complete') {
        report.completed_at = new Date();
      }

      const updated = await this.reportRepo.save(report);

      this.logger.log(`Updated report ${reportId} status to ${newStatus}`);

      return updated;
    } catch (error) {
      if (error instanceof ResourceNotFoundException || error instanceof InvalidStateException) {
        throw error;
      }
      this.logger.error(`Failed to update report status: ${(error as Error).message}`);
      throw new DatabaseException('Failed to update report status', error);
    }
  }

  /**
   * Update report file size
   * @param reportId - Report UUID
   * @param fileSize - File size in bytes
   */
  async updateFileSize(reportId: string, fileSize: number): Promise<void> {
    try {
      await this.reportRepo.update(reportId, { file_size: fileSize });
      this.logger.log(`Updated report ${reportId} file size to ${fileSize} bytes`);
    } catch (error) {
      this.logger.error(`Failed to update file size: ${(error as Error).message}`);
      throw new DatabaseException('Failed to update file size', error);
    }
  }

  /**
   * Store HTML content for a report
   * @param reportId - Report UUID
   * @param htmlContent - Generated HTML content
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   */
  async storeHtmlContent(
    reportId: string,
    htmlContent: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<void> {
    try {
      const report = await this.findById(reportId, userId, roles);
      report.html_content = htmlContent;
      report.file_size = Buffer.byteLength(htmlContent, 'utf8');
      await this.reportRepo.save(report);
      await this.updateStatus(reportId, 'html_complete', undefined, undefined, userId, roles);

      this.logger.log(`Stored HTML content for report ${reportId} (${report.file_size} bytes)`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to store HTML content: ${(error as Error).message}`);
      throw new DatabaseException('Failed to store HTML content', error);
    }
  }

  /**
   * Update job ID for a report
   * @param reportId - Report UUID
   * @param jobId - Queue job ID
   */
  async updateJobId(reportId: string, jobId: string): Promise<void> {
    try {
      await this.reportRepo.update(reportId, { job_id: jobId });
      this.logger.log(`Updated report ${reportId} with job ID ${jobId}`);
    } catch (error) {
      this.logger.error(`Failed to update job ID: ${(error as Error).message}`);
      throw new DatabaseException('Failed to update job ID', error);
    }
  }

  /**
   * Increment retry count for a report
   * @param reportId - Report UUID
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   * @returns New retry count
   */
  async incrementRetryCount(
    reportId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<number> {
    try {
      const report = await this.findById(reportId, userId, roles);
      report.retry_count = (report.retry_count || 0) + 1;
      await this.reportRepo.save(report);

      this.logger.log(`Incremented retry count for report ${reportId} to ${report.retry_count}`);

      return report.retry_count;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to increment retry count: ${(error as Error).message}`);
      throw new DatabaseException('Failed to increment retry count', error);
    }
  }

  // ==================== Delete Operations ====================

  /**
   * Delete a report
   * @param reportId - Report UUID
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   */
  async delete(
    reportId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<void> {
    try {
      const report = await this.findById(reportId, userId, roles);
      await this.reportRepo.remove(report);
      this.logger.log(`Deleted report ${reportId}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to delete report: ${(error as Error).message}`);
      throw new DatabaseException('Failed to delete report', error);
    }
  }

  // ==================== Download Tracking ====================

  /**
   * Increment the download count for a report
   * @param reportId - Report UUID
   */
  async incrementDownloadCount(reportId: string): Promise<void> {
    try {
      await this.reportRepo.increment({ id: reportId }, 'download_count', 1);
    } catch (error) {
      this.logger.warn(`Failed to increment download count for ${reportId}: ${(error as Error).message}`);
    }
  }

  // ==================== HTML Generation ====================

  /**
   * Generate HTML for a report
   * @param reportId - Report UUID
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   * @returns HTML generation result
   */
  async generateHtml(
    reportId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<HtmlGenerationResult> {
    const startTime = Date.now();

    try {
      // Check if report is accessible to the user
      const { accessible, report } = await this.isReportAccessible(
        reportId,
        userId,
        roles,
      );

      if (!accessible || !report) {
        throw new ResourceNotFoundException('Report', reportId);
      }

      if (!report.template) {
        throw new ValidationException('Report template not found');
      }

      await this.updateStatus(reportId, 'processing', undefined, undefined, userId, roles);

      const testRun = report.test_run || await this.testRunRepo.findOne({
        where: { id: report.test_run_id },
        relations: ['systemUnderTest'],
      });

      if (!testRun) {
        throw new ResourceNotFoundException('Test Run', report.test_run_id);
      }

      const sections = report.template.sections || [];
      const styling = report.template.styling || this.utils.getDefaultStyling();

      const sectionsHtml = await this.htmlCompiler.renderSections(sections, testRun, report, userId, roles);
      const html = this.htmlCompiler.compileHtml(report.name, sectionsHtml, styling);

      await this.storeHtmlContent(reportId, html, userId, roles);

      const generationTimeMs = Date.now() - startTime;

      this.logger.log(
        `Generated HTML for report ${reportId} in ${generationTimeMs}ms with ${sections.length} sections`,
      );

      return {
        html,
        generationTimeMs,
        sectionCount: sections.length,
      };
    } catch (error) {
      await this.updateStatus(
        reportId,
        'failed',
        (error as Error).message,
        'HTML_GENERATION_ERROR',
        userId,
        roles,
      ).catch((e) => this.logger.error(`Failed to update status to failed: ${e}`));

      if (
        error instanceof ResourceNotFoundException ||
        error instanceof ValidationException
      ) {
        throw error;
      }

      this.logger.error(`Failed to generate HTML: ${(error as Error).message}`);
      throw new DatabaseException('Failed to generate HTML', error);
    }
  }

  /**
   * Preview a single section with styling
   * @param section - Section configuration to preview
   * @param testRunId - Optional test run UUID (uses mock data if not provided)
   * @param styling - Optional custom styling
   * @param userId - User ID for loading accessible organizations
   * @param roles - User roles from JWT token (for admin bypass)
   * @returns HTML string for the section preview
   */
  async previewSection(
    section: ReportSectionConfig,
    testRunId?: string,
    styling?: ReportStyling,
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    try {
      let testRun: TestRun | null = null;
      if (testRunId) {
        // Check if test run is accessible to the user
        const { accessible, testRun: accessibleTestRun } = await this.isTestRunAccessible(
          testRunId,
          userId,
          roles,
        );

        if (accessible && accessibleTestRun) {
          testRun = accessibleTestRun;
        } else {
          this.logger.warn(`Test run ${testRunId} not found or not accessible, using mock data for preview`);
        }
      }

      const sectionHtml = await this.htmlCompiler.renderSections([section], testRun, null, userId, roles);

      const finalStyling = { ...this.utils.getDefaultStyling(), ...styling };
      const previewHtml = this.htmlCompiler.compilePreviewHtml(sectionHtml, section, finalStyling);

      return previewHtml;
    } catch (error) {
      this.logger.error(`Failed to preview section: ${(error as Error).message}`);
      throw new ValidationException(
        `Failed to preview section: ${(error as Error).message}`,
      );
    }
  }
}
