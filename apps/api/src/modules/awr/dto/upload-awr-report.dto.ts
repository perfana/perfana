import {
  IsString,
  IsOptional,
  IsUUID,
  Length,
  IsEnum,
  Matches,
  Max,
  Min,
  IsInt,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Supported file types for AWR report upload
 */
export type AwrFileType = 'html' | 'text';

/**
 * DTO for uploading an AWR report file
 *
 * Used with multipart/form-data file upload. The file itself is handled
 * by Multer middleware, this DTO validates the accompanying metadata.
 *
 * @example
 * // With curl:
 * // curl -X POST http://localhost:3001/api/test-runs/{testRunId}/awr-reports \
 * //   -F "file=@awrrpt_1_100_101.html" \
 * //   -F "description=Production AWR report"
 */
export class UploadAwrReportDto {
  @ApiPropertyOptional({
    description: 'File type override (auto-detected if not provided)',
    example: 'html',
    enum: ['html', 'text'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['html', 'text'], { message: 'File type must be either html or text' })
  fileType?: AwrFileType;
}

/**
 * DTO for uploading AWR report via URL (alternative to file upload)
 */
export class UploadAwrReportByUrlDto {
  @ApiProperty({
    description: 'URL to fetch the AWR report from',
    example: 'https://storage.example.com/awr-reports/awrrpt_1_100_101.html',
    maxLength: 2000,
  })
  @IsString()
  @Length(1, 2000, { message: 'URL must be between 1 and 2000 characters' })
  @Matches(/^https?:\/\/.+/, { message: 'URL must be a valid HTTP or HTTPS URL' })
  url!: string;

  @ApiPropertyOptional({
    description: 'Original file name',
    example: 'awrrpt_1_100_101.html',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'File name must be between 1 and 255 characters' })
  fileName?: string;

  @ApiPropertyOptional({
    description: 'File type (auto-detected if not provided)',
    example: 'html',
    enum: ['html', 'text'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['html', 'text'], { message: 'File type must be either html or text' })
  fileType?: AwrFileType;
}

/**
 * Query parameters for listing AWR reports
 */
export class ListAwrReportsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by parse status',
    example: 'completed',
    enum: ['pending', 'parsing', 'completed', 'failed'],
  })
  @IsOptional()
  @IsString()
  @IsEnum(['pending', 'parsing', 'completed', 'failed'], {
    message: 'Parse status must be pending, parsing, completed, or failed',
  })
  parseStatus?: string;

  @ApiPropertyOptional({
    description: 'Filter by database name',
    example: 'ORCL',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255, { message: 'Database name must be between 1 and 255 characters' })
  dbName?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of results (default: 50, max: 100)',
    example: 20,
    default: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(100, { message: 'Limit must not exceed 100' })
  limit?: number;

  @ApiPropertyOptional({
    description: 'Offset for pagination',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0, { message: 'Offset must be at least 0' })
  offset?: number;

  @ApiPropertyOptional({
    description: 'Sort by field',
    example: 'uploadedAt',
    enum: ['uploadedAt', 'beginTime', 'dbName', 'parseStatus'],
    default: 'uploadedAt',
  })
  @IsOptional()
  @IsString()
  @IsEnum(['uploadedAt', 'beginTime', 'dbName', 'parseStatus'], {
    message: 'Sort by must be uploadedAt, beginTime, dbName, or parseStatus',
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
 * Path parameters for AWR report endpoints
 */
export class AwrReportParamsDto {
  @ApiProperty({
    description: 'AWR report UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4', { message: 'Report ID must be a valid UUID' })
  reportId!: string;
}

/**
 * Path parameters for test run AWR report endpoints
 */
export class TestRunAwrReportParamsDto {
  @ApiProperty({
    description: 'Test run UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4', { message: 'Test run ID must be a valid UUID' })
  testRunId!: string;
}
