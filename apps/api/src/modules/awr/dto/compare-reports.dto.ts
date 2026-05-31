import {
  IsUUID,
  IsOptional,
  IsBoolean,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SqlComparisonResult, WaitEventComparisonResult, LoadProfileComparisonResult, SeveritySummary } from '../types/analysis.types';
import type { AwrInsight } from '../types/insights.types';

/**
 * DTO for comparing two AWR reports
 */
export class CompareReportsDto {
  @ApiProperty({
    description: 'Current (target) AWR report ID to analyze',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4', { message: 'Current report ID must be a valid UUID' })
  currentReportId!: string;

  @ApiProperty({
    description: 'Baseline AWR report ID to compare against',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsUUID('4', { message: 'Baseline report ID must be a valid UUID' })
  baselineReportId!: string;

  @ApiPropertyOptional({
    description: 'Minimum percentage change to consider as significant regression (default: 20)',
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'Regression threshold must be at least 1%' })
  @Max(100, { message: 'Regression threshold must not exceed 100%' })
  regressionThresholdPercent?: number;

  @ApiPropertyOptional({
    description: 'Minimum percentage change to consider as significant improvement (default: 20)',
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'Improvement threshold must be at least 1%' })
  @Max(100, { message: 'Improvement threshold must not exceed 100%' })
  improvementThresholdPercent?: number;

  @ApiPropertyOptional({
    description: 'Include detailed SQL statement comparison in response',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeSqlComparison?: boolean;

  @ApiPropertyOptional({
    description: 'Include wait event comparison in response',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeWaitEventComparison?: boolean;

  @ApiPropertyOptional({
    description: 'Include load profile metric comparison in response',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeLoadProfileComparison?: boolean;

  @ApiPropertyOptional({
    description: 'Include info-level insights (less significant changes)',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  includeInfoInsights?: boolean;

  @ApiPropertyOptional({
    description: 'Maximum number of SQL statements to include in comparison (default: 50)',
    example: 50,
    default: 50,
    minimum: 10,
    maximum: 200,
  })
  @IsOptional()
  @IsNumber()
  @Min(10, { message: 'Max SQL statements must be at least 10' })
  @Max(200, { message: 'Max SQL statements must not exceed 200' })
  maxSqlStatements?: number;
}

/**
 * DTO for comparing AWR reports across test runs
 * Allows selecting baseline from a different test run
 */
export class CompareTestRunAwrReportsDto {
  @ApiProperty({
    description: 'Current test run ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4', { message: 'Current test run ID must be a valid UUID' })
  currentTestRunId!: string;

  @ApiProperty({
    description: 'Baseline test run ID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsUUID('4', { message: 'Baseline test run ID must be a valid UUID' })
  baselineTestRunId!: string;

  @ApiPropertyOptional({
    description: 'Specific AWR report ID from current test run (uses latest if not specified)',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Current report ID must be a valid UUID' })
  currentReportId?: string;

  @ApiPropertyOptional({
    description: 'Specific AWR report ID from baseline test run (uses latest if not specified)',
    example: '123e4567-e89b-12d3-a456-426614174003',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Baseline report ID must be a valid UUID' })
  baselineReportId?: string;

  @ApiPropertyOptional({
    description: 'Minimum percentage change to consider as significant',
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'Threshold must be at least 1%' })
  @Max(100, { message: 'Threshold must not exceed 100%' })
  significantChangeThreshold?: number;
}

/**
 * Comparison analysis response DTO
 */
export class ComparisonResponseDto {
  @ApiProperty({
    description: 'Current AWR report ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  currentReportId!: string;

  @ApiProperty({
    description: 'Baseline AWR report ID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  baselineReportId!: string;

  @ApiProperty({
    description: 'Generated insights (regressions and improvements)',
    type: 'array',
    items: { type: 'object' },
  })
  insights!: AwrInsight[];

  @ApiProperty({
    description: 'Summary of insights by severity',
    example: { critical: 2, warning: 5, info: 10, total: 17 },
  })
  severitySummary!: SeveritySummary;

  @ApiPropertyOptional({
    description: 'SQL statement comparison details',
  })
  sqlComparison?: SqlComparisonResult;

  @ApiPropertyOptional({
    description: 'Wait event comparison details',
  })
  waitEventComparison?: WaitEventComparisonResult;

  @ApiPropertyOptional({
    description: 'Load profile metric comparison',
  })
  loadProfileComparison?: LoadProfileComparisonResult;

  @ApiProperty({
    description: 'When comparison was performed',
    example: '2024-01-15T12:00:00Z',
    type: String,
  })
  comparedAt!: Date;

  @ApiPropertyOptional({ description: 'Comparison algorithm version', example: '1.0.0' })
  comparisonVersion?: string;

  @ApiPropertyOptional({ description: 'Comparison duration in milliseconds', example: 1250 })
  comparisonDurationMs?: number;
}

/**
 * Quick comparison summary for list views
 */
export class ComparisonSummaryDto {
  @ApiProperty({ description: 'Number of SQL regressions', example: 3 })
  sqlRegressions!: number;

  @ApiProperty({ description: 'Number of SQL improvements', example: 5 })
  sqlImprovements!: number;

  @ApiProperty({ description: 'Number of new SQL statements', example: 2 })
  newSqlStatements!: number;

  @ApiProperty({ description: 'Number of wait event increases', example: 4 })
  waitEventIncreases!: number;

  @ApiProperty({ description: 'Number of wait event decreases', example: 6 })
  waitEventDecreases!: number;

  @ApiPropertyOptional({ description: 'Overall DB time change percentage', example: 15.5 })
  dbTimeChangePercent?: number;

  @ApiPropertyOptional({ description: 'Overall transaction rate change percentage', example: -5.2 })
  transactionRateChangePercent?: number;

  @ApiProperty({
    description: 'Overall status',
    enum: ['improved', 'regressed', 'stable'],
    example: 'regressed',
  })
  overallStatus!: 'improved' | 'regressed' | 'stable';
}

/**
 * Available baselines response for comparison dropdown
 */
export class AvailableBaselineDto {
  @ApiProperty({
    description: 'Test run ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  testRunId!: string;

  @ApiPropertyOptional({ description: 'Test run name/ID', example: 'load-test-2024-01-14' })
  testRunName?: string;

  @ApiProperty({
    description: 'AWR report ID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  awrReportId!: string;

  @ApiPropertyOptional({ description: 'Database name', example: 'ORCL' })
  dbName?: string;

  @ApiPropertyOptional({
    description: 'Report begin time',
    example: '2024-01-14T10:00:00Z',
    type: String,
  })
  beginTime?: Date;

  @ApiPropertyOptional({
    description: 'Report end time',
    example: '2024-01-14T11:00:00Z',
    type: String,
  })
  endTime?: Date;

  @ApiPropertyOptional({ description: 'Report uploaded time', type: String })
  uploadedAt?: Date;
}

/**
 * List of available baselines for comparison
 */
export class AvailableBaselinesResponseDto {
  @ApiProperty({
    description: 'List of available baseline reports',
    type: [AvailableBaselineDto],
  })
  baselines!: AvailableBaselineDto[];

  @ApiProperty({ description: 'Total number of available baselines', example: 10 })
  total!: number;
}
