import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TrendsPresetResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the trends preset',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  id!: string;

  @ApiProperty({
    description: 'Name of the trends preset',
    example: 'Response Time Trends Analysis'
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'Optional description of the preset',
    example: 'Tracks response time trends across different environments'
  })
  description?: string;

  @ApiProperty({
    description: 'Type of preset: generic or specific',
    example: 'generic'
  })
  preset_type!: string;

  @ApiPropertyOptional({
    description: 'ID of the associated application dashboard',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  application_dashboard_id?: string;

  @ApiPropertyOptional({
    description: 'ID of the metrics source',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  metrics_source_id?: string;

  @ApiPropertyOptional({
    description: 'ID of the selected panel/metric',
    example: 5
  })
  panel_id?: number;

  @ApiPropertyOptional({
    description: 'Title of the selected panel',
    example: 'Response Time'
  })
  panel_title?: string;

  @ApiPropertyOptional({
    description: 'Aggregation type for metric evaluation (avg, max, min, last, q50, q90, q95, q99)',
    example: 'avg'
  })
  evaluate_type?: string;

  @ApiPropertyOptional({
    description: 'Data source for trends (grafana or dynatrace)',
    example: 'grafana'
  })
  source?: string;

  @ApiProperty({
    description: 'Test run ID this preset was created for',
    example: 'MyApp-prod-loadTest-00042'
  })
  created_for_test_run_id!: string;

  @ApiPropertyOptional({
    description: 'Dashboard label for reference',
    example: 'Production Dashboard'
  })
  dashboard_label?: string;

  @ApiPropertyOptional({
    description: 'Array of series configurations for multi-series trends',
    example: [{ dashboardId: 'abc', panelId: 1, metricName: 'response_time', source: 'grafana' }]
  })
  series_config?: Record<string, any>[];

  @ApiProperty({
    description: 'Whether this preset is available to all users',
    example: false
  })
  is_global!: boolean;

  @ApiProperty({
    description: 'User ID who created this preset',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  created_by!: string;

  @ApiProperty({
    description: 'Timestamp when the preset was created',
    example: '2024-01-15T10:30:00Z'
  })
  created_at!: string;

  @ApiProperty({
    description: 'Timestamp when the preset was last updated',
    example: '2024-01-15T10:30:00Z'
  })
  updated_at!: string;
}