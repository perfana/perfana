import { IsString, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateMetricClassificationDto {
  @ApiProperty({
    description: 'Application dashboard ID',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @IsString()
  applicationDashboardId!: string;

  @ApiProperty({
    description: 'Panel ID',
    example: '1'
  })
  @IsString()
  panelId!: string;

  @ApiProperty({
    description: 'Dashboard label',
    example: 'perfana-afterburner',
    required: false
  })
  @IsString()
  @IsOptional()
  dashboardLabel?: string;

  @ApiProperty({
    description: 'Panel title from the dashboard',
    example: 'Response Times',
    required: false
  })
  @IsString()
  @IsOptional()
  panelTitle?: string;

  @ApiProperty({
    description: 'Metric name (null for panel-wide classification)',
    example: 'response_time_p90',
    required: false
  })
  @IsString()
  @IsOptional()
  metricName?: string;

  @ApiProperty({
    description: 'Classification category for the metric',
    example: 'RED_duration',
    enum: [
      'RED_duration',
      'RED_rate', 
      'RED_errors',
      'USE_saturation',
      'USE_utilization',
      'USE_errors',
      'business_metric',
      'infrastructure_metric',
      'application_metric',
      'custom'
    ]
  })
  @IsString()
  classification!: string;

  @ApiProperty({
    description: 'Whether higher values are better for this metric',
    example: false
  })
  @IsBoolean()
  higherIsBetter!: boolean;
}

export class MetricClassificationDto {
  @ApiProperty({
    description: 'Unique identifier for the metric classification',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  id!: string;

  @ApiProperty({
    description: 'System under test ID',
    example: '550e8400-e29b-41d4-a716-446655440001'
  })
  system_under_test_id!: string;

  @ApiProperty({
    description: 'Test environment',
    example: 'production'
  })
  test_environment!: string;

  @ApiProperty({
    description: 'Workload type',
    example: 'loadTest'
  })
  workload!: string;

  @ApiProperty({
    description: 'Dashboard label from Grafana',
    example: 'perfana-afterburner'
  })
  dashboard_label!: string;

  @ApiProperty({
    description: 'Panel ID from the dashboard',
    example: '1',
    required: false
  })
  panel_id?: string;

  @ApiProperty({
    description: 'Panel title from the dashboard',
    example: 'Response Times'
  })
  panel_title!: string;

  @ApiProperty({
    description: 'Metric name being classified',
    example: 'response_time_p90'
  })
  metric_name!: string;

  @ApiProperty({
    description: 'Classification category for the metric (e.g., RED_duration, USE_saturation)',
    example: 'RED_duration',
    enum: [
      'RED_duration',
      'RED_rate',
      'RED_errors',
      'USE_saturation',
      'USE_utilization',
      'USE_errors',
      'business_metric',
      'infrastructure_metric',
      'application_metric',
      'custom'
    ]
  })
  metric_classification!: string;

  @ApiProperty({
    description: 'User ID who created this classification',
    example: 'user@example.com',
    required: false
  })
  created_by?: string;

  @ApiProperty({
    description: 'Timestamp when this classification was created',
    example: '2024-01-15T10:30:00.000Z'
  })
  created_at!: string;

  @ApiProperty({
    description: 'Timestamp when this classification was last updated',
    example: '2024-01-15T10:30:00.000Z'
  })
  updated_at!: string;
}