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
  OwnedResource,
  SystemUnderTest,
} from '@perfana/shared';
import { withRequestEm } from '../../../common/db/request-em';
import {
  ResourceNotFoundException,
  DatabaseException,
  ValidationException,
  InvalidStateException,
} from '../../../common/exceptions/business.exception';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { withOrgFilter } from '../../../common/utils/with-org-filter';
import { AuditService } from '../../audit/audit.service';
import { ReportGenerationValidatorService } from './report-generation-validator.service';
import { ReportUtilsService } from './report-utils.service';
import { ReportHtmlCompilerService } from './report-html-compiler.service';

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
    @InjectRepository(SystemUnderTest)
    private readonly systemRepo: Repository<SystemUnderTest>,
    private readonly authzService: AuthorizationService,
    private readonly auditService: AuditService,
    private readonly validator: ReportGenerationValidatorService,
    private readonly utils: ReportUtilsService,
    private readonly htmlCompiler: ReportHtmlCompilerService,
  ) {}

  // ==================== Authorization Helpers ====================

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
    const testRun = await withRequestEm(this.testRunRepo).findOne({
      where: { id: testRunId },
      relations: ['systemUnderTest', 'systemUnderTest.team'],
    });

    if (!testRun) {
      return { accessible: false, testRun: null };
    }

    // Internal/system calls (no userId) bypass auth — authorization was checked at the controller boundary
    if (!userId) {
      return { accessible: true, testRun };
    }

    // Delegate to AuthorizationService.canAccessResource which handles:
    //   1. Global admin bypass
    //   2. Legacy null-org bypass
    //   3. Organization membership check
    // team_id is intentionally omitted — preserves the prior behavior of not checking
    // team membership for test run access (only org membership). created_by is unused
    // by canAccessResource (only canModifyResource reads it).
    const result = await this.authzService.canAccessResource(userId, roles, {
      organization_id: testRun.organizationId,
      created_by: '',
    } as OwnedResource);

    if (!result.allowed) {
      this.logger.debug(`Access denied for user ${userId} to test run ${testRunId}: ${result.reason}`);
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
    const report = await this.reportRepo.findOne({
      where: { id: reportId },
      relations: ['template', 'test_run'],
    });

    if (!report) {
      return { accessible: false, report: null };
    }

    // Internal/system calls (no userId) bypass auth — authorization was checked at the controller boundary
    if (!userId) {
      return { accessible: true, report };
    }

    // Use test_run.organization_id directly (not via systemUnderTest → team chain).
    // Delegate to AuthorizationService.canAccessResource for admin bypass + legacy
    // null-org bypass + org membership check. team_id is omitted to preserve the
    // prior behavior of not checking team membership for report access. created_by
    // is unused by canAccessResource (only canModifyResource reads it).
    const result = await this.authzService.canAccessResource(userId, roles, {
      organization_id: report.test_run?.organizationId,
      created_by: '',
    } as OwnedResource);

    if (!result.allowed) {
      this.logger.debug(`Access denied for user ${userId} to report ${reportId}: ${result.reason}`);
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
  // audit-skip: GeneratedReport is DELETE-only (Phase 5a brainstorm) — the row
  // create is the trigger for a background-job pipeline; status/file/share
  // mutations are bucket-2. User-facing audit happens on delete.
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

      const template = await withRequestEm(this.templateRepo).findOne({
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

      const savedReport = await withRequestEm(this.reportRepo).save(report);

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

        // Inherit org/team from the parent SUT — ReportTemplate.organization_id
        // is NOT NULL and the camelCase property key is required.
        const system = await withRequestEm(this.systemRepo).findOne({
          where: { id: testRun.systemUnderTestId },
        });
        if (!system) {
          throw new ResourceNotFoundException('SystemUnderTest', testRun.systemUnderTestId);
        }

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
          organizationId: system.organization_id,
          teamId: system.team_id,
        });

        const savedTemplate = await withRequestEm(this.templateRepo).save(template);
        // Phase 5a — full CRUD on ReportTemplate per the burndown. Adhoc
        // templates are still recorded; their is_adhoc=true diff makes them
        // filterable in the audit viewer.
        this.auditService.logCreate(savedTemplate as unknown as OwnedResource);
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

      // GeneratedReport intentionally not audited on create per DELETE-only
      // policy (Phase 5a brainstorm). The conditional template logCreate above
      // is what satisfies the lint rule for this method.
      const savedReport = await withRequestEm(this.reportRepo).save(report);

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

      // Resolve accessible org IDs: null means global admin (no filter needed)
      const orgIds = await withOrgFilter(userId, roles, this.authzService);
      if (orgIds !== null && orgIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty report list');
        return { items: [], total: 0, offset: options?.offset || 0, limit: options?.limit || 50 };
      }

      const limit = options?.limit || 50;
      const offset = options?.offset || 0;
      const sortBy = options?.sortBy || 'created_at';
      const sortOrder = options?.sortOrder || 'desc';

      const queryBuilder = this.reportRepo
        .createQueryBuilder('report')
        .leftJoinAndSelect('report.template', 'template');

      if (orgIds !== null) {
        this.applyReportOrganizationFilter(queryBuilder, orgIds, 'report');
      }

      if (options?.status) {
        queryBuilder.andWhere('report.status = :status', { status: options.status });
      }

      queryBuilder
        .orderBy(`report.${sortBy}`, sortOrder.toUpperCase() as 'ASC' | 'DESC')
        .skip(offset)
        .take(limit);

      const [items, total] = await queryBuilder.getManyAndCount();

      this.logger.log(`Retrieved ${items.length} reports (total: ${total})${orgIds === null ? ' (admin)' : ` (orgs: ${orgIds.length})`}`);

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

      // Resolve accessible org IDs: null means global admin (no filter needed)
      const orgIds = await withOrgFilter(userId, roles, this.authzService);
      if (orgIds !== null && orgIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty report list');
        return { items: [], total: 0, offset: options?.offset || 0, limit: options?.limit || 10 };
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
      if (orgIds !== null) {
        this.applyReportOrganizationFilter(queryBuilder, orgIds, 'report');
      }

      if (options?.status) {
        queryBuilder.andWhere('report.status = :status', { status: options.status });
      }

      queryBuilder
        .orderBy(`report.${sortBy}`, sortOrder.toUpperCase() as 'ASC' | 'DESC')
        .skip(offset)
        .take(limit);

      const [items, total] = await queryBuilder.getManyAndCount();

      this.logger.log(`Retrieved ${items.length} reports for test run ${testRunId}${orgIds === null ? ' (admin)' : ` (orgs: ${orgIds.length})`}`);

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
      // Resolve accessible org IDs: null means global admin (no filter needed)
      const orgIds = await withOrgFilter(userId, roles, this.authzService);
      if (orgIds !== null && orgIds.length === 0) {
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

      // First, try to find the test run to get its UUID
      // This handles both UUID and string test_run_id inputs
      const testRunQuery = withRequestEm(this.testRunRepo)
        .createQueryBuilder('tr')
        .leftJoin('tr.systemUnderTest', 'sut')
        .leftJoin('sut.team', 'team')
        .where('(tr.id = :testRunId OR tr.test_run_id = CAST(:testRunId AS text))', { testRunId });

      // Apply organization filtering for non-admin users
      if (orgIds !== null) {
        testRunQuery.andWhere('sut.organization_id IN (:...orgIds)', { orgIds });
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

      this.logger.log(`Retrieved report summary for test run ${testRunId}: ${totalReports} total${orgIds === null ? ' (admin)' : ` (orgs: ${orgIds.length})`}`);

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
      // Resolve accessible org IDs: null means global admin (no filter needed)
      const orgIds = await withOrgFilter(userId, roles, this.authzService);
      if (orgIds !== null && orgIds.length === 0) {
        this.logger.debug('User has no organization memberships, returning empty pending reports list');
        return [];
      }

      const queryBuilder = this.reportRepo
        .createQueryBuilder('report')
        .leftJoinAndSelect('report.template', 'template')
        .leftJoinAndSelect('report.test_run', 'test_run')
        .where('report.status = :status', { status: 'pending' });

      // Apply organization filtering for non-admin users
      if (orgIds !== null) {
        this.applyReportOrganizationFilter(queryBuilder, orgIds, 'report');
      }

      queryBuilder
        .orderBy('report.created_at', 'ASC')
        .take(limit);

      const reports = await queryBuilder.getMany();

      this.logger.log(`Retrieved ${reports.length} pending reports${orgIds === null ? ' (admin)' : ` (orgs: ${orgIds.length})`}`);

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
  // audit-skip: GeneratedReport status flow — bucket-2 background-job state
  // machine (pending → processing → html_complete → pdf_*). Not user-curated.
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

      const updated = await withRequestEm(this.reportRepo).save(report);

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
  // audit-skip: GeneratedReport bookkeeping — file_size is bucket-2 output of
  // the background pipeline; not user-curated config.
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
  // audit-skip: GeneratedReport content storage — bucket-2 output of the HTML
  // compiler pipeline; not user-curated.
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
      await withRequestEm(this.reportRepo).save(report);
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
  // audit-skip: GeneratedReport job tracking — bucket-2 BullMQ-internal field.
  async updateJobId(reportId: string, jobId: string): Promise<void> {
    try {
      // withRequestEm: run inside the request's RLS transaction so job_id
      // commits atomically with the freshly-created report row. Using the
      // default repo here writes on a separate connection that cannot see the
      // uncommitted row, silently updating 0 rows (job_id stays NULL).
      await withRequestEm(this.reportRepo).update(reportId, { job_id: jobId });
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
  // audit-skip: GeneratedReport retry counter — bucket-2 queue retry
  // bookkeeping, not user-driven mutation.
  async incrementRetryCount(
    reportId: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<number> {
    try {
      const report = await this.findById(reportId, userId, roles);
      report.retry_count = (report.retry_count || 0) + 1;
      await withRequestEm(this.reportRepo).save(report);

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

      // GeneratedReport has no organization_id column of its own — fall back
      // to the parent template's org, or the test_run's org. findById loads
      // both relations, so one of these is always populated.
      const orgIdOverride =
        report.template?.organizationId ??
        report.test_run?.organizationId ??
        undefined;

      this.auditService.logDelete(report as unknown as OwnedResource, {
        organizationIdOverride: orgIdOverride,
      });

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

      const testRun = report.test_run || await withRequestEm(this.testRunRepo).findOne({
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
