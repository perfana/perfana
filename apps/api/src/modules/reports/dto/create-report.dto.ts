import {
  IsString,
  IsOptional,
  IsUUID,
  Length,
  IsEnum,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  ValidateNested,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsObject,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Report section types supported by the reporting system.
 * Uses underscores (not hyphens) as per project conventions.
 */
export const REPORT_SECTION_TYPES = [
  'header',
  'text_block',
  'slo',
  'apdex',
  'transaction_response_times',
  'regressions',
  'awr',
  'trends',
  'comparisons',
  'graphs',
  'top_10_lists',
] as const;

export type ReportSectionType = (typeof REPORT_SECTION_TYPES)[number];

/**
 * DTO for section configuration within a report
 */
export class ReportSectionConfigDto {
  @ApiProperty({
    description: 'Section type identifier',
    example: 'slo',
    enum: REPORT_SECTION_TYPES,
  })
  @IsString()
  @IsEnum(REPORT_SECTION_TYPES, {
    message: `Section type must be one of: ${REPORT_SECTION_TYPES.join(', ')}`,
  })
  type!: ReportSectionType;

  @ApiProperty({
    description: 'Display order in the report (0-based)',
    example: 0,
    minimum: 0,
    maximum: 49,
  })
  @IsNumber()
  @Min(0, { message: 'Order must be at least 0' })
  @Max(49, { message: 'Order must not exceed 49' })
  order!: number;

  @ApiPropertyOptional({
    description: 'Custom title for the section (overrides default)',
    example: 'Performance Summary',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(0, 255, { message: 'Title must not exceed 255 characters' })
  title?: string;

  @ApiPropertyOptional({
    description: 'Section-specific configuration options',
    example: { includeChart: true, showFailedOnly: false },
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Optional comment for stakeholder communication (not available for header/text_block)',
    example: 'All SLOs met during this test run',
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @Length(0, 5000, { message: 'Comment must not exceed 5000 characters' })
  comment?: string;
}

/**
 * DTO for report styling options
 */
export class ReportStylingDto {
  @ApiPropertyOptional({
    description: 'Primary color for the report (hex or CSS color)',
    example: '#1976d2',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @Length(0, 50, { message: 'Primary color must not exceed 50 characters' })
  primaryColor?: string;

  @ApiPropertyOptional({
    description: 'Secondary color for the report (hex or CSS color)',
    example: '#9c27b0',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @Length(0, 50, { message: 'Secondary color must not exceed 50 characters' })
  secondaryColor?: string;

  @ApiPropertyOptional({
    description: 'Logo URL or base64 encoded image',
    example: 'https://example.com/logo.png',
    maxLength: 100000,
  })
  @IsOptional()
  @IsString()
  @Length(0, 100000, { message: 'Logo must not exceed 100000 characters' })
  logo?: string;

  @ApiPropertyOptional({
    description: 'Font family for the report',
    example: 'system-ui, sans-serif',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @Length(0, 200, { message: 'Font family must not exceed 200 characters' })
  fontFamily?: string;

  @ApiPropertyOptional({
    description: 'Custom CSS to inject into the report',
    example: '.header { border-bottom: 2px solid #1976d2; }',
    maxLength: 10000,
  })
  @IsOptional()
  @IsString()
  @Length(0, 10000, { message: 'Custom CSS must not exceed 10000 characters' })
  customCss?: string;
}

/**
 * DTO for generating a report from an existing template
 *
 * @example
 * // Generate report from template:
 * // POST /api/reports/generate
 * // {
 * //   "test_run_id": "123e4567-e89b-12d3-a456-426614174000",
 * //   "template_id": "456e7890-e89b-12d3-a456-426614174000"
 * // }
 */
export class GenerateReportFromTemplateDto {
  @ApiProperty({
    description: 'Test run UUID to generate report for',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4', { message: 'Test run ID must be a valid UUID' })
  test_run_id!: string;

  @ApiProperty({
    description: 'Template UUID to use for generation',
    example: '456e7890-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4', { message: 'Template ID must be a valid UUID' })
  template_id!: string;

  @ApiPropertyOptional({
    description: 'Custom report name (defaults to template name + timestamp)',
    example: 'Load Test Report - January 2026',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'Name must be between 1 and 255 characters' })
  name?: string;
}

/**
 * DTO for generating an ad-hoc report with custom sections
 *
 * @example
 * // Generate ad-hoc report:
 * // POST /api/reports/generate/ad-hoc
 * // {
 * //   "test_run_id": "123e4567-e89b-12d3-a456-426614174000",
 * //   "name": "Custom Performance Report",
 * //   "sections": [
 * //     { "type": "header", "order": 0, "title": "Performance Analysis" },
 * //     { "type": "slo", "order": 1, "comment": "All targets met" }
 * //   ]
 * // }
 */
export class GenerateAdHocReportDto {
  @ApiProperty({
    description: 'Test run UUID to generate report for',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4', { message: 'Test run ID must be a valid UUID' })
  test_run_id!: string;

  @ApiProperty({
    description: 'Report name',
    example: 'Custom Performance Report',
    maxLength: 255,
  })
  @IsString()
  @Length(1, 255, { message: 'Name must be between 1 and 255 characters' })
  name!: string;

  @ApiProperty({
    description: 'Section configurations for the report (1-50 sections)',
    type: [ReportSectionConfigDto],
    minItems: 1,
    maxItems: 50,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one section is required' })
  @ArrayMaxSize(50, { message: 'Maximum 50 sections allowed' })
  @ValidateNested({ each: true })
  @Type(() => ReportSectionConfigDto)
  sections!: ReportSectionConfigDto[];

  @ApiPropertyOptional({
    description: 'Custom styling options for the report',
    type: ReportStylingDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReportStylingDto)
  styling?: ReportStylingDto;

  @ApiPropertyOptional({
    description: 'Whether to save this configuration as a template for future use',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  save_as_template?: boolean;

  @ApiPropertyOptional({
    description: 'Template name (required if save_as_template is true)',
    example: 'Standard Performance Template',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'Template name must be between 1 and 255 characters' })
  template_name?: string;

  @ApiPropertyOptional({
    description: 'Template description (used if save_as_template is true)',
    example: 'Standard template for weekly performance reports',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @Length(0, 1000, { message: 'Template description must not exceed 1000 characters' })
  template_description?: string;
}

/**
 * DTO for requesting PDF generation from an existing HTML report
 *
 * @example
 * // Generate PDF:
 * // POST /api/reports/123e4567-e89b-12d3-a456-426614174000/pdf
 */
export class GeneratePdfDto {
  @ApiPropertyOptional({
    description: 'Paper format for PDF generation',
    example: 'a4',
    enum: ['a4', 'letter', 'legal', 'a3'],
    default: 'a4',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['a4', 'letter', 'legal', 'a3'], {
    message: 'Paper format must be a4, letter, legal, or a3',
  })
  paperFormat?: 'a4' | 'letter' | 'legal' | 'a3';

  @ApiPropertyOptional({
    description: 'Page orientation',
    example: 'portrait',
    enum: ['portrait', 'landscape'],
    default: 'portrait',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['portrait', 'landscape'], {
    message: 'Orientation must be portrait or landscape',
  })
  orientation?: 'portrait' | 'landscape';

  @ApiPropertyOptional({
    description: 'Include page header with report name',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeHeader?: boolean;

  @ApiPropertyOptional({
    description: 'Include page footer with page numbers',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeFooter?: boolean;
}

/**
 * DTO for updating share settings on a report
 *
 * @example
 * // Enable sharing:
 * // PUT /api/reports/123e4567-e89b-12d3-a456-426614174000/share
 * // { "share_enabled": true, "expires_at": "2026-02-28T00:00:00Z" }
 */
export class UpdateShareSettingsDto {
  @ApiProperty({
    description: 'Whether to enable public sharing',
    example: true,
  })
  @IsBoolean()
  share_enabled!: boolean;

  @ApiPropertyOptional({
    description: 'Expiration date for the share link (ISO 8601 format)',
    example: '2026-02-28T00:00:00Z',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/, {
    message: 'Expires at must be a valid ISO 8601 date string',
  })
  expires_at?: string;
}

/**
 * Query parameters for listing reports for a test run
 */
export class ListReportsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by report status',
    example: 'html_complete',
    enum: ['pending', 'processing', 'html_complete', 'pdf_processing', 'pdf_complete', 'failed'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['pending', 'processing', 'html_complete', 'pdf_processing', 'pdf_complete', 'failed'], {
    message:
      'Status must be pending, processing, html_complete, pdf_processing, pdf_complete, or failed',
  })
  status?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of results (default: 50, max: 100)',
    example: 20,
    default: 50,
  })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(100, { message: 'Limit must not exceed 100' })
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Offset for pagination',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Offset must be at least 0' })
  @Type(() => Number)
  offset?: number;

  @ApiPropertyOptional({
    description: 'Sort by field',
    example: 'created_at',
    enum: ['created_at', 'name', 'status', 'completed_at'],
    default: 'created_at',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['created_at', 'name', 'status', 'completed_at'], {
    message: 'Sort by must be created_at, name, status, or completed_at',
  })
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    example: 'desc',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['asc', 'desc'], { message: 'Sort order must be asc or desc' })
  sortOrder?: 'asc' | 'desc';
}

/**
 * Path parameters for share endpoints
 */
export class ShareParamsDto {
  @ApiProperty({
    description: 'Share UUID (unique identifier for public access)',
    example: '789e0123-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4', { message: 'Share ID must be a valid UUID' })
  shareId!: string;
}

/**
 * DTO for previewing a single report section
 *
 * @example
 * // Preview Apdex section:
 * // POST /api/reports/preview-section
 * // {
 * //   "test_run_id": "123e4567-e89b-12d3-a456-426614174000",
 * //   "section": {
 * //     "type": "apdex",
 * //     "order": 0,
 * //     "config": { "showSummary": true, "errorThreshold": 0.5 }
 * //   }
 * // }
 */
export class PreviewSectionDto {
  @ApiPropertyOptional({
    description: 'Test run UUID to generate preview for (optional, uses mock data if not provided)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Test run ID must be a valid UUID' })
  test_run_id?: string;

  @ApiProperty({
    description: 'Section configuration to preview',
    type: ReportSectionConfigDto,
  })
  @ValidateNested()
  @Type(() => ReportSectionConfigDto)
  section!: ReportSectionConfigDto;

  @ApiPropertyOptional({
    description: 'Custom styling options for the preview',
    type: ReportStylingDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReportStylingDto)
  styling?: ReportStylingDto;
}
