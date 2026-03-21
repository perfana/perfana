import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { REPORT_SECTION_TYPES, ReportSectionType, ReportSectionConfigDto, ReportStylingDto } from './create-report.dto';

/**
 * Report status values
 */
export const REPORT_STATUS_VALUES = [
  'pending',
  'processing',
  'html_complete',
  'pdf_processing',
  'pdf_complete',
  'failed',
] as const;

export type ReportStatus = (typeof REPORT_STATUS_VALUES)[number];

/**
 * Response DTO for report generation
 */
export class GenerateReportResponseDto {
  @ApiProperty({
    description: 'Generated report UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  report_id!: string;

  @ApiProperty({
    description: 'BullMQ job ID for tracking progress',
    example: 'html-generation-123',
  })
  job_id!: string;

  @ApiProperty({
    description: 'Initial report status',
    example: 'pending',
    enum: REPORT_STATUS_VALUES,
  })
  status!: ReportStatus;

  @ApiPropertyOptional({
    description: 'Estimated completion time in seconds',
    example: 30,
  })
  estimated_completion_seconds?: number;
}

/**
 * Response DTO for PDF generation
 */
export class GeneratePdfResponseDto {
  @ApiProperty({
    description: 'Report UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  report_id!: string;

  @ApiProperty({
    description: 'BullMQ job ID for tracking progress',
    example: 'pdf-generation-456',
  })
  job_id!: string;

  @ApiProperty({
    description: 'Report status',
    example: 'pdf_processing',
    enum: REPORT_STATUS_VALUES,
  })
  status!: ReportStatus;
}

/**
 * Response DTO for share settings
 */
export class ShareSettingsResponseDto {
  @ApiProperty({
    description: 'Share UUID for public access',
    example: '789e0123-e89b-12d3-a456-426614174000',
  })
  share_id!: string;

  @ApiProperty({
    description: 'Whether sharing is enabled',
    example: true,
  })
  share_enabled!: boolean;

  @ApiProperty({
    description: 'Full share URL',
    example: 'https://perfana.io/reports/share/789e0123-e89b-12d3-a456-426614174000',
  })
  share_url!: string;

  @ApiProperty({
    description: 'Number of times the shared link has been accessed',
    example: 42,
  })
  share_view_count!: number;

  @ApiPropertyOptional({
    description: 'Last time the shared link was accessed',
    example: '2026-01-15T10:30:00Z',
  })
  last_shared_at?: Date;

  @ApiPropertyOptional({
    description: 'When the share link expires',
    example: '2026-02-28T00:00:00Z',
  })
  expires_at?: Date;
}

/**
 * Response DTO for public share access
 */
export class PublicShareResponseDto {
  @ApiProperty({
    description: 'HTML content of the report',
    example: '<!DOCTYPE html><html>...</html>',
  })
  html_content!: string;

  @ApiProperty({
    description: 'Report name',
    example: 'Performance Report - January 2026',
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'Test run name for context',
    example: 'Load Test Run #45',
  })
  test_run_name?: string;

  @ApiProperty({
    description: 'When the report was generated',
    example: '2026-01-15T10:30:00Z',
  })
  generated_at!: Date;
}

/**
 * Response DTO for a single report (compact version)
 */
export class ReportListItemDto {
  @ApiProperty({
    description: 'Report UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Associated test run UUID',
    example: '456e7890-e89b-12d3-a456-426614174000',
  })
  test_run_id!: string;

  @ApiProperty({
    description: 'Template name used for generation',
    example: 'Standard Performance Template',
  })
  template_name!: string;

  @ApiProperty({
    description: 'Report name',
    example: 'Performance Report - January 2026',
  })
  name!: string;

  @ApiProperty({
    description: 'User who generated the report',
    example: 'john.doe@example.com',
  })
  generated_by!: string;

  @ApiProperty({
    description: 'Current status',
    example: 'html_complete',
    enum: REPORT_STATUS_VALUES,
  })
  status!: ReportStatus;

  @ApiProperty({
    description: 'Whether sharing is enabled',
    example: false,
  })
  share_enabled!: boolean;

  @ApiProperty({
    description: 'Share UUID',
    example: '789e0123-e89b-12d3-a456-426614174000',
  })
  share_id!: string;

  @ApiProperty({
    description: 'Number of share views',
    example: 0,
  })
  share_view_count!: number;

  @ApiProperty({
    description: 'Number of PDF downloads',
    example: 5,
  })
  download_count!: number;

  @ApiProperty({
    description: 'Whether PDF is available',
    example: true,
  })
  has_pdf!: boolean;

  @ApiPropertyOptional({
    description: 'File size in bytes',
    example: 1024000,
  })
  file_size?: number;

  @ApiProperty({
    description: 'When the report was created',
    example: '2026-01-15T10:00:00Z',
  })
  created_at!: Date;

  @ApiPropertyOptional({
    description: 'When the report was completed',
    example: '2026-01-15T10:05:00Z',
  })
  completed_at?: Date;
}

/**
 * Response DTO for paginated report list
 */
export class ReportListResponseDto {
  @ApiProperty({
    description: 'List of reports',
    type: [ReportListItemDto],
  })
  items!: ReportListItemDto[];

  @ApiProperty({
    description: 'Total number of reports matching the query',
    example: 100,
  })
  total!: number;

  @ApiProperty({
    description: 'Current offset',
    example: 0,
  })
  offset!: number;

  @ApiProperty({
    description: 'Page size limit',
    example: 50,
  })
  limit!: number;
}

/**
 * Response DTO for report summary (used in test run card)
 */
export class ReportSummaryDto {
  @ApiProperty({
    description: 'Total number of reports',
    example: 10,
  })
  total_reports!: number;

  @ApiProperty({
    description: 'Number of completed reports',
    example: 8,
  })
  completed_reports!: number;

  @ApiProperty({
    description: 'Number of pending/processing reports',
    example: 1,
  })
  pending_reports!: number;

  @ApiProperty({
    description: 'Number of failed reports',
    example: 1,
  })
  failed_reports!: number;

  @ApiPropertyOptional({
    description: 'Most recent report',
    type: ReportListItemDto,
  })
  latest_report?: ReportListItemDto;

  @ApiProperty({
    description: 'Total downloads across all reports',
    example: 42,
  })
  total_downloads!: number;

  @ApiProperty({
    description: 'Total share views across all reports',
    example: 150,
  })
  total_share_views!: number;
}

/**
 * Response DTO for full report details
 */
export class ReportDetailDto {
  @ApiProperty({
    description: 'Report UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Associated test run UUID',
    example: '456e7890-e89b-12d3-a456-426614174000',
  })
  test_run_id!: string;

  @ApiProperty({
    description: 'Template UUID',
    example: '789e0123-e89b-12d3-a456-426614174000',
  })
  template_id!: string;

  @ApiProperty({
    description: 'Report name',
    example: 'Performance Report - January 2026',
  })
  name!: string;

  @ApiProperty({
    description: 'User who generated the report',
    example: 'john.doe@example.com',
  })
  generated_by!: string;

  @ApiPropertyOptional({
    description: 'HTML content (only included if requested)',
    example: '<!DOCTYPE html><html>...</html>',
  })
  html_content?: string;

  @ApiPropertyOptional({
    description: 'When HTML was generated',
    example: '2026-01-15T10:05:00Z',
  })
  html_generated_at?: Date;

  @ApiProperty({
    description: 'Share UUID',
    example: '789e0123-e89b-12d3-a456-426614174000',
  })
  share_id!: string;

  @ApiProperty({
    description: 'Whether sharing is enabled',
    example: false,
  })
  share_enabled!: boolean;

  @ApiProperty({
    description: 'Number of share views',
    example: 0,
  })
  share_view_count!: number;

  @ApiPropertyOptional({
    description: 'Last share access time',
    example: '2026-01-15T12:00:00Z',
  })
  last_shared_at?: Date;

  @ApiProperty({
    description: 'Whether PDF is available',
    example: true,
  })
  has_pdf!: boolean;

  @ApiPropertyOptional({
    description: 'File size in bytes',
    example: 1024000,
  })
  file_size?: number;

  @ApiProperty({
    description: 'MIME type',
    example: 'application/pdf',
  })
  mime_type!: string;

  @ApiProperty({
    description: 'Current status',
    example: 'html_complete',
    enum: REPORT_STATUS_VALUES,
  })
  status!: ReportStatus;

  @ApiPropertyOptional({
    description: 'Error code if failed',
    example: 'GENERATION_TIMEOUT',
  })
  error_code?: string;

  @ApiPropertyOptional({
    description: 'Error message if failed',
    example: 'Report generation timed out after 60 seconds',
  })
  error_message?: string;

  @ApiPropertyOptional({
    description: 'BullMQ job ID',
    example: 'html-generation-123',
  })
  job_id?: string;

  @ApiProperty({
    description: 'Number of retry attempts',
    example: 0,
  })
  retry_count!: number;

  @ApiProperty({
    description: 'Maximum retry attempts',
    example: 3,
  })
  max_retries!: number;

  @ApiProperty({
    description: 'Number of PDF downloads',
    example: 5,
  })
  download_count!: number;

  @ApiPropertyOptional({
    description: 'Last download time',
    example: '2026-01-15T14:00:00Z',
  })
  last_downloaded_at?: Date;

  @ApiPropertyOptional({
    description: 'When the report expires',
    example: '2026-02-15T00:00:00Z',
  })
  expires_at?: Date;

  @ApiProperty({
    description: 'When the report was created',
    example: '2026-01-15T10:00:00Z',
  })
  created_at!: Date;

  @ApiProperty({
    description: 'When the report was last updated',
    example: '2026-01-15T10:05:00Z',
  })
  updated_at!: Date;

  @ApiPropertyOptional({
    description: 'When generation started',
    example: '2026-01-15T10:00:30Z',
  })
  started_at?: Date;

  @ApiPropertyOptional({
    description: 'When generation completed',
    example: '2026-01-15T10:05:00Z',
  })
  completed_at?: Date;
}

/**
 * Response DTO for template list item (compact version)
 */
export class TemplateListItemDto {
  @ApiProperty({
    description: 'Template UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Template name',
    example: 'Standard Performance Template',
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'Template description',
    example: 'Standard template for weekly performance reports',
  })
  description?: string;

  @ApiProperty({
    description: 'User who created the template',
    example: 'john.doe@example.com',
  })
  created_by!: string;

  @ApiProperty({
    description: 'Number of sections',
    example: 5,
  })
  section_count!: number;

  @ApiProperty({
    description: 'Section types in this template',
    type: [String],
    example: ['header', 'slo', 'apdex', 'graphs'],
    enum: REPORT_SECTION_TYPES,
  })
  section_types!: ReportSectionType[];

  @ApiProperty({
    description: 'Whether this is the default template for its scope',
    example: false,
  })
  is_default!: boolean;

  @ApiProperty({
    description: 'When the template was created',
    example: '2026-01-01T00:00:00Z',
  })
  created_at!: Date;

  @ApiProperty({
    description: 'When the template was last updated',
    example: '2026-01-10T00:00:00Z',
  })
  updated_at!: Date;
}

/**
 * Response DTO for paginated template list
 */
export class TemplateListResponseDto {
  @ApiProperty({
    description: 'List of templates',
    type: [TemplateListItemDto],
  })
  items!: TemplateListItemDto[];

  @ApiProperty({
    description: 'Total number of templates matching the query',
    example: 10,
  })
  total!: number;

  @ApiProperty({
    description: 'Current offset',
    example: 0,
  })
  offset!: number;

  @ApiProperty({
    description: 'Page size limit',
    example: 50,
  })
  limit!: number;
}

/**
 * Response DTO for full template details
 */
export class TemplateDetailDto {
  @ApiProperty({
    description: 'Template UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Template name',
    example: 'Standard Performance Template',
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'Template description',
    example: 'Standard template for weekly performance reports',
  })
  description?: string;

  @ApiProperty({
    description: 'User who created the template',
    example: 'john.doe@example.com',
  })
  created_by!: string;

  @ApiProperty({
    description: 'System ID for template scoping',
    example: 'perfana',
  })
  system_id!: string;

  @ApiProperty({
    description: 'Test environment for template scoping',
    example: 'production',
  })
  test_environment!: string;

  @ApiProperty({
    description: 'Workload for template scoping',
    example: 'load-test',
  })
  workload!: string;

  @ApiProperty({
    description: 'Section configurations',
    type: [ReportSectionConfigDto],
  })
  sections!: ReportSectionConfigDto[];

  @ApiPropertyOptional({
    description: 'Styling options',
    type: ReportStylingDto,
  })
  styling?: ReportStylingDto;

  @ApiProperty({
    description: 'Whether this is the default template',
    example: false,
  })
  is_default!: boolean;

  @ApiProperty({
    description: 'When the template was created',
    example: '2026-01-01T00:00:00Z',
  })
  created_at!: Date;

  @ApiProperty({
    description: 'When the template was last updated',
    example: '2026-01-10T00:00:00Z',
  })
  updated_at!: Date;
}

/**
 * Response DTO for template summary (for dropdowns)
 */
export class TemplateSummaryDto {
  @ApiProperty({
    description: 'Template UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Template name',
    example: 'Standard Performance Template',
  })
  name!: string;

  @ApiProperty({
    description: 'Whether this is the default template',
    example: false,
  })
  is_default!: boolean;

  @ApiProperty({
    description: 'Number of sections',
    example: 5,
  })
  section_count!: number;
}

/**
 * Response DTO for job progress
 */
export class JobProgressDto {
  @ApiProperty({
    description: 'BullMQ job ID',
    example: 'html-generation-123',
  })
  job_id!: string;

  @ApiProperty({
    description: 'Report UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  report_id!: string;

  @ApiProperty({
    description: 'Current generation stage',
    example: 'rendering_html',
    enum: ['initializing', 'fetching_data', 'rendering_html', 'saving', 'complete'],
  })
  stage!: 'initializing' | 'fetching_data' | 'rendering_html' | 'saving' | 'complete';

  @ApiProperty({
    description: 'Progress percentage (0-100)',
    example: 75,
    minimum: 0,
    maximum: 100,
  })
  progress!: number;

  @ApiProperty({
    description: 'Human-readable status message',
    example: 'Rendering HTML content...',
  })
  message!: string;
}
