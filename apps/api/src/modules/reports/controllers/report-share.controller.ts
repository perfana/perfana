import { Controller, Get, Param, Logger, HttpException, HttpStatus, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Public } from '../../../decorators/public.decorator';
import { ReportShareService } from '../services/report-share.service';
import { PublicShareResponseDto, ShareParamsDto } from '../dto';

/**
 * Controller for public report share access.
 *
 * This controller provides unauthenticated access to shared reports.
 * All endpoints use the @Public() decorator to bypass authentication.
 */
@ApiTags('reports/share')
@Controller('reports/share')
export class ReportShareController {
  private readonly logger = new Logger(ReportShareController.name);

  constructor(private readonly reportShareService: ReportShareService) {}

  /**
   * Download PDF for publicly shared report
   *
   * This endpoint allows unauthenticated PDF download of shared reports.
   * It increments the view count on each access.
   */
  @Get(':shareId/pdf')
  @Public()
  @ApiOperation({
    summary: 'Download PDF for publicly shared report',
    description:
      'Downloads a PDF version of a shared report by its share ID. No authentication required. ' +
      'Generates PDF on-the-fly from HTML content. ' +
      'Returns 404 if report not found, sharing is disabled, or link has expired.',
  })
  @ApiParam({
    name: 'shareId',
    description: 'Share UUID (unique identifier for public access)',
    example: '789e0123-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'PDF file downloaded successfully',
    type: StreamableFile,
  })
  @ApiResponse({
    status: 404,
    description: 'Shared report not found, sharing disabled, or link expired',
  })
  async downloadPublicPdf(
    @Param() params: ShareParamsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    try {
      // Serve pre-generated PDF from database
      const result = await this.reportShareService.getPublicReportPdf(params.shareId);

      if (!result) {
        throw new HttpException(
          'PDF has not been generated for this report yet',
          HttpStatus.NOT_FOUND,
        );
      }

      // Sanitize filename
      const sanitizedName = result.reportName
        .replace(/[^a-z0-9\s-]/gi, '_')
        .replace(/\s+/g, '_')
        .toLowerCase();

      // Set content type and disposition
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${sanitizedName}.pdf"`,
        'Content-Length': result.pdfData.length.toString(),
      });

      this.logger.log(
        `Serving pre-generated PDF for public share ${params.shareId}, size: ${result.pdfData.length} bytes`,
      );

      return new StreamableFile(result.pdfData);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      // Handle specific error types from the service
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';

      if (
        errorMessage.includes('not found') ||
        errorMessage.includes('Shared Report') ||
        errorMessage.includes('Sharing is not enabled') ||
        errorMessage.includes('share link has expired') ||
        errorMessage.includes('content is not yet available')
      ) {
        this.logger.warn(`Public PDF download denied for ${params.shareId}: ${errorMessage}`);
        throw new HttpException(errorMessage, HttpStatus.NOT_FOUND);
      }

      this.logger.error(`Failed to serve PDF for public share ${params.shareId}:`, error);
      throw new HttpException(
        'Failed to download PDF for shared report',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get publicly shared report by share ID
   *
   * This endpoint allows unauthenticated access to reports that have
   * sharing enabled. It increments the view count on each access.
   */
  @Get(':shareId')
  @Public()
  @ApiOperation({
    summary: 'Get publicly shared report',
    description:
      'Retrieves a shared report by its share ID. No authentication required. ' +
      'Returns 404 if report not found, sharing is disabled, or link has expired.',
  })
  @ApiParam({
    name: 'shareId',
    description: 'Share UUID (unique identifier for public access)',
    example: '789e0123-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Report content retrieved successfully',
    type: PublicShareResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Shared report not found, sharing disabled, or link expired',
  })
  async getPublicReport(@Param() params: ShareParamsDto): Promise<PublicShareResponseDto> {
    try {
      const publicReport = await this.reportShareService.getPublicReport(params.shareId);

      this.logger.debug(`Public report accessed: ${publicReport.reportId}`);

      return {
        html_content: publicReport.htmlContent,
        name: publicReport.reportName,
        generated_at: publicReport.generatedAt || new Date(),
      };
    } catch (error) {
      // Handle specific error types from the service
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';

      // ResourceNotFoundException and ValidationException from service
      if (
        errorMessage.includes('not found') ||
        errorMessage.includes('Shared Report') ||
        errorMessage.includes('Sharing is not enabled') ||
        errorMessage.includes('share link has expired') ||
        errorMessage.includes('content is not yet available')
      ) {
        this.logger.warn(`Public share access denied for ${params.shareId}: ${errorMessage}`);
        throw new HttpException(errorMessage, HttpStatus.NOT_FOUND);
      }

      this.logger.error(`Failed to get public report ${params.shareId}:`, error);
      throw new HttpException(
        'Failed to retrieve shared report',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Health check for share endpoint
   *
   * Simple endpoint to verify the share controller is operational.
   */
  @Get('health/check')
  @Public()
  @ApiOperation({
    summary: 'Health check for share module',
    description: 'Simple health check to verify share endpoints are operational.',
  })
  @ApiResponse({ status: 200, description: 'Health check passed' })
  getHealth(): { status: string; module: string } {
    return { status: 'ok', module: 'reports-share' };
  }
}
