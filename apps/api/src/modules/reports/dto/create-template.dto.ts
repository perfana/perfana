import {
  IsString,
  IsOptional,
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
} from 'class-validator';
import { MAX_REPORT_SECTIONS } from '@perfana/shared/types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ReportSectionConfigDto, ReportStylingDto } from './create-report.dto';

/**
 * DTO for creating a new report template
 *
 * @example
 * // Create template:
 * // POST /api/report-templates
 * // {
 * //   "name": "Standard Performance Template",
 * //   "system_id": "perfana",
 * //   "test_environment": "production",
 * //   "workload": "load-test",
 * //   "sections": [
 * //     { "type": "header", "order": 0, "title": "Performance Report" },
 * //     { "type": "slo", "order": 1 }
 * //   ]
 * // }
 */
export class CreateTemplateDto {
  @ApiProperty({
    description: 'Template name (unique within scope)',
    example: 'Standard Performance Template',
    maxLength: 255,
  })
  @IsString()
  @Length(1, 255, { message: 'Name must be between 1 and 255 characters' })
  name!: string;

  @ApiPropertyOptional({
    description: 'Template description',
    example: 'Standard template for weekly performance reports with all key metrics',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @Length(0, 1000, { message: 'Description must not exceed 1000 characters' })
  description?: string;

  @ApiProperty({
    description: 'System ID for template scoping',
    example: 'perfana',
    maxLength: 255,
  })
  @IsString()
  @Length(1, 255, { message: 'System ID must be between 1 and 255 characters' })
  system_id!: string;

  @ApiProperty({
    description: 'Test environment for template scoping',
    example: 'production',
    maxLength: 255,
  })
  @IsString()
  @Length(1, 255, { message: 'Test environment must be between 1 and 255 characters' })
  test_environment!: string;

  @ApiProperty({
    description: 'Workload for template scoping',
    example: 'load-test',
    maxLength: 255,
  })
  @IsString()
  @Length(1, 255, { message: 'Workload must be between 1 and 255 characters' })
  workload!: string;

  @ApiProperty({
    description: `Section configurations for the template (1-${MAX_REPORT_SECTIONS} sections)`,
    type: [ReportSectionConfigDto],
    minItems: 1,
    maxItems: MAX_REPORT_SECTIONS,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one section is required' })
  @ArrayMaxSize(MAX_REPORT_SECTIONS, { message: `Maximum ${MAX_REPORT_SECTIONS} sections allowed` })
  @ValidateNested({ each: true })
  @Type(() => ReportSectionConfigDto)
  sections!: ReportSectionConfigDto[];

  @ApiPropertyOptional({
    description: 'Styling options for the template',
    type: ReportStylingDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReportStylingDto)
  styling?: ReportStylingDto;

  @ApiPropertyOptional({
    description: 'Whether this is the default template for its scope',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

/**
 * DTO for updating an existing report template
 *
 * @example
 * // Update template:
 * // PATCH /api/report-templates/123e4567-e89b-12d3-a456-426614174000
 * // {
 * //   "description": "Updated description",
 * //   "is_default": true
 * // }
 */
export class UpdateTemplateDto {
  @ApiPropertyOptional({
    description: 'Template name (unique within scope)',
    example: 'Updated Performance Template',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'Name must be between 1 and 255 characters' })
  name?: string;

  @ApiPropertyOptional({
    description: 'Template description',
    example: 'Updated template description',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @Length(0, 1000, { message: 'Description must not exceed 1000 characters' })
  description?: string;

  @ApiPropertyOptional({
    description: `Section configurations for the template (1-${MAX_REPORT_SECTIONS} sections)`,
    type: [ReportSectionConfigDto],
    minItems: 1,
    maxItems: MAX_REPORT_SECTIONS,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one section is required' })
  @ArrayMaxSize(MAX_REPORT_SECTIONS, { message: `Maximum ${MAX_REPORT_SECTIONS} sections allowed` })
  @ValidateNested({ each: true })
  @Type(() => ReportSectionConfigDto)
  sections?: ReportSectionConfigDto[];

  @ApiPropertyOptional({
    description: 'Styling options for the template',
    type: ReportStylingDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReportStylingDto)
  styling?: ReportStylingDto;

  @ApiPropertyOptional({
    description: 'Whether this is the default template for its scope',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

/**
 * DTO for adding a section to a template
 *
 * @example
 * // Add section:
 * // POST /api/report-templates/123e4567-e89b-12d3-a456-426614174000/sections
 * // { "type": "graphs", "order": 5, "title": "Performance Graphs" }
 */
export class AddSectionDto extends ReportSectionConfigDto {}

/**
 * DTO for reordering sections in a template
 *
 * @example
 * // Reorder sections:
 * // PUT /api/report-templates/123e4567-e89b-12d3-a456-426614174000/sections/reorder
 * // { "section_orders": [{ "order": 0 }, { "order": 1 }, { "order": 2 }] }
 */
export class ReorderSectionsDto {
  @ApiProperty({
    description: 'New order mapping for sections (array index = current position, value = new order)',
    type: [Number],
    example: [2, 0, 1],
    minItems: 1,
    maxItems: MAX_REPORT_SECTIONS,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one order value is required' })
  @ArrayMaxSize(MAX_REPORT_SECTIONS, { message: `Maximum ${MAX_REPORT_SECTIONS} order values allowed` })
  @IsNumber({}, { each: true })
  @Min(0, { each: true, message: 'Order values must be at least 0' })
  @Max(MAX_REPORT_SECTIONS - 1, { each: true, message: `Order values must not exceed ${MAX_REPORT_SECTIONS - 1}` })
  section_orders!: number[];
}

/**
 * DTO for duplicating a template
 *
 * @example
 * // Duplicate template:
 * // POST /api/report-templates/123e4567-e89b-12d3-a456-426614174000/duplicate
 * // { "name": "Copy of Standard Template", "system_id": "perfana-staging" }
 */
export class DuplicateTemplateDto {
  @ApiProperty({
    description: 'Name for the duplicated template',
    example: 'Copy of Standard Performance Template',
    maxLength: 255,
  })
  @IsString()
  @Length(1, 255, { message: 'Name must be between 1 and 255 characters' })
  name!: string;

  @ApiPropertyOptional({
    description: 'System ID for the duplicated template (defaults to original)',
    example: 'perfana-staging',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'System ID must be between 1 and 255 characters' })
  system_id?: string;

  @ApiPropertyOptional({
    description: 'Test environment for the duplicated template (defaults to original)',
    example: 'staging',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'Test environment must be between 1 and 255 characters' })
  test_environment?: string;

  @ApiPropertyOptional({
    description: 'Workload for the duplicated template (defaults to original)',
    example: 'stress-test',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'Workload must be between 1 and 255 characters' })
  workload?: string;
}

/**
 * Query parameters for listing templates
 */
export class ListTemplatesQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by system ID',
    example: 'perfana',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'System ID must be between 1 and 255 characters' })
  system_id?: string;

  @ApiPropertyOptional({
    description: 'Filter by test environment',
    example: 'production',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'Test environment must be between 1 and 255 characters' })
  test_environment?: string;

  @ApiPropertyOptional({
    description: 'Filter by workload',
    example: 'load-test',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'Workload must be between 1 and 255 characters' })
  workload?: string;

  @ApiPropertyOptional({
    description: 'Show only default templates',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  default_only?: boolean;

  @ApiPropertyOptional({
    description: 'Search term for filtering by name',
    example: 'performance',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(0, 100, { message: 'Search term must not exceed 100 characters' })
  search?: string;

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
    enum: ['created_at', 'name', 'updated_at', 'is_default'],
    default: 'created_at',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['created_at', 'name', 'updated_at', 'is_default'], {
    message: 'Sort by must be created_at, name, updated_at, or is_default',
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
