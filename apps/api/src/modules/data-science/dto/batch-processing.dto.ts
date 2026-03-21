import { IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class RefreshSourcesDto {
  @ApiProperty({ description: 'Include Grafana metrics', required: false })
  @IsOptional()
  @IsBoolean()
  grafana?: boolean;

  @ApiProperty({ description: 'Include Dynatrace metrics', required: false })
  @IsOptional()
  @IsBoolean()
  dynatrace?: boolean;

  @ApiProperty({ description: 'Include performance test metrics', required: false })
  @IsOptional()
  @IsBoolean()
  performanceMetrics?: boolean;
}

export class BatchRefreshDto {
  @ApiProperty({
    description: 'Array of test run IDs to process',
    type: [String],
    example: ['test-run-1', 'test-run-2', 'test-run-3']
  })
  @IsArray()
  @IsString({ each: true })
  testRunIds!: string[];

  @ApiProperty({
    description: 'Whether to include ADAPT analysis',
    required: false,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  adapt?: boolean;

  @ApiProperty({
    description: 'Filter which sources to check for gaps. When omitted all sources are included.',
    required: false,
    type: RefreshSourcesDto,
  })
  @IsOptional()
  sources?: RefreshSourcesDto;

  @ApiProperty({
    description: 'When true, re-collect ALL metrics for the full test run time range instead of only filling gaps',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  forceRefetch?: boolean;
}

export class BatchReevaluateDto {
  @ApiProperty({
    description: 'Array of test run IDs to re-evaluate',
    type: [String],
    example: ['test-run-1', 'test-run-2', 'test-run-3']
  })
  @IsArray()
  @IsString({ each: true })
  testRunIds!: string[];

  @ApiProperty({
    description: 'Whether to re-evaluate benchmark checks',
    required: false,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  checks?: boolean;

  @ApiProperty({
    description: 'Whether to include ADAPT analysis in re-evaluation',
    required: false,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  adapt?: boolean;

  // Optional fields for specific metric re-analysis
  @ApiProperty({
    description: 'Application dashboard ID for specific metric re-analysis (optional)',
    example: '550e8400-e29b-41d4-a716-446655440001',
    required: false
  })
  @IsOptional()
  @IsUUID()
  applicationDashboardId?: string;

  @ApiProperty({
    description: 'Panel ID for specific metric re-analysis (optional)',
    example: 1,
    required: false
  })
  @IsOptional()
  @IsInt()
  panelId?: number;

  @ApiProperty({
    description: 'Metric name for specific metric re-analysis (optional)',
    example: 'response_time_p90',
    required: false
  })
  @IsOptional()
  @IsString()
  metricName?: string;
}

export class TestRunScopeDto {
  @ApiProperty({ description: 'System under test ID (UUID)', example: '550e8400-e29b-41d4-a716-446655440001' })
  @IsString()
  systemUnderTestId!: string;

  @ApiProperty({ description: 'Test environment', example: 'production' })
  @IsString()
  testEnvironment!: string;

  @ApiProperty({ description: 'Workload identifier', example: 'loadTest' })
  @IsString()
  workload!: string;
}

export class AvailableSourcesRequestDto {
  @ApiProperty({
    description: 'Array of test run scopes to check for configured sources',
    type: [TestRunScopeDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestRunScopeDto)
  scopes!: TestRunScopeDto[];
}