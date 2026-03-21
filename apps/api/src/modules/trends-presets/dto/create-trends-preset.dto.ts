import { IsString, IsBoolean, IsOptional, IsEnum, IsNumber, MaxLength, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PresetType {
  GENERIC = 'generic',
  SPECIFIC = 'specific'
}

export class CreateTrendsPresetDto {
  @ApiProperty({
    description: 'Name of the trends filter preset',
    example: 'Response Time Trends Analysis'
  })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({
    description: 'Optional description of the preset',
    example: 'Tracks response time trends across different environments'
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
    description: 'ID of the selected application dashboard',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @IsString()
  @IsOptional()
  application_dashboard_id?: string;

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
    description: 'Aggregation type for metric evaluation (avg, max, min, last, q50, q90, q95, q99)',
    example: 'avg'
  })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  evaluate_type?: string;

  @ApiPropertyOptional({
    description: 'Data source for trends (grafana or dynatrace)',
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
    description: 'Array of series configurations for multi-series trends',
    example: [{ dashboardId: 'abc', panelId: 1, metricName: 'response_time', source: 'grafana' }]
  })
  @IsArray()
  @IsOptional()
  @Type(() => Object)
  series_config?: Record<string, any>[];

  @ApiProperty({
    description: 'Test run ID this preset was created for',
    example: 'MyApp-prod-loadTest-00042'
  })
  @IsString()
  @MaxLength(255)
  created_for_test_run_id!: string;

  @ApiProperty({
    description: 'Whether this preset should be available to all users',
    example: false
  })
  @IsBoolean()
  is_global!: boolean;
}