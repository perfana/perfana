/**
 * AWR Reports Controller
 *
 * REST API endpoints for AWR (Automatic Workload Repository) report management.
 * Provides endpoints for upload, retrieval, analysis, and comparison of AWR reports.
 *
 * Endpoints are organized into two route patterns:
 * - /test-runs/:testRunId/awr-reports - Test run scoped operations (upload, list)
 * - /awr-reports - Global operations (get, delete, analysis, compare)
 *
 * All endpoints require authentication via Keycloak JWT or API Key.
 */
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Request,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  KeycloakEnhancedAuthGuard,
} from '../../../guards/keycloak-enhanced-auth.guard';
import { UserCtx, UserContext } from '../../../common/decorators/user-context.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestRun } from '../../../entities';
import { OwnedResource } from '@perfana/shared';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AwrReportsService, CreateAwrReportOptions } from '../services/awr-reports.service';
import { AwrParserService } from '../services/awr-parser.service';
import { AwrAnalysisService } from '../services/awr-analysis.service';
import { AwrComparisonService } from '../services/awr-comparison.service';
import {
  UploadAwrReportDto,
  UploadAwrReportByUrlDto,
  ListAwrReportsQueryDto,
  AwrReportResponseDto,
  AwrReportListResponseDto,
  AwrReportSummaryResponseDto,
  UploadAwrReportResponseDto,
  AwrAnalysisResponseDto,
  CompareReportsDto,
  CompareTestRunAwrReportsDto,
  ComparisonResponseDto,
  ComparisonSummaryDto,
  AvailableBaselinesResponseDto,
} from '../dto';
import type { FileType } from '../entities/awr-report.entity';

// Maximum file size: 50MB
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Controller for AWR Report operations
 *
 * Provides endpoints for:
 * - Uploading AWR reports (file or URL)
 * - Listing and retrieving reports
 * - Running analysis on reports
 * - Comparing reports against baselines
 */
@ApiTags('AWR Reports')
@ApiBearerAuth()
@Controller()
export class AwrReportsController {
  private readonly logger = new Logger(AwrReportsController.name);

  constructor(
    private readonly awrReportsService: AwrReportsService,
    private readonly awrParserService: AwrParserService,
    private readonly awrAnalysisService: AwrAnalysisService,
    private readonly awrComparisonService: AwrComparisonService,
    private readonly authzService: AuthorizationService,
    @InjectRepository(TestRun)
    private readonly testRunRepo: Repository<TestRun>,
  ) {}

  private async validateTestRunAccess(
    testRunId: string,
    ctx: UserContext,
  ): Promise<boolean> {
    // Look up the test run's organization via its system under test
    const testRun = await this.testRunRepo.findOne({
      where: { id: testRunId },
      relations: ['systemUnderTest'],
    });
    if (!testRun || !testRun.systemUnderTest) return false;

    // Delegate the admin / legacy-null-org / membership decision to AuthorizationService.
    // team_id is omitted to preserve the prior behavior of not checking team membership
    // for AWR resources. created_by is unused by canAccessResource (only canModifyResource
    // reads it).
    const result = await this.authzService.canAccessResource(ctx.userId, ctx.roles, {
      organization_id: testRun.systemUnderTest.organization_id,
      created_by: '',
    } as OwnedResource);
    return result.allowed;
  }

  private async validateReportAccess(
    reportId: string,
    ctx: UserContext,
  ): Promise<boolean> {
    // Look up the report's organization via test_run → system_under_test
    const query = `
      SELECT sut.organization_id
      FROM awr_reports ar
      INNER JOIN test_runs tr ON tr.id = ar.test_run_id
      INNER JOIN systems_under_test sut ON sut.id = tr.system_under_test_id
      WHERE ar.id = $1
      LIMIT 1
    `;
    const rows = await this.testRunRepo.query(query, [reportId]);
    if (!rows || rows.length === 0) return false;

    const result = await this.authzService.canAccessResource(ctx.userId, ctx.roles, {
      organization_id: rows[0].organization_id,
      created_by: '',
    } as OwnedResource);
    return result.allowed;
  }

  // ==================== Test Run Scoped Endpoints ====================

  /**
   * Upload AWR report file for a test run
   */
  @Post('test-runs/:testRunId/awr-reports')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  @ApiOperation({
    summary: 'Upload AWR report file',
    description: 'Upload an AWR report HTML file for a test run. The file will be parsed asynchronously.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiParam({
    name: 'testRunId',
    description: 'Test run UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({
    description: 'AWR report file upload',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'AWR report file (HTML format)',
        },
        description: {
          type: 'string',
          description: 'Optional description',
        },
        fileType: {
          type: 'string',
          enum: ['html', 'text'],
          description: 'File type (auto-detected if not provided)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'AWR report uploaded successfully', type: UploadAwrReportResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid file or request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async uploadReport(
    @Param('testRunId', ParseUUIDPipe) testRunId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAwrReportDto,
    @Request() req: AuthenticatedRequest,
    @UserCtx() ctx: UserContext,
  ): Promise<UploadAwrReportResponseDto> {
    const userId = this.getUserIdOrThrow(req);

    // Validate organization access
    const hasAccess = await this.validateTestRunAccess(testRunId, ctx);
    if (!hasAccess) {
      throw new UnauthorizedException('Access denied to this test run');
    }

    // Validate file
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    this.logger.log(`Uploading AWR report for test run ${testRunId}: ${file.originalname}`);

    // Detect file type from extension or content-type
    const fileType = this.detectFileType(file, dto.fileType);

    // Create report record
    const createOptions: CreateAwrReportOptions = {
      testRunId,
      fileName: file.originalname,
      fileSize: file.size,
      fileType,
      rawContent: file.buffer.toString('utf-8'),
      uploadedBy: userId,
    };

    const uploadResult = await this.awrReportsService.create(createOptions);

    // Trigger async parsing (fire and forget)
    this.parseReportAsync(uploadResult.id);

    return uploadResult;
  }

  /**
   * Upload AWR report by URL
   */
  @Post('test-runs/:testRunId/awr-reports/url')
  @ApiOperation({
    summary: 'Upload AWR report by URL',
    description: 'Upload an AWR report by providing a URL to fetch the file from.',
  })
  @ApiParam({
    name: 'testRunId',
    description: 'Test run UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({ status: 201, description: 'AWR report uploaded successfully', type: UploadAwrReportResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid URL or request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async uploadReportByUrl(
    @Param('testRunId', ParseUUIDPipe) testRunId: string,
    @Body() dto: UploadAwrReportByUrlDto,
    @Request() req: AuthenticatedRequest,
    @UserCtx() ctx: UserContext,
  ): Promise<UploadAwrReportResponseDto> {
    const userId = this.getUserIdOrThrow(req);

    // Validate organization access
    const hasAccess = await this.validateTestRunAccess(testRunId, ctx);
    if (!hasAccess) {
      throw new UnauthorizedException('Access denied to this test run');
    }

    this.logger.log(`Uploading AWR report by URL for test run ${testRunId}: ${dto.url}`);

    // Detect file type from URL or provided value
    const fileType: FileType = dto.fileType || this.detectFileTypeFromUrl(dto.url);
    const fileName = dto.fileName || this.extractFileNameFromUrl(dto.url);

    // Create report record with URL reference
    const createOptions: CreateAwrReportOptions = {
      testRunId,
      fileName,
      fileSize: 0, // Will be updated after fetching
      fileType,
      rawContentUrl: dto.url,
      uploadedBy: userId,
    };

    const uploadResult = await this.awrReportsService.create(createOptions);

    // Trigger async parsing (will fetch content from URL)
    this.parseReportAsync(uploadResult.id);

    return uploadResult;
  }

  /**
   * List AWR reports for a test run
   */
  @Get('test-runs/:testRunId/awr-reports')
  @ApiOperation({
    summary: 'List AWR reports for a test run',
    description: 'Retrieve all AWR reports associated with a test run with pagination and filtering.',
  })
  @ApiParam({
    name: 'testRunId',
    description: 'Test run UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiQuery({ name: 'parseStatus', required: false, enum: ['pending', 'parsing', 'completed', 'failed'] })
  @ApiQuery({ name: 'dbName', required: false, description: 'Filter by database name' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max results (default: 50)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Pagination offset' })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['uploadedAt', 'beginTime', 'dbName', 'parseStatus'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiResponse({ status: 200, description: 'AWR reports retrieved successfully', type: AwrReportListResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listReportsForTestRun(
    @Param('testRunId', ParseUUIDPipe) testRunId: string,
    @Query() query: ListAwrReportsQueryDto,
    @UserCtx() ctx: UserContext,
  ): Promise<AwrReportListResponseDto> {
    const hasAccess = await this.validateTestRunAccess(testRunId, ctx);
    if (!hasAccess) {
      return { items: [], total: 0, limit: 50, offset: 0 };
    }
    return this.awrReportsService.findByTestRunId(testRunId, query);
  }

  // ==================== Global AWR Report Endpoints ====================

  /**
   * Get single AWR report by ID
   */
  @Get('awr-reports/:reportId')
  @ApiOperation({
    summary: 'Get AWR report by ID',
    description: 'Retrieve a single AWR report with all metadata and analysis summary.',
  })
  @ApiParam({
    name: 'reportId',
    description: 'AWR report UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({ status: 200, description: 'AWR report retrieved successfully', type: AwrReportResponseDto })
  @ApiResponse({ status: 404, description: 'AWR report not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getReport(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<AwrReportResponseDto> {
    const hasAccess = await this.validateReportAccess(reportId, ctx);
    if (!hasAccess) {
      throw new UnauthorizedException('Access denied to this report');
    }
    return this.awrReportsService.findById(reportId);
  }

  /**
   * Get AWR report summary (for collapsed card view)
   */
  @Get('awr-reports/:reportId/summary')
  @ApiOperation({
    summary: 'Get AWR report summary',
    description: 'Retrieve a compact summary of the AWR report for collapsed card display.',
  })
  @ApiParam({
    name: 'reportId',
    description: 'AWR report UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({ status: 200, description: 'Summary retrieved successfully', type: AwrReportSummaryResponseDto })
  @ApiResponse({ status: 404, description: 'AWR report not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getReportSummary(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<AwrReportSummaryResponseDto> {
    const hasAccess = await this.validateReportAccess(reportId, ctx);
    if (!hasAccess) {
      throw new UnauthorizedException('Access denied to this report');
    }
    return this.awrReportsService.getSummary(reportId);
  }

  /**
   * Get raw AWR report content
   */
  @Get('awr-reports/:reportId/raw')
  @ApiOperation({
    summary: 'Get raw AWR report content',
    description: 'Download the original AWR report file content or get the URL for large files.',
  })
  @ApiParam({
    name: 'reportId',
    description: 'AWR report UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Raw content or URL returned',
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Raw HTML content (for small files)' },
        url: { type: 'string', description: 'URL to download content (for large files)' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'AWR report not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getRawContent(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ content?: string; url?: string }> {
    const hasAccess = await this.validateReportAccess(reportId, ctx);
    if (!hasAccess) {
      throw new UnauthorizedException('Access denied to this report');
    }
    return this.awrReportsService.getRawContent(reportId);
  }

  /**
   * Delete AWR report
   */
  @Delete('awr-reports/:reportId')
  @ApiOperation({
    summary: 'Delete AWR report',
    description: 'Delete an AWR report and all associated analysis data.',
  })
  @ApiParam({
    name: 'reportId',
    description: 'AWR report UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({ status: 200, description: 'AWR report deleted successfully' })
  @ApiResponse({ status: 404, description: 'AWR report not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async deleteReport(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<{ message: string }> {
    const hasAccess = await this.validateReportAccess(reportId, ctx);
    if (!hasAccess) {
      throw new UnauthorizedException('Access denied to this report');
    }
    await this.awrReportsService.delete(reportId);
    return { message: 'AWR report deleted successfully' };
  }

  // ==================== Analysis Endpoints ====================

  /**
   * Get or trigger analysis for an AWR report
   */
  @Get('awr-reports/:reportId/analysis')
  @ApiOperation({
    summary: 'Get AWR report analysis',
    description: 'Retrieve analysis results for an AWR report. If analysis has not been run, it will be triggered.',
  })
  @ApiParam({
    name: 'reportId',
    description: 'AWR report UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiQuery({
    name: 'reanalyze',
    required: false,
    type: Boolean,
    description: 'Force re-analysis even if results exist',
  })
  @ApiResponse({ status: 200, description: 'Analysis results retrieved', type: AwrAnalysisResponseDto })
  @ApiResponse({ status: 404, description: 'AWR report not found or not parsed yet' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAnalysis(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @UserCtx() ctx: UserContext,
    @Query('reanalyze') reanalyze?: string,
  ): Promise<AwrAnalysisResponseDto> {
    const hasAccess = await this.validateReportAccess(reportId, ctx);
    if (!hasAccess) {
      throw new UnauthorizedException('Access denied to this report');
    }
    const shouldReanalyze = reanalyze === 'true';

    if (shouldReanalyze) {
      return this.awrAnalysisService.reanalyzeReport(reportId);
    }

    // Check for existing analysis
    const existingAnalysis = await this.awrAnalysisService.getAnalysisForReport(reportId);
    if (existingAnalysis) {
      return existingAnalysis;
    }

    // Run analysis if not exists
    return this.awrAnalysisService.analyzeSingleReport(reportId);
  }

  /**
   * Trigger re-analysis of an AWR report
   */
  @Post('awr-reports/:reportId/analysis')
  @ApiOperation({
    summary: 'Trigger AWR report analysis',
    description: 'Run or re-run analysis on an AWR report. Useful when analysis rules have been updated.',
  })
  @ApiParam({
    name: 'reportId',
    description: 'AWR report UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({ status: 200, description: 'Analysis completed', type: AwrAnalysisResponseDto })
  @ApiResponse({ status: 404, description: 'AWR report not found or not parsed yet' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async triggerAnalysis(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<AwrAnalysisResponseDto> {
    const hasAccess = await this.validateReportAccess(reportId, ctx);
    if (!hasAccess) {
      throw new UnauthorizedException('Access denied to this report');
    }
    return this.awrAnalysisService.reanalyzeReport(reportId);
  }

  // ==================== Comparison Endpoints ====================

  /**
   * Compare two AWR reports
   */
  @Post('awr-reports/compare')
  @ApiOperation({
    summary: 'Compare AWR reports',
    description: 'Compare two AWR reports to identify performance regressions and improvements.',
  })
  @ApiResponse({ status: 200, description: 'Comparison completed', type: ComparisonResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid request or reports not parsed' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async compareReports(
    @Body() dto: CompareReportsDto,
    @UserCtx() ctx: UserContext,
  ): Promise<ComparisonResponseDto> {
    // Validate access to both reports
    if (dto.currentReportId) {
      const hasAccess = await this.validateReportAccess(dto.currentReportId, ctx);
      if (!hasAccess) {
        throw new UnauthorizedException('Access denied to current report');
      }
    }
    if (dto.baselineReportId) {
      const hasAccess = await this.validateReportAccess(dto.baselineReportId, ctx);
      if (!hasAccess) {
        throw new UnauthorizedException('Access denied to baseline report');
      }
    }
    return this.awrComparisonService.compareReports(dto);
  }

  /**
   * Compare AWR reports across test runs
   */
  @Post('awr-reports/compare-test-runs')
  @ApiOperation({
    summary: 'Compare AWR reports across test runs',
    description: 'Compare AWR reports from two different test runs. Uses latest reports if specific IDs not provided.',
  })
  @ApiResponse({ status: 200, description: 'Comparison completed', type: ComparisonResponseDto })
  @ApiResponse({ status: 400, description: 'No completed reports found for test runs' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async compareTestRunReports(
    @Body() dto: CompareTestRunAwrReportsDto,
    @UserCtx() ctx: UserContext,
  ): Promise<ComparisonResponseDto> {
    // Validate access to both test runs
    if (dto.currentTestRunId) {
      const hasAccess = await this.validateTestRunAccess(dto.currentTestRunId, ctx);
      if (!hasAccess) {
        throw new UnauthorizedException('Access denied to current test run');
      }
    }
    if (dto.baselineTestRunId) {
      const hasAccess = await this.validateTestRunAccess(dto.baselineTestRunId, ctx);
      if (!hasAccess) {
        throw new UnauthorizedException('Access denied to baseline test run');
      }
    }
    return this.awrComparisonService.compareTestRunReports(dto);
  }

  /**
   * Get quick comparison summary
   */
  @Get('awr-reports/:reportId/comparison-summary')
  @ApiOperation({
    summary: 'Get comparison summary',
    description: 'Get a quick summary of comparison results between two reports.',
  })
  @ApiParam({
    name: 'reportId',
    description: 'Current AWR report UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiQuery({
    name: 'baselineReportId',
    required: true,
    description: 'Baseline AWR report UUID for comparison',
  })
  @ApiResponse({ status: 200, description: 'Comparison summary retrieved', type: ComparisonSummaryDto })
  @ApiResponse({ status: 400, description: 'Baseline report ID required' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getComparisonSummary(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Query('baselineReportId', ParseUUIDPipe) baselineReportId: string,
    @UserCtx() ctx: UserContext,
  ): Promise<ComparisonSummaryDto> {
    const hasAccess = await this.validateReportAccess(reportId, ctx);
    if (!hasAccess) {
      throw new UnauthorizedException('Access denied to this report');
    }
    return this.awrComparisonService.getComparisonSummary(reportId, baselineReportId);
  }

  /**
   * Get available baselines for comparison
   */
  @Get('awr-reports/:reportId/available-baselines')
  @ApiOperation({
    summary: 'Get available baselines',
    description: 'List AWR reports from other test runs that can be used as comparison baselines.',
  })
  @ApiParam({
    name: 'reportId',
    description: 'AWR report UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum baselines to return (default: 20)',
  })
  @ApiResponse({ status: 200, description: 'Available baselines retrieved', type: AvailableBaselinesResponseDto })
  @ApiResponse({ status: 404, description: 'AWR report not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAvailableBaselines(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @UserCtx() ctx: UserContext,
    @Query('limit') limit?: number,
  ): Promise<AvailableBaselinesResponseDto> {
    const hasAccess = await this.validateReportAccess(reportId, ctx);
    if (!hasAccess) {
      throw new UnauthorizedException('Access denied to this report');
    }
    // Convert undefined/NaN to undefined so service default kicks in
    const effectiveLimit = limit && !isNaN(limit) ? limit : undefined;
    return this.awrComparisonService.getAvailableBaselines(reportId, effectiveLimit);
  }

  /**
   * Get available baselines for a test run
   */
  @Get('test-runs/:testRunId/awr-reports/available-baselines')
  @ApiOperation({
    summary: 'Get available baselines for test run',
    description: 'List AWR reports from other test runs that can be used as comparison baselines.',
  })
  @ApiParam({
    name: 'testRunId',
    description: 'Test run UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum baselines to return (default: 20)',
  })
  @ApiResponse({ status: 200, description: 'Available baselines retrieved', type: AvailableBaselinesResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAvailableBaselinesForTestRun(
    @Param('testRunId', ParseUUIDPipe) testRunId: string,
    @UserCtx() ctx: UserContext,
    @Query('limit') limit?: number,
  ): Promise<AvailableBaselinesResponseDto> {
    const hasAccess = await this.validateTestRunAccess(testRunId, ctx);
    if (!hasAccess) {
      throw new UnauthorizedException('Access denied to this test run');
    }
    // Convert undefined/NaN to undefined so service default kicks in
    const effectiveLimit = limit && !isNaN(limit) ? limit : undefined;
    return this.awrComparisonService.getAvailableBaselinesForTestRun(testRunId, effectiveLimit);
  }

  // ==================== Private Helper Methods ====================

  /**
   * Get user ID from request or throw unauthorized exception
   */
  private getUserIdOrThrow(req: AuthenticatedRequest): string {
    const userId = KeycloakEnhancedAuthGuard.getUserId(req);
    if (!userId) {
      throw new UnauthorizedException('User ID not found in request');
    }
    return userId;
  }

  /**
   * Detect file type from file metadata or provided value
   */
  private detectFileType(file: Express.Multer.File, providedType?: string): FileType {
    if (providedType === 'html' || providedType === 'text') {
      return providedType;
    }

    const extension = file.originalname.toLowerCase().split('.').pop();
    if (extension === 'txt' || extension === 'text') {
      return 'text';
    }

    // Default to HTML
    return 'html';
  }

  /**
   * Detect file type from URL
   */
  private detectFileTypeFromUrl(url: string): FileType {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.endsWith('.txt') || lowerUrl.endsWith('.text')) {
      return 'text';
    }
    return 'html';
  }

  /**
   * Extract file name from URL
   */
  private extractFileNameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart && lastPart.length > 0) {
        return decodeURIComponent(lastPart);
      }
    } catch {
      // URL parsing failed, use fallback
    }
    return 'awr-report.html';
  }

  /**
   * Trigger async parsing of a report (fire and forget)
   */
  private parseReportAsync(reportId: string): void {
    // Schedule parsing without blocking the response
    setImmediate(async () => {
      try {
        this.logger.log(`Starting async parsing for report ${reportId}`);
        await this.awrParserService.parseReport(reportId);
        this.logger.log(`Async parsing completed for report ${reportId}`);
      } catch (error) {
        const errorMessage = error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
        this.logger.error(`Async parsing failed for report ${reportId}: ${errorMessage}`);
        // Status is already set to 'failed' by the parser service
      }
    });
  }
}
