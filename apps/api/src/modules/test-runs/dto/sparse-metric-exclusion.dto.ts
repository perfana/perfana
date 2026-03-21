import { IsString, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSparseMetricExclusionDto {
  @ApiProperty({
    description: 'System under test name (used as fallback when systemUnderTestId is not provided)',
    example: 'MyAfterburner'
  })
  @IsString()
  system!: string;

  @ApiProperty({
    description: 'System under test UUID (preferred over name lookup)',
    example: '550e8400-e29b-41d4-a716-446655440001',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  systemUnderTestId?: string;

  @ApiProperty({
    description: 'Test environment',
    example: 'acc'
  })
  @IsString()
  environment!: string;

  @ApiProperty({
    description: 'Workload type',
    example: 'loadTest'
  })
  @IsString()
  workload!: string;

  @ApiProperty({
    description: 'Dashboard label where the metric appears',
    example: 'JFR Exporter afterburner-fe'
  })
  @IsString()
  dashboardLabel!: string;

  @ApiProperty({
    description: 'Metric name to exclude from sparse data checks',
    example: 'big allocation size'
  })
  @IsString()
  metricName!: string;

  @ApiProperty({
    description: 'Optional reason for why this metric is expected to be sparse',
    example: 'JFR event only fires on large allocations',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class SparseMetricExclusionDto {
  @ApiProperty({
    description: 'Unique identifier',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  id!: string;

  @ApiProperty({
    description: 'System under test ID',
    example: '550e8400-e29b-41d4-a716-446655440001'
  })
  system_under_test_id!: string;

  @ApiProperty({ description: 'Test environment', example: 'acc' })
  test_environment!: string;

  @ApiProperty({ description: 'Workload type', example: 'loadTest' })
  workload!: string;

  @ApiProperty({ description: 'Dashboard label', example: 'JFR Exporter afterburner-fe' })
  dashboard_label!: string;

  @ApiProperty({ description: 'Metric name', example: 'big allocation size' })
  metric_name!: string;

  @ApiProperty({
    description: 'Reason for exclusion',
    example: 'JFR event only fires on large allocations',
    required: false,
  })
  reason?: string;

  @ApiProperty({ description: 'Created timestamp', example: '2024-01-15T10:30:00.000Z' })
  created_at!: string;

  @ApiProperty({ description: 'Updated timestamp', example: '2024-01-15T10:30:00.000Z' })
  updated_at!: string;
}
