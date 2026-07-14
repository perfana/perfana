import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PresetType, CompareSeriesConfig } from './create-compare-preset.dto';

export class ComparePresetResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the preset',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  id!: string;

  @ApiProperty({
    description: 'Name of the filter preset',
    example: 'Response Time Analysis'
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'Optional description of the preset',
    example: 'Shows percentiles for response time and latency metrics'
  })
  description?: string;

  @ApiProperty({
    description: 'Type of preset: generic (reusable across test runs) or specific (locked to a single test run)',
    enum: PresetType,
    example: PresetType.GENERIC
  })
  preset_type!: PresetType;

  @ApiPropertyOptional({
    description: 'Series search filter text',
    example: 'response'
  })
  series_search_text?: string;

  @ApiProperty({
    description: 'Whether to show percentile columns',
    example: true
  })
  show_percentiles!: boolean;

  @ApiPropertyOptional({
    description: 'ID of the selected application dashboard',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  application_dashboard_id?: string;

  @ApiPropertyOptional({
    description: 'ID of the metrics source',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  metrics_source_id?: string;

  @ApiPropertyOptional({
    description: 'Data source for comparison (grafana or dynatrace)',
    example: 'grafana'
  })
  source?: string;

  @ApiPropertyOptional({
    description: 'ID of the selected panel/metric',
    example: 5
  })
  panel_id?: number;

  @ApiPropertyOptional({
    description: 'Title of the selected panel for reference',
    example: 'Response Time'
  })
  panel_title?: string;

  @ApiPropertyOptional({
    description: 'Baseline test run ID (only for test run-specific presets)',
    example: 'MyApp-prod-loadTest-00042'
  })
  baseline_test_run_id?: string;

  @ApiPropertyOptional({
    description: 'Application release/version of the baseline test run',
    example: 'v2.1.0'
  })
  baseline_application_release?: string;

  @ApiPropertyOptional({
    description: 'Annotations from the baseline test run',
    example: ['Performance regression fix', 'Memory optimization']
  })
  baseline_annotations?: string[];

  @ApiPropertyOptional({
    description: 'Dashboard label for display purposes',
    example: 'Load Testing Dashboard'
  })
  dashboard_label?: string;

  @ApiPropertyOptional({
    description: 'Array of series configurations for comparison',
    type: [CompareSeriesConfig]
  })
  series_config?: CompareSeriesConfig[];

  @ApiPropertyOptional({
    description: 'Compare card display config: thresholds + percentile toggles',
    example: {
      warningThreshold: 10,
      regressionThreshold: 50,
      minAbsolute: 0,
      percentiles: { p90: false, p95: true, p99: true },
    },
  })
  display_config?: {
    warningThreshold: number;
    regressionThreshold: number;
    minAbsolute: number;
    percentiles: { p90: boolean; p95: boolean; p99: boolean };
  };

  @ApiProperty({
    description: 'Whether this preset is available to all users',
    example: false
  })
  is_global!: boolean;

  @ApiProperty({
    description: 'ID of the user who created this preset',
    example: '660e8400-e29b-41d4-a716-446655440000'
  })
  created_by!: string;

  @ApiProperty({
    description: 'When the preset was created',
    example: '2024-01-15T10:30:00Z'
  })
  created_at!: string;

  @ApiProperty({
    description: 'When the preset was last updated',
    example: '2024-01-15T10:30:00Z'
  })
  updated_at!: string;
}