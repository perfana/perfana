import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Param,
  Body,
  Request,
  Logger,
  HttpException,
  HttpStatus,
  HttpCode,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../../types/auth.types';
import { ReportGenerationService } from '../services/report-generation.service';
import { runAfterRequestCommit } from '../../../common/db/request-em';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { ReportShareService } from '../services/report-share.service';
import { HtmlGenerationProcessor } from '../processors/html-generation.processor';
import { PdfGenerationProcessor } from '../processors/pdf-generation.processor';
import {
  GenerateReportFromTemplateDto,
  GenerateAdHocReportDto,
  GeneratePdfDto,
  PreviewSectionDto,
  UpdateShareSettingsDto,
  ListReportsQueryDto,
  GenerateReportResponseDto,
  GeneratePdfResponseDto,
  ShareSettingsResponseDto,
  ReportListResponseDto,
  ReportSummaryDto,
  ReportDetailDto,
  type ReportStatus,
  type ReportSectionType,
} from '../dto';

/**
 * Controller for report generation and management operations.
 *
 * All endpoints are protected by the global KeycloakEnhancedAuthGuard
 * which supports both Keycloak JWT and API Key authentication.
 */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportGenerationController {
  private readonly logger = new Logger(ReportGenerationController.name);

  constructor(
    private readonly reportGenerationService: ReportGenerationService,
    private readonly reportShareService: ReportShareService,
    private readonly htmlGenerationProcessor: HtmlGenerationProcessor,
    private readonly pdfGenerationProcessor: PdfGenerationProcessor,
  ) {}

  /**
   * Persist the HTML-generation job id (inside the request transaction) and
   * defer the actual BullMQ enqueue until after that transaction commits, so
   * the worker's separate DB connection can read the report row (#421).
   * Returns the job id to include in the HTTP response.
   */
  private async enqueueHtmlGenerationAfterCommit(
    reportId: string,
    testRunId: string,
    templateId: string,
    initiatedBy: string,
  ): Promise<string> {
    if (this.htmlGenerationProcessor.isAvailable()) {
      const jobId = `html-gen-${reportId}-${Date.now()}`;
      // Commits atomically with the report row (job_id would otherwise be NULL).
      await this.reportGenerationService.updateJobId(reportId, jobId);
      runAfterRequestCommit(async () => {
        try {
          await this.htmlGenerationProcessor.addJob(reportId, testRunId, templateId, {
            initiatedBy,
            jobId,
          });
          this.logger.log(`Queued HTML generation job ${jobId} for report ${reportId}`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(`Failed to queue HTML generation for report ${reportId}: ${msg}`);
        }
      });
      return jobId;
    }

    // Redis/BullMQ unavailable — process synchronously in the background, also
    // after commit so generateHtml can read the row.
    this.logger.warn('BullMQ unavailable - processing HTML generation synchronously');
    runAfterRequestCommit(() => {
      this.htmlGenerationProcessor.processSync(reportId).catch((error) => {
        this.logger.error(`Sync HTML generation failed for report ${reportId}: ${error.message}`);
      });
    });
    return `sync-${reportId}`;
  }

  // ==================== Report Listing ====================

  @Get()
  @ApiOperation({ summary: 'Get all reports with optional filtering' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by report status' })
  @ApiQuery({ name: 'limit', required: false, description: 'Maximum results (default: 50)' })
  @ApiQuery({ name: 'offset', required: false, description: 'Pagination offset (default: 0)' })
  @ApiQuery({ name: 'sortBy', required: false, description: 'Sort field (default: created_at)' })
  @ApiQuery({ name: 'sortOrder', required: false, description: 'Sort order (default: desc)' })
  @ApiResponse({ status: 200, description: 'Return paginated list of reports', type: ReportListResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  async findAll(
    @Query() query: ListReportsQueryDto,
    @UserCtx() ctx?: UserContext,
  ): Promise<ReportListResponseDto> {
    try {
      const result = await this.reportGenerationService.findAll({
        status: query.status as ReportStatus,
        limit: query.limit || 50,
        offset: query.offset || 0,
        sortBy: query.sortBy as 'created_at' | 'name' | 'status',
        sortOrder: query.sortOrder as 'asc' | 'desc',
        userId: ctx?.userId,
        roles: ctx?.roles,
      });

      return {
        items: result.items.map((report) => ({
          id: report.id,
          name: report.name,
          status: report.status as ReportStatus,
          test_run_id: report.test_run_id,
          template_name: report.template?.name || '',
          generated_by: report.generated_by,
          share_enabled: report.share_enabled,
          share_id: report.share_id,
          share_view_count: report.share_view_count,
          download_count: report.download_count || 0,
          has_pdf: !!report.pdf_data,
          file_size: report.file_metadata?.fileSize as number | undefined,
          created_at: report.created_at,
          updated_at: report.updated_at,
        })),
        total: result.total,
        offset: result.offset,
        limit: result.limit,
      };
    } catch (error) {
      this.logger.error('Failed to fetch reports:', error);
      throw new HttpException(
        'Failed to fetch reports',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('test-run/:testRunId')
  @ApiOperation({ summary: 'Get all reports for a specific test run' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by report status' })
  @ApiQuery({ name: 'limit', required: false, description: 'Maximum results (default: 50)' })
  @ApiQuery({ name: 'offset', required: false, description: 'Pagination offset (default: 0)' })
  @ApiQuery({ name: 'sortBy', required: false, description: 'Sort field (default: created_at)' })
  @ApiQuery({ name: 'sortOrder', required: false, description: 'Sort order (default: desc)' })
  @ApiResponse({ status: 200, description: 'Return paginated list of reports for test run', type: ReportListResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async findByTestRun(
    @Param('testRunId') testRunId: string,
    @Query() query: ListReportsQueryDto,
    @UserCtx() ctx: UserContext,
  ): Promise<ReportListResponseDto> {
    try {
      const result = await this.reportGenerationService.findByTestRunId(testRunId, {
        status: query.status as ReportStatus | undefined,
        limit: query.limit,
        offset: query.offset,
        sortBy: query.sortBy as 'created_at' | 'name' | 'status' | undefined,
        sortOrder: query.sortOrder,
        userId: ctx.userId,
        roles: ctx.roles,
      });

      return {
        items: result.items.map((report) => ({
          id: report.id,
          test_run_id: report.test_run_id,
          template_name: report.template?.name || 'Unknown Template',
          name: report.name,
          generated_by: report.generated_by,
          status: report.status as ReportStatus,
          share_enabled: report.share_enabled,
          share_id: report.share_id,
          share_view_count: report.share_view_count || 0,
          download_count: report.download_count || 0,
          has_pdf: report.status === 'pdf_complete',
          file_size: report.file_size,
          created_at: report.created_at,
          completed_at: report.completed_at,
        })),
        total: result.total,
        offset: result.offset,
        limit: result.limit,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch reports for test run ${testRunId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to fetch reports',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('test-run/:testRunId/summary')
  @ApiOperation({ summary: 'Get report summary for a test run' })
  @ApiResponse({ status: 200, description: 'Return report summary statistics', type: ReportSummaryDto })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async getSummary(
    @Param('testRunId') testRunId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<ReportSummaryDto> {
    try {
      const summary = await this.reportGenerationService.getSummary(testRunId, ctx.userId, ctx.roles);

      return {
        total_reports: summary.totalReports,
        completed_reports: summary.completedReports,
        pending_reports: summary.pendingReports,
        failed_reports: summary.failedReports,
        latest_report: summary.latestReport
          ? {
              id: summary.latestReport.id,
              test_run_id: summary.latestReport.test_run_id,
              template_name: summary.latestReport.template?.name || 'Unknown Template',
              name: summary.latestReport.name,
              generated_by: summary.latestReport.generated_by,
              status: summary.latestReport.status as ReportStatus,
              share_enabled: summary.latestReport.share_enabled,
              share_id: summary.latestReport.share_id,
              share_view_count: summary.latestReport.share_view_count || 0,
              download_count: summary.latestReport.download_count || 0,
              has_pdf: summary.latestReport.status === 'pdf_complete',
              file_size: summary.latestReport.file_size,
              created_at: summary.latestReport.created_at,
              completed_at: summary.latestReport.completed_at,
            }
          : undefined,
        total_downloads: summary.totalDownloads,
        total_share_views: summary.totalShareViews,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch report summary for test run ${testRunId}:`, error);
      throw new HttpException(
        'Failed to fetch report summary',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== Report Generation ====================

  @Post('generate')
  @ApiOperation({ summary: 'Generate a report from an existing template' })
  @ApiResponse({ status: 201, description: 'Report generation started', type: GenerateReportResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Test run or template not found' })
  async generateFromTemplate(
    @Body() dto: GenerateReportFromTemplateDto,
    @Request() req: AuthenticatedRequest,
    @UserCtx() ctx: UserContext,
  ): Promise<GenerateReportResponseDto> {
    try {
      const generatedBy = req.user?.email || req.user?.preferred_username || 'unknown';

      const report = await this.reportGenerationService.createFromTemplate({
        testRunId: dto.test_run_id,
        templateId: dto.template_id,
        name: dto.name,
        generatedBy,
        userId: ctx.userId,
        roles: ctx.roles,
      });

      this.logger.log(`Report ${report.id} generation started from template ${dto.template_id}`);

      // Trigger HTML generation AFTER the request transaction commits, so the
      // worker (a different DB connection) can see the report row. Enqueuing
      // inline races the commit → worker reads "not found" and abandons the
      // job, leaving the report stuck at pending (issue #421).
      const jobId = await this.enqueueHtmlGenerationAfterCommit(
        report.id,
        dto.test_run_id,
        dto.template_id,
        generatedBy,
      );

      return {
        report_id: report.id,
        job_id: jobId,
        status: report.status as ReportStatus,
        estimated_completion_seconds: 30,
      };
    } catch (error) {
      this.logger.error('Failed to generate report from template:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException(errorMessage, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to generate report',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('generate/ad-hoc')
  @ApiOperation({ summary: 'Generate an ad-hoc report with custom sections' })
  @ApiResponse({ status: 201, description: 'Report generation started', type: GenerateReportResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Test run not found' })
  async generateAdHoc(
    @Body() dto: GenerateAdHocReportDto,
    @Request() req: AuthenticatedRequest,
    @UserCtx() ctx: UserContext,
  ): Promise<GenerateReportResponseDto> {
    try {
      const generatedBy = req.user?.email || req.user?.preferred_username || 'unknown';

      const report = await this.reportGenerationService.createAdHocReport({
        testRunId: dto.test_run_id,
        name: dto.name,
        sections: dto.sections.map((s) => ({
          type: s.type as ReportSectionType,
          order: s.order,
          title: s.title,
          config: s.config,
          comment: s.comment,
        })),
        styling: dto.styling
          ? {
              primaryColor: dto.styling.primaryColor,
              secondaryColor: dto.styling.secondaryColor,
              logo: dto.styling.logo,
              fontFamily: dto.styling.fontFamily,
              customCss: dto.styling.customCss,
            }
          : undefined,
        generatedBy,
        saveAsTemplate: dto.save_as_template,
        templateName: dto.template_name,
        templateDescription: dto.template_description,
        userId: ctx.userId,
        roles: ctx.roles,
      });

      this.logger.log(`Ad-hoc report ${report.id} generation started`);

      // Trigger HTML generation after commit — see generateFromTemplate (#421).
      const jobId = await this.enqueueHtmlGenerationAfterCommit(
        report.id,
        dto.test_run_id,
        report.template_id,
        generatedBy,
      );

      return {
        report_id: report.id,
        job_id: jobId,
        status: report.status as ReportStatus,
        estimated_completion_seconds: 30,
      };
    } catch (error) {
      this.logger.error('Failed to generate ad-hoc report:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException(errorMessage, HttpStatus.NOT_FOUND);
      }
      if (errorMessage.includes('At least') || errorMessage.includes('Maximum')) {
        throw new HttpException(errorMessage, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to generate report',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('preview-section')
  @HttpCode(200)
  @ApiOperation({ summary: 'Preview a single report section with styling' })
  @ApiResponse({ status: 200, description: 'Return HTML preview of the section', type: String })
  @ApiResponse({ status: 400, description: 'Invalid section configuration' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  async previewSection(
    @Body() dto: PreviewSectionDto,
    @UserCtx() ctx: UserContext,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const html = await this.reportGenerationService.previewSection(
        {
          type: dto.section.type as ReportSectionType,
          order: dto.section.order,
          title: dto.section.title,
          config: dto.section.config,
          comment: dto.section.comment,
        },
        dto.test_run_id,
        dto.styling
          ? {
              primaryColor: dto.styling.primaryColor,
              secondaryColor: dto.styling.secondaryColor,
              logo: dto.styling.logo,
              fontFamily: dto.styling.fontFamily,
              customCss: dto.styling.customCss,
            }
          : undefined,
        ctx.userId,
        ctx.roles,
      );

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error) {
      this.logger.error('Failed to preview section:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      throw new HttpException(
        `Failed to preview section: ${errorMessage}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ==================== Report CRUD ====================

  @Get(':reportId')
  @ApiOperation({ summary: 'Get a single report by ID' })
  @ApiResponse({ status: 200, description: 'Return the report', type: ReportDetailDto })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  async findOne(
    @Param('reportId') reportId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<ReportDetailDto> {
    try {
      const report = await this.reportGenerationService.findById(reportId, ctx.userId, ctx.roles);

      return {
        id: report.id,
        test_run_id: report.test_run_id,
        template_id: report.template_id,
        name: report.name,
        generated_by: report.generated_by,
        html_content: report.html_content,
        html_generated_at: report.html_generated_at,
        share_id: report.share_id,
        share_enabled: report.share_enabled,
        share_view_count: report.share_view_count || 0,
        last_shared_at: report.last_shared_at,
        has_pdf: report.status === 'pdf_complete',
        file_size: report.file_size,
        mime_type: report.mime_type || 'text/html',
        status: report.status as ReportStatus,
        error_code: report.error_code,
        error_message: report.error_message,
        job_id: report.job_id,
        retry_count: report.retry_count || 0,
        max_retries: report.max_retries || 3,
        download_count: report.download_count || 0,
        last_downloaded_at: report.last_downloaded_at,
        expires_at: report.expires_at,
        created_at: report.created_at,
        updated_at: report.updated_at,
        started_at: report.started_at,
        completed_at: report.completed_at,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch report ${reportId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to fetch report',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':reportId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a report' })
  @ApiResponse({ status: 204, description: 'Report deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  async delete(
    @Param('reportId') reportId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<void> {
    try {
      await this.reportGenerationService.delete(reportId, ctx.userId, ctx.roles);
      this.logger.log(`Report ${reportId} deleted`);
    } catch (error) {
      this.logger.error(`Failed to delete report ${reportId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to delete report',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== PDF Generation ====================

  @Post(':reportId/pdf')
  @ApiOperation({ summary: 'Generate PDF from an existing HTML report' })
  @ApiResponse({ status: 200, description: 'PDF generation started', type: GeneratePdfResponseDto })
  @ApiResponse({ status: 400, description: 'Report HTML not ready' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  async generatePdf(
    @Param('reportId') reportId: string,
    @Body() _dto: GeneratePdfDto,
    @UserCtx() ctx: UserContext,
  ): Promise<GeneratePdfResponseDto> {
    try {
      const report = await this.reportGenerationService.findById(reportId, ctx.userId, ctx.roles);

      if (report.status !== 'html_complete' && report.status !== 'pdf_complete') {
        throw new HttpException(
          'Report HTML must be complete before generating PDF',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Skip if PDF already generated
      if (report.status === 'pdf_complete') {
        return {
          report_id: reportId,
          job_id: report.job_id || `pdf-${reportId}`,
          status: 'pdf_complete',
        };
      }

      // Queue PDF generation job to perfana-report worker
      if (!this.pdfGenerationProcessor.isAvailable()) {
        throw new HttpException(
          'PDF generation is currently unavailable. Please ensure Redis is running.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      const jobId = await this.pdfGenerationProcessor.addJob(reportId);
      this.logger.log(`Queued PDF generation job ${jobId} for report ${reportId}`);

      return {
        report_id: reportId,
        job_id: jobId,
        status: 'pdf_processing',
      };
    } catch (error) {
      this.logger.error(`Failed to start PDF generation for report ${reportId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to start PDF generation',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':reportId/pdf/download')
  @ApiOperation({
    summary: 'Download PDF for a report',
    description: 'Returns the generated PDF if available. If not generated yet, use POST /reports/:reportId/pdf first to queue generation.'
  })
  @ApiResponse({ status: 200, description: 'PDF file', type: StreamableFile })
  @ApiResponse({ status: 202, description: 'PDF generation in progress - try again later' })
  @ApiResponse({ status: 400, description: 'PDF not available' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  async downloadPdf(
    @Param('reportId') reportId: string,
    @UserCtx() ctx: UserContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    try {
      const report = await this.reportGenerationService.findById(reportId, ctx.userId, ctx.roles);

      // Check if HTML content is available
      if (!report.html_content) {
        throw new HttpException(
          'Report HTML content not available. Generate report first using POST /reports/generate',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Check PDF generation status
      if (report.status === 'pending' || report.status === 'processing') {
        throw new HttpException(
          {
            statusCode: HttpStatus.ACCEPTED,
            message: 'Report HTML is still being generated. Please wait for HTML generation to complete.',
            reportStatus: report.status,
            reportId: report.id,
          },
          HttpStatus.ACCEPTED,
        );
      }

      if (report.status === 'pdf_processing') {
        throw new HttpException(
          {
            statusCode: HttpStatus.ACCEPTED,
            message: 'PDF is currently being generated. Please try again in a few moments.',
            reportStatus: report.status,
            reportId: report.id,
            jobId: report.job_id,
          },
          HttpStatus.ACCEPTED,
        );
      }

      if (report.status === 'failed') {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `Report generation failed: ${report.error_message || 'Unknown error'}`,
            errorCode: report.error_code,
            reportId: report.id,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // If status is html_complete, auto-trigger PDF generation
      if (report.status === 'html_complete') {
        if (this.pdfGenerationProcessor.isAvailable()) {
          try {
            const jobId = await this.pdfGenerationProcessor.addJob(reportId);
            this.logger.log(`Auto-queued PDF generation job ${jobId} for report ${reportId} on download request`);
          } catch (queueError) {
            this.logger.warn(`Failed to auto-queue PDF generation for report ${reportId}:`, queueError);
          }
        }
        throw new HttpException(
          {
            statusCode: HttpStatus.ACCEPTED,
            message: 'PDF generation has been queued. Please try again in a few moments.',
            reportStatus: 'pdf_processing',
            reportId: report.id,
          },
          HttpStatus.ACCEPTED,
        );
      }

      // If we get here, status should be pdf_complete
      // PDF should be stored in database by perfana-report service
      if (!report.pdf_data) {
        throw new HttpException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'PDF data not found in database. The PDF may not have been generated correctly by perfana-report service.',
            reportStatus: report.status,
            reportId: report.id,
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Serve PDF from database
      this.logger.log(`Serving PDF from database for report ${reportId}`);

      // Sanitize filename
      const sanitizedName = report.name
        .replace(/[^a-z0-9\s-]/gi, '_')
        .replace(/\s+/g, '_')
        .toLowerCase();

      // Set content type and disposition
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${sanitizedName}.pdf"`,
        'Content-Length': report.pdf_data.length.toString(),
      });

      this.logger.log(`PDF served successfully for report ${reportId}, size: ${report.pdf_data.length} bytes`);

      await this.reportGenerationService.incrementDownloadCount(reportId);

      return new StreamableFile(report.pdf_data);

    } catch (error) {
      if (error instanceof HttpException) {
        // 202 Accepted is expected when PDF is being generated - don't log as error
        if (error.getStatus() !== HttpStatus.ACCEPTED) {
          this.logger.error(`Failed to download PDF for report ${reportId}:`, error);
        }
        throw error;
      }
      this.logger.error(`Failed to download PDF for report ${reportId}:`, error);
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to download PDF',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== Share Management ====================

  @Get(':reportId/share')
  @ApiOperation({ summary: 'Get share settings for a report' })
  @ApiResponse({ status: 200, description: 'Return share settings', type: ShareSettingsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  async getShareSettings(
    @Param('reportId') reportId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<ShareSettingsResponseDto> {
    try {
      const report = await this.reportGenerationService.findById(reportId, ctx.userId, ctx.roles);

      return {
        share_id: report.share_id,
        share_enabled: report.share_enabled,
        share_url: report.share_enabled
          ? `${process.env.APP_URL || 'http://localhost:4001'}/reports/share/${report.share_id}`
          : '',
        share_view_count: report.share_view_count || 0,
        last_shared_at: report.last_shared_at,
        expires_at: report.expires_at,
      };
    } catch (error) {
      this.logger.error(`Failed to get share settings for report ${reportId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to get share settings',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':reportId/share')
  @ApiOperation({ summary: 'Update share settings for a report' })
  @ApiResponse({ status: 200, description: 'Share settings updated', type: ShareSettingsResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  async updateShareSettings(
    @Param('reportId') reportId: string,
    @Body() dto: UpdateShareSettingsDto,
    @UserCtx() _ctx: UserContext,
  ): Promise<ShareSettingsResponseDto> {
    try {
      const baseUrl = process.env.APP_URL || 'http://localhost:4001';
      const updatedSettings = await this.reportShareService.updateShareSettings(
        reportId,
        {
          shareEnabled: dto.share_enabled,
          expiresAt: dto.expires_at ? new Date(dto.expires_at) : null,
        },
        baseUrl,
      );

      return {
        share_id: updatedSettings.shareId,
        share_enabled: updatedSettings.shareEnabled,
        share_url: updatedSettings.shareEnabled ? updatedSettings.shareUrl : '',
        share_view_count: updatedSettings.shareViewCount,
        last_shared_at: updatedSettings.lastSharedAt,
        expires_at: updatedSettings.expiresAt,
      };
    } catch (error) {
      this.logger.error(`Failed to update share settings for report ${reportId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to update share settings',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ==================== Report Retry ====================

  @Post(':reportId/retry')
  @ApiOperation({ summary: 'Retry a failed report generation' })
  @ApiResponse({ status: 200, description: 'Report generation retry started', type: GenerateReportResponseDto })
  @ApiResponse({ status: 400, description: 'Report is not in failed state or max retries exceeded' })
  @ApiResponse({ status: 401, description: 'Unauthorized - valid authentication required' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  async retryGeneration(
    @Param('reportId') reportId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<GenerateReportResponseDto> {
    try {
      const report = await this.reportGenerationService.findById(reportId, ctx.userId, ctx.roles);

      if (report.status !== 'failed') {
        throw new HttpException(
          'Only failed reports can be retried',
          HttpStatus.BAD_REQUEST,
        );
      }

      if ((report.retry_count || 0) >= (report.max_retries || 3)) {
        throw new HttpException(
          'Maximum retry attempts exceeded',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Reset status to pending for retry
      await this.reportGenerationService.updateStatus(reportId, 'pending');
      await this.reportGenerationService.incrementRetryCount(reportId);

      // Actually re-enqueue the generation job — resetting status alone left
      // the report stuck at pending with nothing processing it (#421).
      const jobId = await this.enqueueHtmlGenerationAfterCommit(
        reportId,
        report.test_run_id,
        report.template_id,
        report.generated_by,
      );

      this.logger.log(`Report ${reportId} retry initiated (job ${jobId})`);

      return {
        report_id: reportId,
        job_id: jobId,
        status: 'pending',
        estimated_completion_seconds: 30,
      };
    } catch (error) {
      this.logger.error(`Failed to retry report ${reportId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      const errorMessage = error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Unknown error';
      if (errorMessage.includes('not found')) {
        throw new HttpException('Report not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to retry report generation',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
