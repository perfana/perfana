import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsArray,
  ValidateNested,
  Length,
  IsUrl,
  ArrayMaxSize,
  Matches,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { IsValidTestRunId, IsValidISODate } from '../../../common/validators';

export class VariableDto {
  @ApiProperty({ description: 'Variable placeholder name', example: '${hostname}' })
  @IsString()
  @Length(1, 255, { message: 'Variable placeholder must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9_${}.[\]-]+$/, {
    message: 'Variable placeholder must contain only alphanumeric characters, underscores, dots, brackets, and template syntax'
  })
  placeholder!: string;

  @ApiProperty({ description: 'Variable value', example: 'prod-server-01' })
  @IsString()
  @Length(0, 2000, { message: 'Variable value must not exceed 2000 characters' })
  value!: string;
}

export class DeepLinkDto {
  @ApiProperty({ description: 'Link name', example: 'Grafana Dashboard' })
  @IsString()
  @Length(1, 255, { message: 'Link name must be between 1 and 255 characters' })
  name!: string;

  @ApiProperty({ description: 'Link URL', example: 'https://grafana.example.com/d/abc123' })
  @IsString()
  @IsUrl({ require_tld: false }, { message: 'Link URL must be a valid URL' })
  @Length(1, 2048, { message: 'Link URL must not exceed 2048 characters' })
  url!: string;
}

export class UpdateRunningTestDto {
  @ApiProperty({
    description: 'System under test name (application name)',
    example: 'PaymentService'
  })
  @IsString()
  @Length(1, 255, { message: 'System under test name must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'System under test name must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  systemUnderTest!: string;

  @ApiPropertyOptional({
    description: 'Application version',
    example: '1.2.3'
  })
  @IsOptional()
  @IsString()
  @Length(1, 100, { message: 'Version must be between 1 and 100 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Version must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  version?: string;

  @ApiProperty({
    description: 'Workload name (test type)',
    example: 'loadTest'
  })
  @IsString()
  @Length(1, 255, { message: 'Workload must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Workload must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  workload!: string;

  @ApiProperty({
    description: 'Test environment name',
    example: 'production'
  })
  @IsString()
  @Length(1, 255, { message: 'Test environment must be between 1 and 255 characters' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'Test environment must contain only alphanumeric characters, dots, hyphens, and underscores'
  })
  testEnvironment!: string;

  @ApiPropertyOptional({
    description: 'Test start time (ISO 8601 format)',
    example: '2024-01-15T10:30:00.000Z'
  })
  @IsOptional()
  @IsString()
  @IsValidISODate()
  start?: string;

  @ApiPropertyOptional({
    description: 'Test end time (ISO 8601 format)',
    example: '2024-01-15T11:30:00.000Z'
  })
  @IsOptional()
  @IsString()
  @IsValidISODate()
  end?: string;

  @ApiPropertyOptional({
    description: 'Test duration in seconds',
    example: '3600'
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? undefined : parsed;
    }
    return value;
  })
  @IsInt({ message: 'Duration must be an integer' })
  @Min(0, { message: 'Duration must be non-negative' })
  @Max(86400 * 7, { message: 'Duration must not exceed 7 days (604800 seconds)' })
  duration?: number;

  @ApiPropertyOptional({
    description: 'Analysis start offset in seconds (initial period excluded from analysis)',
    example: '300'
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? undefined : parsed;
    }
    return value;
  })
  @IsInt({ message: 'Analysis start offset must be an integer' })
  @Min(0, { message: 'Analysis start offset must be non-negative' })
  @Max(86400, { message: 'Analysis start offset must not exceed 1 day (86400 seconds)' })
  analysisStartOffset?: number;

  @ApiProperty({
    description: 'Unique test run identifier',
    example: 'PaymentService-production-loadTest-20240115-103000'
  })
  @IsString()
  @IsValidTestRunId()
  testRunId!: string;

  @ApiProperty({
    description: 'Whether the test is completed',
    example: false
  })
  @IsBoolean()
  completed!: boolean;

  @ApiPropertyOptional({
    description: 'CI build results URL',
    example: 'https://jenkins.example.com/job/payment-service/123'
  })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false }, { message: 'CI build results URL must be a valid URL' })
  @Length(1, 2048, { message: 'CI build results URL must not exceed 2048 characters' })
  CIBuildResultsUrl?: string;

  @ApiPropertyOptional({
    description: 'CI build results URL (alias for CIBuildResultsUrl, used by Java event-scheduler clients)',
    example: 'https://jenkins.example.com/job/payment-service/123'
  })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false }, { message: 'Build results URL must be a valid URL' })
  @Length(1, 2048, { message: 'Build results URL must not exceed 2048 characters' })
  buildResultsUrl?: string;

  @ApiPropertyOptional({
    description: 'Test run annotations (free text)',
    example: 'Testing new payment gateway with increased load'
  })
  @IsOptional()
  @IsString()
  @Length(0, 5000, { message: 'Annotations must not exceed 5000 characters' })
  annotations?: string;

  @ApiPropertyOptional({
    description: 'Test run variables (max 50)',
    type: [VariableDto]
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50, { message: 'Maximum 50 variables allowed' })
  @ValidateNested({ each: true })
  @Type(() => VariableDto)
  variables?: VariableDto[];

  @ApiPropertyOptional({
    description: 'Whether to abort the test',
    example: false
  })
  @IsOptional()
  @IsBoolean()
  abort?: boolean;

  @ApiPropertyOptional({
    description: 'Abort message (required if abort is true)',
    example: 'Test aborted due to excessive errors'
  })
  @IsOptional()
  @IsString()
  @Length(0, 1000, { message: 'Abort message must not exceed 1000 characters' })
  abortMessage?: string;

  @ApiPropertyOptional({
    description: 'Test run tags (max 50)',
    type: [String],
    example: ['performance', 'production', 'payment-gateway']
  })
  @IsOptional()
  @Transform(({ value }) => {
    // Handle comma-separated string from legacy clients
    if (typeof value === 'string') {
      return value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
    }
    return value;
  })
  @IsArray()
  @ArrayMaxSize(50, { message: 'Maximum 50 tags allowed' })
  @IsString({ each: true })
  @Length(1, 100, { each: true, message: 'Each tag must be between 1 and 100 characters' })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Deep links for the test run (max 20)',
    type: [DeepLinkDto]
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20, { message: 'Maximum 20 deep links allowed' })
  @ValidateNested({ each: true })
  @Type(() => DeepLinkDto)
  deepLinks?: DeepLinkDto[];

  @ApiPropertyOptional({
    description: 'ADAPT mode: DEFAULT (regression testing) or BASELINE (always accepted into control group)',
    example: 'BASELINE',
    enum: ['DEFAULT', 'BASELINE'],
  })
  @IsOptional()
  @IsString()
  @Matches(/^(DEFAULT|BASELINE)$/, { message: 'adaptMode must be DEFAULT or BASELINE' })
  adaptMode?: string;
}