import { IsString, IsBoolean, IsOptional, IsEnum, IsNumber, MaxLength, IsArray, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PresetType {
  GENERIC = 'generic',
  SPECIFIC = 'specific'
}

export class CompareSeriesConfig {
  @ApiProperty({ description: 'Application dashboard ID (UUID)' })
  @IsString()
  dashboardId!: string;

  @ApiProperty({ description: 'Dashboard label for display' })
  @IsString()
  dashboardLabel!: string;

  @ApiProperty({ description: 'Panel ID within the dashboard' })
  @IsNumber()
  panelId!: number;

  @ApiProperty({ description: 'Panel title for display' })
  @IsString()
  panelTitle!: string;

  @ApiProperty({ description: 'Metric name for this series' })
  @IsString()
  metricName!: string;

  @ApiProperty({ description: 'Data source type', enum: ['grafana', 'dynatrace', 'performance-metrics'] })
  @IsString()
  source!: string;

  @ApiPropertyOptional({ description: 'True when this series is the run-wide "All aggregated" pseudo-metric' })
  @IsBoolean()
  @IsOptional()
  isAggregated?: boolean;

  @ApiPropertyOptional({ description: "Panel value format (e.g. 'percentunit', 's', 'ms')" })
  @IsString()
  @IsOptional()
  yAxesFormat?: string;
}

export class CreateComparePresetDto {
  @ApiProperty({
    description: 'Name of the filter preset',
    example: 'Response Time Analysis'
  })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({
    description: 'Optional description of the preset',
    example: 'Shows percentiles for response time and latency metrics'
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({
    description: 'Type of preset: generic (reusable across test runs) or specific (locked to a single test run)',
    enum: PresetType,
    example: PresetType.GENERIC
  })
  @IsEnum(PresetType)
  preset_type!: PresetType;

  @ApiPropertyOptional({
    description: 'Series search filter text',
    example: 'response'
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  series_search_text?: string;

  @ApiProperty({
    description: 'Whether to show percentile columns',
    example: true
  })
  @IsBoolean()
  show_percentiles!: boolean;

  @ApiPropertyOptional({
    description: 'ID of the selected application dashboard',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @IsString()
  @IsOptional()
  application_dashboard_id?: string;

  @ApiPropertyOptional({
    description: 'ID of the metrics source',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @IsString()
  @IsOptional()
  metrics_source_id?: string;

  @ApiPropertyOptional({
    description: 'Data source for comparison (grafana or dynatrace)',
    example: 'grafana'
  })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  source?: string;

  @ApiPropertyOptional({
    description: 'Dashboard label for display purposes',
    example: 'Production Dashboard'
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  dashboard_label?: string;

  @ApiPropertyOptional({
    description: 'ID of the selected panel/metric',
    example: 5
  })
  @IsNumber()
  @IsOptional()
  panel_id?: number;

  @ApiPropertyOptional({
    description: 'Title of the selected panel for reference',
    example: 'Response Time'
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  panel_title?: string;

  @ApiPropertyOptional({
    description: 'Baseline test run ID (only for test run-specific presets)',
    example: 'MyApp-prod-loadTest-00042'
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  baseline_test_run_id?: string;

  @ApiPropertyOptional({
    description: 'Test run ID for which this preset was created (used to filter test run-specific presets)',
    example: 'MyApp-prod-loadTest-00042'
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  created_for_test_run_id?: string;

  @ApiProperty({
    description: 'Whether this preset should be available to all users',
    example: false
  })
  @IsBoolean()
  is_global!: boolean;

  @ApiPropertyOptional({
    description: 'Array of series configurations to add to comparison',
    type: [CompareSeriesConfig]
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompareSeriesConfig)
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
  @IsOptional()
  @IsObject()
  display_config?: {
    warningThreshold: number;
    regressionThreshold: number;
    minAbsolute: number;
    percentiles: { p90: boolean; p95: boolean; p99: boolean };
  };
}