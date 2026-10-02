import { IsString, IsBoolean, IsOptional, IsArray, IsEnum, ValidateNested, IsNumber, Min, MaxLength, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DataSource {
  GRAFANA = 'grafana',
  DYNATRACE = 'dynatrace',
  PERFORMANCE_METRICS = 'performance-metrics'
}

export class SeriesConfigDto {
  @ApiProperty({
    description: 'Dashboard ID',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @IsString()
  dashboardId!: string;

  @ApiProperty({
    description: 'Dashboard label for display',
    example: 'Load Testing Dashboard'
  })
  @IsString()
  dashboardLabel!: string;

  @ApiProperty({
    description: 'Panel ID within the dashboard',
    example: 5
  })
  @IsNumber()
  panelId!: number;

  @ApiProperty({
    description: 'Panel title for display',
    example: 'Response Time'
  })
  @IsString()
  panelTitle!: string;

  @ApiProperty({
    description: 'Metric name/identifier',
    example: 'http_request_duration_seconds_p95'
  })
  @IsString()
  metricName!: string;

  @ApiProperty({
    description: 'Data source for this series',
    enum: DataSource,
    example: DataSource.GRAFANA
  })
  @IsEnum(DataSource)
  source!: DataSource;

  @ApiPropertyOptional({
    description: 'Y-axis format specification',
    example: 'ms'
  })
  @IsString()
  @IsOptional()
  yAxisFormat?: string;

  @ApiPropertyOptional({
    description:
      'Colour slot the series holds in the chart palette. Absent on presets saved before'
      + ' the shared chart standard, which fall back to list position.',
    example: 0
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  colorSlot?: number;

  @ApiPropertyOptional({
    description: 'Whether the series was hidden from the chart (it stays in the legend table)',
    example: false
  })
  @IsBoolean()
  @IsOptional()
  hidden?: boolean;
}

export class CreateGraphPresetDto {
  @ApiProperty({
    description: 'Name of the graph preset',
    example: 'My Custom Graph'
  })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({
    description: 'Optional description of the preset',
    example: 'Shows response time and throughput metrics from multiple dashboards'
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({
    description: 'Test run ID to associate with this preset',
    example: '550e8400-e29b-41d4-a716-446655440000'
  })
  @IsString()
  @IsNotEmpty()
  testRunId!: string;

  @ApiProperty({
    description: 'Array of series configurations',
    type: [SeriesConfigDto],
    example: [
      {
        dashboardId: '550e8400-e29b-41d4-a716-446655440000',
        dashboardLabel: 'Load Testing',
        panelId: 5,
        panelTitle: 'Response Time',
        metricName: 'http_request_duration_seconds_p95',
        source: 'grafana',
        yAxisFormat: 'ms'
      }
    ]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeriesConfigDto)
  seriesConfig!: SeriesConfigDto[];

  @ApiPropertyOptional({
    description: 'Chart-level options stored with the preset. `axisMode` is persisted and read back on load; other keys are accepted and round-tripped untouched.',
    example: { axisMode: 'overlay' }
  })
  @IsOptional()
  chartOptions?: Record<string, unknown>;

  @ApiProperty({
    description: 'Whether this preset should be available to all users',
    example: false,
    default: false
  })
  @IsBoolean()
  @IsOptional()
  isGlobal?: boolean;
}
